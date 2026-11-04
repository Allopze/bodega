/**
 * Saldo de un producto en una faena a lo largo del tiempo (CHART-035b de
 * `AUDITORIA_VISUALIZACIONES_CHOME.md`): la línea escalonada del saldo y las
 * barras de lo que entró y salió, sobre el kardex.
 *
 * Módulo **puro**: la consulta trae los movimientos de la ventana y aquí se
 * arma la serie. Reglas que no son obvias:
 *
 * - **El efecto, no el tipo.** Entra lo que sube el saldo (`stockAfter -
 *   stockBefore > 0`) y sale lo que lo baja. `egreso_desecho` se guarda con
 *   signo negativo, `egreso_entrega` depende del flujo y `retiro_epp_trabajador`
 *   no mueve saldo: sólo el efecto es verdad en los tres.
 * - **El saldo se arrastra.** Se parte del saldo anterior al primer movimiento
 *   de la ventana y se suma el efecto de cada día. Sumar (y no leer `stockAfter`
 *   del último movimiento) es lo que sobrevive a una regularización masiva, que
 *   inserta decenas de ajustes en el mismo instante y no tiene orden verificable.
 * - **Día civil de Chile.** Un movimiento de las 23:30 chilenas ya es del día
 *   siguiente en UTC; medido en UTC caería en la barra equivocada.
 * - **Tres escalas.** Hasta 92 días, un punto por día; hasta 400, por semana
 *   (lunes a domingo); más allá, por mes. Más barras que píxeles no se leen.
 */
import { formatDate, formatQty, todayInChile } from "@/lib/utils"

export interface BalanceMovement {
  /** Instante ISO del movimiento. */
  performedAt: string
  stockBefore: number
  stockAfter: number
}

export type BalanceGranularity = "day" | "week" | "month"

export interface BalanceBucket {
  /** Inicio del tramo, «YYYY-MM-DD» (el día, el lunes o el día 1 del mes). */
  start: string
  /** Rótulo del eje: «5 nov», «Sem. 2 nov», «nov 2026». */
  label: string
  ingress: number
  egress: number
  /** Saldo al cierre del tramo. */
  balance: number
  movements: number
  /** El tramo contiene hoy y todavía no termina (sólo por semana y por mes). */
  partial: boolean
}

export interface BalanceSeries {
  granularity: BalanceGranularity
  from: string
  to: string
  opening: number
  closing: number
  ingress: number
  egress: number
  movements: number
  buckets: BalanceBucket[]
}

const DAY_MS = 86_400_000
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const

const plainToMs = (plain: string): number => Date.parse(`${plain}T00:00:00Z`)
const msToPlain = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const dayAndMonth = (plain: string) => `${Number(plain.slice(8, 10))} ${MONTHS[Number(plain.slice(5, 7)) - 1] ?? ""}`

/** Lunes de la semana de una fecha «YYYY-MM-DD». */
function mondayOf(plain: string): string {
  const ms = plainToMs(plain)
  return msToPlain(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS)
}

export function chooseGranularity(spanDays: number): BalanceGranularity {
  if (spanDays <= 92) return "day"
  if (spanDays <= 400) return "week"
  return "month"
}

function bucketStart(plain: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return plain
  if (granularity === "week") return mondayOf(plain)
  return `${plain.slice(0, 7)}-01`
}

function nextBucketStart(start: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return msToPlain(plainToMs(start) + DAY_MS)
  if (granularity === "week") return msToPlain(plainToMs(start) + 7 * DAY_MS)
  const year = Number(start.slice(0, 4))
  const month = Number(start.slice(5, 7))
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`
}

function bucketLabel(start: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return dayAndMonth(start)
  if (granularity === "week") return `Sem. ${dayAndMonth(start)}`
  return `${MONTHS[Number(start.slice(5, 7)) - 1] ?? ""} ${start.slice(0, 4)}`
}

/**
 * Arma la serie de la ventana `[from, to]` (días civiles de Chile). `null` cuando
 * la ventana no tiene ningún movimiento: sin saldo anterior conocido no hay línea
 * que dibujar, y el gráfico explica el vacío.
 */
export function shapeBalanceSeries(
  movements: readonly BalanceMovement[],
  options: { from: string; to: string; today?: string },
): BalanceSeries | null {
  const { from, to } = options
  if (!PLAIN_DATE.test(from) || !PLAIN_DATE.test(to) || from > to) return null
  const today = options.today ?? todayInChile()

  const inWindow = movements
    .map((movement, index) => ({ movement, index, day: todayInChile(movement.performedAt) }))
    .filter(({ day }) => day >= from && day <= to)
    // Estable: los movimientos de un mismo instante conservan el orden recibido.
    .sort((a, b) => a.movement.performedAt.localeCompare(b.movement.performedAt) || a.index - b.index)
  if (inWindow.length === 0) return null

  const spanDays = Math.round((plainToMs(to) - plainToMs(from)) / DAY_MS) + 1
  const granularity = chooseGranularity(spanDays)
  const opening = inWindow[0]!.movement.stockBefore

  const byStart = new Map<string, { ingress: number; egress: number; movements: number }>()
  let ingress = 0
  let egress = 0
  for (const { movement, day } of inWindow) {
    const start = bucketStart(day, granularity)
    const bucket = byStart.get(start) ?? { ingress: 0, egress: 0, movements: 0 }
    const effect = movement.stockAfter - movement.stockBefore
    if (effect > 0) { bucket.ingress += effect; ingress += effect }
    else if (effect < 0) { bucket.egress += -effect; egress += -effect }
    bucket.movements += 1
    byStart.set(start, bucket)
  }

  const todayBucket = bucketStart(today, granularity)
  const buckets: BalanceBucket[] = []
  let balance = opening
  const last = bucketStart(to, granularity)
  for (let start = bucketStart(from, granularity); start <= last; start = nextBucketStart(start, granularity)) {
    const found = byStart.get(start)
    balance += (found?.ingress ?? 0) - (found?.egress ?? 0)
    buckets.push({
      start,
      label: bucketLabel(start, granularity),
      ingress: found?.ingress ?? 0,
      egress: found?.egress ?? 0,
      balance,
      movements: found?.movements ?? 0,
      partial: granularity !== "day" && start === todayBucket,
    })
  }

  return { granularity, from, to, opening, closing: balance, ingress, egress, movements: inWindow.length, buckets }
}

/**
 * La respuesta del gráfico: de dónde a dónde fue el saldo y cuánto entró y salió.
 * Con el mismo saldo al empezar y al terminar no dice que «pasó» de uno a otro.
 */
export function balanceSummary(
  series: BalanceSeries,
  context: { productName: string; worksiteName: string; unit: string },
): string {
  const { unit } = context
  const lead = `Saldo de «${context.productName}» en ${context.worksiteName}:`
  const span = `entre el ${formatDate(series.from)} y el ${formatDate(series.to)}`
  const movement = series.opening === series.closing
    ? `terminó en el mismo saldo que al empezar (${formatQty(series.closing, unit)}) ${span}.`
    : `pasó de ${formatQty(series.opening)} a ${formatQty(series.closing, unit)} ${span}.`
  return `${lead} ${movement} Ingresaron ${formatQty(series.ingress, unit)} y salieron ${formatQty(series.egress, unit)}.`
}

/** Nombre completo del tramo (con año): «03-11-2026», «Semana del 02-11-2026», «nov 2026». */
export function balancePeriodLabel(granularity: BalanceGranularity, bucket: Pick<BalanceBucket, "start" | "label">): string {
  if (granularity === "day") return formatDate(bucket.start)
  if (granularity === "week") return `Semana del ${formatDate(bucket.start)}`
  return bucket.label
}

/** Alternativa en datos («Ver datos»): sólo los tramos con movimientos, con el saldo al cierre. */
export function balanceTable(series: BalanceSeries): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Período", "Ingresos", "Egresos", "Saldo al cierre"],
    rows: series.buckets
      .filter((bucket) => bucket.movements > 0)
      .map((bucket) => [
        balancePeriodLabel(series.granularity, bucket),
        formatQty(bucket.ingress),
        formatQty(bucket.egress),
        formatQty(bucket.balance),
      ]),
  }
}

/** Nota bajo el gráfico cuando las barras no son por día. */
export function balanceGranularityNote(series: BalanceSeries): string | null {
  if (series.granularity === "day") return null
  const unit = series.granularity === "week" ? "una semana (de lunes a domingo)" : "un mes"
  const current = series.buckets.some((bucket) => bucket.partial)
  return `Cada barra es ${unit}${current ? "; la última sigue en curso" : ""}.`
}
