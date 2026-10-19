import { formatDate } from "@/lib/utils"
import type { FieldKind } from "@/lib/sst/types"
import { inspectionSubjectTypeLabel } from "@/lib/prevention/inspection-list-query"

/**
 * Cómo se lee una respuesta ya guardada.
 *
 * La pantalla en modo lectura, el acta impresa y el Excel mostraban el valor
 * tal como se almacena: `pqs` en vez de «PQS (Polvo Químico Seco)» o una fecha
 * ISO en vez de `19-10-2026`. Este es el único sitio que lo traduce; ningún
 * consumidor debe reimplementarlo.
 */

/** Lo mínimo del ítem que hace falta para leer su respuesta. */
export interface AnswerValueItem {
  kind?: FieldKind | null
  options?: readonly { value: string; label: string }[]
}

/**
 * - `date`: formato de fecha de la plataforma (hora de Chile).
 * - `select`: la etiqueta de la opción elegida; si la opción ya no existe, el valor guardado.
 * - `multiselect`: cada valor traducido, separados por coma.
 * - cualquier otro: el texto recortado.
 *
 * Un valor vacío devuelve `empty` y no una cadena en blanco.
 */
export function formatInspectionAnswerValue(
  item: AnswerValueItem | null | undefined,
  value: string | null | undefined,
  empty = "—",
): string {
  const text = value?.trim() ?? ""
  if (text === "") return empty
  const options = item?.options ?? []
  const labelOf = (raw: string) => options.find((option) => option.value === raw)?.label ?? raw

  switch (item?.kind) {
    case "date":
      return formatDate(text)
    case "select":
      return labelOf(text)
    case "multiselect":
      return text.split(",").map((part) => labelOf(part.trim())).filter(Boolean).join(", ") || empty
    default:
      return text
  }
}

/** «Camión · KA122», o solo el rótulo si no hay tipo, o `empty` si no hay nada. */
export function formatInspectionSubject(
  subjectType: string | null | undefined,
  subjectLabel: string | null | undefined,
  empty = "—",
): string {
  const type = subjectType?.trim() ?? ""
  const label = subjectLabel?.trim() ?? ""
  if (type) return label ? `${inspectionSubjectTypeLabel(type)} · ${label}` : inspectionSubjectTypeLabel(type)
  return label || empty
}

/** Puntos base (8000) → «80%», igual que el resto de la plataforma; `emptyLabel` cuando no hay cifra. */
export function formatComplianceBasisPoints(basisPoints: number | null | undefined, emptyLabel: string): string {
  if (basisPoints === null || basisPoints === undefined) return emptyLabel
  return `${basisPoints / 100}%`
}
