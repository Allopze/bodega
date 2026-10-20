import { z } from "zod"
import { validateRe20CausalGraph } from "@/lib/prevention/incidents"

/* Esquemas zod del expediente RE-20 v3 (data pública + payload sensible).
 * Todo lo agregado respecto de expedientes ya guardados es OPCIONAL o con
 * default: un expediente anterior sigue parseando. Las celdas citadas son las
 * del libro «RE-20 v3» (hoja!celda). */

const text = (max: number) => z.string().trim().max(max).nullable().optional()
const dateTime = z.string().datetime({ offset: true }).nullable().optional()
const plainDate = z.union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).nullable().optional()
const clock = z.union([z.string().trim().regex(/^\d{2}:\d{2}$/), z.literal("")]).nullable().optional()
const yesNo = z.boolean().nullable().optional()

export const re20TaskSchema = z.object({
  id: z.string().trim().min(1).max(80),
  sheet: z.string().trim().min(1).max(120),
  label: z.string().trim().min(2).max(300),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).default("pending"),
  responsibleRole: z.string().trim().max(120).nullable().optional(),
  responsibleUserId: z.string().trim().min(1).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  completedAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

/** L_POTENCIAL (Clasificación!D). Acepta los valores anteriores y los normaliza al libro. */
export const RE20_POTENTIAL_VALUES = ["Bajo", "Medio", "Alto", "Grave o fatal"] as const
const LEGACY_POTENTIAL: Record<string, (typeof RE20_POTENTIAL_VALUES)[number]> = {
  low: "Bajo", medium: "Medio", high: "Alto", critical: "Grave o fatal", fatal: "Grave o fatal",
}
const potentialSchema = z.preprocess(
  (value) => typeof value === "string" ? (LEGACY_POTENTIAL[value.trim().toLowerCase()] ?? value.trim()) : value,
  z.enum(RE20_POTENTIAL_VALUES),
).nullable().optional()

/** INV.PRE.ACC!C96:C99 — ocho acciones inmediatas con casilla y responsable. */
export const RE20_IMMEDIATE_ACTIONS = [
  "firstAid", "isolation", "suspension", "evidencePreservation",
  "supervisorNotice", "committeeNotice", "administratorNotice", "authorityNotice",
] as const
const immediateAction = z.object({ marked: z.boolean().default(false), responsible: text(300) })
const immediateActionsSchema = z.object({
  firstAid: immediateAction.optional(),
  isolation: immediateAction.optional(),
  suspension: immediateAction.optional(),
  evidencePreservation: immediateAction.optional(),
  supervisorNotice: immediateAction.optional(),
  committeeNotice: immediateAction.optional(),
  administratorNotice: immediateAction.optional(),
  authorityNotice: immediateAction.optional(),
}).default({})

/** ÁRBOL DE CAUSAS!B34:B41 — 8 aspectos fijos de 7.1. */
export const RE20_VARIATION_ASPECTS = ["person", "task", "equipment", "material", "environment", "organization", "information", "emergency"] as const
/** INV.DEF.ACC!B103:B109 — 7 instrumentos fijos de 9.1. */
export const RE20_INSTRUMENT_IDS = ["iper", "work_program", "procedure", "odi", "training", "maintenance", "emergency_plan"] as const
/** INV.DEF.ACC!B145:B152 — ocho Sí/No de 11.1. */
export const RE20_TEAM_CHECKLIST_KEYS = [
  "coherentTree", "allRootCausesHaveMeasures", "controlHierarchyReviewed", "ownersDefined",
  "sensitiveDataProtected", "iperUpdatedOrJustified", "effectivenessPlanDefined", "attachmentsIncluded",
] as const
/** INV.DEF.ACC!B164:B175 — anexos A–L. */
export const RE20_ANNEX_CODES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"] as const
/** INV.DEF.ACC!B178:K178 — firmas de 4 roles. */
export const RE20_SIGNATURE_ROLES = ["investigator", "cphs", "contract_admin", "area_manager"] as const

const measureEffectivenessSchema = z.object({
  criterion: text(1000),
  method: text(1000),
  /** L_EFICACIA. */
  result: text(80),
  /** L_RIESGO. */
  residualRisk: text(80),
  additionalAction: text(1000),
}).default({})

/** Antes `effectiveness` era un enum plano y `residualRisk`/`evidenceReferences` colgaban de la medida. */
const LEGACY_EFFECTIVENESS: Record<string, string> = {
  effective: "Eficaz", partially_effective: "Parcial", ineffective: "No eficaz",
}
function normalizeMeasure(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw
  const measure = { ...(raw as Record<string, unknown>) }
  if (typeof measure.effectiveness === "string") {
    const result = LEGACY_EFFECTIVENESS[measure.effectiveness]
    measure.effectiveness = result ? { result } : {}
  }
  if (typeof measure.residualRisk === "string" && measure.residualRisk) {
    measure.effectiveness = { ...(measure.effectiveness as object | undefined), residualRisk: measure.residualRisk }
  }
  delete measure.residualRisk
  if (Array.isArray(measure.evidenceReferences)) {
    if (measure.evidence == null && measure.evidenceReferences.length > 0) measure.evidence = measure.evidenceReferences.join("; ")
    delete measure.evidenceReferences
  }
  return measure
}

const measureSchema = z.preprocess(normalizeMeasure, z.object({
  id: z.string().trim().min(1).max(80),
  /** ID del hecho raíz del árbol al que responde (INV.DEF.ACC!B92). */
  rootCauseId: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(3000),
  /** L_CONTROL, ordenado por jerarquía (Eliminación → EPP). */
  controlType: text(80),
  correctivePreventive: text(80),
  scope: text(80),
  priority: text(80),
  responsibleUserId: z.string().trim().min(1).nullable().optional(),
  responsibleRole: z.string().trim().max(120).nullable().optional(),
  resources: text(1000),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** L_ESTADO. */
  status: text(80),
  evidence: text(3000),
  /** Distinto del responsable: INV.DEF.ACC!B112. */
  verifierUserId: z.string().trim().min(1).nullable().optional(),
  verifiedAt: dateTime,
  effectiveness: measureEffectivenessSchema,
  capaId: z.string().trim().min(1).nullable().optional(),
}))

const eventSchema = z.object({
  id: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  verified: z.boolean(),
  source: z.string().trim().max(1000).nullable().optional(),
  expectedBarrier: z.string().trim().max(1000).nullable().optional(),
  actualBarrier: z.string().trim().max(1000).nullable().optional(),
  /** ÁRBOL DE CAUSAS!L10/M10. */
  causal: z.boolean().default(true),
  requiresVerification: z.boolean().default(false),
})

const relationSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  type: z.enum(["chain", "conjunction", "independent"]),
  justification: z.string().trim().max(2000).nullable().optional(),
})

const LEGACY_KEYS = ["diffusion", "accidentFollowups", "damageFollowups", "classification"] as const

function hasContent(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasContent)
  if (typeof value === "string") return value.trim().length > 0
  return true
}

/**
 * `diffusion`, `accidentFollowups`, `damageFollowups` y `classification` dejaron de ser fuente de verdad
 * (la difusión y el seguimiento son tablas canónicas; cada campo lleva su valor de catálogo). Los
 * expedientes guardados antes los traen: se aceptan y, si tenían contenido, se conservan en `legacy`
 * en vez de perderse. Lo vacío se descarta.
 */
function absorbLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const data = { ...(raw as Record<string, unknown>) }
  const legacy = { ...((data.legacy as Record<string, unknown> | undefined) ?? {}) }
  for (const key of LEGACY_KEYS) {
    if (key in data) {
      if (hasContent(data[key])) legacy[key] = data[key]
      delete data[key]
    }
  }
  if (Object.keys(legacy).length > 0) data.legacy = legacy
  return data
}

const preliminarySchema = z.object({
  eventDescription: z.string().trim().max(10000).nullable().optional(),
  activity: z.string().trim().max(500).nullable().optional(),
  /** Descripción general de la lesión (INV.DEF.ACC!B28). El detalle clínico va en `sensitive.injuryClinical`. */
  injuryDescription: z.string().trim().max(2000).nullable().optional(),
  bodyZone: z.string().trim().max(200).nullable().optional(),
  causalAgent: z.string().trim().max(500).nullable().optional(),
  source: z.string().trim().max(500).nullable().optional(),
  conditions: z.string().trim().max(5000).nullable().optional(),
  deviation: z.string().trim().max(5000).nullable().optional(),
  immediateResponse: z.string().trim().max(5000).nullable().optional(),
  initialMeasures: z.string().trim().max(5000).nullable().optional(),
  /** INV.PRE.ACC!C7:C10. */
  managerName: text(300),
  reportDate: plainDate,
  subManagement: text(300),
  area: text(300),
  /** INV.PRE.ACC!C42. */
  shiftEntryTime: clock,
  shiftExitTime: clock,
  /** INV.PRE.ACC!C51:C52 (L_LUGAR + otros). */
  hazardSource: text(300),
  hazardSourceOther: text(300),
  temperature: text(80),
  weather: text(80),
  shiftSystem: text(80),
  /** INV.PRE.ACC!O34. */
  injuryElement: text(500),
  /** INV.PRE.ACC!C101:C106 — dos medidas propuestas. */
  proposedMeasures: z.array(z.string().trim().max(2000)).max(2).default([]),
  /** INV.PRE.ACC!C96:C99. */
  immediateActions: immediateActionsSchema,
  /** INV.PRE.ACC!C100. */
  immediateActionsDetail: text(5000),
}).default({ proposedMeasures: [], immediateActions: {} })

/** INV.DEF.ACC!B19:H27 (el detalle clínico va en `sensitive`). */
const affectedPersonSchema = z.object({
  tenureCompany: text(120),
  taskExperience: text(120),
  shift: text(120),
  hoursWorkedBefore: text(60),
  contractType: text(120),
  directSupervisor: text(300),
  /** L_SNV. */
  trainedForTask: text(80),
  /** L_AUTORIZ. */
  authorization: text(80),
  odiInformed: text(80),
  procedureKnown: text(80),
  ppeRequired: text(1000),
  ppeUsed: text(1000),
  /** L_SEXO. */
  sex: text(40),
  injurySummary: text(2000),
}).default({})

const teamMemberSchema = z.object({
  userId: z.string().trim().max(80).default(""),
  /** Cargo / representación (INV.DEF.ACC!E36). */
  position: text(200),
  /** L_ROL. */
  role: z.string().trim().max(120).default(""),
  visitedSite: yesNo,
  impartialityDeclared: yesNo,
  signedAt: dateTime,
})

const evidenceItemSchema = z.object({
  id: z.string().trim().min(1).max(80),
  /** L_EVIDENCIA. */
  type: text(120),
  description: text(2000),
  origin: text(500),
  date: plainDate,
  custody: text(500),
  attachmentId: z.string().trim().max(100).nullable().optional(),
})

const definitiveSchema = z.object({
  genderPerspective: z.string().trim().max(5000).nullable().optional(),
  /** §7 reconstrucción objetiva en tercera persona. */
  reconstruction: text(10000),
  chronology: z.array(z.object({
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    description: z.string().trim().max(2000),
    evidenceReference: z.string().trim().max(1000).nullable().optional(),
    observations: text(1000),
  })).max(200).default([]),
  /** 7.1 (ÁRBOL DE CAUSAS!B34:J41). */
  variations: z.array(z.object({
    aspect: z.enum(RE20_VARIATION_ASPECTS),
    expected: text(1500),
    actual: text(1500),
    existingControl: text(1500),
    controlFailure: text(1500),
  })).max(8).default([]),
  /** Anterior a 9.1; se conserva para expedientes guardados. */
  preventiveInstruments: z.array(z.object({
    name: z.string().trim().max(300),
    result: z.enum(["reviewed", "gap_found", "not_applicable", "pending"]),
    observation: z.string().trim().max(1500).nullable().optional(),
  })).max(50).default([]),
  /** 9.1 (INV.DEF.ACC!B103:L109). */
  instruments: z.array(z.object({
    id: z.enum(RE20_INSTRUMENT_IDS),
    requiresChange: yesNo,
    change: text(1500),
    responsibleUserId: z.string().trim().max(80).nullable().optional(),
    dueDate: plainDate,
  })).max(7).default([]),
  conclusion: z.string().trim().max(10000).nullable().optional(),
  cphsOpinion: z.string().trim().max(5000).nullable().optional(),
  /** §11 (INV.DEF.ACC!B136:B140). */
  closure: z.object({
    informedTo: text(1000),
    communicationMeansAndDate: text(1000),
    proposedClosureDate: plainDate,
    learningReplicated: yesNo,
    learningDetail: text(3000),
    executiveSummary: text(5000),
  }).default({}),
  /** §11.1: ocho Sí/No. */
  teamChecklist: z.object({
    coherentTree: yesNo,
    allRootCausesHaveMeasures: yesNo,
    controlHierarchyReviewed: yesNo,
    ownersDefined: yesNo,
    sensitiveDataProtected: yesNo,
    iperUpdatedOrJustified: yesNo,
    effectivenessPlanDefined: yesNo,
    attachmentsIncluded: yesNo,
  }).default({}),
  /** §12 pronunciamiento CPHS (INV.DEF.ACC!B156:B160). */
  cphs: z.object({
    sessionDate: plainDate,
    minutesNumber: text(80),
    quorum: yesNo,
    reviewed: yesNo,
    /** L_CPHS. */
    decision: text(120),
    rationale: text(5000),
    measures: text(5000),
  }).default({}),
  /** §13 control de anexos A–L. */
  annexes: z.array(z.object({
    code: z.enum(RE20_ANNEX_CODES),
    /** L_SNNA. */
    included: text(40),
    location: text(300),
  })).max(12).default([]),
  /** §14 firmas. */
  signatures: z.array(z.object({
    role: z.enum(RE20_SIGNATURE_ROLES),
    name: text(300),
    date: plainDate,
  })).max(4).default([]),
}).default({ chronology: [], variations: [], preventiveInstruments: [], instruments: [], closure: {}, teamChecklist: {}, cphs: {}, annexes: [], signatures: [] })

const causalTreeSchema = z.object({
  events: z.array(eventSchema).max(500).default([]),
  relations: z.array(relationSchema).max(1500).default([]),
}).default({ events: [], relations: [] }).superRefine((tree, ctx) => {
  for (const message of validateRe20CausalGraph(tree)) {
    ctx.addIssue({ code: "custom", message })
  }
})

const nearMissSchema = z.object({
  potential: potentialSchema,
  seriousOrFatalPotential: z.boolean().default(false),
  do36TreeRequired: z.boolean().default(false),
  internalPolicyNote: z.string().trim().max(1000).nullable().optional(),
  measures: z.string().trim().max(3000).nullable().optional(),
}).default({ seriousOrFatalPotential: false, do36TreeRequired: false }).transform((value) => {
  // Reporte Cuasi Accidente!D24: con potencial «Grave o fatal» el árbol es obligatorio (DO-36) y no se desmarca.
  const serious = value.potential === "Grave o fatal"
  return {
    ...value,
    seriousOrFatalPotential: serious || value.seriousOrFatalPotential,
    do36TreeRequired: serious || value.do36TreeRequired,
  }
})

export const re20PublicDataSchema = z.preprocess(absorbLegacy, z.object({
  /** Sólo el árbol de causas es seleccionable; «5_whys»/«other» se aceptan por expedientes guardados (el servicio rechaza cambiar a ellos). */
  methodology: z.enum(["causal_tree", "5_whys", "other"]).default("causal_tree"),
  methodologyNote: z.string().trim().max(500).nullable().optional(),
  tasks: z.array(re20TaskSchema).max(80).default([]),
  team: z.array(teamMemberSchema).max(30).default([]),
  conflictOfInterestNotes: text(3000),
  preliminary: preliminarySchema,
  affectedPerson: affectedPersonSchema,
  evidences: z.array(evidenceItemSchema).max(100).default([]),
  definitive: definitiveSchema,
  causalTree: causalTreeSchema,
  measures: z.array(measureSchema).max(200).default([]).superRefine((measures, ctx) => {
    measures.forEach((measure, index) => {
      if (measure.responsibleUserId && measure.verifierUserId && measure.responsibleUserId === measure.verifierUserId) {
        ctx.addIssue({
          code: "custom",
          path: [index, "verifierUserId"],
          message: "El verificador de la medida debe ser una persona distinta de su responsable (INV.DEF.ACC!B112).",
        })
      }
    })
  }),
  nearMiss: nearMissSchema,
  /**
   * Reunión post accidente (PASO A PASO 9, al reintegro). La fecha de reintegro es el
   * vencimiento de la tarea `post_accident_meeting`; antes estas tres partes vivían como
   * texto con encabezados en la nota de esa tarea, que se sigue leyendo como respaldo.
   */
  postAccidentMeeting: z.object({
    causesReviewed: text(620),
    newMeasures: text(620),
    reinstruction: text(620),
  }).optional(),
  attachmentIds: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  /** Copias anteriores de difusión, seguimientos y clasificación libre, conservadas sin interpretarse. */
  legacy: z.record(z.string(), z.unknown()).optional(),
}))

export type Re20PublicData = z.infer<typeof re20PublicDataSchema>
export type Re20Measure = Re20PublicData["measures"][number]

/** RE-20-07 (DECLARACIÓN INDIVIDUAL): `involved`/`witness`/`injured_person`; `cphs` queda como legado. */
const declarationSchema = z.object({
  id: z.string().trim().min(1).max(80),
  personId: z.string().trim().max(80).nullable().optional(),
  kind: z.enum(["involved", "witness", "injured_person", "cphs"]),
  name: z.string().trim().max(200),
  role: z.string().trim().max(200).nullable().optional(),
  investigationNumber: text(80),
  interviewDate: plainDate,
  place: text(300),
  nationalId: text(40),
  contact: text(300),
  interviewers: text(500),
  directKnowledge: z.string().trim().max(3000).nullable().optional(),
  participation: z.string().trim().max(2000).nullable().optional(),
  /** Relato libre (RE-20-07 §1). */
  statement: z.string().trim().max(10000),
  /** Aclaraciones solicitadas (§2). */
  clarifications: text(5000),
  corrections: z.string().trim().max(3000).nullable().optional(),
  /** §3: las 8 preguntas Sí/No. */
  answers: z.object({
    directWitness: yesNo,
    participatedInTask: yesNo,
    knewProcess: yesNo,
    thirdPartyInformation: yesNo,
    sketchAttached: yesNo,
    photosAttached: yesNo,
    contactAuthorized: yesNo,
    reserveIdentity: yesNo,
  }).default({}),
  reserveIdentity: z.boolean().default(false),
  /** Cláusula de la declaración (RE-20-07!B43). */
  clauseAccepted: yesNo,
  attachmentReferences: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  signedAt: z.string().datetime({ offset: true }).nullable().optional(),
})

const yesNoDetail = z.object({ answer: yesNo, detail: text(2000) })

/** RE-20-03 (Entrevista CPHyS-Ejecutivo-Otro). Los campos de la versión anterior se conservan. */
const injuredInterviewSchema = z.object({
  personId: z.string().trim().max(80).nullable().optional(),
  task: z.string().trim().max(2000).nullable().optional(),
  training: z.string().trim().max(2000).nullable().optional(),
  instructions: z.string().trim().max(2000).nullable().optional(),
  ppe: z.string().trim().max(2000).nullable().optional(),
  supervision: z.string().trim().max(2000).nullable().optional(),
  normalVersusActualWork: z.string().trim().max(4000).nullable().optional(),
  workingConditions: z.string().trim().max(3000).nullable().optional(),
  differencesFromUsual: z.string().trim().max(3000).nullable().optional(),
  attachmentReferences: z.array(z.string().trim().min(1).max(1000)).max(100).default([]),
  workerName: text(300),
  position: text(300),
  tenureCompany: text(120),
  tenurePosition: text(120),
  accidentDate: plainDate,
  accidentTime: clock,
  shift: text(120),
  place: text(500),
  summary: text(5000),
  /** B19: la tarea estaba en el ámbito del cargo. */
  taskWithinScope: yesNo,
  /** B23-B27: capacitación (OJT, ODI, familiarización PDR, licencia u otra). */
  trained: yesNo,
  trainingDetail: z.object({
    ojt: yesNo, odi: yesNo, pdrFamiliarization: yesNo, license: text(300), other: text(300),
  }).optional(),
  /** B30: estándar documentado + cuál. */
  documentedStandard: yesNoDetail.optional(),
  knowsStandard: yesNo,
  canDoAlone: yesNo,
  knowsRisks: yesNo,
  ppeUsedAtEvent: text(2000),
  ppeFitsWell: yesNo,
  safetyMeasuresTaken: text(3000),
  talkedWithSupervisor: yesNo,
  whatWouldPrevent: text(3000),
  whatWasDifferent: text(3000),
  whatWasMissing: text(3000),
  interviewDate: plainDate,
  interviewer: text(300),
}).default({ attachmentReferences: [] })

const diatSchema = z.object({
  form: z.record(z.string(), z.union([z.string().trim().max(2000), z.boolean()])).default({}),
  status: z.enum(["draft", "prepared"]).default("draft"),
  knownAt: z.string().datetime({ offset: true }).nullable().optional(),
  sentAt: z.string().datetime({ offset: true }).nullable().optional(),
  receiptReference: z.string().trim().max(1000).nullable().optional(),
  observations: z.string().trim().max(3000).nullable().optional(),
  /** DIAT sección de clasificación. */
  severity: z.enum(["grave", "fatal", "other"]).nullable().optional(),
  scope: z.enum(["work", "commute"]).nullable().optional(),
  commuteType: text(300),
  proofMedium: text(500),
}).default({ form: {}, status: "draft" })

export const re20SensitivePayloadSchema = z.object({
  purpose: z.string().trim().min(3).max(300),
  declarations: z.array(declarationSchema).max(200).default([]),
  injuredInterview: injuredInterviewSchema,
  /** Detalle clínico de la lesión: sale de `data` (INV.DEF.ACC!B28 sólo lleva la descripción general). */
  injuryClinical: z.object({
    description: text(3000),
    bodyPartDetail: text(500),
    clinicalNotes: text(3000),
  }).default({}),
  diat: diatSchema,
})

export type Re20SensitivePayload = z.infer<typeof re20SensitivePayloadSchema>
