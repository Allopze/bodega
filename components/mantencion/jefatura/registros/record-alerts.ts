import { formatNumber, formatReading, plural } from "@/lib/mantencion/format"
import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import { STAMP_GAP_LIMIT_HOURS } from "@/lib/services/mantencion/records-filters"
import { formatDate, formatDateTime } from "@/lib/utils"
import { photoCaption } from "./photo-labels"

/**
 * Alertas de un registro, leídas del detalle que ya trajo el servidor: la
 * pantalla y el PDF dicen lo mismo. Módulo puro.
 *
 * Cada alerta lleva dos niveles de texto. `label` es el nombre corto (lo que
 * imprime el PDF y lo que nombra el filtro de la lista). El resto —`title`,
 * `message`, `action`— es lo que lee quien revisa en pantalla: qué pasó y por
 * qué importa, y qué hacer. Ninguno depende de un `title` del navegador, que no
 * se ve en el teléfono ni con teclado.
 */
export interface RecordAlertTag {
  key: "jump" | "outside" | "manual" | "duplicate" | "stamp"
  /** Nombre corto de la alerta (PDF y filtro). */
  label: string
  /** Titular en tipo oración. */
  title: string
  /** Qué pasó y por qué importa. */
  message: string
  /** Qué hacer con ello. */
  action: string
  /** Registro al que apunta la alerta (el duplicado anterior). */
  linkTo?: { id: string; folio: string | null }
  /** Ancla dentro del propio detalle: la foto o los datos que la explican. */
  anchor?: { href: string; label: string }
}

type AlertSource = Pick<
  RecordDetail,
  | "readingJumpAlert" | "readingJumpConfirmed" | "outOfWorksite" | "worksiteName" | "schedule" | "duplicateOf" | "duplicateConfirmed"
  | "stampGap" | "photos" | "reading" | "unit" | "previousReading" | "equipment" | "receivedAt"
>

/** «5 horas», «12 días», «3 meses»: la diferencia dicha como la diría una persona. */
export function gapText(hours: number): string {
  if (hours < 48) return plural(Math.max(1, Math.round(hours)), "hora", "horas")
  const days = Math.round(hours / 24)
  if (days < 60) return plural(days, "día", "días")
  return plural(Math.round(days / 30), "mes", "meses")
}

export const DATA_ANCHOR = "#datos-del-registro"

export function recordAlertTags(detail: AlertSource): RecordAlertTag[] {
  const tags: RecordAlertTag[] = []

  if (detail.readingJumpAlert) {
    const previous = detail.previousReading
    const diff = previous ? detail.reading - previous.value : null
    const how = previous && diff !== null && diff > 0
      ? `La lectura es ${formatReading(detail.reading, detail.unit)}: ${formatNumber(diff)} ${detail.unit} más que la anterior (${formatReading(previous.value, detail.unit)}, del ${formatDate(previous.date)}), más de lo esperado para ese lapso.`
      : "La lectura supera lo esperado desde el registro anterior."
    tags.push({
      key: "jump",
      label: "Salto de lectura",
      title: "Salto de lectura",
      message: `${how}${detail.readingJumpConfirmed ? " El mecánico la confirmó en el teléfono." : ""}`,
      action: "Compárala con el uso real del equipo; si no cuadra, pide una corrección con «Observar».",
      anchor: { href: DATA_ANCHOR, label: "Ver las lecturas" },
    })
  }

  if (detail.outOfWorksite) {
    const own = detail.equipment.worksite
    tags.push({
      key: "outside",
      label: "Fuera de faena",
      title: "Registrado fuera de la faena del equipo",
      message: own && own !== detail.worksiteName
        ? `Se registró en la faena ${detail.worksiteName}, pero el equipo pertenece a ${own}.`
        : `El equipo no pertenece a la faena ${detail.worksiteName}, donde se registró.`,
      action: "Confirma que el equipo trabajó ahí; si se registró en el equipo equivocado, anula el registro.",
      anchor: { href: "#equipo", label: "Ver el equipo" },
    })
  }

  if (detail.schedule && detail.schedule.intervalValue !== detail.schedule.suggestedIntervalValue) {
    const reason = detail.schedule.manualReason?.trim()
    tags.push({
      key: "manual",
      label: "Pauta elegida a mano",
      title: "Pauta elegida a mano",
      message: `Se hizo la mantención de ${formatReading(detail.schedule.intervalValue, detail.unit)} en vez de la sugerida, de ${formatReading(detail.schedule.suggestedIntervalValue, detail.unit)}. Motivo: ${reason || "sin motivo registrado"}.`,
      action: reason ? "Verifica que el motivo justifique el cambio." : "Pide el motivo al mecánico con «Observar».",
      anchor: { href: DATA_ANCHOR, label: "Ver la pauta usada" },
    })
  }

  if (detail.duplicateOf) {
    tags.push({
      key: "duplicate",
      label: "Preventiva duplicada",
      title: "Posible preventiva duplicada",
      message: `Hay otra preventiva vigente de este equipo y esta pauta, muy cerca en el tiempo o en la lectura.${detail.duplicateConfirmed ? " El mecánico confirmó en el teléfono que era otro trabajo." : ""}`,
      action: "Si es el mismo trabajo, anula uno de los dos.",
      linkTo: detail.duplicateOf,
    })
  }

  if (detail.stampGap) {
    const { hours, subject, photoId, at } = detail.stampGap
    const gap = gapText(hours)
    const direction = new Date(at).getTime() <= new Date(detail.receivedAt).getTime() ? "antes" : "después"
    const label = `Hora del sello y de recepción difieren más de ${STAMP_GAP_LIMIT_HOURS} h`
    if (subject === "foto") {
      const index = detail.photos.findIndex((photo) => photo.id === photoId)
      const caption = index >= 0 ? photoCaption(detail.photos, index) : "Foto"
      tags.push({
        key: "stamp",
        label,
        title: "La fecha de una foto no cuadra",
        message: `La foto «${caption}» es del ${formatDate(at)}, ${gap} ${direction} de que se recibiera el registro, y el teléfono no declaró un período sin señal. Puede ser una foto de otra mantención.`,
        action: "Pide una foto nueva o confirma con el mecánico.",
        anchor: photoId ? { href: `#foto-${photoId}`, label: "Ver la foto" } : undefined,
      })
    } else {
      tags.push({
        key: "stamp",
        label,
        title: "La hora de la firma no cuadra",
        message: `El teléfono firmó el registro el ${formatDateTime(at)}, ${gap} ${direction} de que llegara a la plataforma, y no declaró un período sin señal. La hora del teléfono puede estar mal.`,
        action: "Confirma con el mecánico la fecha en que hizo el trabajo.",
        anchor: { href: DATA_ANCHOR, label: "Ver las fechas" },
      })
    }
  }

  return tags
}
