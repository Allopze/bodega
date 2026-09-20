export type { PdtpAggregateActivityWorksite, PdtpAggregateWorksiteSummary, PdtpAggregatedSheetView, PdtpSheetView } from "./sheets"
export type { PdtpComplianceMonth, PdtpComplianceIndicators, PdtpCategoryCompliance } from "./compliance"
export type { PdtpActivityUpdateInput, PdtpActivityAddInput, PdtpScheduleConflictDetail } from "./activities"
export { PdtpScheduleConflictError } from "./activities"
export { listPdtpExecutionConnectors, getPdtpExecutionConnector } from "./connectors"
export type { PdtpExecutionConnector, PdtpCompletionPolicy, PdtpEvidenceKind, PdtpConnectorEvent, ConnectorInstrument, PdtpExecutableInstance } from "./connectors"
export { listPdtpExecutableInstances, pdtpExecutableInstancesSourceSql, pdtpExecutableInstancesQueueSql } from "./executable-instances"
export type { PdtpExecutableInstanceKind, PdtpExecutableInstanceStatus, PdtpExecutionStatus, PdtpExecutableInstanceDerivedStatus, PdtpExecutableInstanceRow, ListPdtpExecutableInstancesFilters, PdtpExecutableInstanceFilters } from "./executable-instances"
export { materializePdtpScheduledInstances, reconcilePdtpScheduledInstances, buildPdtpScheduledInstanceRows, derivePdtpScheduledInstanceStatus, pdtpScheduledInstanceIdempotencyKey } from "./scheduled-instances"
export type { PdtpScheduledInstanceSeed, PdtpScheduledInstanceDerivedStatus } from "./scheduled-instances"
export { getPdtpScheduledInstanceStartContext, pdtpScheduledExecutionStartIdempotencyKey, resolvePdtpScheduledInstrument, startPdtpScheduledInstance, assertPdtpScheduledInstanceTransition, recordPdtpScheduledInstanceOutcome } from "./scheduled-execution"
export type { PdtpScheduledInstanceAction } from "./scheduled-execution"
export { assertPdtpTriggerEventSupported, pdtpTriggerEventIdempotencyKey, recordPdtpTriggerEvent, reconcilePdtpTriggerEvents } from "./trigger-events"
export { calculatePdtpScheduledInstanceCompliance } from "./scheduled-compliance"
export type { PdtpScheduledCompliance, PdtpScheduledComplianceRow } from "./scheduled-compliance"
export { readPdtpActivityContent, writePdtpActivityContent } from "./activity-content"
export type { PdtpActivityContent } from "./activity-content"
export type { WorksiteScope } from "./helpers"
export type { PendingPdtpExecution } from "./executions"
export type { PdtpSheetCreateInput } from "./sheet-management"

// Re-export schema types para el dominio Checklist → Plan de Acción
export type {
  PdtpActivityChecklist, NewPdtpActivityChecklist,
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
  plazoFromPrioridad, plazoFromDañoPotencial, isActionVencida,
  requiereDetencionInmediata, PDTP_DANO_POTENCIAL_DETENCION,
} from "./checklist-domain"
export type { PdtpDanoPotencial } from "./checklist-domain"

export {
  assertWorksiteAccess,
  assertPdtpActionPlanItemAccess,
  assertPdtpExecutionAccess,
  getPdtpProgramActivityCount,
  isActivePdtpWorksite,
} from "./helpers"

export { loadPdtpCatalog, listPdtpResponsibleCatalog } from "./catalog"
export { projectRecurrenceToLegacySchedule, describePdtpRecurrence, describePdtpRecurrenceImpact, deriveScheduleHorizon } from "./recurrence"
export type { PdtpRecurrenceRule, PdtpRecurrenceFrequency, PdtpScheduleMode } from "./recurrence"
export {
  createPdtpTemplateVersion,
  publishPdtpBase2026Revision,
  listActivePdtpTemplates,
  listPdtpTemplatesWithVersions,
  getPdtpTemplateVersion,
  getCurrentPdtpBase2026Version,
  PDTP_BASE_2026_TEMPLATE_CODE,
} from "./templates"
export { getActivePdtpProgram } from "./lifecycle"
export {
  listPdtpExecutorRoleOptions,
  listPdtpActivityExecutorAssignments,
  setPdtpActivityExecutorAssignments,
} from "./executors"
export type { PdtpExecutorRoleOption, PdtpActivityExecutorAssignmentView } from "./executors"
export {
  PDTP_2026_OBJECTIVES,
  pdtpObjectiveForLegacyNumber,
  listPdtpObjectives,
  upsertPdtpObjective,
  deletePdtpObjective,
  reorderPdtpObjectives,
  setPdtpActivityObjective,
} from "./objectives"
export type { PdtpObjective } from "./objectives"
export {
  CURRENT_PDTP_CONTENT_SCHEMA_VERSION,
  MIN_RECONSTRUCTIBLE_PDTP_CONTENT_SCHEMA_VERSION,
  PdtpContentSchemaVersionMissingError,
  PdtpUnreconstructibleContentSchemaError,
  buildPdtpProgramContentSnapshot,
  computePdtpProgramContentDigest,
  computePdtpProgramContentDigestForStoredVersion,
} from "./content-digest"
export {
  pdtpSubmitReviewBlockers,
  getPdtpSubmitReviewBlockers,
  getPdtpCoverageReport,
  pdtpCoverageIssueBlocksLifecycle,
  submitPdtpProgramForReview,
  approvePdtpProgramJdpr,
  signPdtpProgramLegal,
  activatePdtpProgram,
  rejectPdtpApprovalStep,
  rejectPdtpProgram,
  reopenRejectedPdtpProgram,
  archivePdtpProgram,
} from "./lifecycle"
export type { PdtpApprovalDecisionValue, PdtpCoverageReport } from "./lifecycle"
export type { PdtpFulfillmentCoverageIssue, PdtpFulfillmentCoverageStatus } from "./fulfillment"
export type { PdtpCoverageInstrument } from "./instrument-gap"
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
export { getPdtpAggregatedSheetViewByProgram, getPdtpSheetView, getPdtpSheetViewByProgram, buildPdtpExport } from "./sheets"
export { markPdtpExecution, approvePdtpExecution, rejectPdtpExecution, listPendingPdtpExecutions, getPendingPdtpApprovalsForView, getPdtpChangeLog } from "./executions"
export {
  getPdtpComplianceIndicators, getPdtpComplianceIndicatorsForScope, getPdtpComplianceByCategoryForScope,
  effectiveApprovedExecutionsByCell,
} from "./compliance"
export {
  buildPdtpRe36Document,
} from "./re36-document"
export {
  pdtpPeriodClosureId,
  pdtpPeriodCutoffIso,
  buildPdtpPeriodClosureSnapshot,
  closePdtpPeriod,
  reopenPdtpPeriod,
  listPdtpPeriodClosures,
  getPdtpPeriodClosure,
  getLatestPdtpPeriodClosure,
  assertPdtpPeriodOpen,
} from "./period-closures"
export type {
  PdtpPeriodClosureSnapshot, PdtpPeriodClosureObjective, PdtpPeriodClosureListRow,
} from "./period-closures"
export {
  PDTP_CLOSURE_DISTRIBUTION_ROLES,
  resolvePdtpClosureRecipients,
  distributePdtpPeriodClosure,
} from "./period-closure-distribution"
export type {
  PdtpRe36Document, PdtpRe36Sheet, PdtpRe36Row, PdtpRe36Cell, PdtpRe36Band, PdtpRe36DeviationRow,
} from "./re36-document"
export {
  PDTP_SUBJECT_SOURCES,
  isFlowSubjectSource,
  resolvePdtpSubjectCount,
  resolvePdtpSubjectRoster,
} from "./subject-registry"
export type {
  PdtpSubjectPeriod,
  PdtpSubjectRosterMember,
  PdtpSubjectRosterOptions,
  PdtpSubjectRosterResolution,
  PdtpSubjectSource,
} from "./subject-registry"
export { updatePdtpActivity, addPdtpActivity, batchUpdatePdtpActivities, duplicatePdtpActivity, retirePdtpActivity, reorderPdtpActivities, listPdtpProgramActivities, listPdtpProgramScheduleForYear } from "./activities"
export type { PdtpActivityBatchUpdateInput } from "./activities"
export { applyPdtpSchedulePresetToActivities } from "./schedule-batch"
export type { PdtpScheduleBatchInput, PdtpScheduleBatchResult, PdtpScheduleBatchSkipReason } from "./schedule-batch"
export { PDTP_SCHEDULE_PRESETS, presetToCells, presetToRule } from "./schedule-presets"
export type { PdtpSchedulePresetKey, PdtpSchedulePresetParams } from "./schedule-presets"
export { findPdtpWeeklyPending, runPdtpWeeklyReminders, runPdtpActionPlanVencidasReminders, runPdtpObligationReminders, runPdtpSignaturePendingReminders } from "./reminders"
export type { PdtpPendingTarget, PdtpWeeklyPendingResult, PdtpActionVencidasReminderResult, PdtpObligationReminderResult, PdtpSignaturePendingResult } from "./reminders"
export { setPdtpActivityOverride, deletePdtpActivityOverride, loadPdtpOverrides, applyOverridesToSchedule } from "./overrides"
export {
  listPdtpActivityAssignees,
  listPdtpAssigneeCandidates,
  setPdtpActivityAssignees,
  resolvePdtpAssigneesForCell,
} from "./assignees"
export type { PdtpActivityAssignee, PdtpAssigneeCandidate, PdtpSetAssigneesInput } from "./assignees"
export type { PdtpOverrideInput } from "./overrides"
export {
  recordPdtpDeviation,
  withdrawPdtpDeviation,
  loadPdtpDeviations,
  applyDeviationsToSchedule,
  deviationsByActivityMonth,
  getPdtpDeviationKind,
  listPdtpDeviationsForProgram,
} from "./deviations"
export type { PdtpDeviationKind } from "./deviations"
// `PdtpExecutionDeviation` es el tipo de retorno de `recordPdtpDeviation`,
// `loadPdtpDeviations` y `listPdtpDeviationsForProgram`: sin él exportado acá,
// un consumidor del servicio tenía que importarlo de `@/db/schema` para poder
// nombrar lo que estas tres funciones devuelven.
export type { PdtpExecutionDeviation } from "@/db/schema"
export {
  listPdtpProgramWorksites,
  listAccessiblePdtpProgramWorksites,
  setPdtpProgramWorksites,
  resolveProgramWorksiteIds,
  listPdtpActivityWorksiteExclusions,
  syncPdtpCphsHeadcountExclusion,
  PDTP_CPHS_ACTIVITY_NUMBERS,
  PDTP_CPHS_MIN_HEADCOUNT,
  resolvePdtpEffectiveActivitiesForWorksite,
  assertPdtpWorksiteCanOperateProgram,
  setPdtpActivityWorksiteAdjustment,
  listPdtpActivityWorksiteParams,
} from "./worksites"
export type { PdtpActivityWorksiteAdjustmentInput } from "./worksites"
export { cleanupPdtpEvidenceOrphans } from "./evidence-gc"
export type { CleanupPdtpEvidenceOrphansOptions, CleanupPdtpEvidenceOrphansResult } from "./evidence-gc"
export { createAnnualPdtpProgram, createPdtpRevision, updatePdtpProgram, listPdtpPrograms, getPdtpProgram, deletePdtpProgram } from "./programs"
/** @internal Fixture helper; product code must use createAnnualPdtpProgram. */
export { createLegacyPdtpProgramForTests } from "./programs"
export { stagePdtpXlsxImport, applyPdtpImportBatch, cancelPdtpImportBatch, finalizePdtpImportBootstrap, rollbackPdtpImportBatch, getPdtpImportBatch, linkPdtpImportCandidate } from "./imports"
export type { PdtpImportPreview } from "./imports"
export { getPdtpDocumentMetadata, listPdtpReconciliationCandidates, reconcilePdtpDeclaredActor } from "./document-metadata"
export { ensurePdtp2026InspectionTemplates, PDTP_2026_INSPECTION_SPECS } from "@/lib/services/pdtp-adapters/inspection-templates-2026"
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
export { listPdtpConstanciaActivities, assertPdtpActivityMechanism } from "./constancias"
export type { PdtpConstanciaView, PdtpConstanciaDebt } from "./constancias"

// ── Plan de Acción → Seguimiento ─────────────────────────────────────────────
/* El motor de checklist propio del PDTP se retiró: los instrumentos viven en
 * Inspecciones. De `checklists.ts` sólo queda la lectura, porque la tabla se
 * conserva —está dentro de la huella firmada del programa— y sus filas nacen
 * únicamente al copiar hacia adelante un snapshot ya firmado. */
export type { PdtpChecklistTemplate } from "./checklists"
export { listProgramActiveChecklists } from "./checklists"

export type { PdtpActionPlanItemInput, PdtpActionPlanItemUpdate } from "./action-plan"
export {
  listActionPlanItems,
  createActionPlanItem, updateActionPlanItem, deleteActionPlanItem,
  listActionsByProgram, getActionPlanClosureRate,
  verifyActionPlanItem, reopenActionPlanItem,
} from "./action-plan"

export type { PdtpFollowupInput } from "./followups"
export { addFollowup, listFollowups, listVencidas } from "./followups"

export type { PdtpIntegralCompliance, PdtpIntegralComplianceAxes } from "./compliance"
export { getPdtpIntegralCompliance, getPdtpIntegralComplianceForScope } from "./compliance"

export type { PdtpManagementReport, PdtpManagementReportFilters, PdtpManagementReportActivityRow } from "./management-report"
export { getPdtpManagementReport, resolveActivePdtpProgramId } from "./management-report"
export type { PdtpBaseComparison, PdtpRevisionDiff } from "./base-comparison"
export { comparePdtpProgramToSourceBase, comparePdtpRevisionToCurrentBase } from "./base-comparison"
export type { PdtpRevisionDiffDecisionView } from "./revision-diff-decisions"
export { decidePdtpRevisionDiff, listPdtpRevisionDiffDecisions } from "./revision-diff-decisions"

export type { PdtpAuditDossier } from "./audit-dossier"
export { getPdtpAuditDossier } from "./audit-dossier"

// ── Auto-acreditación (Fase 2) ────────────────────────────────────────────────
export { accreditPdtpFromEvent, revokePdtpAccreditation } from "./accreditation"
export type { PdtpAccreditationSourceType, AccreditationInput, AccreditationResult, RevocationResult } from "./accreditation"
