import { MetaBadge, type StateMetaInput } from "@/components/states/state-badge"
import { SHIFT_STATUS_LABEL, type ShiftStatus } from "@/lib/fleet/shifts/calc"

/** Rótulos de `SHIFT_STATUS_LABEL` (una sola fuente) con el color que decide la familia del estado. */
const META: Record<ShiftStatus, StateMetaInput> = {
  sin_telemetria: { label: SHIFT_STATUS_LABEL.sin_telemetria, variant: "neutral" },
  pendiente: { label: SHIFT_STATUS_LABEL.pendiente, variant: "info" },
  sin_senal: { label: SHIFT_STATUS_LABEL.sin_senal, variant: "warning" },
  sin_uso: { label: SHIFT_STATUS_LABEL.sin_uso, variant: "neutral" },
  sin_dato_ralenti: { label: SHIFT_STATUS_LABEL.sin_dato_ralenti, variant: "warning" },
  sobre_meta: { label: SHIFT_STATUS_LABEL.sobre_meta, variant: "danger" },
  en_meta: { label: SHIFT_STATUS_LABEL.en_meta, variant: "success" },
}

/** Qué significa cada estado, en lenguaje llano: va como `title` de la insignia. */
const DESCRIPTION: Record<ShiftStatus, string> = {
  sin_telemetria: "El equipo no tiene VisionLink: no hay horas de motor que medir.",
  pendiente: "Alguna hora del turno aún no llega de VisionLink; se completa sola en las próximas horas.",
  sin_senal: "El equipo no transmite desde antes de ese día (lleva 3 días o más sin señal).",
  sin_uso: "Menos de 0,5 h de motor: el turno no entra al ranking.",
  sin_dato_ralenti: "Hay horas de motor pero VisionLink no informó ralentí ni trabajo.",
  sobre_meta: "El % de ralentí supera la meta.",
  en_meta: "El % de ralentí está dentro de la meta.",
}

export function ShiftStatusBadge({ status }: { status: ShiftStatus }) {
  return <MetaBadge meta={META[status]} title={DESCRIPTION[status]} />
}
