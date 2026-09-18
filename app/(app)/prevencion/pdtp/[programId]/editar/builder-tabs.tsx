"use client"

import * as React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  pdtpActivities,
  pdtpActivitySchedule,
  pdtpPrograms,
  pdtpSheets,
} from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"
import type { PdtpBaseComparison, PdtpRevisionDiff } from "@/lib/services/prevention-pdtp"
import { deriveScheduleHorizon } from "@/lib/services/pdtp/recurrence"
import { ChecklistTab } from "./checklist-tab"
import { GuidedActivityForm } from "./guided-activity-form"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import { ImportExcelSection } from "./import-excel-section"
import { WorksiteAdjustmentsPanel } from "./worksite-adjustments-panel"
import { ActividadesTab } from "./tabs/actividades-tab"
import { MetadataTab, WorksiteScopePanel } from "./tabs/metadata-tab"
import { ObjetivosTab } from "./tabs/objetivos-tab"
import { PlanificacionTab, ScheduleOverview } from "./tabs/planificacion-tab"
import { ReviewTab } from "./tabs/revision-tab"
import { SheetsTab } from "./tabs/sheets-tab"
import { ExecutorAssignmentsPanel } from "./executor-assignments-panel"
import type { PdtpObjective } from "@/lib/services/prevention-pdtp"
import type { PdtpCompletionPolicy, PdtpEvidenceKind } from "@/lib/services/pdtp/connectors"
import type { pdtpActivityExecutionConfigs, pdtpActivityReminderRules } from "@/db/schema"

export { ActividadesTab } from "./tabs/actividades-tab"
export { MetadataTab, WorksiteScopePanel } from "./tabs/metadata-tab"
export { ObjetivosTab } from "./tabs/objetivos-tab"
export { PlanificacionTab } from "./tabs/planificacion-tab"
export { AudiencePreviewPanel } from "./tabs/revision-tab"
export type { PdtpActivityRow, PdtpScheduleRow } from "./tabs/types"

type WorksiteParam = {
  activityId: string
  worksiteId: string
  expectedSubjectCount: number | null
  targetCoveragePercent: string | number | null
  responsibleSlugs: unknown
  responsibleDisplay: string | null
}
type ScheduleOverride = {
  activityId: string
  worksiteId: string
  month: number
  week: number
  plannedQuantity: number
}

type PdtpBuilderTabsProps = {
  program: typeof pdtpPrograms.$inferSelect
  sheets: Array<typeof pdtpSheets.$inferSelect>
  activities: Array<typeof pdtpActivities.$inferSelect>
  schedule: Array<typeof pdtpActivitySchedule.$inferSelect>
  checklists: PdtpChecklistTemplate[]
  objectives: PdtpObjective[]
  userId: string
  canDelete: boolean
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  catalogActivities: Array<PdtpActivityPickerOption & { executionGuidance: string; currentRevision: number }>
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  canManageWorksiteMembership: boolean
  memberWorksiteIds: string[]
  activityWorksiteExclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
  activityWorksiteParams: WorksiteParam[]
  activityScheduleOverrides: ScheduleOverride[]
  activityExecutionConfigs: Array<typeof pdtpActivityExecutionConfigs.$inferSelect>
  activityReminderRules: Array<typeof pdtpActivityReminderRules.$inferSelect>
  baseComparison: (PdtpBaseComparison | PdtpRevisionDiff) | null
  coverageIssues: Array<{
    n: number
    status: string
    reason: string
    destinationModule?: string
    requiredPermission?: string
    suggestedExecutorRoleIds?: string[]
  }>
  executorAssignments: Array<{ activityId: string; roleId: string; roleName: string; roleLabel: string }>
  executorRoleOptions: Array<{ id: string; name: string; label: string; permissions: string[] }>
  revisionDiffDecisions: Array<{ activityIdentity: string; decision: "applied" | "kept"; decidedAt: string }>
  initialStep?: string
  initialCatalogActivityId?: string
  connectors: Array<{
    key: string
    label: string
    moduleHref: string
    supportedEvents: Array<{ key: string; label: string }>
    supportedBindingSourceTypes: readonly string[]
    supportedCompletionPolicies: readonly PdtpCompletionPolicy[]
    supportedEvidenceKinds: readonly PdtpEvidenceKind[]
  }>
  instruments: Array<{ id: string; label: string; sourceType: string; catalogActivityId: string }>
}

const STEPS = [
  { value: "actividades", label: "Actividades" },
  { value: "faenas", label: "Ajustes por faena" },
  { value: "revision", label: "Revisión" },
] as const
type Step = (typeof STEPS)[number]["value"]

function isStep(value: string | null): value is Step {
  return STEPS.some((step) => step.value === value)
}

export function PdtpBuilderTabs({
  program,
  sheets,
  activities,
  schedule,
  checklists,
  objectives,
  userId,
  canDelete,
  responsibleCatalog,
  catalogActivities,
  visibleWorksites,
  canManageWorksiteMembership,
  memberWorksiteIds,
  activityWorksiteExclusions,
  activityWorksiteParams,
  activityScheduleOverrides,
  activityExecutionConfigs,
  activityReminderRules,
  baseComparison,
  coverageIssues,
  executorAssignments,
  executorRoleOptions,
  revisionDiffDecisions,
  initialStep,
  initialCatalogActivityId,
  connectors,
  instruments,
}: PdtpBuilderTabsProps) {
  const storageKey = `pdtp-builder-step:${program.id}`
  const requestedStep: Step | null = initialStep && isStep(initialStep) ? initialStep : null
  const [activeStep, setActiveStep] = React.useState<Step>(() => requestedStep ?? "actividades")

  // La pestaña guardada sólo puede leerse en el cliente. Cuando no hay una
  // sección solicitada por URL, `restored` mantiene los paneles fuera hasta
  // que la pestaña real está resuelta, de modo que nunca se interactúa con un
  // panel provisional durante la hidratación. Una sección solicitada se toma
  // desde el primer render y la página remonta este editor si cambia.
  const [restored, setRestored] = React.useState(() => Boolean(requestedStep))
  const restoreStorageKey = requestedStep ? null : storageKey

  React.useEffect(() => {
    if (!restoreStorageKey) return
    try {
      const saved = window.sessionStorage.getItem(storageKey)
      if (isStep(saved)) setActiveStep(saved)
    } catch {
      // El editor sigue operativo aunque sessionStorage no esté disponible.
    } finally {
      setRestored(true)
    }
  }, [restoreStorageKey, storageKey])

  function changeStep(value: string) {
    const next: Step = isStep(value) ? value : "actividades"
    setActiveStep(next)
    try {
      window.sessionStorage.setItem(storageKey, next)
    } catch {
      // Persistir la pestaña es una mejora, no un requisito para editar.
    }
  }

  const activeActivities = activities.filter((activity) => activity.status === "active")
  const scheduleHorizon = deriveScheduleHorizon({ year: program.year, periodStart: program.periodStart, periodEnd: program.periodEnd })
  const generalViewCode = sheets.find((sheet) => sheet.programId === program.id && sheet.code === "pdtp_general")?.code
    ?? sheets.find((sheet) => sheet.programId === program.id)?.code
    ?? "pdtp_general"

  return (
    <Tabs value={activeStep} onValueChange={changeStep}>
      <section className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-h3 text-[var(--color-text)]">Editor del programa anual</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {activeActivities.length} actividad(es) activa(s) · {activities.length - activeActivities.length} retirada(s)
            </p>
          </div>
          <Button asChild size="sm"><Link href={`/prevencion/pdtp/${program.id}`}>Ver programa</Link></Button>
        </div>
      </section>

      <TabsList className="w-full justify-start overflow-x-auto" aria-label="Secciones del editor">
        {STEPS.map((step, index) => (
          <TabsTrigger key={step.value} value={step.value}>{index + 1}. {step.label}</TabsTrigger>
        ))}
      </TabsList>

      {!restored ? (
        <p className="py-6 text-sm text-[var(--color-text-muted)]">Abriendo el editor…</p>
      ) : (
      <>
      <TabsContent value="actividades" className="space-y-5">
        <GuidedActivityForm
          programId={program.id}
          responsibleCatalog={responsibleCatalog}
          catalogActivities={catalogActivities}
          generalViewCode={generalViewCode}
          programYear={program.year}
          programPeriodStart={program.periodStart}
          programPeriodEnd={program.periodEnd}
          connectors={connectors}
          instruments={instruments}
          initialCatalogActivityId={initialCatalogActivityId}
        />
        <section>
          <h3 className="mb-2 text-h3 text-[var(--color-text)]">Actividades guardadas ({activities.length})</h3>
          <ActividadesTab
            programId={program.id}
            programYear={program.year}
            periodStart={program.periodStart}
            periodEnd={program.periodEnd}
            activities={activities}
            schedule={schedule}
            responsibleCatalog={responsibleCatalog}
            catalogActivities={catalogActivities}
            objectives={objectives}
            connectors={connectors}
            instruments={instruments}
            activityExecutionConfigs={activityExecutionConfigs}
            activityReminderRules={activityReminderRules}
          />
        </section>

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
            Objetivos del programa{objectives.length > 0 ? ` (${objectives.length})` : ""}
          </summary>
          <div className="border-t border-[var(--color-border)] p-4">
            <ObjetivosTab programId={program.id} objectives={objectives} activities={activities} />
          </div>
        </details>

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
            Programación global avanzada
          </summary>
          <div className="space-y-4 border-t border-[var(--color-border)] p-4">
            <ScheduleOverview activities={activeActivities} schedule={schedule} horizon={scheduleHorizon} />
            <PlanificacionTab
              programId={program.id}
              year={program.year}
              periodStart={program.periodStart}
              periodEnd={program.periodEnd}
              activities={activeActivities}
              schedule={schedule}
              responsibleCatalog={responsibleCatalog}
            />
          </div>
        </details>

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
            Requisitos y evidencia
          </summary>
          <div className="border-t border-[var(--color-border)] p-4">
            <ChecklistTab programId={program.id} activities={activeActivities} checklists={checklists} />
          </div>
        </details>
      </TabsContent>

      <TabsContent value="faenas" className="space-y-5">
        {visibleWorksites.length === 0 ? (
          <EmptyState
            title="No tienes faenas visibles"
            description="Los ajustes se definen únicamente sobre las faenas que tu cuenta puede administrar."
          />
        ) : (
          <>
            {canManageWorksiteMembership && (
              <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
                  Alcance de faenas del programa
                </summary>
                <div className="border-t border-[var(--color-border)] p-4">
                  <WorksiteScopePanel
                    programId={program.id}
                    visibleWorksites={visibleWorksites}
                    memberWorksiteIds={memberWorksiteIds}
                    appliesToAllWorksites={program.appliesToAllWorksites}
                  />
                </div>
              </details>
            )}
            <WorksiteAdjustmentsPanel
              activities={activities}
              schedule={schedule}
              visibleWorksites={visibleWorksites}
              memberWorksiteIds={memberWorksiteIds}
              appliesToAllWorksites={program.appliesToAllWorksites}
              exclusions={activityWorksiteExclusions}
              params={activityWorksiteParams}
              overrides={activityScheduleOverrides}
              responsibleCatalog={responsibleCatalog}
            />
          </>
        )}
      </TabsContent>

      <TabsContent value="revision" className="space-y-5">
        <ExecutorAssignmentsPanel
          programId={program.id}
          activities={activities}
          roleOptions={executorRoleOptions}
          assignments={executorAssignments}
          coverageIssues={coverageIssues}
        />
        <ReviewTab
          program={program}
          activities={activities}
          checklists={checklists}
          responsibleCatalog={responsibleCatalog}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          appliesToAllWorksites={program.appliesToAllWorksites}
          activityWorksiteExclusions={activityWorksiteExclusions}
          baseComparison={baseComparison}
          revisionDiffDecisions={revisionDiffDecisions}
        />

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">Datos del programa</summary>
          <div className="border-t border-[var(--color-border)] p-4">
            <MetadataTab program={program} canDelete={canDelete} activities={activities} />
          </div>
        </details>

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">Vistas operativas e importación administrativa</summary>
          <div className="space-y-6 border-t border-[var(--color-border)] p-4">
            <SheetsTab programId={program.id} sheets={sheets} userId={userId} />
            <ImportExcelSection programId={program.id} visibleWorksites={visibleWorksites} catalogActivities={catalogActivities} />
          </div>
        </details>
      </TabsContent>
      </>
      )}
    </Tabs>
  )
}
