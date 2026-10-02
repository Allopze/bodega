/** Cambio optimista de un riesgo: aplicar o revertir campos y reclasificar con la regla de la columna generada. */
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import { classify, magnitudeOf } from "./methodology"
import type { MiperEntrySnapshot } from "./snapshot"

const reclassify = (entry: MiperEntrySnapshot): MiperEntrySnapshot => ({
  ...entry,
  magnitude: magnitudeOf(entry.probability, entry.consequence),
  classification: classify(entry.probability, entry.consequence),
})

export function applyEntryValues(entry: MiperEntrySnapshot, values: MiperEntryValues, riskFactors: ReadonlyArray<{ id: string; name: string }>): MiperEntrySnapshot {
  const next = { ...entry, ...values } as MiperEntrySnapshot
  if ("riskFactorId" in values) next.riskFactor = riskFactors.find((factor) => factor.id === values.riskFactorId)?.name ?? null
  return reclassify(next)
}

export function revertEntryFields(current: MiperEntrySnapshot, previous: MiperEntrySnapshot, fields: readonly string[]): MiperEntrySnapshot {
  const next: Record<string, unknown> = { ...current }
  for (const field of fields) {
    next[field] = (previous as unknown as Record<string, unknown>)[field]
    if (field === "riskFactorId") next.riskFactor = previous.riskFactor
  }
  return reclassify(next as unknown as MiperEntrySnapshot)
}
