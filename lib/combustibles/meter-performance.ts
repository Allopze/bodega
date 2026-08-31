/**
 * Rendimiento calculado desde la serie de lecturas del medidor.
 *
 * El proveedor ya entrega un km/L por transacción, pero lo calcula contra la
 * lectura anterior sin validarla: cuando el operario pierde un dígito al tipear
 * en el surtidor (720.325 anotado como 72.000) el delta sale negativo y Copec
 * responde 0. Sobre datos reales eso deja 48 de 265 cargas sin rendimiento, y el
 * promedio ponderado del mes las omite en silencio.
 *
 * Acá el tramo malo no se descarta: se PUENTEA. Si la lectura N no es creíble,
 * el ancla se queda en N-1 y sus litros se acumulan hasta la primera lectura que
 * sí cierre un tramo plausible, que es la cifra correcta — el combustible se
 * consumió igual, sólo que repartido en dos cargas.
 */

/**
 * Techo de rendimiento plausible en km/L.
 *
 * En el histórico real de Aramco 48 de 154 transacciones dan valores absurdos
 * (hasta 785 km/L) porque la lectura previa viene desfasada. Un rendimiento
 * inventado envenena los tableros y el detector de anomalías, así que sobre este
 * techo el tramo no se acepta.
 */
export const DEFAULT_MAX_KM_PER_LITER = 25

export interface MeterObservation {
  /** Instante de la carga, ISO 8601. La serie se ordena por acá. */
  occurredAt: string
  /** Lectura del medidor. `null` cuando la transacción no la trae. */
  value: number | null
  /** Litros cargados en esta transacción. */
  liters: number
  /** km/L que declara el proveedor; se usa como respaldo, ver abajo. */
  providerPerformance?: number | null
}

export interface MeterPerformanceSummary {
  /** Promedio ponderado por litros. 0 cuando no hubo ningún tramo utilizable. */
  average: number
  /** Litros cubiertos por un tramo con rendimiento calculado o respaldado. */
  litersMeasured: number
  /** Litros que ningún tramo pudo cubrir. */
  litersUnmeasured: number
  /** Tramos cerrados contra la lectura anterior inmediata. */
  segments: number
  /** Tramos que tuvieron que saltarse una o más lecturas no creíbles. */
  bridged: number
  /** Veces que la lectura no creíble resultó ser el ancla, no la siguiente. */
  reanchored: number
  /** Litros cuyo rendimiento salió del dato del proveedor y no del medidor. */
  litersFromProvider: number
}

function isPlausible(performance: number, max: number): boolean {
  return Number.isFinite(performance) && performance > 0 && performance <= max
}

/**
 * Resume la serie de un equipo. Las observaciones se ordenan por `occurredAt`;
 * el llamador no necesita entregarlas ordenadas.
 *
 * La primera lectura de la ventana no tiene contra qué compararse — su tramo
 * empezó antes del archivo — así que para esos litros se acepta el km/L del
 * proveedor cuando cae dentro de la banda. Es el único caso donde el dato del
 * proveedor manda: ahí sabe algo que nosotros no (la carga del mes anterior).
 */
export function summarizeMeterPerformance(
  observations: MeterObservation[],
  options: { maxPerformance?: number } = {},
): MeterPerformanceSummary {
  const max = options.maxPerformance ?? DEFAULT_MAX_KM_PER_LITER
  const series = [...observations].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  const summary: MeterPerformanceSummary = {
    average: 0, litersMeasured: 0, litersUnmeasured: 0,
    segments: 0, bridged: 0, reanchored: 0, litersFromProvider: 0,
  }
  let weighted = 0

  const accept = (performance: number, liters: number) => {
    weighted += performance * liters
    summary.litersMeasured += liters
  }

  // Índice de la primera observación con lectura: hasta ahí no hay serie.
  const anchorIndex = series.findIndex((item) => item.value !== null)
  if (anchorIndex === -1) {
    // Sin ninguna lectura, el proveedor es lo único que hay.
    for (const item of series) {
      const fallback = item.providerPerformance ?? 0
      if (isPlausible(fallback, max) && item.liters > 0) {
        accept(fallback, item.liters)
        summary.litersFromProvider += item.liters
      } else summary.litersUnmeasured += item.liters
    }
    summary.average = summary.litersMeasured > 0 ? round2(weighted / summary.litersMeasured) : 0
    return summary
  }

  // Todo lo anterior al ancla (incluida ella) pertenece a un tramo que empezó
  // fuera de la ventana: ahí el km/L del proveedor es el mejor dato disponible.
  for (let i = 0; i <= anchorIndex; i++) {
    const item = series[i]!
    if (item.liters <= 0) continue
    const fallback = item.providerPerformance ?? 0
    if (isPlausible(fallback, max)) {
      accept(fallback, item.liters)
      summary.litersFromProvider += item.liters
    } else summary.litersUnmeasured += item.liters
  }

  let anchor = series[anchorIndex]!
  let pendingLiters = 0
  /** Última lectura rechazada y los litros acumulados desde ella: si la
   *  siguiente cierra bien contra ELLA y no contra el ancla, el valor raro era
   *  el ancla (un dígito de más), no la que rechazamos. */
  let rejected: { value: number; liters: number } | null = null
  let skipped = 0

  for (let i = anchorIndex + 1; i < series.length; i++) {
    const item = series[i]!
    pendingLiters += item.liters
    if (rejected) rejected.liters += item.liters
    if (item.value === null) continue

    const performance = pendingLiters > 0 ? (item.value - anchor.value!) / pendingLiters : Number.NaN
    if (isPlausible(performance, max)) {
      accept(performance, pendingLiters)
      summary.segments++
      if (skipped > 0) summary.bridged++
      anchor = item
      pendingLiters = 0
      rejected = null
      skipped = 0
      continue
    }

    if (rejected) {
      const fromRejected = rejected.liters > 0 ? (item.value - rejected.value) / rejected.liters : Number.NaN
      if (isPlausible(fromRejected, max)) {
        // El ancla era el valor malo: sus litros pendientes hasta la lectura
        // rechazada no tienen tramo, pero de ahí en adelante la serie es sana.
        summary.litersUnmeasured += pendingLiters - rejected.liters
        accept(fromRejected, rejected.liters)
        summary.segments++
        summary.reanchored++
        anchor = item
        pendingLiters = 0
        rejected = null
        skipped = 0
        continue
      }
    }

    // `liters: 0` y no `item.liters`: el tramo que empezaría en esta lectura se
    // mide con los litros de las cargas SIGUIENTES, no con los de ella misma.
    rejected = { value: item.value, liters: 0 }
    skipped++
  }

  summary.litersUnmeasured += pendingLiters
  summary.average = summary.litersMeasured > 0 ? round2(weighted / summary.litersMeasured) : 0
  return summary
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
