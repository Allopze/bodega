import { chileDateParts } from "@/lib/utils"

export type PdtpPeriod = {
  year: number
  month: number
  week: number
}

/**
 * `not_performed` no es "sin ejecución": es "sin ejecución **con un motivo
 * declarado**" (un desvío `not_performed` activo en el mes, ver
 * `deviations.ts`). El planificado sigue en pie y la actividad sigue contando
 * en cero para el indicador; lo que cambia es que la faena ya explicó por qué,
 * así que no se la sigue tratando como deuda silenciosa.
 */
export type PdtpActivityStatus = "pending" | "executed" | "overdue" | "not_scheduled" | "not_performed"

/**
 * Filtro de estado del visor de actividades: los cuatro estados reales de
 * `PdtpActivityStatus` más `"en_cero"`, un filtro compuesto (no un estado
 * nuevo) que corresponde exactamente a lo que
 * `PdtpComplianceMonth.zeroActivityIds` cuenta en `compliance.ts` — ver
 * `isPdtpActivityZeroThisMonth` más abajo.
 */
export type PdtpActivityStatusFilter = PdtpActivityStatus | "en_cero"

type PdtpPeriodRow = {
  year: number
  month: number
  week: number
}

/**
 * Compute the current PDTP period (year, month, week).
 * Week is calculated as: day 1-7 → week 1, day 8-14 → week 2, day 15-21 → week 3, day 22-31 → week 4
 * This matches how pdtpActivitySchedule and pdtpExecutions bucket planned/executed activities.
 */
export function currentPdtpPeriod(now: Date = new Date()): PdtpPeriod {
  // Hora de Chile, no la del proceso: en producción corre en UTC y el período
  // saltaba de mes (y de año) 3–4 horas antes que la faena.
  const { year, month, day } = chileDateParts(now)
  const week = Math.min(4, Math.ceil(day / 7))

  return { year, month, week }
}

/**
 * ¿La celda es posterior a la semana en curso? Es el validador de celda que
 * comparten el "no realizado", el "no aplica" y —desde PRV-03 (auditoría
 * 2026-09-28)— el registro y la aprobación de ejecuciones: sobre una semana que
 * todavía no ocurre no hay hecho que declarar.
 */
export function isPdtpCellInFuture(
  cell: { year: number; month: number; week: number },
  current: PdtpPeriod = currentPdtpPeriod(),
): boolean {
  return cell.year > current.year
    || (cell.year === current.year && cell.month > current.month)
    || (cell.year === current.year && cell.month === current.month && cell.week > current.week)
}

export function assertPdtpCellNotInFuture(cell: { year: number; month: number; week: number }, message: string): void {
  if (isPdtpCellInFuture(cell)) throw new Error(message)
}

/**
 * El período contra el que se lee un programa de `year`: hoy si es el año en
 * curso; diciembre, semana 4 si ya terminó —el año que está en cierre se mide
 * completo, no contra el enero del calendario—; su primera semana si todavía
 * no empieza.
 */
export function pdtpReferencePeriodForYear(year: number, today: PdtpPeriod = currentPdtpPeriod()): PdtpPeriod {
  if (year < today.year) return { year, month: 12, week: 4 }
  if (year > today.year) return { year, month: 1, week: 1 }
  return today
}

export type PdtpOperationalYears = {
  /** El año que el tablero y las pantallas muestran por omisión. */
  primary: number
  /**
   * El año anterior, cuando sigue activo sin cierre anual mientras el nuevo ya
   * opera: "cierre pendiente de <año>" (D23). `null` si no hay nada que cerrar
   * o si el año anterior ES el operativo (el nuevo todavía no se activa).
   */
  closing: number | null
}

/**
 * PREV-C03.7: qué año muestra la plataforma por omisión en torno al cambio de
 * año. El 1 de enero el año civil cambia, pero el programa nuevo puede no estar
 * activo todavía y el anterior sigue recibiendo el cierre de diciembre: mostrar
 * el año civil dejaba el tablero vacío (o con un borrador en cero) y hacía
 * desaparecer el resultado del año que se está cerrando.
 *
 * - Año civil con programa activo → ese año; y si el anterior sigue activo sin
 *   cierre anual, queda como `closing`.
 * - Año civil sin programa activo, pero el anterior activo → el anterior.
 * - En cualquier otro caso → el año civil.
 *
 * Pura: recibe los programas (año, estado, cierre anual) y el año civil en
 * Chile. La variante con base es `getPdtpOperationalYears` (lifecycle.ts).
 */
export function resolvePdtpOperationalYears(
  programs: ReadonlyArray<{ year: number; status: string; yearClosedAt?: string | null }>,
  calendarYear: number,
): PdtpOperationalYears {
  const isOpenActive = (year: number) => programs.some((program) => program.year === year && program.status === "active" && !program.yearClosedAt)
  const currentActive = isOpenActive(calendarYear)
  const previousOpen = isOpenActive(calendarYear - 1)
  if (currentActive) return { primary: calendarYear, closing: previousOpen ? calendarYear - 1 : null }
  if (previousOpen) return { primary: calendarYear - 1, closing: null }
  return { primary: calendarYear, closing: null }
}

/**
 * El PDTP se vuelve exigible cuando se activa la versión ya aprobada. Como el
 * calendario firmado solo tiene granularidad mes/semana, la semana de
 * activación se conserva completa: todavía puede ejecutarse durante ese mismo
 * bloque; únicamente salen las celdas de semanas anteriores.
 *
 * `activatedAt = null` conserva el comportamiento histórico de programas
 * importados que ya estaban activos antes de que se registrara esta huella.
 */
export function isPdtpPeriodOnOrAfterActivation(
  period: PdtpPeriodRow,
  activatedAt: string | null | undefined,
): boolean {
  const activationPeriod = pdtpActivationPeriod(activatedAt)
  if (!activationPeriod) return true
  return isPdtpPeriodOnOrAfterActivationPeriod(period, activationPeriod)
}

/**
 * La misma regla, ya resuelta a período.
 *
 * Se separa para que la pantalla pueda aplicarla sin recibir el `activatedAt`
 * crudo: el checklist del programa la usa para distinguir una casilla que
 * nadie hizo de una que el programa todavía no exigía. Reusarla evita tener
 * dos versiones de "antes de la activación", que es la clase de duplicación
 * que se desincroniza sin que ningún test lo note.
 */
export function isPdtpPeriodOnOrAfterActivationPeriod(
  period: PdtpPeriodRow,
  activationPeriod: PdtpPeriod,
): boolean {
  if (period.year !== activationPeriod.year) return period.year > activationPeriod.year
  if (period.month !== activationPeriod.month) return period.month > activationPeriod.month
  return period.week >= activationPeriod.week
}

export function pdtpActivationPeriod(activatedAt: string | null | undefined): PdtpPeriod | null {
  if (!activatedAt) return null
  const activationDate = new Date(activatedAt)
  return Number.isNaN(activationDate.getTime()) ? null : currentPdtpPeriod(activationDate)
}

/**
 * Desde cuándo el programa le exige algo a UNA faena.
 *
 * Son dos hechos independientes y hacen falta los dos: que el programa se
 * active y que la faena esté incorporada a él. Hasta que ocurre el segundo, el
 * programa está vigente pero no sobre esta faena. Por eso gana el más tardío.
 *
 * Una faena incorporada en octubre arrastraba las casillas de marzo y las
 * contaba como incumplimiento, porque el único corte que existía era el del
 * programa —uno solo, global— y ninguna de las quince llamadas a
 * `filterPdtpRowsFromActivation` sabía de qué faena estaba hablando.
 *
 * Sin `worksiteAddedAt` devuelve el corte del programa, que es el
 * comportamiento anterior: cada sitio se puede migrar por separado.
 */
export function effectiveActivationFor(
  programActivatedAt: string | null | undefined,
  worksiteAddedAt: string | null | undefined,
): string | null | undefined {
  if (!worksiteAddedAt) return programActivatedAt
  if (!programActivatedAt) return worksiteAddedAt
  /* Por instante y no por texto: Postgres devuelve `2026-03-01 12:00:00+00` y
   * `toISOString()` devuelve `2026-03-01T12:00:00.000Z`. Comparados como
   * cadenas, el espacio (0x20) siempre pierde contra la T (0x54), así que la
   * fecha de la faena nunca ganaría si vino de la base. */
  const added = new Date(worksiteAddedAt).getTime()
  const activated = new Date(programActivatedAt).getTime()
  if (Number.isNaN(added)) return programActivatedAt
  if (Number.isNaN(activated)) return worksiteAddedAt
  return added > activated ? worksiteAddedAt : programActivatedAt
}

/** Excluye del cómputo las obligaciones anteriores a la activación. */
export function filterPdtpRowsFromActivation<T extends PdtpPeriodRow>(
  rows: T[],
  activatedAt: string | null | undefined,
): T[] {
  return activatedAt
    ? rows.filter((row) => isPdtpPeriodOnOrAfterActivation(row, activatedAt))
    : rows
}

/**
 * Hasta qué mes (1–12, inclusive) del programa `programYear` hay deuda
 * **vencida**: un mes vence cuando terminó, tanto para el período que se está
 * mirando como para hoy. `0` = nada vencido todavía.
 *
 * - Año en curso: los meses anteriores al menor entre el mes mirado y el de
 *   hoy. Mirar septiembre en mayo no vuelve vencidos junio y julio.
 * - Año ya terminado: los meses anteriores al mirado, salvo que se mire
 *   diciembre —que es como `pdtpReferencePeriodForYear` lee un año en cierre—:
 *   entonces diciembre también terminó y vencen los 12.
 * - Año que no empieza: nada.
 *
 * PREV-C06: sin este corte el estado sólo miraba el mes en curso, y una
 * trimestral no hecha en marzo se leía en mayo como "No programada".
 */
export function pdtpOverdueCutoffMonth(programYear: number, period: PdtpPeriod, today: PdtpPeriod = period): number {
  const todayCut = programYear < today.year ? 12 : programYear > today.year ? 0 : today.month - 1
  const periodCut = period.year > programYear
    ? 12
    : period.year < programYear
      ? 0
      : programYear < today.year && period.month === 12 ? 12 : period.month - 1
  return Math.max(0, Math.min(todayCut, periodCut))
}

/**
 * Datos opcionales del estado de una actividad. Todos son por mes (índice
 * 0 = enero).
 *
 * - `monthlyNotPerformed`: desvíos `not_performed` activos. Lo arma
 *   `sheets.ts` desde la costura única.
 * - `monthlySubmitted`: cantidad enviada y aún sin revisar (D9: "un envío paga
 *   el mes"). Un mes con un envío pendiente no es deuda muda: el responsable
 *   ya respondió y lo que falta es la revisión.
 * - `programYear` y `today`: alimentan `pdtpOverdueCutoffMonth`. Sin ellos el
 *   año es el del período y hoy es el propio período, que es el
 *   comportamiento previo (vencen los meses anteriores al mirado) y mantiene
 *   la función pura.
 */
export type PdtpActivityStatusOptions = {
  monthlyNotPerformed?: number[]
  monthlySubmitted?: number[]
  programYear?: number
  today?: PdtpPeriod
}

/** Un mes con un "no realizada" declarado ya está explicado: no es deuda muda. */
function hasDeclaredNotPerformed(options: PdtpActivityStatusOptions | undefined, monthIndex: number): boolean {
  return (options?.monthlyNotPerformed?.[monthIndex] ?? 0) > 0
}

function overdueCutoff(period: PdtpPeriod, options: PdtpActivityStatusOptions | undefined): number {
  return pdtpOverdueCutoffMonth(options?.programYear ?? period.year, period, options?.today ?? period)
}

/**
 * Un mes vencido es deuda cuando tenía plan, no tiene ejecución, no tiene un
 * envío esperando revisión (D9) y nadie declaró por qué no se hizo.
 */
function isUnpaidMonth(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  monthIndex: number,
  options: PdtpActivityStatusOptions | undefined,
): boolean {
  const planned = monthlyPlanned[monthIndex] ?? 0
  const executed = monthlyExecuted[monthIndex] ?? 0
  const submitted = options?.monthlySubmitted?.[monthIndex] ?? 0
  return planned > 0 && executed === 0 && submitted === 0 && !hasDeclaredNotPerformed(options, monthIndex)
}

/**
 * Derive the status of a single activity for a given period.
 *
 * PREV-C06: la deuda vencida se evalúa **primero**. Si algún mes ya vencido
 * (`pdtpOverdueCutoffMonth`) quedó impago, la actividad está `overdue` sin
 * importar qué pase en el mes en curso: ni "no programada este mes" ni una
 * ejecución de este mes esconden un mes anterior en cero.
 *
 * Sin deuda vencida, manda el mes en curso:
 * - 'not_scheduled': nada planificado este mes;
 * - 'executed': algo ejecutado este mes;
 * - 'not_performed': sin ejecutar, con un desvío "no realizada" que declara
 *   el motivo;
 * - 'pending': planificado este mes y sin ejecutar.
 *
 * Un mes vencido con un `not_performed` declarado, o con un envío pendiente
 * de aprobación (D9), no produce `overdue`: la deuda está explicada o espera
 * revisión. Lo que no cambia es el indicador: `compliance.ts` sigue contando
 * esa celda en cero hasta que se apruebe.
 */
export function deriveActivityStatus(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
  options?: PdtpActivityStatusOptions,
): PdtpActivityStatus {
  if (countOverdueMonths(monthlyPlanned, monthlyExecuted, period, options) > 0) return "overdue"

  const currentMonthPlanned = monthlyPlanned[period.month - 1] ?? 0
  const currentMonthExecuted = monthlyExecuted[period.month - 1] ?? 0
  if (currentMonthPlanned === 0) return "not_scheduled"
  if (currentMonthExecuted > 0) return "executed"
  if (hasDeclaredNotPerformed(options, period.month - 1)) return "not_performed"
  return "pending"
}

/**
 * Cuántos meses vencidos quedaron impagos (misma regla que
 * `deriveActivityStatus`). Alimenta el badge "Atrasado · 2 meses".
 */
export function countOverdueMonths(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
  options?: PdtpActivityStatusOptions,
): number {
  const cutoff = overdueCutoff(period, options)
  let count = 0
  for (let i = 0; i < cutoff; i++) {
    if (isUnpaidMonth(monthlyPlanned, monthlyExecuted, i, options)) count++
  }
  return count
}

/**
 * Primer mes vencido e impago (1–12), o `null`. El formulario "Registrar" de
 * una actividad atrasada abre ahí: la deuda más antigua es la que se salda
 * primero.
 */
export function pdtpFirstOverdueMonth(
  monthlyPlanned: number[],
  monthlyExecuted: number[],
  period: PdtpPeriod,
  options?: PdtpActivityStatusOptions,
): number | null {
  const cutoff = overdueCutoff(period, options)
  for (let i = 0; i < cutoff; i++) {
    if (isUnpaidMonth(monthlyPlanned, monthlyExecuted, i, options)) return i + 1
  }
  return null
}

/**
 * Orden de gravedad para agregar estados entre faenas: atrasada, no
 * realizada, pendiente, ejecutada, no programada.
 */
const PDTP_STATUS_SEVERITY: Record<PdtpActivityStatus, number> = {
  overdue: 4,
  not_performed: 3,
  pending: 2,
  executed: 1,
  not_scheduled: 0,
}

/**
 * Estado de una actividad sobre varias faenas: el **peor caso** (D9). Sumar
 * primero plan y ejecución entre faenas y derivar después dejaba que la
 * ejecución de una faena tapara el mes en cero de otra.
 */
export function aggregatePdtpActivityStatus(statuses: readonly PdtpActivityStatus[]): PdtpActivityStatus {
  let worst: PdtpActivityStatus = "not_scheduled"
  for (const status of statuses) {
    if (PDTP_STATUS_SEVERITY[status] > PDTP_STATUS_SEVERITY[worst]) worst = status
  }
  return worst
}

/**
 * "En cero" en el mes de `period`: la actividad tenía planificación ese mes
 * y ninguna ejecución **aprobada**. Es exactamente el criterio de
 * `PdtpComplianceMonth.zeroActivityIds` en `compliance.ts` (rama "resto" del
 * bucle mensual: `p > 0 && rawExecuted === 0`, y `rawExecuted` ahí solo suma
 * `approvedExecutionRows`), llevado al visor de actividades para que el
 * enlace del indicador muestre lo mismo que cuenta.
 *
 * Es un criterio **del mes**, no de la actividad: desde PREV-C06 una
 * actividad con deuda anterior es `overdue` aunque este mes esté ejecutado,
 * así que este filtro ya no se deriva de `deriveActivityStatus` —lo haría
 * contar actividades que el indicador no cuenta—.
 *
 * `coverage` y `closed_on_time` quedan excluidos, igual que en
 * `compliance.ts`: tienen su propia regla todo-o-nada y un cero ahí significa
 * "no se acreditó el padrón/plazo", no "no se hizo nada".
 *
 * `approvedMonthlyExecuted` **debe** venir filtrado a solo `status ===
 * "approved"`: una ejecución enviada y aún sin aprobar sigue siendo "en cero"
 * para el indicador (ronda 2/5, tarea 1.4).
 *
 * Tampoco mira los desvíos "no realizada": declaran el motivo pero no tocan
 * el planificado, así que la actividad sigue en cero para `compliance.ts`.
 */
export function isPdtpActivityZeroThisMonth(
  activity: { indicatorMode?: string | null },
  monthlyPlanned: number[],
  approvedMonthlyExecuted: number[],
  period: PdtpPeriod,
): boolean {
  if (activity.indicatorMode === "coverage" || activity.indicatorMode === "closed_on_time") return false
  const planned = monthlyPlanned[period.month - 1] ?? 0
  const executed = approvedMonthlyExecuted[period.month - 1] ?? 0
  return planned > 0 && executed === 0
}

/**
 * Período PDTP de un día chileno ya resuelto (`AAAA-MM-DD`, p. ej.
 * `todayInChile()`), o `null` si no es una fecha. Existe para que un
 * componente cliente mida el atraso contra el "hoy" que calculó el servidor,
 * sin volver a preguntarle al reloj del navegador.
 */
export function pdtpPeriodFromChileDate(value: string | null | undefined): PdtpPeriod | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  if (!match) return null
  const [, year, month, day] = match
  return { year: Number(year), month: Number(month), week: Math.min(4, Math.ceil(Number(day) / 7)) }
}

/** Lo mínimo de una fila de planilla (`PdtpSheetView`) para derivar su estado. */
export type PdtpStatusSource = {
  effectiveMonthlyPlanned: number[]
  effectiveMonthlyExecuted: number[]
  monthlyNotPerformed?: number[]
  /** Vista por faena: lo enviado y sin revisar (D9). */
  pendingMonthlyExecuted?: number[]
  /** Vista agregada: el estado ya resuelto en cada faena. */
  worksiteSummaries?: ReadonlyArray<{ status: PdtpActivityStatus; overdueMonths?: number }>
}

export type PdtpSheetActivityStatus = {
  status: PdtpActivityStatus
  overdueMonths: number
  /** Primer mes vencido e impago; sólo en la vista por faena. */
  firstOverdueMonth: number | null
}

/**
 * La única regla de estado de una fila de la planilla. La usan la tabla
 * (conteos, filtro y badge: `statusOf` en `pdtp-sheet-table.tsx`) y el KPI
 * "Atrasadas" del tablero, para que el número del tile y el largo de la lista
 * a la que enlaza no puedan divergir.
 *
 * - Vista agregada (trae `worksiteSummaries` con al menos una faena): el peor
 *   caso de las faenas (`aggregatePdtpActivityStatus`).
 * - Vista por faena: `deriveActivityStatus` sobre los arreglos efectivos,
 *   con lo enviado como mes pagado (D9).
 */
export function pdtpSheetActivityStatus(
  activity: PdtpStatusSource,
  period: PdtpPeriod,
  context: { programYear: number; today: PdtpPeriod },
): PdtpSheetActivityStatus {
  const summaries = activity.worksiteSummaries
  if (summaries && summaries.length > 0) {
    return {
      status: aggregatePdtpActivityStatus(summaries.map((summary) => summary.status)),
      overdueMonths: Math.max(0, ...summaries.map((summary) => summary.overdueMonths ?? 0)),
      firstOverdueMonth: null,
    }
  }
  const options: PdtpActivityStatusOptions = {
    monthlyNotPerformed: activity.monthlyNotPerformed,
    monthlySubmitted: activity.pendingMonthlyExecuted,
    programYear: context.programYear,
    today: context.today,
  }
  return {
    status: deriveActivityStatus(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, period, options),
    overdueMonths: countOverdueMonths(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, period, options),
    firstOverdueMonth: pdtpFirstOverdueMonth(activity.effectiveMonthlyPlanned, activity.effectiveMonthlyExecuted, period, options),
  }
}
