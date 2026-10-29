import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import { STAMP_GAP_LIMIT_HOURS } from "@/lib/services/mantencion/records-filters"

/**
 * Alertas de un registro como etiquetas de texto (§10: «alertas como etiquetas»).
 * Salen del detalle que ya leyó el servidor, así que la pantalla y el PDF dicen
 * lo mismo. Módulo puro.
 */
export interface RecordAlertTag {
  key: "jump" | "outside" | "manual" | "duplicate" | "stamp"
  label: string
  /** Texto de apoyo (se usa como `title` y en el PDF). */
  hint?: string
  /** Registro al que apunta la etiqueta (el duplicado anterior). */
  linkTo?: { id: string; folio: string | null }
}

type AlertSource = Pick<
  RecordDetail,
  "readingJumpAlert" | "readingJumpConfirmed" | "outOfWorksite" | "worksiteName" | "schedule" | "duplicateOf" | "stampGapHours"
>

export function recordAlertTags(detail: AlertSource): RecordAlertTag[] {
  const tags: RecordAlertTag[] = []
  if (detail.readingJumpAlert) {
    tags.push({
      key: "jump",
      label: "Salto de lectura",
      hint: detail.readingJumpConfirmed ? "El mecánico confirmó la lectura en el teléfono." : "La lectura supera lo esperado desde el registro anterior.",
    })
  }
  if (detail.outOfWorksite) {
    tags.push({ key: "outside", label: "Fuera de faena", hint: `El equipo no pertenece a la faena ${detail.worksiteName}.` })
  }
  if (detail.schedule && detail.schedule.intervalValue !== detail.schedule.suggestedIntervalValue) {
    tags.push({ key: "manual", label: "Pauta elegida a mano", hint: detail.schedule.manualReason ?? undefined })
  }
  if (detail.duplicateOf) {
    tags.push({ key: "duplicate", label: "Preventiva duplicada", hint: "Hay otra preventiva vigente del mismo equipo y pauta muy cerca en el tiempo o en la lectura.", linkTo: detail.duplicateOf })
  }
  if (detail.stampGapHours != null) {
    tags.push({
      key: "stamp",
      label: `Hora del sello y de recepción difieren más de ${STAMP_GAP_LIMIT_HOURS} h`,
      hint: `Difieren cerca de ${detail.stampGapHours} h y el teléfono no declaró un período sin señal.`,
    })
  }
  return tags
}
