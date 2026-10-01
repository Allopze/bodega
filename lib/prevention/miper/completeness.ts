/**
 * Reglas del §5.1 del spec, una sola vez: la grilla las pinta en vivo y el
 * servicio las aplica al enviar a revisión. Los errores bloquean el envío; las
 * advertencias sólo se muestran (el Intolerable siempre lleva su advertencia
 * crítica, aunque esté completo).
 */
import { isScaleValue } from "./methodology"
import type { MiperSnapshot } from "./snapshot"

export type CompletenessIssue = {
  scope: "header" | "entry" | "control"
  entryId?: string
  controlId?: string
  field: string
  message: string
  severity: "error" | "warning"
}

const REQUIRED_ENTRY_FIELDS: Array<[keyof MiperSnapshot["entries"][number], string]> = [
  ["activity", "Falta la actividad."], ["task", "Falta la tarea."], ["position", "Falta el puesto de trabajo."],
  ["riskFactorId", "Falta el factor de riesgo."], ["hazard", "Falta el peligro."], ["risk", "Falta el riesgo."],
  ["probableDamage", "Falta el daño probable."], ["controlledStatus", "Indica si el riesgo está controlado."],
]

export function checkMiperCompleteness(
  snapshot: MiperSnapshot,
  options: { linkedControlIds?: ReadonlySet<string>; requireProgramLink?: boolean } = {},
): CompletenessIssue[] {
  const issues: CompletenessIssue[] = []
  const h = snapshot.header
  const headerError = (field: string, message: string) => issues.push({ scope: "header", field, message, severity: "error" })
  if (h.elaboratedOn && h.updatedOn && h.updatedOn < h.elaboratedOn) headerError("updatedOn", "La fecha de actualización no puede ser anterior a la de elaboración.")
  if (!h.elaboratedOn) headerError("elaboratedOn", "Falta la fecha de elaboración.")
  const counts = [h.headcountMale, h.headcountFemale, h.headcountOther]
  if (h.headcountTotal === null || counts.some((value) => value === null)) headerError("headcountTotal", "Completa la dotación: total, hombres, mujeres y otro.")
  else if (counts.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== h.headcountTotal) headerError("headcountTotal", "Hombres + mujeres + otro debe sumar el total de trabajadores.")
  if (!h.siteRepresentativeName) headerError("siteRepresentativeName", "Falta el representante de la empresa en la faena (Administrador de contrato).")
  if (snapshot.entries.length === 0) headerError("entries", "La matriz no tiene registros de evaluación.")

  for (const entry of snapshot.entries) {
    const err = (field: string, message: string, controlId?: string) =>
      issues.push({ scope: controlId ? "control" : "entry", entryId: entry.id, controlId, field, message, severity: "error" })
    for (const [field, message] of REQUIRED_ENTRY_FIELDS) if (entry[field] === null || entry[field] === "") err(field, message)
    if (!isScaleValue(entry.probability)) err("probability", "Selecciona la probabilidad (Baja, Media o Alta).")
    if (!isScaleValue(entry.consequence)) err("consequence", "Selecciona la consecuencia (Baja, Media o Alta).")

    const cls = entry.classification
    if ((entry.controlledStatus === "yes" || entry.controlledStatus === "partial") && entry.controls.length === 0) {
      err("controls", "Si el riesgo está controlado (total o parcialmente), registra al menos una medida.")
    }
    if ((cls === "important" || cls === "intolerable") && entry.controls.length === 0) {
      err("controls", "Un riesgo Importante o Intolerable exige al menos una medida de control.")
    }
    const assigned = entry.controls.filter((control) => control.dueDate && (control.responsibleUserId || control.responsibleName))
    if (cls === "important" && entry.controlledStatus !== "yes" && entry.controls.length > 0 && assigned.length === 0) {
      err("dueDate", "Un riesgo Importante no controlado exige una medida con responsable y plazo.")
    }
    if (cls === "intolerable") {
      if (entry.controls.length > 0 && assigned.length === 0) err("dueDate", "Un riesgo Intolerable exige una medida con responsable y plazo.")
      if (options.requireProgramLink && !entry.controls.some((control) => options.linkedControlIds?.has(control.id))) {
        err("programLink", "Un riesgo Intolerable exige una medida vinculada a una actividad del Programa de Trabajo.")
      }
      issues.push({ scope: "entry", entryId: entry.id, field: "classification", severity: "warning", message: "Riesgo Intolerable: no debe comenzar ni continuar el trabajo hasta que se reduzca el riesgo." })
    }
    for (const control of entry.controls) {
      if (control.description.trim().length < 3) err("description", "La medida necesita una descripción.", control.id)
      if (!control.dueDate) err("dueDate", "La medida necesita un plazo.", control.id)
      if (cls !== "tolerable" && !control.responsibleUserId && !control.responsibleName) err("responsible", "La medida necesita un responsable.", control.id)
    }
  }
  return issues
}

export function issuesByEntry(issues: CompletenessIssue[]): Map<string, CompletenessIssue[]> {
  const map = new Map<string, CompletenessIssue[]>()
  for (const issue of issues) if (issue.entryId) map.set(issue.entryId, [...(map.get(issue.entryId) ?? []), issue])
  return map
}
