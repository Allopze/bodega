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

/* ── Vista de cara al trabajador (página pública de resultado) ────────────────
 * El resultado de la auto-evaluación (`resultado`) es inmutable, pero el estado
 * del caso cambia cuando el responsable revisa. La pantalla pública debe reflejar
 * ese estado actual, no el resultado original.
 */
export interface WorkerResultView {
  tone: "success" | "danger" | "warning" | "neutral"
  title: string
  message: string
  /** El trabajo puede iniciar. */
  canStart: boolean
  /** Mostrar los motivos de la detención al trabajador. */
  showReasons: boolean
}

export function workerResultView(estado: string): WorkerResultView {
  switch (estado as EstadoPpa) {
    case "aprobado_auto":
      return {
        tone: "success",
        title: "Puede iniciar el trabajo de forma segura",
        message: "Recuerde mantener los controles durante toda la tarea.",
        canStart: true,
        showReasons: false,
      }
    case "autorizado":
      return {
        tone: "success",
        title: "El supervisor autorizó el inicio",
        message: "Puede iniciar el trabajo. Mantenga los controles durante toda la tarea.",
        canStart: true,
        showReasons: false,
      }
    case "detenido":
      return {
        tone: "danger",
        title: "Detenga el trabajo",
        message:
          "Comuníquese con su supervisor. El trabajo no debe comenzar hasta que el supervisor revise la situación y autorice el inicio.",
        canStart: false,
        showReasons: true,
      }
    case "en_correccion":
      return {
        tone: "warning",
        title: "El supervisor solicitó correcciones",
        message: "Corrija las condiciones indicadas y vuelva a realizar el PPA antes de iniciar el trabajo.",
        canStart: false,
        showReasons: true,
      }
    case "rechazado":
      return {
        tone: "danger",
        title: "El supervisor rechazó el inicio",
        message: "No inicie el trabajo. Comuníquese con su supervisor para más información.",
        canStart: false,
        showReasons: true,
      }
    case "cerrado":
      return {
        tone: "neutral",
        title: "Caso cerrado",
        message: "Este PPA fue cerrado. Si necesita iniciar un trabajo, realice un nuevo PPA.",
        canStart: false,
        showReasons: false,
      }
    default:
      return {
        tone: "neutral",
        title: estadoPpaLabel(estado),
        message: "",
        canStart: false,
        showReasons: false,
      }
  }
}
