/**
 * Reglas puras sobre una serie de lecturas de medidor (odómetro u horómetro).
 *
 * Las comparten el detector de anomalías (que objeta una lectura) y Flota (que
 * calcula el recorrido de la ventana): si cada uno tuviera su propia vara, Flota
 * sumaría un avance que el detector ya marcó como imposible. Sin acceso a datos:
 * lo importan el servidor y las pruebas.
 */

/** Config JSON de una regla de anomalía (`fuel_anomaly_rules.config`); `{}` si falta o no es JSON. */
export const configOf = (rule: { config: string | null }): Record<string, unknown> => {
  try { return rule.config ? JSON.parse(rule.config) : {} } catch { return {} }
}

/** Buscar un override por tipo de equipo en `config.equipmentTypes[slug][key]`.
 *  Los detectores batch pueden definir umbrales distintos por tipo de equipo
 *  en el JSON de configuración de la regla, sin necesidad de crear una regla
 *  por cada combinación. Ejemplo de config:
 *  ```json
 *  { "thresholdPct": 50, "equipmentTypes": { "cargadora_frontal": { "thresholdPct": 30 } } }
 *  ``` */
export function readEqTypeOverride(cfg: Record<string, unknown>, slug: string, key: string): unknown {
  const eqTypes = cfg["equipmentTypes"]
  if (!eqTypes || typeof eqTypes !== "object") return undefined
  const typeCfg = (eqTypes as Record<string, unknown>)[slug]
  if (!typeCfg || typeof typeCfg !== "object") return undefined
  return (typeCfg as Record<string, unknown>)[key]
}

/** Días calendario entre dos instantes, con piso de 1: dos cargas del mismo día
 *  no dividen por cero, y un salto grande entre ellas sigue siendo implausible. */
export function elapsedDays(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (!Number.isFinite(ms)) return 1
  return Math.max(1, Math.round(ms / 86_400_000))
}

/**
 * Techo de avance diario del medidor. `maxKmPerDay` para odómetro y
 * `maxHoursPerDay` para horómetro, ambos con override por tipo de equipo.
 *
 * Los valores por omisión son cotas físicas, no metas de operación: 1.500 km en
 * un día es más de lo que rinde un camión conduciendo sin parar, y un motor no
 * puede acumular más de 24 horas por día.
 */
export function maxMeterRatePerDayOf(rule: { config: string | null }, meterType: "km" | "hora", equipmentTypeSlug?: string): number {
  const key = meterType === "hora" ? "maxHoursPerDay" : "maxKmPerDay"
  const fallback = meterType === "hora" ? 24 : 1_500
  const cfg = configOf(rule)
  if (equipmentTypeSlug) {
    const override = readEqTypeOverride(cfg, equipmentTypeSlug, key)
    if (typeof override === "number" && override > 0) return override
  }
  if (typeof cfg[key] === "number" && (cfg[key] as number) > 0) return cfg[key] as number
  return fallback
}

export interface MeterSeriesPoint {
  value: number
  /** Instante ISO de la lectura. */
  occurredAt: string
  /** Un caso de medidor regresivo sobre ESTA lectura se cerró como `reset_medidor`: el medidor se reemplazó o reinició aquí. */
  acceptedReset?: boolean
}

export interface MeterSeriesAdvance {
  /** Suma de los avances que ningún control objeta; `null` si la serie no tiene ni un par así. */
  advance: number | null
  /** Pares consecutivos que no se sumaron. Con `> 0`, `advance` es una cota inferior y no el recorrido completo. */
  discardedPairs: number
}

/**
 * Recorrido de una serie de lecturas ya ordenada por instante (de un solo
 * equipo, medidor y fuente): suma de los avances entre lecturas consecutivas.
 *
 * Un par se descarta —no se suma— cuando el detector de anomalías lo objetaría:
 * - la lectura **retrocede** (`kilometraje_regresivo`/`horometro_regresivo`) y no
 *   hay un reset aceptado sobre ella, o
 * - el medidor **avanza más de lo posible** para los días transcurridos
 *   (`salto_medidor_implausible`, con la cota `maxPerDay` de esa regla).
 *
 * El detector deja el caso sobre la lectura *actual* del par, así que esa
 * lectura queda en duda y **no sirve de base** para el par siguiente: sin esto,
 * un error de tipeo que baja la lectura (72.000 en lugar de 720.325) se sumaba de
 * vuelta como un salto "razonable" hasta la lectura buena (+648.000 km). Ese par
 * siguiente también se descarta, y la lectura que lo cierra vuelve a ser base.
 *
 * Un **reset aceptado** (`acceptedReset`) declara que la serie parte de nuevo en
 * esa lectura: el tramo anterior → reset no se suma (el medidor nuevo no dice
 * cuánto recorrió el viejo) pero tampoco cuenta como par descartado, porque no es
 * un error de dato sino un hecho físico. Un caso cerrado como `lectura_corregida`
 * NO es un reset: la lectura siguió siendo un error y se descarta igual.
 *
 * Nunca devuelve un valor negativo, y cada par sumado cabe bajo la cota física.
 */
export function meterSeriesAdvance(points: readonly MeterSeriesPoint[], maxPerDay: number): MeterSeriesAdvance {
  let advance = 0
  let counted = 0
  let discardedPairs = 0
  // `false` justo después de un par objetado: la lectura que lo causó no es base fiable.
  let baselineTrusted = true

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    if (curr.acceptedReset) {
      baselineTrusted = true
      continue
    }
    if (!baselineTrusted) {
      discardedPairs++
      baselineTrusted = true
      continue
    }
    const delta = curr.value - prev.value
    if (delta < 0 || delta / elapsedDays(prev.occurredAt, curr.occurredAt) > maxPerDay) {
      discardedPairs++
      baselineTrusted = false
      continue
    }
    advance += delta
    counted++
  }

  return { advance: counted > 0 ? advance : null, discardedPairs }
}
