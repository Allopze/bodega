/**
 * lib/ppa/badges.ts
 * Labels y variantes de badge para estados/decisiones del PPA.
 */

import type { EstadoPpa, PpaDecision } from "./types"

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "outline"

export const ESTADO_PPA_LABELS: Record<EstadoPpa, string> = {
  aprobado_auto: "Aprobado automáticamente",
  detenido:      "Trabajo detenido",
  en_correccion: "En corrección",
  autorizado:    "Autorizado",
  rechazado:     "Rechazado",
  cerrado:       "Cerrado",
}

export function estadoPpaLabel(estado: string): string {
  return ESTADO_PPA_LABELS[estado as EstadoPpa] ?? estado
}

export function estadoPpaBadgeVariant(estado: string): BadgeVariant {
  switch (estado as EstadoPpa) {
    case "aprobado_auto":
    case "autorizado":
      return "success"
    case "detenido":
      return "danger"
    case "en_correccion":
      return "warning"
    case "rechazado":
      return "danger"
    case "cerrado":
      return "outline"
    default:
      return "default"
  }
}

export const DECISION_PPA_LABELS: Record<PpaDecision, string> = {
  autorizado: "Autorizó el inicio",
  rechazado:  "Rechazó el inicio",
  correccion: "Solicitó corrección",
}

export function decisionPpaLabel(decision: string | null | undefined): string {
  if (!decision) return "—"
  return DECISION_PPA_LABELS[decision as PpaDecision] ?? decision
}

/** ¿El estado representa un PPA pendiente de acción del responsable? */
export function isPendienteRevision(estado: string): boolean {
  return estado === "detenido" || estado === "en_correccion"
}
