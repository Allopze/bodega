import { formatPercent, formatQty } from "@/lib/utils"

/**
 * Cómo se lee el texto de un caso de combustible.
 *
 * El detector guardaba los números crudos y la estación tal como la manda Copec:
 * «Lectura de odómetro (1) de la carga de JFDB-87 en 2794-LOS CARRERA, ESQ. LAUTARO es
 * menor que la carga anterior (35551).» (crítica 2026-11-15). El detector escribe ahora
 * con estas mismas funciones, y `readableCaseText` reescribe al mostrarlas las
 * descripciones ya guardadas con las plantillas viejas. Sólo las reconoce si calzan
 * enteras: un texto que no calza se muestra tal cual.
 *
 * Sin dependencias de servidor.
 */

export type CaseMeter = "km" | "hora"

const METER_LABEL: Record<CaseMeter, string> = { km: "de odómetro", hora: "de horómetro" }
const METER_UNIT: Record<CaseMeter, string> = { km: "km", hora: "h" }
const CONNECTORS = new Set(["de", "del", "y", "e"])

/** Una lectura de medidor con separador de miles, un decimal a lo más y su unidad: «35.551 km». */
export function meterReadingText(value: number, meter: CaseMeter): string {
  return `${formatQty(value, undefined, { maximumFractionDigits: 1 })} ${METER_UNIT[meter]}`
}

/**
 * El nombre de una estación, que Copec manda en mayúsculas, en caja de oración por palabra:
 * «2794-LOS CARRERA, ESQ. LAUTARO» → «2794-Los Carrera, Esq. Lautaro», sin espacios dobles. Un
 * nombre que ya trae minúsculas conserva su caja.
 */
export function stationNameText(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ")
  if (/\p{Ll}/u.test(name)) return name
  let first = true
  return name.toLocaleLowerCase("es-CL").replace(/\p{L}+/gu, (word) => {
    const keep = !first && CONNECTORS.has(word)
    first = false
    return keep ? word : word.charAt(0).toLocaleUpperCase("es-CL") + word.slice(1)
  })
}

/** Lectura que retrocede respecto de la carga anterior (regla `kilometraje_regresivo`). */
export function regressiveReadingText(input: {
  meter: CaseMeter
  reading: number
  previous: number
  plate: string
  /** `operation`: el log operacional; `load`: una carga (manual o de Copec). */
  source: "operation" | "load"
  /** Sólo las cargas de Copec traen estación; `null` cuando la carga de Copec no la informó. */
  station?: string | null
}): string {
  const where = input.source === "operation" ? `del log operacional de ${input.plate}` : `de la carga de ${input.plate}`
  const station = input.station === undefined ? "" : ` en ${input.station ? stationNameText(input.station) : "estación no informada"}`
  return `Lectura ${METER_LABEL[input.meter]} ${where}${station}: ${meterReadingText(input.reading, input.meter)}, menor que la carga anterior (${meterReadingText(input.previous, input.meter)}).`
}

/** Salto de medidor imposible para el equipo (regla `salto_medidor_implausible`). */
export function meterJumpText(input: { meter: CaseMeter; plate: string; delta: number; days: number; ratePerDay: number }): string {
  const unit = METER_UNIT[input.meter]
  const days = `${formatQty(input.days, undefined, { maximumFractionDigits: 1 })} ${input.days === 1 ? "día" : "días"}`
  return `Lectura ${METER_LABEL[input.meter]} de ${input.plate} sube ${formatQty(Math.round(input.delta))} ${unit} en ${days} (${formatQty(Math.round(input.ratePerDay))} ${unit}/día): supera lo posible para el equipo.`
}

const NUMBER = "(-?\\d+(?:\\.\\d+)?)"
const LEGACY_REGRESSIVE = new RegExp(
  `^Lectura (de odómetro|de horómetro) \\(${NUMBER}\\) (de la carga de|del log operacional de) (\\S+?)(?: en (.+?))? es menor que la carga anterior \\(${NUMBER}\\)\\.$`,
)
const LEGACY_JUMP = /^(Lectura de (?:odómetro|horómetro) de \S+ sube [\d.]+ (?:km|h)) en (\d+(?:[.,]\d+)?) día\(s\) (.*)$/
const LEGACY_VARIATION = /^(Consumo (?:de .+? )?varió )(-?\d+)%( respecto al período anterior .*)$/

/**
 * El texto de un caso para mostrarlo: las descripciones guardadas con las plantillas viejas
 * salen con separador de miles, unidad y la estación legible; cualquier otro texto, tal cual.
 */
export function readableCaseText(description: string): string {
  const regressive = LEGACY_REGRESSIVE.exec(description)
  if (regressive) {
    const [, label, reading, where, plate, station, previous] = regressive
    return regressiveReadingText({
      meter: label === "de horómetro" ? "hora" : "km",
      reading: Number(reading),
      previous: Number(previous),
      plate: plate!,
      source: where === "del log operacional de" ? "operation" : "load",
      station: station === undefined ? undefined : station === "estación no informada" ? null : station,
    })
  }
  const jump = LEGACY_JUMP.exec(description)
  if (jump) {
    const days = Number(jump[2]!.replace(",", "."))
    return `${jump[1]} en ${formatQty(days, undefined, { maximumFractionDigits: 1 })} ${days === 1 ? "día" : "días"} ${jump[3]}`
  }
  const variation = LEGACY_VARIATION.exec(description)
  if (variation) return `${variation[1]}${formatPercent(Number(variation[2]), 0)}${variation[3]}`
  return description
}

/**
 * «Observado» y «Esperado» de un caso, que se guardan como texto: una cifra sola o con su
 * comparación («> 35551», «≤ 120400») sale con separador de miles; otro texto, tal cual.
 */
export function readableCaseValue(raw: string): string {
  const match = /^([<>≤≥]=?\s*)?(-?\d+(?:\.\d+)?)$/.exec(raw.trim())
  if (!match) return raw
  return `${match[1] ?? ""}${formatQty(Number(match[2]), undefined, { maximumFractionDigits: 2 })}`
}
