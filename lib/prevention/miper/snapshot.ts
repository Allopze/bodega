/**
 * Foto autosuficiente de un MIPER: la forma que se congela en cada ronda de
 * revisión y en cada versión sellada. Lleva nombres, no ids de diccionario,
 * para que una versión antigua se pueda leer y exportar aunque el diccionario
 * cambie después. El diff entre dos fotos es la base de "Modificados desde la
 * ronda anterior" y de "cambios pendientes de revisión".
 */
import type { RiskClassification } from "./methodology"

export type ControlHierarchy = "elimination" | "substitution" | "engineering" | "administrative" | "ppe"
export type ControlledStatus = "yes" | "partial" | "no"

export type MiperControlSnapshot = {
  id: string; hierarchy: ControlHierarchy; description: string
  responsibleUserId: string | null; responsibleName: string | null; dueDate: string | null; status: string
  /**
   * D5 (Fase C). Opcionales porque una foto sellada antes de la Fase C no los
   * trae, y una foto sellada no se recalcula. Ausente = por implementar y sin
   * frecuencia, la regla de entonces: así los leen `controlsKey`, la
   * completitud y el Excel. Las fotos nuevas los llevan siempre, al final.
   */
  isExisting?: boolean
  verificationFrequency?: string | null
}

export type MiperEntrySnapshot = {
  id: string; rowNumber: number
  activity: string | null; task: string | null; position: string | null; location: string | null
  exposedFemale: number; exposedMale: number; exposedOther: number
  riskFactorId: string | null; riskFactor: string | null; isRoutine: boolean | null
  hazard: string | null; risk: string | null; probableDamage: string | null
  probability: number | null; consequence: number | null; magnitude: number | null
  classification: RiskClassification | null; controlledStatus: ControlledStatus | null
  controls: MiperControlSnapshot[]
}

export type MiperHeaderSnapshot = {
  period: number | null; iperCode: string | null; elaboratedOn: string | null; updatedOn: string | null
  companyName: string | null; companyRut: string | null; companyAddress: string | null; companyCommune: string | null
  economicActivity: string | null; adherentNumber: string | null; worksiteName: string | null
  siteRepresentativeUserId: string | null; siteRepresentativeName: string | null
  headcountTotal: number | null; headcountMale: number | null; headcountFemale: number | null; headcountOther: number | null
  participationSummary: string; consultationEvidenceReference: string
}

export type MiperSnapshot = { header: MiperHeaderSnapshot; entries: MiperEntrySnapshot[] }
export type EntryChange = { kind: "added" | "removed" | "modified"; entryId: string; rowNumber: number; fields: string[] }
export type SnapshotDiff = { headerFields: string[]; entries: EntryChange[]; hasChanges: boolean }

export const CONTROL_HIERARCHY_LABEL: Record<ControlHierarchy, string> = {
  elimination: "I. Eliminación",
  substitution: "II. Sustitución",
  engineering: "III. Controles de ingeniería",
  administrative: "IV. Controles administrativos",
  ppe: "V. Elementos de protección personal",
}

export const CONTROLLED_STATUS_LABEL: Record<ControlledStatus, string> = { yes: "Sí", partial: "Parcialmente", no: "No" }

/** Orden = orden de columnas del RE-04. `rowNumber` queda fuera: renumerar no es cambiar contenido. */
const ENTRY_FIELDS = [
  "activity", "task", "position", "location", "exposedFemale", "exposedMale", "exposedOther",
  "riskFactor", "isRoutine", "hazard", "risk", "probableDamage", "probability", "consequence",
  "magnitude", "classification", "controlledStatus",
] as const

export const ENTRY_FIELD_LABEL: Record<string, string> = {
  activity: "Actividad", task: "Tarea", position: "Puesto de trabajo", location: "Lugar específico",
  exposedFemale: "Expuestos F", exposedMale: "Expuestos M", exposedOther: "Expuestos otro",
  riskFactor: "Factor de riesgo", isRoutine: "Rutinaria", hazard: "Peligro", risk: "Riesgo",
  probableDamage: "Daño probable", probability: "Probabilidad", consequence: "Consecuencia",
  magnitude: "MR", classification: "Clasificación", controlledStatus: "¿Está controlado?", controls: "Medidas de control",
}

export const HEADER_FIELD_LABEL: Record<keyof MiperHeaderSnapshot, string> = {
  period: "Período", iperCode: "Código IPER", elaboratedOn: "Fecha de elaboración", updatedOn: "Fecha de actualización",
  companyName: "Razón social", companyRut: "RUT empleador", companyAddress: "Dirección", companyCommune: "Comuna",
  economicActivity: "Actividad económica principal", adherentNumber: "N° de adherente", worksiteName: "Centro de trabajo",
  siteRepresentativeUserId: "Representante de la empresa en la faena (Administrador de contrato)",
  siteRepresentativeName: "Representante de la empresa en la faena (Administrador de contrato)",
  headcountTotal: "N° total de trabajadores", headcountMale: "Trabajadores hombres", headcountFemale: "Trabajadoras mujeres",
  headcountOther: "Trabajadores otro", participationSummary: "Participación y consulta", consultationEvidenceReference: "Evidencia de la consulta",
}

/** Una foto sellada antes de la Fase C no trae `isExisting` ni la frecuencia: se normalizan para que no parezcan cambios. */
function controlsKey(controls: MiperControlSnapshot[]): string {
  return JSON.stringify([...controls].sort((a, b) => a.id.localeCompare(b.id)).map((c) => [
    c.id, c.hierarchy, c.description, c.responsibleUserId, c.responsibleName, c.dueDate, c.status,
    c.isExisting ?? false, c.verificationFrequency ?? null,
  ]))
}

export function diffSnapshots(before: MiperSnapshot | null, after: MiperSnapshot): SnapshotDiff {
  const headerFields = before
    ? (Object.keys(after.header) as Array<keyof MiperHeaderSnapshot>).filter((key) => before.header[key] !== after.header[key])
    : []
  const previous = new Map((before?.entries ?? []).map((item) => [item.id, item]))
  const entries: EntryChange[] = []
  for (const current of after.entries) {
    const old = previous.get(current.id)
    if (!old) { entries.push({ kind: "added", entryId: current.id, rowNumber: current.rowNumber, fields: [] }); continue }
    previous.delete(current.id)
    const fields: string[] = ENTRY_FIELDS.filter((field) => old[field] !== current[field])
    if (controlsKey(old.controls) !== controlsKey(current.controls)) fields.push("controls")
    if (fields.length > 0) entries.push({ kind: "modified", entryId: current.id, rowNumber: current.rowNumber, fields })
  }
  for (const removed of previous.values()) entries.push({ kind: "removed", entryId: removed.id, rowNumber: removed.rowNumber, fields: [] })
  return { headerFields, entries, hasChanges: headerFields.length > 0 || entries.length > 0 }
}

export function changesByEntry(diff: SnapshotDiff): Map<string, EntryChange> {
  return new Map(diff.entries.map((change) => [change.entryId, change]))
}
