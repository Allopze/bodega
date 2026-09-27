/**
 * Fachada del servicio de inspecciones de Prevención (PREV-M09).
 *
 * El servicio vivía en un solo archivo de ~3.400 líneas; se dividió por
 * responsabilidad bajo `lib/services/prevention-inspections/` sin cambiar
 * lógica ni nombres. Este archivo re-exporta exactamente la misma API pública
 * que tenía, así que ningún import del repo cambia: se sigue importando desde
 * `@/lib/services/prevention-inspections`.
 *
 * Los helpers internos que un módulo comparte con otro (`kindCondition`,
 * `assertContainerSubject`, `requireEditableRunForDeviation`) se exportan entre
 * módulos hermanos pero NO se re-exportan aquí: siguen fuera de la API pública.
 */

export { type InspectionAccess, assertInspectionOperationEnabled } from "./prevention-inspections/module-toggle"

export {
  itemsFromDefinition,
  contentHashOf,
  importInspectionTemplate,
  setInspectionTemplatePdtpActivities,
  setInspectionTemplateParity,
  approveInspectionTemplate,
  rollbackInspectionTemplate,
  retireInspectionTemplate,
} from "./prevention-inspections/templates"

export {
  createInspectionProgram,
  updateInspectionProgram,
  assertProgramInScope,
  resolveSubject,
  listInspectionSubjects,
  listInspectionSubjectsByWorksite,
  listRiskEntriesForWorksite,
} from "./prevention-inspections/programs"

export {
  createInspectionRun,
  saveInspectionAnswers,
  completeInspectionRun,
  createFindingCapa,
  stopVehicleForFinding,
  reviewInspectionRun,
  closeInspectionFinding,
} from "./prevention-inspections/runs"

export { transitionInspectionRun, reassignInspectionRun } from "./prevention-inspections/transitions"

export {
  addRunDocument,
  deleteRunDocument,
  addAnswerEvidence,
  assertFindingEvidenceUploadAllowed,
  addFindingEvidence,
  deleteAnswerEvidence,
} from "./prevention-inspections/evidence"

export {
  type InspectionKindFilter,
  type InspectionListFilters,
  INSPECTION_PAGE_SIZE,
  listInspectionRuns,
  summarizeInspectionRuns,
  listAllInspectionRunsForExport,
  getInspectionRunDetail,
  summarizeInspectionTimelyClosure,
  summarizeInspectionTrends,
} from "./prevention-inspections/queries"

export { saveInspectionParticipants, registerInspectionPreventiveAction } from "./prevention-inspections/annexes"

export {
  listInspectionTemplates,
  listInspectionDocumentSources,
  listInspectionPrograms,
  listInspectionWorksites,
  type InspectionAssignee,
  listInspectionAssignees,
  listInspectionReviewers,
  listInspectionPdtpActivityOptions,
  listImportableDefinitions,
} from "./prevention-inspections/catalogs"

export { remindInspectionReview, remindTemplateApproval } from "./prevention-inspections/reminders"

export { listUnclassifiedDeviationsFor, registerDeviation, removeDeviation } from "./prevention-inspections/deviations"
