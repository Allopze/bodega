/**
 * Vocabulario de `/admin/talana`: lo que la pantalla y el Excel dicen de los
 * códigos que guarda la sincronización. Puro (sin servidor ni React) para que lo
 * usen la vista, la exportación y las pruebas.
 */
import type { DifferenceFixIn } from "@/lib/integrations/talana/talana-differences"
import type { TalanaItemKind, TalanaItemOutcome } from "@/lib/integrations/talana/talana-read"
import type { StateMetaInput } from "@/components/states/state-badge"

export const FUSIBLE_REASON_LABELS: Record<string, string> = {
  no_active_contracts: "Talana devolvió cero contratos activos",
  active_drop: "Los contratos activos cayeron sin finiquitos que lo expliquen",
  mass_altas: "Demasiadas altas en una sola corrida",
}

export function fusibleReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Una verificación de seguridad detuvo la corrida"
  return FUSIBLE_REASON_LABELS[reason] ?? "Una verificación de seguridad detuvo la corrida"
}

export const ITEM_KIND_LABELS: Record<TalanaItemKind, string> = {
  alta: "Alta",
  reactivacion: "Reactivación",
  baja: "Baja",
  traslado: "Traslado de faena",
  cargo: "Cambio de cargo",
  jefe: "Cambio de jefe",
  sexo: "Sexo completado",
}

/** Por qué una persona se omitió o un cambio no se aplicó. */
export const ITEM_REASON_LABELS: Record<string, string> = {
  faena_sin_mapeo: "Centro de costo sin faena",
  nombre_invalido: "Nombre inválido",
  posible_duplicado: "Posible duplicado (mismo nombre, otro RUT)",
  sin_cargo_de_sistema: "Falta el cargo Sin clasificar",
  creado_despues_del_termino: "La ficha se creó después del término",
  actividad_posterior: "Tiene actividad en Chome después del término",
  cargo_distinto: "Cargo distinto (Chome manda)",
  faena_distinta: "Faena distinta (Chome manda)",
  jefe_distinto: "Jefe distinto (Chome manda)",
  cambio_manual_en_chome: "Cambiado a mano en Chome",
  conflicto_concurrente: "La ficha cambió durante la corrida",
  error: "Error",
}

export function itemReasonLabel(reasonCode: string | null | undefined): string | null {
  if (!reasonCode) return null
  return ITEM_REASON_LABELS[reasonCode] ?? "Otro motivo"
}

/** Resultado de un cambio: lo que pasó y, si se omitió o falló, por qué. */
export function itemOutcomeMeta(outcome: TalanaItemOutcome): StateMetaInput {
  switch (outcome) {
    case "applied": return { label: "Aplicado", variant: "success" }
    case "planned": return { label: "Simulado", variant: "info" }
    case "skipped": return { label: "Omitido", variant: "neutral" }
    case "failed": return { label: "Falló", variant: "danger" }
  }
}

export const RUN_MODE_LABELS: Record<string, string> = {
  simulate: "Simulación",
  apply: "Aplicación",
}

export const RUN_TRIGGER_LABELS: Record<string, string> = {
  cron: "Programada",
  manual: "Manual",
}

export function runStatusMeta(status: string): StateMetaInput {
  switch (status) {
    case "running": return { label: "En curso", variant: "info" }
    case "success": return { label: "Terminó bien", variant: "success" }
    case "partial": return { label: "Con omitidos", variant: "warning" }
    case "blocked": return { label: "Detenida", variant: "danger" }
    case "failed": return { label: "Falló", variant: "danger" }
    default: return { label: "Sin estado", variant: "neutral" }
  }
}

/** Motivo de una corrida detenida o fallida, en lenguaje de usuario. */
export function runReasonText(run: { status: string; fusibleReason: string | null; errorCode: string | null; fusibleBypassed?: boolean }): string | null {
  if (run.status === "blocked") return fusibleReasonLabel(run.fusibleReason)
  if (run.status === "failed") return run.errorCode ? `No se pudo completar (código ${run.errorCode})` : "No se pudo completar"
  if (run.fusibleBypassed) return "Pasó el fusible tras una revisión"
  return null
}

export const FIX_IN_LABELS: Record<DifferenceFixIn, string> = {
  talana: "Talana",
  chome: "Chome",
  revisar: "Revisar",
}

export const FIX_IN_VARIANT: Record<DifferenceFixIn, "info" | "primary" | "warning"> = {
  talana: "info",
  chome: "primary",
  revisar: "warning",
}
