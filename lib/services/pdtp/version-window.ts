/**
 * lib/services/pdtp/version-window.ts
 *
 * PREV-C05-B (T6): la **ventana** de cada versión de un programa dentro de su
 * año. Una revisión v+1 activada a mitad de año no reemplaza el año entero:
 * reemplaza desde su semana de activación en adelante. Los meses anteriores
 * siguen siendo de la versión que estaba vigente cuando ocurrieron.
 *
 * - `from`: la semana de activación de la versión (se conserva completa, igual
 *   que `isPdtpPeriodOnOrAfterActivation`). `null` = programa sin huella de
 *   activación (importados antes de que existiera).
 * - `until`: la semana de activación de la versión que la reemplazó —el primer
 *   período que ya no es suyo—, o `null` si nadie la reemplazó.
 *
 * Ventanas contiguas y sin solape: la semana de activación de v2 es de v2 y
 * no de v1, así que una misma celda nunca pertenece a dos versiones.
 *
 * D24: una versión cerrada por reemplazo sigue admitiendo, **dentro de su
 * ventana**, registros tardíos, aprobaciones, desvíos y cierres de mes. Lo
 * que no admite nada es un año cerrado formalmente (`yearClosedAt`), un
 * programa archivado o uno que nunca estuvo vigente. Las obligaciones siguen
 * naciendo sólo en la versión `active` (`obligations.ts`).
 */

import { and, eq, isNotNull } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { pdtpPrograms } from "@/db/schema"
import { formatDate } from "@/lib/utils"
import { isPdtpPeriodOnOrAfterActivation, pdtpActivationPeriod, type PdtpPeriod } from "./period"

export type PdtpVersionRow = {
  id: string
  year: number
  version: number
  status: string
  activatedAt: string | null
}

export type PdtpVersionWindow = {
  programId: string
  year: number
  version: number
  status: string
  activatedAt: string | null
  from: PdtpPeriod | null
  until: PdtpPeriod | null
  successor: { programId: string; version: number; activatedAt: string } | null
}

/** Estados que forman parte de la cadena de versiones de un año. */
const CHAIN_STATUSES = new Set(["active", "closed", "archived"])

export function comparePdtpPeriods(left: PdtpPeriod, right: PdtpPeriod): number {
  return left.year - right.year || left.month - right.month || left.week - right.week
}

/**
 * La cadena de versiones que estuvieron vigentes en el año, en orden de
 * vigencia. Una versión sin `activatedAt` (importada) va primero.
 */
export function orderPdtpVersionChain<T extends PdtpVersionRow>(rows: readonly T[]): T[] {
  return rows
    // `active` y `closed` sólo existen tras una activación (o un cierre anual),
    // aunque un programa importado no tenga la huella; `archived` también
    // nace de revisiones que nunca se activaron, así que ahí se exige.
    .filter((row) => CHAIN_STATUSES.has(row.status) && (row.activatedAt !== null || row.status !== "archived"))
    .sort((left, right) => {
      const l = left.activatedAt ? Date.parse(left.activatedAt) : Number.NEGATIVE_INFINITY
      const r = right.activatedAt ? Date.parse(right.activatedAt) : Number.NEGATIVE_INFINITY
      return l - r || left.version - right.version
    })
}

/** Ventanas de todas las versiones de un mismo año (pura). */
export function resolvePdtpVersionWindows(rows: readonly PdtpVersionRow[]): Map<string, PdtpVersionWindow> {
  const windows = new Map<string, PdtpVersionWindow>()
  const byYear = new Map<number, PdtpVersionRow[]>()
  for (const row of rows) byYear.set(row.year, [...(byYear.get(row.year) ?? []), row])
  for (const yearRows of byYear.values()) {
    const chain = orderPdtpVersionChain(yearRows)
    chain.forEach((row, index) => {
      const next = chain[index + 1]
      const successor = next?.activatedAt ? { programId: next.id, version: next.version, activatedAt: next.activatedAt } : null
      windows.set(row.id, {
        programId: row.id,
        year: row.year,
        version: row.version,
        status: row.status,
        activatedAt: row.activatedAt,
        from: pdtpActivationPeriod(row.activatedAt),
        until: successor ? pdtpActivationPeriod(successor.activatedAt) : null,
        successor,
      })
    })
  }
  return windows
}

/** ¿El período cae dentro de la ventana? */
export function isPdtpPeriodInVersionWindow(period: PdtpPeriod, window: Pick<PdtpVersionWindow, "from" | "until">): boolean {
  if (window.from && comparePdtpPeriods(period, window.from) < 0) return false
  if (window.until && comparePdtpPeriods(period, window.until) >= 0) return false
  return true
}

/**
 * Recorta filas por período al **límite superior** de la ventana (el
 * inferior ya lo aplica el corte de activación por faena,
 * `filterPdtpRowsFromActivation`). Sin sucesora devuelve las filas tal cual.
 */
export function filterPdtpRowsBeforeSuccessor<T extends { year: number; month: number; week: number }>(
  rows: T[],
  until: PdtpPeriod | null | undefined,
): T[] {
  if (!until) return rows
  return rows.filter((row) => comparePdtpPeriods(row, until) < 0)
}

/** ¿Algún día del mes `month` del año de la ventana cae antes de su sucesora? */
export function isPdtpMonthBeforeSuccessor(year: number, month: number, until: PdtpPeriod | null | undefined): boolean {
  if (!until) return true
  return comparePdtpPeriods({ year, month, week: 1 }, until) < 0
}

/**
 * La versión dueña de un período, entre las de su año que pueden recibir
 * hechos. La primera versión es la línea de base: un período anterior a toda
 * activación también es suyo (hechos históricos del año, que el cómputo filtra
 * después por su corte de exigibilidad).
 */
export function resolvePdtpVersionOwningPeriod<T extends PdtpVersionRow>(rows: readonly T[], period: PdtpPeriod): T | null {
  const chain = orderPdtpVersionChain(rows.filter((row) => row.year === period.year))
  let owner: T | null = chain[0] ?? null
  for (const row of chain) {
    const from = pdtpActivationPeriod(row.activatedAt)
    if (!from || comparePdtpPeriods(from, period) <= 0) owner = row
  }
  return owner
}

/** "v2 (desde el 03-07-2026)" / "v1 (hasta el 02-07-2026)", para rótulos. */
export function describePdtpVersionWindow(window: Pick<PdtpVersionWindow, "version" | "activatedAt" | "successor">): string {
  const parts: string[] = []
  if (window.activatedAt) parts.push(`desde el ${formatDate(window.activatedAt)}`)
  if (window.successor) parts.push(`hasta la activación de v${window.successor.version} el ${formatDate(window.successor.activatedAt)}`)
  return parts.length > 0 ? `v${window.version} (${parts.join(", ")})` : `v${window.version}`
}

type Client = Tx | typeof db

async function loadYearVersions(client: Client, year: number): Promise<PdtpVersionRow[]> {
  return client.select({
    id: pdtpPrograms.id,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    status: pdtpPrograms.status,
    activatedAt: pdtpPrograms.activatedAt,
  }).from(pdtpPrograms).where(and(eq(pdtpPrograms.year, year), isNotNull(pdtpPrograms.status)))
}

/** La ventana de un programa, o `null` si no existe o nunca estuvo vigente. */
export async function loadPdtpVersionWindow(programId: string, client: Client = db): Promise<PdtpVersionWindow | null> {
  const [program] = await client.select({ year: pdtpPrograms.year }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  if (!program) return null
  return resolvePdtpVersionWindows(await loadYearVersions(client, program.year)).get(programId) ?? null
}

/** Las ventanas de todas las versiones de un año. */
export async function loadPdtpYearVersionWindows(year: number, client: Client = db): Promise<PdtpVersionWindow[]> {
  const windows = resolvePdtpVersionWindows(await loadYearVersions(client, year))
  return [...windows.values()].sort((left, right) => {
    if (!left.from) return -1
    if (!right.from) return 1
    return comparePdtpPeriods(left.from, right.from)
  })
}

export type PdtpProgramAcceptsPeriodOptions = {
  /** Texto cuando el programa no está vigente ni cerrado por reemplazo. */
  notAcceptingMessage?: string
  /** Texto cuando el período es anterior a la activación. */
  beforeActivationMessage?: string
  /**
   * Toma la fila del programa `FOR SHARE` (sólo con una transacción). En serie
   * con la activación de la sucesora —que cierra esta fila— y con el cierre
   * anual —que la toma `FOR UPDATE`—: sin el lock, una escritura podía leer la
   * versión vigente, perder la carrera y quedar fuera de su ventana.
   */
  lock?: boolean
}

export type PdtpProgramForPeriod = {
  id: string
  year: number
  version: number
  status: string
  activatedAt: string | null
  yearClosedAt: string | null
  window: PdtpVersionWindow | null
}

/**
 * Lanza si el programa no admite escrituras sobre `period`. Es la regla única
 * de D24 para ejecuciones, aprobaciones, desvíos y cierres de mes. Devuelve el
 * programa (con su ventana) para que el llamador no lo vuelva a leer.
 *
 * - `active`: el año del programa y desde su activación (regla de siempre).
 * - `closed` por reemplazo: sólo dentro de su ventana. Un período posterior es
 *   de la sucesora, y el mensaje lo dice.
 * - Año cerrado formalmente, archivado, borrador, revisión o rechazado: nada.
 */
export async function assertPdtpProgramAcceptsPeriod(
  programId: string,
  period: PdtpPeriod,
  client: Client = db,
  options: PdtpProgramAcceptsPeriodOptions = {},
): Promise<PdtpProgramForPeriod> {
  const query = client.select({
    id: pdtpPrograms.id,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    status: pdtpPrograms.status,
    activatedAt: pdtpPrograms.activatedAt,
    yearClosedAt: pdtpPrograms.yearClosedAt,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1)
  const [program] = options.lock ? await query.for("share") : await query
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.yearClosedAt) {
    throw new Error(`El año ${program.year} está cerrado formalmente: no admite registros, aprobaciones, desvíos ni cierres.`)
  }
  if (program.year !== period.year) {
    throw new Error(`El período debe corresponder al año del programa (${program.year}).`)
  }
  const beforeActivation = options.beforeActivationMessage
    ?? "El programa aún no estaba activo en el período seleccionado. Registra actividades desde su semana de activación."
  if (program.status === "active") {
    if (!isPdtpPeriodOnOrAfterActivation(period, program.activatedAt)) throw new Error(beforeActivation)
    return { ...program, window: null }
  }
  if (program.status === "closed") {
    const window = await loadPdtpVersionWindow(program.id, client)
    if (!window?.successor) {
      throw new Error(options.notAcceptingMessage ?? `La versión v${program.version} está cerrada y no admite registros.`)
    }
    if (window.from && comparePdtpPeriods(period, window.from) < 0) throw new Error(beforeActivation)
    if (window.until && comparePdtpPeriods(period, window.until) >= 0) {
      throw new Error(
        `Ese período ya es de la versión v${window.successor.version}, vigente desde el ${formatDate(window.successor.activatedAt)}. `
        + `La versión v${program.version} sólo admite registros, aprobaciones, desvíos y cierres de sus propias semanas.`,
      )
    }
    return { ...program, window }
  }
  throw new Error(options.notAcceptingMessage ?? `El programa no admite registros en estado ${program.status}.`)
}

/**
 * La variante de `assertPdtpProgramAcceptsPeriod` para **revisar** lo ya
 * registrado (aprobar o rechazar una ejecución). Es más permisiva a propósito:
 * no exige la semana de activación —la línea de base del año recibe hechos
 * históricos por integración y hay que poder revisarlos— ni un estado
 * vigente. Sólo frena lo que D24 excluye: un año cerrado formalmente, y una
 * celda que ya es de la versión sucesora (su revisión corresponde allá).
 */
export async function assertPdtpProgramAcceptsReview(
  programId: string,
  period: PdtpPeriod,
  client: Client = db,
): Promise<void> {
  const [program] = await client.select({
    id: pdtpPrograms.id,
    year: pdtpPrograms.year,
    version: pdtpPrograms.version,
    status: pdtpPrograms.status,
    yearClosedAt: pdtpPrograms.yearClosedAt,
  }).from(pdtpPrograms).where(eq(pdtpPrograms.id, programId)).limit(1).for("share")
  if (!program) throw new Error("Programa PDTP no encontrado.")
  if (program.yearClosedAt) {
    throw new Error(`El año ${program.year} está cerrado formalmente: no admite registros, aprobaciones, desvíos ni cierres.`)
  }
  if (program.status !== "closed") return
  const window = await loadPdtpVersionWindow(program.id, client)
  if (window?.successor && window.until && comparePdtpPeriods(period, window.until) >= 0) {
    throw new Error(
      `Ese período ya es de la versión v${window.successor.version}, vigente desde el ${formatDate(window.successor.activatedAt)}. `
      + `La versión v${program.version} sólo admite registros, aprobaciones, desvíos y cierres de sus propias semanas.`,
    )
  }
}
