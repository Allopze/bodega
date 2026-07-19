export type { PdtpSheetView } from "./sheets"
export type { PdtpComplianceMonth, PdtpComplianceIndicators } from "./compliance"
export type { PdtpActivityUpdateInput, PdtpActivityAddInput } from "./activities"
export type { WorksiteScope } from "./helpers"
export type { PendingPdtpExecution } from "./executions"
export type { PdtpProgramCreateInput, PdtpProgramImportInput } from "./programs"
export type { PdtpSheetCreateInput } from "./sheet-management"

// Re-export schema types para el dominio Checklist → Plan de Acción
export type {
  PdtpActivityChecklist, NewPdtpActivityChecklist,
  PdtpExecutionChecklist, NewPdtpExecutionChecklist,
  PdtpExecutionChecklistResponse, NewPdtpExecutionChecklistResponse,
  PdtpActionPlanItem, NewPdtpActionPlanItem,
  PdtpActionPlanFollowup, NewPdtpActionPlanFollowup,
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
} from "./helpers"

export { loadPdtpCatalog, listPdtpResponsibleCatalog } from "./catalog"
export { getActivePdtpProgram } from "./lifecycle"
export { approvePdtpProgramJdpr, signPdtpProgramLegal, activatePdtpProgram } from "./lifecycle"
export { getPdtpSheetView, getPdtpSheetViewByProgram, buildPdtpExport } from "./sheets"
export { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution, listPendingPdtpExecutions } from "./executions"
export { getPdtpComplianceIndicators } from "./compliance"
export { updatePdtpActivity, addPdtpActivity, deletePdtpActivity, reorderPdtpActivities, listPdtpProgramActivities, renamePdtpObjective } from "./activities"
export type { PdtpObjectiveRenameInput } from "./activities"
export { findPdtpWeeklyPending, runPdtpWeeklyReminders, runPdtpActionPlanVencidasReminders } from "./reminders"
export type { PdtpPendingTarget, PdtpWeeklyPendingResult, PdtpActionVencidasReminderResult } from "./reminders"
export { setPdtpActivityOverride, deletePdtpActivityOverride, loadPdtpOverrides, applyOverridesToSchedule } from "./overrides"
export type { PdtpOverrideInput } from "./overrides"
export { cleanupPdtpEvidenceOrphans } from "./evidence-gc"
export type { CleanupPdtpEvidenceOrphansOptions, CleanupPdtpEvidenceOrphansResult } from "./evidence-gc"
export { createPdtpProgram, updatePdtpProgram, listPdtpPrograms, getPdtpProgram, deletePdtpProgram, importPdtpFromExcel } from "./programs"
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
