export type CopecCoverageStatus = "unknown" | "incomplete" | "failed" | "complete" | "legitimate_empty" | "closed_with_issues"
export type CopecCoverageChannel = "TCT" | "TAE"
export type CopecCoverageProduct = "diesel" | "bluemax"

export interface ProviderCoverageRow {
  provider: string
  sourceAccount: string
  channel: string
  product: string
  periodMonth: string
  status: string
}

/**
 * Estado terminal de la decisión E6: el mes se cierra con evidencia aunque el
 * informe del proveedor trajera filas inválidas. No es `complete` —hubo filas
 * que no se pudieron usar— ni `incomplete` —eso dejaría el mes bloqueado para
 * siempre y el barrido no avanzaría (hallazgo 4.1)—.
 *
 * Las filas válidas SÍ se proyectan (ver `importCopecPeriod`); lo que este
 * estado certifica es que una persona revisó las inválidas y decidió cerrar el
 * mes con ese motivo escrito y su nombre.
 */
export const CLOSED_WITH_ISSUES: CopecCoverageStatus = "closed_with_issues"

/**
 * Marca que lleva la evidencia cuando el esquema todavía no admite
 * `closed_with_issues` como valor propio (la migración la aporta el carril E).
 * Sin ella, el cierre se guardaba como `complete` y la pantalla perdía el
 * motivo; con ella el estado se reconstruye igual y el mes sigue siendo
 * terminal. Cuando la migración exista, el valor se guarda tal cual y esta
 * marca deja de escribirse.
 */
export const CLOSED_WITH_ISSUES_MARKER = "[cerrado con observaciones]"

const TERMINAL_STATUSES = new Set<CopecCoverageStatus>(["complete", "legitimate_empty", CLOSED_WITH_ISSUES])
const CHANNELS: readonly CopecCoverageChannel[] = ["TCT", "TAE"]
const PRODUCTS: readonly CopecCoverageProduct[] = ["diesel", "bluemax"]

function firstOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`
}

function nextMonth(value: string): string {
  const date = new Date(`${firstOfMonth(value)}T00:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

/**
 * Returns the earliest month that is not terminal for any Copec channel and
 * product. Missing rows are unknown by definition; legacy cursors are never
 * used as evidence that a source dimension was complete.
 */
export function findNextCopecCoverageMonth(
  rows: ProviderCoverageRow[],
  from: string,
  to: string,
): string | null {
  const first = firstOfMonth(from)
  const last = firstOfMonth(to)
  const covered = new Map(rows.map((row) => [`${row.provider}|${row.sourceAccount}|${row.channel}|${row.product}|${row.periodMonth}`, row.status]))

  for (let month = first; month <= last; month = nextMonth(month)) {
    for (const channel of CHANNELS) {
      for (const product of PRODUCTS) {
        const account = `${channel.toLowerCase()}:${product}`
        const status = covered.get(`copec|${account}|${channel}|${product}|${month}`)
        if (!status || !TERMINAL_STATUSES.has(status as CopecCoverageStatus)) return month
      }
    }
  }
  return null
}

/**
 * Whether an operator may close this channel/product month as legitimately
 * empty. Besides "no observation yet", it accepts a file Copec delivered with
 * no rows and no errors: the sync records it as `failed` because an empty file
 * alone is not evidence, so without this the month had no way to close.
 * A file with rejected rows, or pending/incomplete data, still cannot be
 * declared empty.
 */
export function canConfirmCopecEmpty(row: { status: string; sourceAvailability: string; rowsReceived: number } | undefined): boolean {
  if (!row || row.status === "unknown") return true
  return row.status === "failed" && row.sourceAvailability === "available" && row.rowsReceived === 0
}

export function isTerminalCopecCoverage(status: string): status is "complete" | "legitimate_empty" | "closed_with_issues" {
  return TERMINAL_STATUSES.has(status as CopecCoverageStatus)
}

/**
 * Estado que hay que MOSTRAR para una fila de cobertura. Reconoce el valor
 * propio y, mientras el esquema no lo admita, la marca de evidencia con que se
 * guardó el cierre (ver `CLOSED_WITH_ISSUES_MARKER`).
 */
export function copecCoverageStatusOf(row: { status: string; evidence?: string | null }): CopecCoverageStatus {
  if (row.status === CLOSED_WITH_ISSUES) return CLOSED_WITH_ISSUES
  if (row.status === "complete" && row.evidence?.trimStart().startsWith(CLOSED_WITH_ISSUES_MARKER)) return CLOSED_WITH_ISSUES
  return row.status as CopecCoverageStatus
}

/**
 * Si una persona puede cerrar este canal/producto/mes como «cerrado con
 * observaciones» (E6).
 *
 * Se exige lo que la decisión aprobada pide y nada más:
 * - el mes ya terminó (un mes abierto puede recibir más filas);
 * - queda trabajo de mapeo pendiente: no. Con `rowsPending > 0` el mes tendría
 *   litros sin atribuir y cerrarlo los escondería;
 * - Copec SÍ entregó un archivo con filas: un mes sin datos no se «cierra con
 *   observaciones», se cierra como vacío (`canConfirmCopecEmpty`) o queda en
 *   falla.
 * El motivo y el operador los exige `recordCopecPeriodCoverage`.
 */
export function canCloseCopecPeriodWithIssues(
  row: { status: string; sourceAvailability: string; rowsReceived: number; rowsPending: number } | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!row) return { ok: false, reason: "No hay ninguna observación de cobertura para ese canal y producto" }
  if (isTerminalCopecCoverage(row.status)) return { ok: false, reason: "Ese canal y producto ya tiene la cobertura cerrada" }
  if (row.sourceAvailability !== "available") return { ok: false, reason: "Copec no entregó el informe: el mes no se puede cerrar con observaciones, sino resolver la descarga" }
  if (row.rowsReceived === 0) return { ok: false, reason: "El informe no trajo filas: usa «confirmar vacío» o vuelve a sincronizar" }
  if (row.rowsPending > 0) return { ok: false, reason: "Quedan filas sin asignar a un equipo o faena: resuélvelas antes de cerrar el mes" }
  return { ok: true }
}

/** Las cuatro cuentas de la integración (`tct:diesel`, `tct:bluemax`, `tae:diesel`, `tae:bluemax`). */
export const COPEC_COVERAGE_ACCOUNTS: readonly string[] = CHANNELS.flatMap((channel) =>
  PRODUCTS.map((product) => `${channel.toLowerCase()}:${product}`),
)

/**
 * Un mes está **cerrado** cuando las cuatro cuentas tienen cobertura terminal
 * (`complete` o `legitimate_empty`). Es la misma vara con que «Fuentes» decide
 * si un mes cerrado del período está completo.
 */
export function isCopecMonthClosed(rows: ReadonlyArray<{ sourceAccount: string; status: string }>): boolean {
  return COPEC_COVERAGE_ACCOUNTS.every((account) =>
    rows.some((row) => row.sourceAccount === account && isTerminalCopecCoverage(row.status)),
  )
}

/**
 * Meses de una serie mensual (`YYYY-MM`) sobre los que el libro del proveedor no
 * puede decir «no se compró combustible».
 *
 * Una serie de gasto que pinta $0 donde la integración no trajo nada (septiembre
 * de 2026 en producción: ninguna transacción ni fila de cobertura; C-4) se lee
 * como una compra que no ocurrió. Un mes tiene respaldo para mostrar su cifra,
 * cero incluido, cuando:
 * - trae filas aceptadas (la cobertura las cuenta en `rowsAccepted`, o la propia
 *   consulta de la serie ya las vio en `monthsWithRows`) — aunque la cobertura
 *   siga `incomplete`: la cifra es parcial, pero no un cero inventado; o
 * - la cobertura lo cierra (cuatro cuentas terminales): un mes vacío certificado.
 *
 * Todo lo demás —sin fila de cobertura, o `unknown`/`failed`/`incomplete` sin
 * filas— es un hueco.
 */
export function monthsWithoutProviderData(
  monthKeys: readonly string[],
  coverage: ReadonlyArray<{ sourceAccount: string; periodMonth: string; status: string; rowsAccepted: number }>,
  monthsWithRows: ReadonlySet<string> = new Set(),
): Set<string> {
  const gaps = new Set<string>()
  for (const month of monthKeys) {
    if (monthsWithRows.has(month)) continue
    const rows = coverage.filter((row) => row.periodMonth === `${month}-01`)
    if (rows.some((row) => row.rowsAccepted > 0)) continue
    if (isCopecMonthClosed(rows)) continue
    gaps.add(month)
  }
  return gaps
}
