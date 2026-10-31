import type { Session } from "next-auth"
import { asc, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelMandanteWorksites, fuelMandantes, worksites } from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { formatQty, todayInChile } from "@/lib/utils"
import { controlFiltersForRange, wholeMonthRange } from "./field-filters"
import { getReconciliationFlowsByMandante, type ReconciliationFlow } from "./reconciliation"

/**
 * Cuadratura de todos los mandantes activos del alcance en el período (Panel,
 * paso 3, y Cuadratura › Por mandante). Contrato de la Fase 0, completado por la
 * línea L5 sobre `getReconciliationFlowsByMandante`.
 *
 * La cuadratura se mide **por mes completo**: las entradas del proveedor y los
 * totales de la tarjeta llegan por mes. Con un período que no es de meses
 * completos (una semana, un rango) las cifras son las de los meses completos que
 * ese período toca y `wholeMonths` viene en `false`, para que quien la pinte lo
 * diga («Por mes») en vez de presentarlas como las de la semana.
 */
export interface MandanteMonthSummary {
  /** «YYYY-MM». */
  month: string
  inLiters: number
  directLiters: number
  viaTankLiters: number
  deliveredLiters: number
  differenceLiters: number
  /** `null` cuando no entró nada (base cero). */
  differencePct: number | null
  /** `null` cuando no hubo movimiento que medir. */
  overTolerance: boolean | null
}

export interface MandanteReconciliationSummary {
  mandanteId: string
  name: string
  worksiteNames: string[]
  tolerancePct: number
  inLiters: number
  directLiters: number
  viaTankLiters: number
  differenceLiters: number
  /** `null` cuando no entró nada (base cero). */
  differencePct: number | null
  /** `null` cuando no hubo movimiento que medir (ni entradas ni entregas). */
  overTolerance: boolean | null
  /** Directo + vía estanque. */
  deliveredLiters?: number
  /** `false`: el período no es de meses completos y las cifras son las de `monthKeys`. */
  wholeMonths?: boolean
  /** Los meses «YYYY-MM» que cubren las cifras. */
  monthKeys?: string[]
  /** Mes a mes, con cada mes contra la tolerancia. Incluye los meses sin movimiento hasta hoy. */
  months?: MandanteMonthSummary[]
  /** Meses del período que quedaron fuera de tolerancia (aunque el total cuadre). */
  monthsOverTolerance?: string[]
}

/** Lo que usan las pantallas de Cuadratura: el resumen con todos los campos resueltos. */
export interface MandanteReconciliationDetail extends MandanteReconciliationSummary {
  worksiteIds: string[]
  deliveredLiters: number
  wholeMonths: boolean
  monthKeys: string[]
  months: MandanteMonthSummary[]
  monthsOverTolerance: string[]
  /** Litros de puntos sin tipo definido que se cuentan como directos (supuesto S-3). */
  assumedDirectLiters: number
  /** Hubo entradas o entregas en el período. */
  hasMovement: boolean
}

export interface MandantesReconciliation {
  wholeMonths: boolean
  monthKeys: string[]
  /** Los días que se midieron: los del período si son meses completos; si no, los de sus meses completos. */
  range: { from: string; to: string }
  rows: MandanteReconciliationDetail[]
}

export interface MandantesReconciliationOptions {
  /** Una faena: sólo los mandantes que la tienen, y sólo sus movimientos. */
  worksiteId?: string
  /** Un mandante. */
  mandanteId?: string
  /** «Hoy» (YYYY-MM-DD), para no rellenar meses futuros; en pruebas. */
  today?: string
}

const emptyMonth = (month: string): MandanteMonthSummary => ({
  month, inLiters: 0, directLiters: 0, viaTankLiters: 0, deliveredLiters: 0, differenceLiters: 0, differencePct: null, overTolerance: null,
})

export async function getMandantesReconciliation(
  session: Session,
  period: ResolvedFuelPeriod,
  options: MandantesReconciliationOptions = {},
): Promise<MandantesReconciliation> {
  const range = wholeMonthRange(period)
  const today = options.today ?? todayInChile()
  const scope = resolveWorksiteScope(session)

  const mw = fuelMandanteWorksites
  const rows = await db.select({
    mandanteId: fuelMandantes.id,
    name: fuelMandantes.name,
    tolerancePct: fuelMandantes.tolerancePct,
    worksiteId: worksites.id,
    worksiteName: worksites.name,
  }).from(fuelMandantes)
    .leftJoin(mw, eq(mw.mandanteId, fuelMandantes.id))
    .leftJoin(worksites, eq(worksites.id, mw.worksiteId))
    .where(eq(fuelMandantes.isActive, true))
    .orderBy(asc(fuelMandantes.name), asc(worksites.name))

  // Un mandante agrupa faenas: se muestran sólo las del alcance de quien mira.
  // Un rol global ve también los mandantes que aún no tienen faenas (para poder
  // decirlo); uno acotado, sólo los que tocan alguna de las suyas.
  const inScope = (worksiteId: string) => scope.mode === "all" || (scope.mode === "some" && scope.ids.includes(worksiteId))
  const mandantes = new Map<string, { name: string; tolerancePct: number; worksites: Array<{ id: string; name: string }> }>()
  for (const row of rows) {
    let entry = mandantes.get(row.mandanteId)
    if (!entry) { entry = { name: row.name, tolerancePct: row.tolerancePct, worksites: [] }; mandantes.set(row.mandanteId, entry) }
    if (row.worksiteId && row.worksiteName && inScope(row.worksiteId)) entry.worksites.push({ id: row.worksiteId, name: row.worksiteName })
  }
  const visible = [...mandantes.entries()].filter(([id, entry]) => {
    if (options.mandanteId && id !== options.mandanteId) return false
    if (options.worksiteId) return entry.worksites.some((site) => site.id === options.worksiteId)
    return scope.mode === "all" || entry.worksites.length > 0
  })

  const tolerances = new Map(visible.map(([id, entry]) => [id, entry.tolerancePct]))
  const flows = visible.length === 0
    ? new Map<string, ReconciliationFlow>()
    : await getReconciliationFlowsByMandante(session, controlFiltersForRange(range, { worksiteId: options.worksiteId }), tolerances)

  const details = visible.map(([mandanteId, entry]): MandanteReconciliationDetail => {
    const flow = flows.get(mandanteId)
    const totals = flow?.totals
    const byMonth = new Map((flow?.months ?? []).map((month) => [month.month, month]))
    // Los meses sin movimiento hasta hoy también cuentan: un mes en blanco entre dos con datos es información.
    const months = period.monthKeys.filter((key) => byMonth.has(key) || key <= today.slice(0, 7)).map((key): MandanteMonthSummary => {
      const month = byMonth.get(key)
      return month
        ? { month: key, inLiters: month.inputLiters, directLiters: month.directLiters, viaTankLiters: month.viaTankLiters, deliveredLiters: month.deliveredLiters, differenceLiters: month.differenceLiters, differencePct: month.differencePct, overTolerance: month.overTolerance }
        : emptyMonth(key)
    })
    const inLiters = totals?.inputLiters ?? 0
    const deliveredLiters = totals?.deliveredLiters ?? 0
    return {
      mandanteId,
      name: entry.name,
      worksiteNames: entry.worksites.map((site) => site.name),
      worksiteIds: entry.worksites.map((site) => site.id),
      tolerancePct: entry.tolerancePct,
      inLiters,
      directLiters: totals?.directLiters ?? 0,
      viaTankLiters: totals?.viaTankLiters ?? 0,
      deliveredLiters,
      differenceLiters: totals?.differenceLiters ?? 0,
      differencePct: totals?.differencePct ?? null,
      overTolerance: totals?.overTolerance ?? null,
      wholeMonths: period.isWholeMonths,
      monthKeys: period.monthKeys,
      months,
      monthsOverTolerance: months.filter((month) => month.overTolerance).map((month) => month.month),
      assumedDirectLiters: flow?.assumedDirectLiters ?? 0,
      hasMovement: inLiters > 0 || deliveredLiters > 0,
    }
  })

  // Lo que no cuadra primero y, dentro de cada grupo, la mayor diferencia en litros.
  details.sort((left, right) =>
    Number(right.overTolerance === true) - Number(left.overTolerance === true)
    || Math.abs(right.differenceLiters) - Math.abs(left.differenceLiters)
    || left.name.localeCompare(right.name, "es-CL"))

  return { wholeMonths: period.isWholeMonths, monthKeys: period.monthKeys, range, rows: details }
}

/**
 * Un resumen por mandante activo del alcance, con lo que no cuadra primero y,
 * dentro de cada grupo, la mayor diferencia absoluta en litros. Cada fila lleva
 * `wholeMonths`: en `false` el período no es de meses completos (el Panel
 * muestra «Por mes»).
 */
export async function getMandantesReconciliationSummary(
  session: Session,
  period: ResolvedFuelPeriod,
  options: MandantesReconciliationOptions = {},
): Promise<MandanteReconciliationSummary[]> {
  return (await getMandantesReconciliation(session, period, options)).rows
}

/* ---------- Estado en palabras ---------- */

export type ReconciliationTone = "ok" | "over" | "idle"

export interface ReconciliationVerdict {
  tone: ReconciliationTone
  /** Corto, para una insignia: «Cuadra», «Fuera de tolerancia», «Sin movimiento». */
  label: string
  /** Una frase con las cifras: «Faltan 1.320 L (3,1 %), sobre su tolerancia de 2 %». */
  sentence: string
}

type VerdictInput = Pick<MandanteReconciliationSummary, "inLiters" | "directLiters" | "viaTankLiters" | "differenceLiters" | "differencePct" | "tolerancePct" | "overTolerance">

const liters = (value: number) => `${formatQty(Math.abs(value), undefined, { maximumFractionDigits: 0 })} L`
const pct = (value: number) => `${formatQty(Math.abs(value), undefined, { maximumFractionDigits: 1 })} %`

/**
 * El estado de un mandante en palabras. La diferencia es entrada − entregado:
 * positiva, a la entrada le «faltan» litros por entregar; negativa, se entregó
 * más de lo que entró.
 */
export function reconciliationVerdict(row: VerdictInput): ReconciliationVerdict {
  const delivered = row.directLiters + row.viaTankLiters
  const tolerance = pct(row.tolerancePct)
  if (row.overTolerance === null) {
    return { tone: "idle", label: "Sin movimiento", sentence: "No hay entradas ni entregas en este período." }
  }
  if (!row.overTolerance) {
    return {
      tone: "ok",
      label: "Cuadra",
      sentence: row.differenceLiters === 0 || row.differencePct === null
        ? "Cuadra: lo que entró coincide con lo entregado."
        : `Cuadra: la diferencia es de ${liters(row.differenceLiters)} (${pct(row.differencePct)}), dentro de su tolerancia de ${tolerance}.`,
    }
  }
  if (row.inLiters <= 0) {
    return { tone: "over", label: "Fuera de tolerancia", sentence: `Se entregaron ${liters(delivered)} y no hay ninguna entrada registrada en el período.` }
  }
  const detail = row.differencePct === null ? liters(row.differenceLiters) : `${liters(row.differenceLiters)} (${pct(row.differencePct)})`
  return {
    tone: "over",
    label: "Fuera de tolerancia",
    sentence: row.differenceLiters > 0
      ? `Faltan ${detail}, sobre su tolerancia de ${tolerance}.`
      : `Se entregaron ${detail} más de lo que entró, sobre su tolerancia de ${tolerance}.`,
  }
}
