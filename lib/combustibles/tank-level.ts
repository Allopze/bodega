/**
 * Nivel de cada estanque a lo largo del período (CHART-020, P-5): la línea
 * escalonada del nivel y, aparte, lo que entró y lo que salió.
 *
 * Módulo **puro**: la consulta (`getFuelStorageDailyFlows`, en `fuel-cycle.ts`) trae
 * lo que entró y salió de cada estanque por día civil chileno y aquí se arma la
 * serie. Reglas que no son obvias:
 *
 * - **Misma definición que la tabla de abajo.** Nivel = «Al inicio» (todo lo anterior
 *   al primer día del período) + entradas − salidas, con las entradas y salidas que
 *   `getFuelStorageBalances` ya cuenta (recepciones y traspasos recibidos; entregas
 *   desde el estanque, traspasos enviados y lo que la PWA repartió desde su punto de
 *   carga). El último punto de la línea es, por construcción, el «Nivel» de la tabla.
 * - **El nivel se arrastra.** Se parte de la apertura y se suma el efecto de cada día:
 *   un estanque sin movimientos en un tramo mantiene su nivel, no vuelve a cero.
 * - **Lo que falta del período no se dibuja como una caída.** Un período en curso llega
 *   hasta hoy; los tramos posteriores quedan sin nivel (`null`), no en cero ni planos.
 *   Un movimiento fechado después de hoy se respeta: el último día observado es el
 *   mayor entre hoy y el último movimiento, para que el cierre cuadre con la tabla.
 * - **Tres escalas** (las mismas que el saldo de Bodega): hasta 92 días un punto por día,
 *   hasta 400 por semana (lunes a domingo) y más allá por mes. Más barras que píxeles no
 *   se leen.
 * - **Un estanque sin movimientos no se dibuja:** su nivel es una cifra, no una curva. Se
 *   lista aparte (`idle`) para que su ausencia se explique y no parezca un olvido.
 */
import { balancePeriodLabel, chooseGranularity, type BalanceGranularity } from "@/lib/bodega/balance-series"
import { addDaysToPlainDate, formatQty, todayInChile } from "@/lib/utils"

/** Lo que entró y salió de un estanque un día civil chileno (salida de `getFuelStorageDailyFlows`). */
export interface TankDailyFlow {
  storageLocationId: string
  /** Día civil de Chile, «YYYY-MM-DD». */
  day: string
  inLiters: number
  outLiters: number
}

/** De un balance de estanque (`FuelStorageBalance`), lo que la serie necesita. */
export interface TankLevelInput {
  storageLocationId: string
  name: string
  capacityLiters: number | null
  /** El nivel antes del primer día del período: la columna «Al inicio» de la tabla. */
  openingLiters: number
}

export interface TankLevelBucket {
  /** Inicio del tramo, «YYYY-MM-DD» (el día, el lunes o el día 1 del mes). */
  start: string
  /** Rótulo del eje: «5 nov», «Sem. 2 nov», «nov 2026». */
  label: string
  /** Nombre completo del tramo, para el tooltip y «Ver datos». */
  title: string
  inLiters: number
  outLiters: number
  /** Nivel al cierre del tramo (hasta hoy si sigue en curso). `null` si todavía no empieza. */
  level: number | null
  /** El tramo todavía no empieza: no hay nivel que dibujar. */
  future: boolean
  /** Por semana o por mes: el tramo contiene el último día observado y termina después. */
  partial: boolean
}

export interface TankLevelSeries {
  storageLocationId: string
  name: string
  capacityLiters: number | null
  openingLiters: number
  /** Nivel al último día observado. Es el «Nivel» de la tabla del estanque. */
  closingLiters: number
  inLiters: number
  outLiters: number
  buckets: TankLevelBucket[]
}

export interface TankLevelView {
  granularity: BalanceGranularity
  from: string
  to: string
  /** Último día con dato: hoy, el último movimiento o el fin del período, el menor de los dos extremos. `null` si el período no empieza. */
  observedUntil: string | null
  /** El período sigue en curso: lo que falta no se dibuja. */
  partial: boolean
  /** Todo el período es futuro: no hay nada que mostrar todavía. */
  notStarted: boolean
  /** Los estanques con movimientos en el período: los que tienen curva. */
  tanks: TankLevelSeries[]
  /** Los que no se movieron: su nivel es el de apertura. */
  idle: Array<{ storageLocationId: string; name: string; levelLiters: number }>
}

const DAY_MS = 86_400_000
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const

const plainToMs = (plain: string): number => Date.parse(`${plain}T00:00:00Z`)
const msToPlain = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
/** «5 nov». */
const dayAndMonth = (plain: string): string => `${Number(plain.slice(8, 10))} ${MONTHS[Number(plain.slice(5, 7)) - 1] ?? ""}`

function mondayOf(plain: string): string {
  const ms = plainToMs(plain)
  return msToPlain(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS)
}

function bucketStart(plain: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return plain
  if (granularity === "week") return mondayOf(plain)
  return `${plain.slice(0, 7)}-01`
}

function nextBucketStart(start: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return addDaysToPlainDate(start, 1)
  if (granularity === "week") return addDaysToPlainDate(start, 7)
  const year = Number(start.slice(0, 4))
  const month = Number(start.slice(5, 7))
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`
}

function bucketLabel(start: string, granularity: BalanceGranularity): string {
  if (granularity === "day") return dayAndMonth(start)
  if (granularity === "week") return `Sem. ${dayAndMonth(start)}`
  return `${MONTHS[Number(start.slice(5, 7)) - 1] ?? ""} ${start.slice(0, 4)}`
}

const minPlain = (a: string, b: string) => (a < b ? a : b)
const maxPlain = (a: string, b: string) => (a > b ? a : b)

/** Litros enteros, para la prosa: «12.400 L». */
const liters = (value: number): string => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`
/** Litros con un decimal como mucho, igual que la tabla del estanque, para «Ver datos». */
const litersExact = (value: number): string => formatQty(value, undefined, { maximumFractionDigits: 1 })

const EMPTY_VIEW = (from: string, to: string): TankLevelView => ({
  granularity: "day", from, to, observedUntil: null, partial: false, notStarted: true, tanks: [], idle: [],
})

/**
 * Arma la serie de cada estanque sobre `[from, to]` (días civiles de Chile).
 *
 * `flows` son los movimientos por día de los estanques de `tanks` (la consulta ya los
 * acotó al alcance de la sesión); lo que caiga fuera de la ventana o de un estanque
 * desconocido no se cuenta.
 */
export function buildTankLevelView(
  tanks: readonly TankLevelInput[],
  flows: readonly TankDailyFlow[],
  options: { from: string; to: string; today?: string },
): TankLevelView {
  const from = options.from.slice(0, 10)
  const to = options.to.slice(0, 10)
  if (!PLAIN_DATE.test(from) || !PLAIN_DATE.test(to) || from > to) return EMPTY_VIEW(from, to)
  const today = options.today ?? todayInChile()

  const known = new Set(tanks.map((tank) => tank.storageLocationId))
  const byTank = new Map<string, Map<string, { inLiters: number; outLiters: number }>>()
  let latestFlowDay = ""
  for (const flow of flows) {
    if (!known.has(flow.storageLocationId) || flow.day < from || flow.day > to) continue
    const days = byTank.get(flow.storageLocationId) ?? new Map<string, { inLiters: number; outLiters: number }>()
    const day = days.get(flow.day) ?? { inLiters: 0, outLiters: 0 }
    day.inLiters += flow.inLiters
    day.outLiters += flow.outLiters
    days.set(flow.day, day)
    byTank.set(flow.storageLocationId, days)
    if (flow.day > latestFlowDay) latestFlowDay = flow.day
  }

  // El último día con dato: hoy, o un movimiento fechado después de hoy; nunca más allá del período.
  const observedUntil = minPlain(to, latestFlowDay ? maxPlain(today, latestFlowDay) : today)
  if (observedUntil < from) return { ...EMPTY_VIEW(from, to), granularity: chooseGranularity(spanDays(from, to)) }

  const granularity = chooseGranularity(spanDays(from, to))
  const starts: string[] = []
  for (let start = bucketStart(from, granularity); start <= bucketStart(to, granularity); start = nextBucketStart(start, granularity)) starts.push(start)

  const moving: TankLevelSeries[] = []
  const idle: TankLevelView["idle"] = []
  for (const tank of tanks) {
    const days = byTank.get(tank.storageLocationId)
    let level = tank.openingLiters
    let totalIn = 0
    let totalOut = 0
    const buckets: TankLevelBucket[] = []
    for (const start of starts) {
      const label = bucketLabel(start, granularity)
      const title = balancePeriodLabel(granularity, { start, label })
      const first = maxPlain(start, from)
      const last = minPlain(addDaysToPlainDate(nextBucketStart(start, granularity), -1), to)
      if (first > observedUntil) {
        buckets.push({ start, label, title, inLiters: 0, outLiters: 0, level: null, future: true, partial: false })
        continue
      }
      let inLiters = 0
      let outLiters = 0
      const through = minPlain(last, observedUntil)
      for (let day = first; day <= through; day = addDaysToPlainDate(day, 1)) {
        const flow = days?.get(day)
        if (!flow) continue
        inLiters += flow.inLiters
        outLiters += flow.outLiters
      }
      level += inLiters - outLiters
      totalIn += inLiters
      totalOut += outLiters
      buckets.push({ start, label, title, inLiters, outLiters, level, future: false, partial: granularity !== "day" && last > observedUntil })
    }
    if (totalIn + totalOut === 0) {
      idle.push({ storageLocationId: tank.storageLocationId, name: tank.name, levelLiters: tank.openingLiters })
      continue
    }
    moving.push({
      storageLocationId: tank.storageLocationId,
      name: tank.name,
      capacityLiters: tank.capacityLiters,
      openingLiters: tank.openingLiters,
      closingLiters: level,
      inLiters: totalIn,
      outLiters: totalOut,
      buckets,
    })
  }

  return { granularity, from, to, observedUntil, partial: observedUntil < to, notStarted: false, tanks: moving, idle }
}

function spanDays(from: string, to: string): number {
  return Math.round((plainToMs(to) - plainToMs(from)) / DAY_MS) + 1
}

/** «el 14 oct», «la semana del 26 oct», «en nov 2026»: cuándo ocurrió el mínimo, según la escala. */
function whenText(granularity: BalanceGranularity, bucket: Pick<TankLevelBucket, "start" | "label">): string {
  if (granularity === "day") return `el ${dayAndMonth(bucket.start)}`
  if (granularity === "week") return `la semana del ${dayAndMonth(bucket.start)}`
  return `en ${bucket.label}`
}

/**
 * La respuesta del gráfico en una frase: cómo terminó el estanque (o cuántos se movieron) y
 * cuál fue el nivel más bajo, que es lo que dice cuándo había que pedir. Verdadera también
 * con un período en curso (lo dice) y con estanques quietos (no los cuenta como movidos).
 * `null` sin ningún estanque con movimientos: el gráfico explica el vacío.
 */
export function summarizeTankLevels(view: TankLevelView, options: { periodPhrase: string }): string | null {
  const { tanks, idle } = view
  const [only] = tanks
  if (!only) return null
  const phrase = options.periodPhrase

  const lead = tanks.length === 1
    ? only.openingLiters === only.closingLiters
      ? `«${only.name}» terminó con el mismo nivel con que empezó (${liters(only.closingLiters)}) ${phrase}.`
      : `El nivel de «${only.name}» pasó de ${liters(only.openingLiters)} a ${liters(only.closingLiters)} ${phrase}.`
    : `${tanks.length} de ${tanks.length + idle.length} estanques tuvieron movimientos ${phrase}.`

  let lowest: { name: string; bucket: TankLevelBucket; level: number } | null = null
  for (const tank of tanks) {
    for (const bucket of tank.buckets) {
      // Con empate gana el primero: un nivel que se queda plano días sin movimientos «fue el más bajo»
      // desde que llegó ahí, no desde el último día del período.
      if (bucket.level !== null && (!lowest || bucket.level < lowest.level)) lowest = { name: tank.name, bucket, level: bucket.level }
    }
  }
  const low = lowest
    ? ` El nivel más bajo fue ${liters(lowest.level)}${tanks.length > 1 ? ` en «${lowest.name}»` : ""} (${whenText(view.granularity, lowest.bucket)})${lowest.level < 0 ? ": negativo, hay más salidas que entradas registradas" : ""}.`
    : ""
  const partial = view.partial && view.observedUntil
    ? ` El período sigue en curso: el dibujo llega hasta el ${dayAndMonth(view.observedUntil)}.`
    : ""
  return `${lead}${low}${partial}`
}

/** Los estanques que no se movieron, en una línea: su nivel es el de apertura. `null` si no hay. */
export function idleTanksNote(view: TankLevelView, periodPhrase: string): string | null {
  if (view.idle.length === 0) return null
  const list = view.idle.map((tank) => `«${tank.name}» (${liters(tank.levelLiters)})`).join(", ")
  return `Sin movimientos ${periodPhrase}, su nivel no cambió: ${list}.`
}

/** Pie del dibujo cuando las barras no son por día. `null` por día. */
export function tankLevelGranularityNote(view: TankLevelView): string | null {
  if (view.granularity === "day") return null
  const unit = view.granularity === "week" ? "una semana (de lunes a domingo)" : "un mes"
  return `Cada barra es ${unit}${view.tanks.some((tank) => tank.buckets.some((bucket) => bucket.partial)) ? "; la última sigue en curso" : ""}.`
}

/**
 * «Ver datos»: lo mismo que el dibujo en una tabla. Por estanque, el nivel al inicio, cada
 * tramo con movimientos (lo que entró, lo que salió y el nivel con que cerró) y el total.
 * Los tramos sin movimientos no tienen fila: el nivel sigue siendo el de la fila anterior.
 */
export function tankLevelTable(view: TankLevelView): { headers: string[]; rows: string[][] } {
  const total = view.partial ? "Total hasta hoy" : "Total del período"
  return {
    headers: ["Estanque", "Período", "Entradas (L)", "Salidas (L)", "Nivel al cierre (L)"],
    rows: view.tanks.flatMap((tank) => [
      [tank.name, "Al inicio del período", "—", "—", litersExact(tank.openingLiters)],
      ...tank.buckets
        .filter((bucket) => !bucket.future && bucket.inLiters + bucket.outLiters > 0)
        .map((bucket) => [
          tank.name,
          `${bucket.title}${bucket.partial ? " (en curso)" : ""}`,
          litersExact(bucket.inLiters),
          litersExact(bucket.outLiters),
          litersExact(bucket.level ?? tank.closingLiters),
        ]),
      [tank.name, total, litersExact(tank.inLiters), litersExact(tank.outLiters), litersExact(tank.closingLiters)],
    ]),
  }
}
