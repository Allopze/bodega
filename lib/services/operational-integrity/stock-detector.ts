import { integrityFinding, type OperationalIntegrityFinding } from "./types"

interface StockRow { worksiteId: string; productId: string; quantity: number }
interface MovementRow extends StockRow {
  id: string
  type: string
  stockBefore: number
  stockAfter: number
  performedAt: string
}
/**
 * Los saldos viven en columnas `real` (float4), cuyo epsilon es relativo: a la
 * decena ya supera el 1e-6 absoluto que usaba esta comparación. Con saldos de
 * 39,76 el propio Postgres devuelve 39,719997 donde la aritmética exacta da
 * 39,72, y eso se reportaba como salto de cadena.
 *
 * La tolerancia escala con la magnitud, con piso de 1e-6 para saldos pequeños.
 * Sigue siendo mucho más fina que cualquier descuadre operacional real: sobre
 * un saldo de 200 admite 2e-4, y una diferencia así no existe en unidades de
 * bodega.
 */
const differs = (a: number, b: number) => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true
  const scale = Math.max(1, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) > 0.000001 * scale
}

/** Retirar EPP usado se audita sin mover saldo. */
const effectOf = (row: MovementRow) => (row.type === "retiro_epp_trabajador" ? 0 : row.quantity)

/**
 * Tramo que recorre un grupo de movimientos aplicados en el mismo instante.
 *
 * Una regularización masiva inserta todos sus ajustes con un `performedAt`
 * único, así que dentro del bloque no hay forma de recuperar el orden real de
 * aplicación: el id es aleatorio y desempatar por él inventa una secuencia.
 * Exigir esa secuencia reportaba saltos sobre un kardex sano — 28 movimientos
 * en producción, todos falsos positivos.
 *
 * Lo que sí es verificable sin conocer el orden: que el bloque encadene como
 * conjunto. Cada `after` debe ser el `before` de otro movimiento del bloque,
 * salvo uno; queda un `before` inicial y un `after` final sueltos, y el
 * recorrido entre ambos debe igualar la suma de efectos.
 *
 * Devuelve `null` cuando el bloque no encadena — ahí el salto es real.
 */
function blockSpan(rows: MovementRow[]): { start: number; end: number } | null {
  // La aritmética propia de cada movimiento se exige siempre: no depende del orden.
  if (rows.some(row => differs(row.stockAfter, row.stockBefore + effectOf(row)))) return null

  // Se empareja por índice y nunca consigo mismo: un movimiento de efecto nulo
  // (retirar EPP usado) tiene `before === after`, y auto-emparejarlo consumiría
  // su propia punta dejando el bloque sin extremos.
  const openBefores = rows.map((row, index) => ({ index, value: row.stockBefore }))
  const openAfters: number[] = []
  rows.forEach((row, index) => {
    const match = openBefores.findIndex(before => before.index !== index && !differs(before.value, row.stockAfter))
    if (match >= 0) openBefores.splice(match, 1)
    else openAfters.push(row.stockAfter)
  })
  // Un bloque encadenado deja exactamente una punta de cada lado. Cualquier
  // otra cosa —un hueco, un ciclo, un valor repetido de más— se reporta.
  if (openBefores.length !== 1 || openAfters.length !== 1) return null

  const start = openBefores[0]!.value
  const end = openAfters[0]!
  const total = rows.reduce((sum, row) => sum + effectOf(row), 0)
  return differs(end, start + total) ? null : { start, end }
}

const evidence = (row: MovementRow) => ({
  id: row.id, performedAt: row.performedAt, type: row.type,
  quantity: row.quantity, stockBefore: row.stockBefore, stockAfter: row.stockAfter,
})

export function detectStockIntegrity(input: { stocks: StockRow[]; movements: MovementRow[] }): OperationalIntegrityFinding[] {
  const groups = new Map<string, MovementRow[]>()
  const key = (row: StockRow) => JSON.stringify([row.worksiteId, row.productId])
  const stocks = new Map(input.stocks.map(row => [key(row), row]))
  for (const row of input.movements) {
    const rows = groups.get(key(row)) ?? []
    rows.push(row)
    groups.set(key(row), rows)
  }
  const findings: OperationalIntegrityFinding[] = []
  for (const [groupKey, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    rows.sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt) || a.id.localeCompare(b.id))
    const last = rows.at(-1)!
    const base = { domain: "stock" as const, worksiteId: last.worksiteId, entityType: "stock_item" as const, entityId: last.productId, href: `/bodega?vista=kardex&faena=${encodeURIComponent(last.worksiteId)}&producto=${encodeURIComponent(last.productId)}` }

    // Los movimientos del mismo instante se evalúan juntos; entre bloques sí
    // hay un orden temporal que el kardex debe respetar.
    const blocks: MovementRow[][] = []
    for (const row of rows) {
      const current = blocks.at(-1)
      if (current && current[0]!.performedAt === row.performedAt) current.push(row)
      else blocks.push([row])
    }

    const broken: Record<string, unknown>[] = []
    let previousEnd: number | null = null
    let previousId: string | null = null
    for (const block of blocks) {
      const span = blockSpan(block)
      if (!span) {
        broken.push({ reason: "block_does_not_chain", performedAt: block[0]!.performedAt, movements: block.map(evidence) })
        previousEnd = null
        previousId = block.at(-1)!.id
        continue
      }
      if (previousEnd !== null && differs(previousEnd, span.start)) {
        broken.push({ reason: "gap_with_previous", performedAt: block[0]!.performedAt, previousId, previousStockAfter: previousEnd, stockBefore: span.start, movements: block.map(evidence) })
      }
      previousEnd = span.end
      previousId = block.at(-1)!.id
    }

    if (broken.length) findings.push(integrityFinding({ ...base, code: "STOCK_MOVEMENT_CHAIN_BREAK", snapshot: { blocks: broken } }))

    const stock = stocks.get(groupKey)
    // applyMovementTx permits retiring used EPP without creating a stock row.
    const auditOnlyWithoutStock = !stock && rows.every(row => row.type === "retiro_epp_trabajador" && row.stockBefore === 0 && row.stockAfter === 0)
    /**
     * El saldo se compara contra el final del último bloque, no contra el
     * `stockAfter` de una fila elegida por un desempate arbitrario: con varios
     * movimientos en el mismo instante, ese `last` puede no ser el último.
     */
    const lastSpan = blockSpan(blocks.at(-1)!)
    const closing = lastSpan ? lastSpan.end : last.stockAfter
    if (!auditOnlyWithoutStock && (!stock || differs(closing, stock.quantity))) findings.push(integrityFinding({ ...base, code: "STOCK_BALANCE_MISMATCH", snapshot: { lastMovementId: last.id, stockAfter: closing, materializedQuantity: stock?.quantity ?? null } }))
  }
  return findings
}
