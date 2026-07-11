import { REQUEST_STATE_META, OC_STATE_META } from "@/components/states/state-badge"

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp: "EPP", otro: "Otro", repuestos: "Repuestos", servicios: "Servicios",
}
export const URGENCY_LABELS: Record<string, string> = {
  normal: "Normal", high: "Alta", critical: "Crítico",
}
export function requestStatusLabel(s: string): string {
  return REQUEST_STATE_META[s as keyof typeof REQUEST_STATE_META]?.label ?? s
}
export function ocStatusLabel(s: string): string {
  return OC_STATE_META[s as keyof typeof OC_STATE_META]?.label ?? s
}

export const RECEIVABLE_OC_STATUSES = ["sent", "partially_office_received", "office_received", "partially_received"]
