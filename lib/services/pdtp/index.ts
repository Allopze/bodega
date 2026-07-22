export type { PdtpSheetView } from "./sheets"
export type { PdtpComplianceMonth, PdtpComplianceIndicators } from "./compliance"
export type { PdtpActivityUpdateInput, PdtpActivityAddInput } from "./activities"
export { readPdtpActivityContent, writePdtpActivityContent } from "./activity-content"
export type { PdtpActivityContent } from "./activity-content"
export type { WorksiteScope } from "./helpers"
export type { PendingPdtpExecution } from "./executions"
export type { PdtpProgramCreateInput } from "./programs"
export type { PdtpSheetCreateInput } from "./sheet-management"

// Re-export schema types para el dominio Checklist → Plan de Acción
export type {
  PdtpActivityChecklist, NewPdtpActivityChecklist,
  PdtpExecutionChecklist, NewPdtpExecutionChecklist,
  PdtpExecutionChecklistResponse, NewPdtpExecutionChecklistResponse,
  PdtpActionPlanItem, NewPdtpActionPlanItem,
  PdtpActionPlanFollowup, NewPdtpActionPlanFollowup,
  PdtpObligation, NewPdtpObligation,
  PdtpObligationReminder, NewPdtpObligationReminder,
  PdtpDocumentHistoryEntry, NewPdtpDocumentHistoryEntry,
  PdtpRoleLegendEntry, NewPdtpRoleLegendEntry,
  PdtpChecklistStatus, PdtpActionEstado, PdtpActionPrioridad, PdtpActionOrigen,
} from "@/db/schema"

export {
  PDTP_ACTION_ESTADOS, PDTP_ACTION_PRIORIDADES, PDTP_CHECKLIST_STATUS,
  PDTP_PLAZO_DIAS_POR_PRIORIDAD, PDTP_ESTADOS_CERRADOS,
  PDTP_DANO_POTENCIAL, PDTP_DANO_POTENCIAL_A_PRIORIDAD,
  pdtpActivityChecklistId, pdtpExecutionChecklistId, pdtpChecklistResponseId,
  pdtpActionPlanItemId, pdtpActionPlanFollowupId,
  plazoFromPrioridad, plazoFromDañoPotencial, isActionVencida,
  requiereDetencionInmediata, PDTP_DANO_POTENCIAL_DETENCION,
} from "./checklist-domain"
export type { PdtpDanoPotencial } from "./checklist-domain"

export {
  assertWorksiteAccess,
  assertPdtpActionPlanItemAccess,
  assertPdtpChecklistInstanceAccess,
  assertPdtpExecutionAccess,
  getPdtpProgramActivityCount,
  isActivePdtpWorksite,
} from "./helpers"

export { loadPdtpCatalog, listPdtpResponsibleCatalog } from "./catalog"
export { projectRecurrenceToLegacySchedule, describePdtpRecurrence, describePdtpRecurrenceImpact } from "./recurrence"
export type { PdtpRecurrenceRule, PdtpRecurrenceFrequency, PdtpScheduleMode } from "./recurrence"
export { createPdtpTemplateVersion, listActivePdtpTemplates, listPdtpTemplatesWithVersions, getPdtpTemplateVersion } from "./templates"
export { getActivePdtpProgram } from "./lifecycle"
export {
  submitPdtpProgramForReview,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  rejectPdtpApprovalStep,
  rejectPdtpProgram,
  reopenRejectedPdtpProgram,
  archivePdtpProgram,
} from "./lifecycle"
export type { PdtpApprovalDecisionValue } from "./lifecycle"
export {
  DEFAULT_PDTP_APPROVAL_STEPS,
  ensureDefaultPdtpApprovalSteps,
  copyPdtpApprovalSteps,
  listPdtpApprovalSteps,
  replacePdtpApprovalSteps,
  getPdtpApprovalProgress,
  listPdtpApprovalDecisions,
  getPdtpApprovalStep,
  listPdtpApprovalProgress,
  decidePdtpApprovalStep,
  assertAllRequiredPdtpApprovalStepsApproved,
} from "./approval-flow"
export type { PdtpApprovalStepInput, PdtpApprovalSegregationRule } from "./approval-flow"
export { getPdtpSheetView, getPdtpSheetViewByProgram, buildPdtpExport } from "./sheets"
export { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution, listPendingPdtpExecutions } from "./executions"
export { getPdtpComplianceIndicators, getPdtpComplianceIndicatorsForScope } from "./compliance"
export { updatePdtpActivity, addPdtpActivity, batchUpdatePdtpActivities, duplicatePdtpActivity, deletePdtpActivity, reorderPdtpActivities, listPdtpProgramActivities, renamePdtpObjective } from "./activities"
export type { PdtpObjectiveRenameInput, PdtpActivityBatchUpdateInput } from "./activities"
export { findPdtpWeeklyPending, runPdtpWeeklyReminders, runPdtpActionPlanVencidasReminders, runPdtpObligationReminders } from "./reminders"
export type { PdtpPendingTarget, PdtpWeeklyPendingResult, PdtpActionVencidasReminderResult, PdtpObligationReminderResult } from "./reminders"
export { setPdtpActivityOverride, deletePdtpActivityOverride, loadPdtpOverrides, applyOverridesToSchedule } from "./overrides"
export type { PdtpOverrideInput } from "./overrides"
export { cleanupPdtpEvidenceOrphans } from "./evidence-gc"
export type { CleanupPdtpEvidenceOrphansOptions, CleanupPdtpEvidenceOrphansResult } from "./evidence-gc"
export { createPdtpProgram, updatePdtpProgram, listPdtpPrograms, getPdtpProgram, deletePdtpProgram } from "./programs"
export { stagePdtpXlsxImport, applyPdtpImportBatch, cancelPdtpImportBatch, finalizePdtpImportBootstrap, rollbackPdtpImportBatch, getPdtpImportBatch } from "./imports"
export type { PdtpImportPreview } from "./imports"
export { getPdtpDocumentMetadata, listPdtpReconciliationCandidates, reconcilePdtpDeclaredActor } from "./document-metadata"
export { ensurePdtp2026ChecklistTemplates } from "./checklist-templates-2026"
export {
  createPdtpObligation,
  reportPdtpObligation,
  cancelPdtpObligation,
  listPdtpObligations,
  listPdtpDemandActivities,
  getPdtpDemandIndicator,
  refreshPdtpObligationStatuses,
  listPdtpObligationReminderCandidates,
  recordPdtpObligationReminder,
} from "./obligations"
export type { PdtpObligationOrigin, PdtpObligationStatus, PdtpReminderWindow } from "./obligations"
export { createPdtpSheet, deletePdtpSheet, listPdtpProgramSheets } from "./sheet-management"

// ── Checklist → Plan de Acción → Seguimiento ─────────────────────────────────
export type { PdtpChecklistTemplateInput, PdtpChecklistTemplate } from "./checklists"
export {
  savePdtpActivityChecklist, getActivePdtpActivityChecklist,
  listPdtpActivityChecklists, listProgramActiveChecklists,
  deletePdtpActivityChecklist, ensureDefaultChecklist,
} from "./checklists"

export type { PdtpChecklistResponseInput, PdtpExecutionChecklistInstance, PdtpChecklistSubject } from "./execution-checklists"
export {
  getOrCreateExecutionChecklist, getExecutionChecklist, listExecutionChecklists,
  getChecklistResponses,
  upsertChecklistResponses, completeExecutionChecklist,
  calculateInstanceCompliance, getNonCompliantItems, getAverageVerificationCompliance,
  recalcExecutionQuantityFromInstances,
} from "./execution-checklists"

export type { PdtpActionPlanItemInput, PdtpActionPlanItemUpdate } from "./action-plan"
export {
  generateActionPlanFromChecklist, submitExecutionChecklist, listActionPlanItems,
  createActionPlanItem, updateActionPlanItem, deleteActionPlanItem,
  listActionsByProgram, getActionPlanClosureRate,
  verifyActionPlanItem, reopenActionPlanItem,
} from "./action-plan"

export type { PdtpFollowupInput } from "./followups"
export { addFollowup, listFollowups, listVencidas } from "./followups"

export type { PdtpIntegralCompliance, PdtpIntegralComplianceAxes } from "./compliance"
export { getPdtpIntegralCompliance } from "./compliance"

export type { PdtpManagementReport, PdtpManagementReportFilters, PdtpManagementReportObjectiveRow } from "./management-report"
export { getPdtpManagementReport, resolveActivePdtpProgramId } from "./management-report"

export type { PdtpAuditDossier } from "./audit-dossier"
export { getPdtpAuditDossier } from "./audit-dossier"
