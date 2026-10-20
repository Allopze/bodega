import {
  DANO_POTENCIAL_LABELS,
  closingActFromDefinition,
  effectiveRequiredItems,
  fieldKindIsScorable,
  formatSignatureRole,
  inspectionResultOptionsFor,
  type InspectionResult,
} from "@/lib/prevention/inspections"
import { isEppUseDefinition } from "@/lib/prevention/epp-inspection-rows"
import type { ChecklistDefinition, FieldKind, SelectOption } from "@/lib/sst/types"

/**
 * Vista previa de solo lectura del cuestionario de una plantilla: lo que se
 * pregunta, con qué escala, qué exige el cierre y cómo se firma.
 *
 * Es el mapeador puro de `ChecklistDefinition` a lo que la pantalla muestra, sin
 * base de datos ni `node:crypto`: lo usa el servicio que arma la respuesta de la
 * ruta y lo prueban los tests de Node. Antes se aprobaba una plantilla y se
 * declaraba su paridad sin poder ver una sola pregunta (auditoría 2026-10-19,
 * P1-12): `definitionSnapshot` ni siquiera llegaba al cliente.
 *
 * Reutiliza las reglas del motor en vez de reimplementarlas —la escala sale de
 * `inspectionResultOptionsFor`, lo obligatorio de `effectiveRequiredItems`, el
 * acta de `closingActFromDefinition`—: una vista previa que opinara distinto de
 * lo que luego exige la ejecución sería peor que no tenerla.
 */

/** Cómo se responde un ítem que no expresa conformidad: su dato, no un juicio. */
const DATA_KIND_LABELS: Partial<Record<FieldKind, string>> = {
  text: "Texto corto",
  textarea: "Texto libre",
  number: "Número",
  date: "Fecha",
  select: "Una opción de la lista",
  multiselect: "Varias opciones de la lista",
  signature: "Firma",
  readonly: "Solo lectura",
}

export interface TemplatePreviewItem {
  id: string
  label: string
  /** Escala con la etiqueta del instrumento («Bueno / Regular / Malo»). Vacía si el ítem registra un dato. */
  scale: { result: InspectionResult; label: string }[]
  /** Qué dato registra un ítem sin escala («Fecha», «Número»…); `null` si tiene escala. */
  dataKindLabel: string | null
  /** Opciones de un ítem de selección. */
  options: SelectOption[]
  placeholder: string | null
  /** La plantilla lo declara obligatorio. */
  required: boolean
  /** Lo que de verdad exige el cierre: obligatorio declarado o ítem puntuable de una sección que cuenta. */
  effectiveRequired: boolean
  /** Puntúa para el cumplimiento. */
  scored: boolean
  danoPotencial: string | null
  danoPotencialLabel: string | null
  /** Fila y columna de una matriz (EPP: «Casco» · «Usa»); `null` fuera de una matriz. */
  matrix: { rowLabel: string; columnLabel: string } | null
}

export interface TemplatePreviewSection {
  id: string
  title: string
  description: string | null
  countsForCompliance: boolean
  items: TemplatePreviewItem[]
}

export interface TemplatePreviewClosingAct {
  title: string
  resultOptions: SelectOption[]
  hasRestrictions: boolean
  signatureRoles: { role: string; label: string }[]
}

export interface TemplatePreview {
  title: string
  subtitle: string | null
  objective: string | null
  applicableTo: string | null
  sections: TemplatePreviewSection[]
  totals: {
    sections: number
    items: number
    /** Ítems que el cierre exige responder. */
    effectiveRequired: number
    /** Ítems que puntúan para el cumplimiento. */
    scored: number
    /** Ítems con gravedad declarada. */
    withDanoPotencial: number
    /** Ítems que registran un dato en vez de un juicio. */
    dataItems: number
  }
  closingAct: TemplatePreviewClosingAct | null
  /** Registra desviaciones del catálogo en vez de puntuar ítems. */
  recordsDeviations: boolean
  recordsPreventiveActions: boolean
  /** Cierra al declararse ejecutado, sin revisión independiente. */
  closesOnCompletion: boolean
  /** Las prendas se arman con la bodega de la faena al crear la inspección (EPP). */
  rowsFromWarehouse: boolean
}

/** Una versión del mismo código de instrumento, para el historial de la vista previa. */
export interface TemplatePreviewVersion {
  id: string
  versionLabel: string
  status: string
  statusLabel: string
  createdAt: string
  approvedAt: string | null
  supersededAt: string | null
  /** La que se está mirando. */
  current: boolean
}

/** Lo que sirve para cotejar la plantilla con el anexo oficial; plegado en la pantalla. */
export interface TemplatePreviewTechnical {
  /** Código interno del instrumento (comparte todas sus versiones). */
  code: string
  /** Definición en código de la que salió el snapshot; `null` si no tiene origen. */
  sourceDefinitionCode: string | null
  provenanceLabel: string
  source: {
    documentId: string
    versionId: string
    fileName: string
    revision: string | null
    checksumSha256: string
  } | null
  /** SHA-256 del JSON congelado del cuestionario. */
  contentHash: string
  parity: {
    status: string
    expectedItems: number | null
    actualItems: number | null
    differences: string[]
    verifiedAt: string | null
  } | null
}

/** La respuesta de `GET /api/prevencion/inspecciones/plantillas/[templateId]/vista-previa`. */
export interface TemplatePreviewPayload {
  template: {
    id: string
    code: string
    versionLabel: string
    name: string
    kind: string
    status: string
    statusLabel: string
    createdAt: string
    approvedAt: string | null
    supersededAt: string | null
  }
  questionnaire: TemplatePreview
  versions: TemplatePreviewVersion[]
  technical: TemplatePreviewTechnical
}

const orNull = (value: string | undefined | null) => (value && value.trim() ? value : null)

/**
 * Aplana la definición en secciones e ítems legibles. Un snapshot sin
 * `sections` (fixture a mano, snapshot legado incompleto) da una vista vacía en
 * vez de reventar: la plantilla se ve igual y se nota que no tiene preguntas.
 */
export function buildInspectionTemplatePreview(definition: ChecklistDefinition): TemplatePreview {
  const rawSections = Array.isArray(definition.sections) ? definition.sections : []

  // La obligatoriedad efectiva se calcula con la misma función que el cierre,
  // sobre las especificaciones planas, y se cruza por posición.
  const specs = rawSections.flatMap((section) => section.items.map((item) => ({
    required: item.required ?? false,
    countsForCompliance: section.countsForCompliance ?? true,
    kind: item.kind,
  })))
  const effective = new Set(effectiveRequiredItems(specs))

  let cursor = 0
  const sections: TemplatePreviewSection[] = rawSections.map((section) => ({
    id: section.id,
    title: section.title,
    description: orNull(section.description),
    countsForCompliance: section.countsForCompliance ?? true,
    items: section.items.map((item) => {
      const spec = specs[cursor++]!
      const scale = inspectionResultOptionsFor(item.kind)
      const scorable = fieldKindIsScorable(item.kind)
      return {
        id: item.id,
        label: item.label,
        scale,
        dataKindLabel: scorable ? null : DATA_KIND_LABELS[item.kind] ?? "Dato",
        options: item.options ?? [],
        placeholder: orNull(item.placeholder),
        required: spec.required,
        effectiveRequired: effective.has(spec),
        scored: scorable && spec.countsForCompliance,
        danoPotencial: item.danoPotencial ?? null,
        danoPotencialLabel: item.danoPotencial ? DANO_POTENCIAL_LABELS[item.danoPotencial] ?? item.danoPotencial : null,
        matrix: item.matrix ? { rowLabel: item.matrix.rowLabel, columnLabel: item.matrix.columnLabel } : null,
      }
    }),
  }))

  const items = sections.flatMap((section) => section.items)
  const act = closingActFromDefinition(definition)

  return {
    title: definition.title,
    subtitle: orNull(definition.subtitle),
    objective: orNull(definition.objective),
    applicableTo: orNull(definition.applicableTo),
    sections,
    totals: {
      sections: sections.length,
      items: items.length,
      effectiveRequired: items.filter((item) => item.effectiveRequired).length,
      scored: items.filter((item) => item.scored).length,
      withDanoPotencial: items.filter((item) => item.danoPotencial !== null).length,
      dataItems: items.filter((item) => item.dataKindLabel !== null).length,
    },
    closingAct: act
      ? {
          title: act.title,
          resultOptions: act.resultOptions,
          hasRestrictions: act.hasRestrictions,
          signatureRoles: act.signatureRoles.map((role) => ({ role, label: formatSignatureRole(role) })),
        }
      : null,
    recordsDeviations: Boolean(definition.recordsDeviations),
    recordsPreventiveActions: Boolean(definition.recordsPreventiveActions),
    closesOnCompletion: Boolean(definition.closesOnCompletion),
    rowsFromWarehouse: isEppUseDefinition(definition),
  }
}

/** «Cumple · No cumple · No aplica»: la escala en una línea, con la etiqueta del papel. */
export function scaleSummary(scale: readonly { label: string }[]): string {
  return scale.map((option) => option.label).join(" · ")
}
