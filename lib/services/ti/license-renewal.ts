/* ── Urgencia de renovación de una licencia ────────────────────────────────
 * TIUX-41. La renovación era una fecha más en una línea de texto: una licencia
 * que vencía en 3 días se leía igual que una a un año. Una sola regla para la
 * tarjeta, el filtro `?renovacion=proxima` y quien la consuma. El estado se
 * comunica con texto, nunca solo con color (WCAG 1.4.1). Vocabulario puro, sin
 * `@/db`: lo usan componentes de cliente. */

import type { StateMetaInput } from "@/components/states/state-badge"
import { todayInChile } from "@/lib/utils"
import { civilDaysUntil } from "./civil-dates"

/** Días antes de la renovación en que se considera "próxima". Igual que el resumen de TI. */
export const LICENSE_RENEWAL_SOON_DAYS = 14

export type LicenseRenewalKind = "none" | "overdue" | "soon" | "later"

export interface LicenseRenewal extends StateMetaInput {
  kind: LicenseRenewalKind
  /** Días civiles hasta la renovación (negativo si ya pasó); `null` sin fecha. */
  daysLeft: number | null
  /** Solo `overdue` y `soon` piden atención: el resto se muestra como texto. */
  urgent: boolean
}

function soonLabel(days: number): string {
  if (days === 0) return "Renueva hoy"
  return days === 1 ? "Renueva mañana" : `Renueva en ${days} días`
}

export function licenseRenewal(
  renewalDate: string | null | undefined,
  isActive = true,
  today: string = todayInChile(),
): LicenseRenewal {
  // Una licencia inactiva no se renueva: no hay nada que avisar.
  if (!renewalDate || !isActive) return { kind: "none", daysLeft: null, label: "Sin renovación", variant: "default", urgent: false }
  const days = civilDaysUntil(renewalDate, today)
  if (days < 0) return { kind: "overdue", daysLeft: days, label: "Renovación vencida", variant: "danger", urgent: true }
  if (days <= LICENSE_RENEWAL_SOON_DAYS) return { kind: "soon", daysLeft: days, label: soonLabel(days), variant: "warning", urgent: true }
  return { kind: "later", daysLeft: days, label: "Vigente", variant: "default", urgent: false }
}
