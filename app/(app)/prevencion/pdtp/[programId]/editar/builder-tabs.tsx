"use client"

import * as React from "react"
import Link from "next/link"
import { Check } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ChecklistTab } from "./checklist-tab"
import { GuidedActivityForm } from "./guided-activity-form"

import type { pdtpPrograms, pdtpSheets, pdtpActivities, pdtpActivitySchedule } from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"

import { MetadataTab, WorksiteScopePanel } from "./tabs/metadata-tab"
import { ObjetivosTab } from "./tabs/objetivos-tab"
import { ActividadesTab } from "./tabs/actividades-tab"
import { ScheduleOverview, PlanificacionTab } from "./tabs/planificacion-tab"
import { ReviewTab } from "./tabs/revision-tab"
import { SheetsTab } from "./tabs/sheets-tab"
// ImportExcelSection + tipo ImportPreview viven en `./import-excel-section`
import { ImportExcelSection } from "./import-excel-section"

/**
 * Barrel: los tabs viven en `./tabs/*` pero se re-exportan desde aquí porque los
 * cinco archivos de test del editor y `page.tsx` importan de `./builder-tabs`.
 */
export { MetadataTab } from "./tabs/metadata-tab"
export { WorksiteScopePanel } from "./tabs/metadata-tab"
export { ObjetivosTab } from "./tabs/objetivos-tab"
export { PlanificacionTab } from "./tabs/planificacion-tab"
export { AudiencePreviewPanel } from "./tabs/revision-tab"
export type { PdtpActivityRow, PdtpScheduleRow } from "./tabs/types"

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
  memberWorksiteIds: string[]
  activityWorksiteExclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}

const BUILDER_STEPS = [
  { value: "datos", label: "Datos básicos" },
  { value: "objetivos", label: "Objetivos" },
  { value: "actividades", label: "Actividades" },
  // El alcance vive aquí y no en "Datos básicos" porque las exclusiones se
  // aplican sobre actividades ya definidas (paso anterior) y porque los
  // ajustes por faena de la planificación (paso siguiente) dependen de él.
  { value: "alcance", label: "Alcance" },
  { value: "planificacion", label: "Cuándo se realiza" },
  { value: "requisitos", label: "Evidencias" },
  { value: "revision", label: "Revisión" },
] as const

type BuilderStep = (typeof BUILDER_STEPS)[number]["value"]

const isBuilderStep = (value: string | null): value is BuilderStep =>
  BUILDER_STEPS.some((step) => step.value === value)

export function PdtpBuilderTabs({ program, sheets, activities, schedule, checklists, userId, canDelete, responsibleCatalog, visibleWorksites, memberWorksiteIds, activityWorksiteExclusions }: PdtpBuilderTabsProps) {
  // El paso activo se persiste en sessionStorage, no en la URL.
  //
  // Por qué hace falta: cada guardado llama router.refresh(), que al reintentar
  // el render del servidor cruza el boundary de `loading.tsx`; React descarta
  // este árbol y monta uno nuevo, así que el paso volvía al 1 y el usuario
  // perdía su lugar (invisible mientras el alcance vivía en el paso 1).
  //
  // Por qué no la URL: escribirla —con router.replace o history.replaceState—
  // dispara una actualización del router de Next que además descarta el estado
  // de la pestaña que se está editando. Medido en e2e: guardó 1 en vez de 3 en
  // la matriz semanal, perdió un rename de objetivo y vació el preview de Excel.
  const storageKey = `pdtp-builder-step:${program.id}`
  const [activeStep, setActiveStep] = React.useState<BuilderStep>("datos")

  React.useEffect(() => {
    // try/catch como en `lib/prevention/view-mode.ts`: el acceso a storage tira
    // en modo privado, con la cuota llena o dentro de un iframe sandboxeado, y
    // perder el paso recordado no justifica romper el editor entero.
    try {
      const saved = window.sessionStorage.getItem(storageKey)
      if (isBuilderStep(saved)) setActiveStep(saved)
    } catch { /* se queda en el paso 1 */ }
  }, [storageKey])

  function changeStep(value: string) {
    const step: BuilderStep = isBuilderStep(value) ? value : "datos"
    setActiveStep(step)
    try {
      window.sessionStorage.setItem(storageKey, step)
    } catch { /* el paso sigue funcionando, sólo no se recuerda */ }
  }

  const objectiveCount = new Set(activities.map((activity) => activity.objectiveOrder)).size
  const plannedActivityCount = new Set(schedule.filter((row) => row.plannedQuantity > 0).map((row) => row.activityId)).size
  // Completitud por paso: señal binaria "¿queda algo por hacer aquí?". No
  // repite las cifras del encabezado (regla A5) — es otra dimensión.
  const stepDone: Record<BuilderStep, boolean | null> = {
    datos: true,
    objetivos: objectiveCount > 0,
    actividades: activities.length > 0,
    alcance: true,
    planificacion: activities.length > 0 && plannedActivityCount === activities.length,
    requisitos: checklists.length > 0,
    revision: null,
  }
  const generalViewCode = sheets.find((sheet) => sheet.programId === program.id && sheet.code === "pdtp_general")?.code
    ?? sheets.find((sheet) => sheet.programId === program.id)?.code
    ?? "pdtp_general"

  return (
    <Tabs value={activeStep} onValueChange={changeStep}>
      <section className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3" aria-label="Progreso del constructor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-h3 text-[var(--color-text)]">Editor del programa</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{objectiveCount} objetivo(s) · {activities.length} actividad(es) · los cambios guardados permanecen en borrador.</p>
          </div>
          <Button asChild size="sm">
            <Link href={`/prevencion/pdtp/${program.id}`}>Ver resumen y enviar a revisión</Link>
          </Button>
        </div>
      </section>

      <TabsList className="w-full justify-start overflow-x-auto" aria-label="Secciones del editor">
        {BUILDER_STEPS.map((step, index) => (
          <TabsTrigger key={step.value} value={step.value}>
            {index + 1}. {step.label}
            {stepDone[step.value] === true && (
              <>
                <Check className="ml-1.5 h-3 w-3 shrink-0 text-[var(--color-success)]" weight="bold" aria-hidden />
                <span className="sr-only">(completo)</span>
              </>
            )}
            {stepDone[step.value] === false && (
              <>
                <span className="ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden />
                <span className="sr-only">(pendiente)</span>
              </>
            )}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="datos">
        <MetadataTab program={program} canDelete={canDelete} activities={activities} />
      </TabsContent>
      <TabsContent value="objetivos">
        <ObjetivosTab programId={program.id} activities={activities} />
      </TabsContent>
      <TabsContent value="actividades">
        <GuidedActivityForm
          programId={program.id}
          activities={activities}
          responsibleCatalog={responsibleCatalog}
          generalViewCode={generalViewCode}
        />
        <div className="mt-5">
          <h3 className="mb-2 text-h3 text-[var(--color-text)]">Actividades guardadas ({activities.length})</h3>
          <ActividadesTab programId={program.id} activities={activities} responsibleCatalog={responsibleCatalog} />
        </div>
      </TabsContent>
      <TabsContent value="alcance">
        {visibleWorksites.length > 0
          ? (
            <WorksiteScopePanel
              programId={program.id}
              activities={activities}
              visibleWorksites={visibleWorksites}
              memberWorksiteIds={memberWorksiteIds}
              exclusions={activityWorksiteExclusions}
              onGoToActivities={() => changeStep("actividades")}
            />
          )
          : (
            <EmptyState
              title="No tienes faenas visibles"
              description="El alcance por faena se define sobre las faenas que tu cuenta puede ver. Pide acceso a una faena para restringir este programa o excluir actividades."
            />
          )}
      </TabsContent>
      <TabsContent value="planificacion">
        <ScheduleOverview activities={activities} schedule={schedule} />
        <div className="mt-4 rounded-lg border border-[var(--color-border)] px-3 py-2">
          <p className="text-sm font-medium text-[var(--color-text)]">Matriz semanal avanzada</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Ajustes finos de planificación por semana.</p>
          <div className="mt-3"><PlanificacionTab programId={program.id} year={program.year} periodStart={program.periodStart} periodEnd={program.periodEnd} activities={activities} schedule={schedule} /></div>
        </div>
      </TabsContent>
      <TabsContent value="requisitos">
        <ChecklistTab programId={program.id} activities={activities} checklists={checklists} />
      </TabsContent>
      <TabsContent value="revision">
        <ReviewTab
          program={program}
          activities={activities}
          checklists={checklists}
          responsibleCatalog={responsibleCatalog}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          activityWorksiteExclusions={activityWorksiteExclusions}
        />
        <div className="mt-4 space-y-6">
          <SheetsTab programId={program.id} sheets={sheets} userId={userId} />
          <ImportExcelSection programId={program.id} visibleWorksites={visibleWorksites} />
        </div>
      </TabsContent>
    </Tabs>
  )
}

/** Debounce antes de autoguardar un campo tras la última pulsación. */
