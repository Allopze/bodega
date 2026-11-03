import type { FuelStorageBalance } from "@/lib/combustibles/fuel-cycle"
import { formatQty } from "@/lib/utils"

/**
 * Cómo se lee el nivel de un estanque contra su capacidad (CHART-020).
 *
 * Es puro y no sabe de pantallas: dado el nivel y la capacidad, dice el tono, la
 * cifra y la nota que acompañan a la barra. El catálogo de estanques sólo
 * registra la **capacidad** (`fuel_storage_locations.capacity_liters`); no
 * existe un punto de reposición ni un mínimo, así que aquí no hay tono
 * «warning» ni marca de reposición: inventar un umbral pintaría de alerta lo
 * que nadie declaró como alerta.
 *
 * Reglas:
 * - **Sobre la capacidad** o **nivel negativo** → `danger`. El segundo no es un
 *   estanque con deuda de combustible: es más salida que entrada registrada
 *   (una recepción sin cargar, o un nivel de apertura que falta).
 * - **Sin capacidad informada** → sin escala. Una barra necesita un máximo y
 *   dibujarla contra uno inventado compara contra nada: sólo se muestra la cifra.
 */
export type StorageLevelInput = Pick<FuelStorageBalance, "balanceLiters" | "capacityLiters">

export interface StorageLevelView {
  /** Con capacidad positiva hay escala contra la que dibujar la barra. */
  hasCapacity: boolean
  tone: "ok" | "danger" | "neutral"
  problem: "over" | "negative" | null
  /** Parte de la capacidad que ocupa, redondeada y acotada a 0–100; `null` sin capacidad. */
  pct: number | null
  /** «12.400 L de 20.000 L», o «12.400 L» sin capacidad. */
  valueText: string
  note: string
}

const liters = (value: number) => `${formatQty(value, undefined, { maximumFractionDigits: 0 })} L`

export function describeStorageLevel({ balanceLiters, capacityLiters }: StorageLevelInput): StorageLevelView {
  const hasCapacity = capacityLiters != null && capacityLiters > 0
  const negative = balanceLiters < 0
  const valueText = hasCapacity ? `${liters(balanceLiters)} de ${liters(capacityLiters)}` : liters(balanceLiters)

  if (!hasCapacity) {
    return {
      hasCapacity: false,
      tone: negative ? "danger" : "neutral",
      problem: negative ? "negative" : null,
      pct: null,
      valueText,
      note: negative ? NEGATIVE_NOTE : "Sin capacidad informada",
    }
  }
  if (negative) return { hasCapacity, tone: "danger", problem: "negative", pct: 0, valueText, note: NEGATIVE_NOTE }
  if (balanceLiters > capacityLiters) {
    return { hasCapacity, tone: "danger", problem: "over", pct: 100, valueText, note: `Sobre su capacidad en ${liters(balanceLiters - capacityLiters)}` }
  }
  const pct = Math.round((balanceLiters / capacityLiters) * 100)
  return { hasCapacity, tone: "ok", problem: null, pct, valueText, note: `${pct} % de su capacidad` }
}

const NEGATIVE_NOTE = "Nivel negativo: hay más salidas que entradas registradas"

/**
 * La frase que responde la pregunta del gráfico: cuántos estanques se pasan de
 * su capacidad (o quedaron en negativo) y cuántos no se pueden comparar.
 * `null` sin estanques: el estado vacío lo explica la pantalla.
 */
export function summarizeStorageLevels(balances: readonly StorageLevelInput[]): string | null {
  const total = balances.length
  if (total === 0) return null
  const views = balances.map(describeStorageLevel)
  const over = views.filter((view) => view.problem === "over").length
  const negative = views.filter((view) => view.problem === "negative").length
  const withoutCapacity = views.filter((view) => !view.hasCapacity).length

  // El sustantivo concuerda con el total («1 de 3 estanques»); el verbo, con quien lo hace.
  const of = (count: number) => (total === 1 ? "El estanque" : `${count} de ${total} estanques`)
  const parts: string[] = []
  if (over > 0) parts.push(`${of(over)} ${over === 1 ? "está" : "están"} sobre su capacidad`)
  if (negative > 0) {
    // Con el sujeto ya dicho en la primera parte sólo se suma el número («… y 1 tiene …»).
    parts.push(`${over > 0 ? String(negative) : of(negative)} ${negative === 1 ? "tiene" : "tienen"} un nivel negativo`)
  }

  if (withoutCapacity === total && parts.length === 0) return "Ningún estanque tiene capacidad informada: sólo se ve su nivel."
  const head = parts.length > 0 ? `${parts.join(" y ")}.` : "Ningún estanque pasa su capacidad."
  const tail = withoutCapacity > 0
    ? ` ${withoutCapacity} no ${withoutCapacity === 1 ? "tiene" : "tienen"} capacidad informada, así que sólo se ve su nivel.`
    : ""
  return `${head}${tail}`
}
