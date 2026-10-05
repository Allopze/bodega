/* ── Ventanas de garantía del filtro de /ti/garantias ─────────────────────
 * Antes eran seis pastillas con ventanas anidadas (30 ⊂ 60 ⊂ 90) y sin conteo:
 * un activo que vence en 20 días aparecía bajo tres filtros, así que ninguna
 * cifra decía "cuántos hay". Ahora las bandas de la pantalla son disjuntas y se
 * derivan de `warrantyStatus()` (misma regla que el badge de cada fila).
 *
 * Los valores heredados (`expiring_60`, `expiring_90`, `active`) siguen
 * resolviéndose: el tablero y marcadores antiguos enlazan con ellos
 * (`?ventana=expiring_30` y `?ventana=expired` son contrato con el resumen). */

import { warrantyStatus } from "@/lib/services/ti/warranty"

export type WarrantyView =
  | "" | "expired" | "expiring_30" | "expiring_31_90" | "valid"
  // Heredados, acumulativos: no se muestran como pastilla.
  | "active" | "expiring_60" | "expiring_90"

export const WARRANTY_BANDS: { value: WarrantyView; label: string }[] = [
  { value: "expired", label: "Vencidas" },
  { value: "expiring_30", label: "Vencen en 30 días o menos" },
  { value: "expiring_31_90", label: "Vencen en 31 a 90 días" },
  { value: "valid", label: "Vigentes (más de 90 días)" },
]

const VALID_VIEWS = new Set<string>([
  "expired", "expiring_30", "expiring_31_90", "valid", "active", "expiring_60", "expiring_90",
])

export function parseWarrantyView(raw: unknown): WarrantyView {
  return typeof raw === "string" && VALID_VIEWS.has(raw) ? (raw as WarrantyView) : ""
}

/** ¿La garantía que termina en `endDate` cae en la vista pedida? */
export function matchesWarrantyView(endDate: string | null, view: WarrantyView, today?: string): boolean {
  if (!endDate) return false
  const { kind, daysLeft } = warrantyStatus(endDate, today)
  switch (view) {
    case "": return true
    case "expired": return kind === "expired"
    case "expiring_30": return kind === "expiring"
    case "expiring_31_90": return kind === "notice"
    case "valid": return kind === "valid"
    case "active": return kind !== "expired"
    case "expiring_60": return daysLeft !== null && daysLeft >= 0 && daysLeft <= 60
    case "expiring_90": return daysLeft !== null && daysLeft >= 0 && daysLeft <= 90
  }
}

/** Conteo por banda disjunta, calculado sobre el universo ya acotado por faena. */
export function countWarrantyBands(endDates: (string | null)[], today?: string): Record<string, number> {
  const out: Record<string, number> = { "": endDates.filter(Boolean).length }
  for (const band of WARRANTY_BANDS) {
    out[band.value] = endDates.filter((d) => matchesWarrantyView(d, band.value, today)).length
  }
  return out
}
