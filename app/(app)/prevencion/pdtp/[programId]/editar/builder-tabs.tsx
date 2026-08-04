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
import type { PdtpBaseComparison } from "@/lib/services/prevention-pdtp"
import { ChecklistTab } from "./checklist-tab"
import { GuidedActivityForm } from "./guided-activity-form"
import { ImportExcelSection } from "./import-excel-section"
import { WorksiteAdjustmentsPanel } from "./worksite-adjustments-panel"
import { ActividadesTab } from "./tabs/actividades-tab"
import { MetadataTab, WorksiteScopePanel } from "./tabs/metadata-tab"
import { PlanificacionTab, ScheduleOverview } from "./tabs/planificacion-tab"
import { ReviewTab } from "./tabs/revision-tab"
import { SheetsTab } from "./tabs/sheets-tab"

export { MetadataTab, WorksiteScopePanel } from "./tabs/metadata-tab"
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
  userId: string
  canDelete: boolean
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  canManageWorksiteMembership: boolean
  memberWorksiteIds: string[]
  activityWorksiteExclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
  activityWorksiteParams: WorksiteParam[]
  activityScheduleOverrides: ScheduleOverride[]
  baseComparison: PdtpBaseComparison | null
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
  userId,
  canDelete,
  responsibleCatalog,
  visibleWorksites,
  canManageWorksiteMembership,
  memberWorksiteIds,
  activityWorksiteExclusions,
  activityWorksiteParams,
  activityScheduleOverrides,
  baseComparison,
}: PdtpBuilderTabsProps) {
  const storageKey = `pdtp-builder-step:${program.id}`
  const [activeStep, setActiveStep] = React.useState<Step>("actividades")

  // La pestaña guardada sólo puede leerse en el cliente, así que el servidor
  // siempre pinta "actividades" y el efecto corrige después. Ese salto no es
  // cosmético: el panel inicial se desmonta con lo que el usuario tuviera
  // abierto, y un clic hecho entre ambos renders se pierde junto con su
  // diálogo. `restored` mantiene los paneles fuera hasta que la pestaña real
  // está resuelta, de modo que nunca se interactúa con un panel provisional.
  const [restored, setRestored] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey)
      if (isStep(saved)) setActiveStep(saved)
    } catch {
      // El editor sigue operativo aunque sessionStorage no esté disponible.
    } finally {
      setRestored(true)
    }
  }, [storageKey])

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
          generalViewCode={generalViewCode}
        />
        <section>
          <h3 className="mb-2 text-h3 text-[var(--color-text)]">Actividades guardadas ({activities.length})</h3>
          <ActividadesTab
            programId={program.id}
            programYear={program.year}
            periodStart={program.periodStart}
            periodEnd={program.periodEnd}
            activities={activities}
            responsibleCatalog={responsibleCatalog}
          />
        </section>

        <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text)]">
            Programación global avanzada
          </summary>
          <div className="space-y-4 border-t border-[var(--color-border)] p-4">
            <ScheduleOverview activities={activeActivities} schedule={schedule} />
            <PlanificacionTab
              programId={program.id}
              year={program.year}
              periodStart={program.periodStart}
              periodEnd={program.periodEnd}
              activities={activeActivities}
              schedule={schedule}
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
                  />
                </div>
              </details>
            )}
            <WorksiteAdjustmentsPanel
              activities={activities}
              schedule={schedule}
              visibleWorksites={visibleWorksites}
              memberWorksiteIds={memberWorksiteIds}
              exclusions={activityWorksiteExclusions}
              params={activityWorksiteParams}
              overrides={activityScheduleOverrides}
              responsibleCatalog={responsibleCatalog}
            />
          </>
        )}
      </TabsContent>

      <TabsContent value="revision" className="space-y-5">
        <ReviewTab
          program={program}
          activities={activities}
          checklists={checklists}
          responsibleCatalog={responsibleCatalog}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          activityWorksiteExclusions={activityWorksiteExclusions}
          baseComparison={baseComparison}
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
            <ImportExcelSection programId={program.id} visibleWorksites={visibleWorksites} />
          </div>
        </details>
      </TabsContent>
      </>
      )}
    </Tabs>
  )
}
