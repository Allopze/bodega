/* ── Estado de garantía de un activo ───────────────────────────────────────
 * Una sola regla para inventario, ficha y la pantalla de Garantías. Antes vivía
 * sólo en `warranty-table.tsx`: el inventario pintaba una garantía a 15 días
 * igual que una vigente y la ficha mostraba un escudo verde, mientras Garantías
 * decía "Vence en 15 d". El estado se comunica con texto, nunca sólo con color
 * (WCAG 1.4.1). Vocabulario puro, sin `@/db`: lo usan componentes de cliente. */

import type { StateMetaInput } from "@/components/states/state-badge"
import { todayInChile } from "@/lib/utils"
import { civilDaysUntil } from "./civil-dates"

/** Días antes del fin de la garantía en que se considera "por vencer". */
export const WARRANTY_EXPIRING_DAYS = 30
/** Ventana de aviso temprano: se muestra, pero sin urgencia. */
export const WARRANTY_NOTICE_DAYS = 90

export type WarrantyKind = "none" | "expired" | "expiring" | "notice" | "valid"

export interface WarrantyStatus extends StateMetaInput {
  kind: WarrantyKind
  /** Días civiles hasta el fin (negativo si ya venció); `null` sin fecha. */
  daysLeft: number | null
}

function daysLabel(days: number): string {
  if (days === 0) return "Vence hoy"
  return days === 1 ? "Vence mañana" : `Vence en ${days} días`
}

export function warrantyStatus(endDate: string | null | undefined, today: string = todayInChile()): WarrantyStatus {
  if (!endDate) return { kind: "none", daysLeft: null, label: "Sin garantía", variant: "default" }
  const days = civilDaysUntil(endDate, today)
  if (days < 0) return { kind: "expired", daysLeft: days, label: "Vencida", variant: "danger" }
  if (days <= WARRANTY_EXPIRING_DAYS) return { kind: "expiring", daysLeft: days, label: daysLabel(days), variant: "danger" }
  if (days <= WARRANTY_NOTICE_DAYS) return { kind: "notice", daysLeft: days, label: daysLabel(days), variant: "warning" }
  return { kind: "valid", daysLeft: days, label: "Vigente", variant: "success" }
}
