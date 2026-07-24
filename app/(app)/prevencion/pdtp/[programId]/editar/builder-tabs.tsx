"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { FileInput } from "@/components/ui/file-input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SubmitButton } from "@/components/admin/submit-button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  updatePdtpProgramAction,
  deletePdtpProgramAction,
  createPdtpSheetAction,
  deletePdtpSheetAction,
  updatePdtpActivityAction,
  duplicatePdtpActivityAction,
  batchUpdatePdtpActivitiesAction,
  deletePdtpActivityAction,
  reorderPdtpActivitiesAction,
  renamePdtpObjectiveAction,
  publishPdtpTemplateAction,
} from "../../actions"
import {
  setPdtpProgramWorksitesAction,
  excludeActivityForWorksiteAction,
  includeActivityForWorksiteAction,
} from "../../actions/worksites-actions"
import { ChecklistTab } from "./checklist-tab"
import { GuidedActivityForm } from "./guided-activity-form"
import { describePdtpRecurrence, describePdtpRecurrenceImpact, deriveScheduleHorizon, type PdtpRecurrenceFrequency, type PdtpRecurrenceRule, type PdtpScheduleHorizon } from "@/lib/services/pdtp/recurrence"
import { useDebouncedAutosave, autosaveStatusLabel } from "@/lib/hooks/use-debounced-autosave"

import type { pdtpPrograms, pdtpSheets, pdtpActivities, pdtpActivitySchedule } from "@/db/schema"
import type { PdtpChecklistTemplate } from "@/lib/services/prevention-pdtp"

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
  { value: "planificacion", label: "Cuándo se realiza" },
  { value: "requisitos", label: "Evidencias" },
  { value: "revision", label: "Revisión" },
] as const

export function PdtpBuilderTabs({ program, sheets, activities, schedule, checklists, userId, canDelete, responsibleCatalog, visibleWorksites, memberWorksiteIds, activityWorksiteExclusions }: PdtpBuilderTabsProps) {
  const [activeStep, setActiveStep] = React.useState<(typeof BUILDER_STEPS)[number]["value"]>("datos")
  const stepIndex = BUILDER_STEPS.findIndex((step) => step.value === activeStep)
  const objectiveCount = new Set(activities.map((activity) => activity.objectiveOrder)).size
  const generalViewCode = sheets.find((sheet) => sheet.programId === program.id && sheet.code === "pdtp_general")?.code
    ?? sheets.find((sheet) => sheet.programId === program.id)?.code
    ?? "pdtp_general"

  return (
    <Tabs value={activeStep} onValueChange={(value) => setActiveStep(value as typeof activeStep)}>
      <section className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3" aria-label="Progreso del constructor">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Construye el programa paso a paso</p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{objectiveCount} objetivo(s) · {activities.length} actividad(es) · los cambios guardados permanecen en borrador.</p>
          </div>
          <span className="text-xs font-medium text-[var(--color-text-subtle)]">Paso {stepIndex + 1} de {BUILDER_STEPS.length}</span>
        </div>
      </section>

      <TabsList className="w-full justify-start overflow-x-auto" aria-label="Pasos para crear el programa">
        {BUILDER_STEPS.map((step, index) => (
          <TabsTrigger key={step.value} value={step.value}>{index + 1}. {step.label}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="datos">
        <MetadataTab
          program={program}
          canDelete={canDelete}
          activities={activities}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          exclusions={activityWorksiteExclusions}
        />
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
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Actividades guardadas ({activities.length})</h3>
          <ActividadesTab programId={program.id} activities={activities} responsibleCatalog={responsibleCatalog} />
        </div>
      </TabsContent>
      <TabsContent value="planificacion">
        <ScheduleOverview activities={activities} schedule={schedule} />
        <details className="mt-4 rounded-lg border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Abrir matriz semanal avanzada</summary>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">Esta proyección existe para compatibilidad y ajustes excepcionales; no es el editor principal del programa.</p>
          <div className="mt-3"><PlanificacionTab programId={program.id} year={program.year} periodStart={program.periodStart} periodEnd={program.periodEnd} activities={activities} schedule={schedule} /></div>
        </details>
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
        <details className="mt-4 rounded-lg border border-[var(--color-border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Vistas avanzadas y migración desde Excel</summary>
          <div className="mt-4 space-y-6">
            <SheetsTab programId={program.id} sheets={sheets} userId={userId} />
            <ImportExcelSection programId={program.id} visibleWorksites={visibleWorksites} />
          </div>
        </details>
      </TabsContent>

      <div className="mt-5 flex items-center justify-between border-t border-[var(--color-border)] pt-4">
        <Button type="button" variant="ghost" disabled={stepIndex === 0} onClick={() => setActiveStep(BUILDER_STEPS[stepIndex - 1]!.value)}>Anterior</Button>
        {stepIndex < BUILDER_STEPS.length - 1 ? (
          <Button type="button" onClick={() => setActiveStep(BUILDER_STEPS[stepIndex + 1]!.value)}>Siguiente: {BUILDER_STEPS[stepIndex + 1]!.label}</Button>
        ) : (
          <Button asChild><Link href={`/prevencion/pdtp/${program.id}`}>Ver resumen y enviar a revisión</Link></Button>
        )}
      </div>
    </Tabs>
  )
}

/** Debounce antes de autoguardar un campo tras la última pulsación. */
const AUTOSAVE_DEBOUNCE_MS = 1500

export function MetadataTab({ program, canDelete, activities = [], visibleWorksites = [], memberWorksiteIds = [], exclusions = [] }: {
  program: typeof pdtpPrograms.$inferSelect
  canDelete: boolean
  activities?: PdtpActivityRow[]
  visibleWorksites?: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds?: string[]
  exclusions?: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [updateState, updateAction, updatePending] = useActionState(updatePdtpProgramAction, null)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePdtpProgramAction, null)

  const [title, setTitle] = React.useState(program.title)
  const [complianceTarget, setComplianceTarget] = React.useState(String(program.complianceTarget))
  // Último valor confirmado por el servidor; state (no ref) porque isDirty
  // se lee durante el render.
  const [savedValues, setSavedValues] = React.useState({ title: program.title, complianceTarget: String(program.complianceTarget) })
  // Snapshot exacto de lo último enviado al servidor. Es un ref (no dispara
  // render) y solo se lee/escribe en efectos/handlers, nunca durante el
  // render: evita que, si el usuario sigue tecleando mientras el envío en
  // vuelo todavía no responde, se marque como "guardado" un valor que en
  // realidad nunca se envió.
  const submittedRef = React.useRef(savedValues)
  const isDirty = title !== savedValues.title || complianceTarget !== savedValues.complianceTarget

  // Bug A: llamar router.refresh()/push() en el cuerpo del componente los
  // dispara en cada render (useActionState no limpia su estado solo), lo
  // que producía un loop de refetch. En un efecto, corren una sola vez por
  // transición de estado.
  React.useEffect(() => {
    if (updateState?.ok) {
      setSavedValues(submittedRef.current)
      router.refresh()
    }
  }, [updateState, router])

  React.useEffect(() => {
    if (deleteState?.ok) router.push("/prevencion/pdtp")
  }, [deleteState, router])

  // Autoguardado: reenvía la misma acción de servidor ya usada por el botón
  // "Guardar cambios" tras una pausa de tecleo, sin bloquear al usuario con
  // un submit explícito. Advierte con beforeunload si queda algo sin guardar.
  React.useEffect(() => {
    // No agenda un nuevo autoguardado mientras el anterior sigue en vuelo:
    // evita dos envíos superpuestos si el usuario retoma la escritura justo
    // cuando el autoguardado previo todavía no responde.
    if (!isDirty || updatePending) return
    const timeout = setTimeout(() => {
      const snapshot = { title, complianceTarget }
      submittedRef.current = snapshot
      const formData = new FormData()
      formData.set("programId", program.id)
      formData.set("title", snapshot.title)
      formData.set("complianceTarget", snapshot.complianceTarget)
      // El dispatch de useActionState debe invocarse dentro de una transición
      // fuera de un submit nativo; si no, isPending no se actualiza.
      React.startTransition(() => updateAction(formData))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timeout)
  }, [title, complianceTarget, isDirty, updatePending, program.id, updateAction])

  React.useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [isDirty])

  const autosaveStatus = updatePending ? "Guardando…" : isDirty ? "Cambios sin guardar" : "Guardado"

  return (
    <div className="space-y-6">
      <form
        action={updateAction}
        className="max-w-md space-y-4"
        onSubmit={() => { submittedRef.current = { title, complianceTarget } }}
      >
        <input type="hidden" name="programId" value={program.id} />

        <div className="flex items-center justify-between">
          <span className="sr-only" aria-live="polite">{autosaveStatus}</span>
          <span
            aria-hidden
            className={
              updatePending
                ? "text-xs text-[var(--color-text-subtle)]"
                : isDirty
                  ? "text-xs font-medium text-[var(--color-warning)]"
                  : "text-xs text-[var(--color-text-subtle)]"
            }
          >
            {autosaveStatus}
          </span>
        </div>

        <FieldGroup className="gap-4">
          <Field label="Título del programa" htmlFor="meta-title" required>
            <Input id="meta-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>

          <Field label="Año" htmlFor="meta-year">
            <Input id="meta-year" name="year" value={program.year} disabled className="bg-[var(--color-surface-2)]" />
          </Field>

          <Field
            label="Meta de cumplimiento"
            htmlFor="meta-compliance"
            required
            helper="Valor entre 0 y 1. Ej: 0.90 = 90% de cumplimiento esperado."
            error={updateState?.message && !updateState.ok ? updateState.message : undefined}
          >
            <Input
              id="meta-compliance"
              name="complianceTarget"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={complianceTarget}
              onChange={(e) => setComplianceTarget(e.target.value)}
              required
            />
          </Field>
        </FieldGroup>

        <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." size="sm" />
      </form>

      {visibleWorksites.length > 0 && (
        <WorksiteScopePanel
          programId={program.id}
          activities={activities}
          visibleWorksites={visibleWorksites}
          memberWorksiteIds={memberWorksiteIds}
          exclusions={exclusions}
        />
      )}

      {canDelete && (
        <div className="max-w-md border-t border-[var(--color-border)] pt-6">
          <h3 className="mb-2 text-sm font-semibold text-[var(--color-danger)]">Zona de peligro</h3>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            Eliminar este programa borrará todas sus actividades y hojas asociadas. Esta acción no se puede deshacer.
          </p>
          <form action={deleteAction}>
            <input type="hidden" name="programId" value={program.id} />
            <Button type="submit" variant="destructive" size="sm" disabled={deletePending}>
              {deletePending ? "Eliminando..." : "Eliminar programa"}
            </Button>
          </form>
          {deleteState?.message && !deleteState.ok && (
            <p className="mt-2 rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {deleteState.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Membresía de faenas del programa. Sin ninguna seleccionada, el programa
 * aplica a todas las faenas del scope del usuario (comportamiento por
 * defecto, retrocompatible con todo programa existente) — seleccionar
 * faenas aquí las restringe a esas, no crea copias del programa.
 */
export function WorksiteScopePanel({ programId, activities, visibleWorksites, memberWorksiteIds, exclusions }: {
  programId: string
  activities: PdtpActivityRow[]
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds: string[]
  exclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<string[]>(memberWorksiteIds)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // `memberWorksiteIds` es un array: trae identidad nueva en cada render del
  // padre, así que un efecto con esa dep re-adoptaba el valor del servidor y
  // borraba la selección sin guardar cada vez que otra fila hacía router.refresh().
  // Se compara por contenido y se ajusta durante el render.
  const savedMembers = JSON.stringify([...memberWorksiteIds].sort())
  const [lastSavedMembers, setLastSavedMembers] = React.useState(savedMembers)
  if (lastSavedMembers !== savedMembers) {
    setLastSavedMembers(savedMembers)
    setSelected(memberWorksiteIds)
  }

  const isDirty = JSON.stringify([...selected].sort()) !== savedMembers

  function toggle(worksiteId: string) {
    setSelected((current) => current.includes(worksiteId) ? current.filter((id) => id !== worksiteId) : [...current, worksiteId])
  }

  async function save() {
    setPending(true)
    setError(null)
    try {
      const result = await setPdtpProgramWorksitesAction({ programId, worksiteIds: selected })
      if (!result.ok) setError(result.message ?? "Error al guardar las faenas.")
      else router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md border-t border-[var(--color-border)] pt-6">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Faenas que cubre este programa</h3>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Sin ninguna faena marcada, el programa aplica a todas tus faenas autorizadas. Marca faenas solo si este programa no debe cubrirlas todas.
      </p>
      <ul className="space-y-1">
        {visibleWorksites.map((worksite) => (
          <li key={worksite.id}>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input type="checkbox" checked={selected.includes(worksite.id)} onChange={() => toggle(worksite.id)} />
              {worksite.name} <span className="text-xs text-[var(--color-text-subtle)]">({worksite.code})</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" disabled={pending || !isDirty} onClick={save}>{pending ? "Guardando..." : "Guardar faenas"}</Button>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {selected.length === 0 ? "Aplica a todas las faenas autorizadas" : `${selected.length} faena(s) seleccionada(s)`}
        </span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}

      <ActivityExclusionsEditor programId={programId} activities={activities} visibleWorksites={visibleWorksites} exclusions={exclusions} />
    </div>
  )
}

/**
 * Excepción puntual de herencia: una faena no ve una actividad concreta.
 * No cambia la cantidad planificada (eso es `pdtpActivityScheduleOverrides`,
 * ver overrides.ts) — excluye la actividad completa para esa faena.
 */
function ActivityExclusionsEditor({ programId, activities, visibleWorksites, exclusions }: {
  programId: string
  activities: PdtpActivityRow[]
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  exclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const router = useRouter()
  const [activityId, setActivityId] = React.useState(activities[0]?.id ?? "")
  const [worksiteId, setWorksiteId] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const worksiteById = new Map(visibleWorksites.map((w) => [w.id, w]))
  const activityById = new Map(activities.map((a) => [a.id, a]))
  const reasonReady = reason.trim().length >= 10

  async function add() {
    if (!activityId || !worksiteId || !reasonReady) {
      setError("Selecciona actividad, faena e indica un motivo de al menos 10 caracteres.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await excludeActivityForWorksiteAction({ programId, activityId, worksiteId, reason })
      if (!result.ok) setError(result.message ?? "Error al excluir la actividad.")
      else { setReason(""); router.refresh() }
    } finally {
      setPending(false)
    }
  }

  async function remove(exclusion: { activityId: string; worksiteId: string }) {
    if (!reasonReady) {
      setError("Escribe un motivo de al menos 10 caracteres para volver a incluir la actividad.")
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await includeActivityForWorksiteAction({ programId, activityId: exclusion.activityId, worksiteId: exclusion.worksiteId, reason })
      if (!result.ok) setError(result.message ?? "Error al incluir la actividad.")
      else { setReason(""); router.refresh() }
    } finally {
      setPending(false)
    }
  }

  if (activities.length === 0 || visibleWorksites.length === 0) return null

  return (
    <div className="mt-5 border-t border-[var(--color-border)] pt-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Excluir una actividad de una faena</h4>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Escribe el motivo abajo antes de excluir o de volver a incluir una actividad.
      </p>
      {exclusions.length > 0 && (
        <ul className="mb-3 space-y-1">
          {exclusions.map((exclusion) => (
            <li key={`${exclusion.activityId}-${exclusion.worksiteId}`} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
              <span>N°{activityById.get(exclusion.activityId)?.n ?? "?"} — {worksiteById.get(exclusion.worksiteId)?.name ?? exclusion.worksiteId}</span>
              <Button type="button" variant="ghost" size="sm" disabled={pending || !reasonReady} onClick={() => remove(exclusion)}>Quitar</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={activityId} onValueChange={setActivityId}>
          <SelectTrigger aria-label="Actividad a excluir"><SelectValue placeholder="Actividad" /></SelectTrigger>
          <SelectContent>{activities.map((a) => <SelectItem key={a.id} value={a.id}>N°{a.n} — {a.activity.slice(0, 40)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={worksiteId} onValueChange={setWorksiteId}>
          <SelectTrigger aria-label="Faena a excluir"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>{visibleWorksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (mín. 10 caracteres)" />
      </div>
      <Button type="button" size="sm" className="mt-2" disabled={pending || !activityId || !worksiteId || !reasonReady} onClick={add}>{pending ? "Guardando..." : "Excluir"}</Button>
      {error && <p className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}

function SheetsTab({ programId, sheets, userId: _userId }: {
  programId: string
  sheets: Array<typeof pdtpSheets.$inferSelect>
  userId: string
}) {
  const programSheets = sheets.filter((s) => s.programId === programId)
  const templateSheets = sheets.filter((s) => s.programId === null)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Hojas del programa ({programSheets.length})</h3>
        {programSheets.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            No hay hojas custom en este programa. Las hojas plantilla están disponibles automáticamente.
          </p>
        ) : (
          <ul className="space-y-1">
            {programSheets.map((sheet) => (
              <li key={sheet.id} className="flex items-center justify-between rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-[var(--color-text)]">{sheet.label}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">{sheet.code}</span>
                </div>
                <DeleteSheetButton sheetId={sheet.id} programId={programId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Hojas plantilla disponibles ({templateSheets.length})</h3>
        <ul className="space-y-1">
          {templateSheets.map((sheet) => (
            <li key={sheet.id} className="flex items-center rounded border border-[var(--color-border)]/50 bg-[var(--color-surface)]/50 px-3 py-2 text-sm">
              <span className="font-medium text-[var(--color-text)]">{sheet.label}</span>
              <span className="ml-2 text-xs text-[var(--color-text-muted)]">{sheet.code} (plantilla)</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="max-w-md border-t border-[var(--color-border)] pt-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Crear hoja custom</h3>
        <CreateSheetForm programId={programId} />
      </div>
    </div>
  )
}

function CreateSheetForm({ programId }: { programId: string }) {
  const [state, formAction, pending] = useActionState(createPdtpSheetAction, null)

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="programId" value={programId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Código" htmlFor="sheet-code" required>
          <Input id="sheet-code" name="code" required placeholder="mi_hoja" />
        </Field>
        <Field label="Área" htmlFor="sheet-area" required>
          <Input id="sheet-area" name="area" required placeholder="prevencion" />
        </Field>
      </div>
      <Field label="Etiqueta" htmlFor="sheet-label" required error={state?.message && !state.ok ? state.message : undefined}>
        <Input id="sheet-label" name="label" required placeholder="Mi hoja personalizada" />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Creando..." : "Crear hoja"}
      </Button>
    </form>
  )
}

function DeleteSheetButton({ sheetId, programId }: { sheetId: string; programId: string }) {
  const [_state, formAction, pending] = useActionState(deletePdtpSheetAction, null)

  return (
    <form action={formAction}>
      <input type="hidden" name="sheetId" value={sheetId} />
      <input type="hidden" name="programId" value={programId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Eliminar
      </Button>
    </form>
  )
}

type ImportPreview = {
  batchId: string
  status: string
  source: { fileName: string; checksumSha256: string; sizeBytes: number }
  counts: {
    objectives: number; activities: number; plannedCells: number; plannedQuantity: number
    executedCells: number; executedQuantity: number; views: number
    creates: number; updates: number; unchanged: number; existingExtraActivitiesPreserved: number
    calendarCellsAdded: number; calendarCellsUpdated: number; calendarCellsRemoved: number
    scheduleRowsReplaced: number; viewMembershipsAdded: number; viewMembershipsRemoved: number
    viewMembershipRowsReplaced: number; checklistBindingsPreserved: number; sourceLinksPreserved: number
    checklistBindingsLost: number; sourceLinksLost: number; scheduleClassificationsPending: number
  }
  calendarChanges: Array<{ activityNumber: number; added: number; updated: number; removed: number }>
  executions: Array<{ activityNumber: number; month: number; week: number; executedQuantity: number; sourceCell: string }>
  metadata?: { documentCode?: string | null; indicatorTarget?: number | null; indicatorPeriodicity?: string | null } | null
  warnings: string[]
  blockingErrors: string[]
}

function ImportExcelSection({ programId, visibleWorksites }: {
  programId: string
  visibleWorksites: Array<{ id: string; name: string; code: string }>
}) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [state, setState] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [worksiteId, setWorksiteId] = React.useState(visibleWorksites.length === 1 ? visibleWorksites[0]!.id : "")
  const [acceptMissingEvidence, setAcceptMissingEvidence] = React.useState(false)
  const [acceptanceReason, setAcceptanceReason] = React.useState("")
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState("")

  // Va contra una API route, no un Server Action: el workbook real
  // ("PROGRAMA DE TRABAJO PREVENTIVO SG-SST.xlsx") pesa ~4-5 MB y Next.js
  // limita el body de los Server Actions a 1 MB por defecto — con un
  // Server Action esto fallaba en runtime con "Body exceeded 1 MB limit"
  // para cualquier archivo real (mismo patrón que pdtp-execution-form.tsx).
  async function handleStage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "stage")
      fd.set("programId", programId)
      fd.set("file", file)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) {
        setState({ ok: false, message: json.error ?? "Error al importar el Excel." })
      } else {
        setState({ ok: true, message: json.message })
        setPreview(json.preview as ImportPreview)
        formRef.current?.reset()
      }
    } catch {
      setState({ ok: false, message: "Error de red al importar el Excel." })
    } finally {
      setPending(false)
    }
  }

  async function handleApply() {
    if (!preview) return
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "apply")
      fd.set("batchId", preview.batchId)
      if (worksiteId) fd.set("worksiteId", worksiteId)
      fd.set("acceptMissingEvidence", String(acceptMissingEvidence))
      fd.set("acceptanceReason", acceptanceReason)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) setState({ ok: false, message: json.error ?? "No se pudo aplicar el lote." })
      else {
        setState({ ok: true, message: json.message })
        setPreview(null)
        router.refresh()
      }
    } catch {
      setState({ ok: false, message: "Error de red al aplicar el lote." })
    } finally {
      setPending(false)
    }
  }

  async function handleCancel() {
    if (!preview || cancelReason.trim().length < 10) {
      setState({ ok: false, message: "Indica un motivo de cancelación de al menos 10 caracteres." })
      return
    }
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("mode", "cancel")
      fd.set("batchId", preview.batchId)
      fd.set("reason", cancelReason)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) setState({ ok: false, message: json.error ?? "No se pudo cancelar el lote." })
      else {
        setState({ ok: true, message: json.message })
        setPreview(null)
        setConfirmCancel(false)
        setCancelReason("")
      }
    } catch {
      setState({ ok: false, message: "Error de red al cancelar el lote." })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-6">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Migrar un programa desde Excel</h3>
      <p className="mb-3 max-w-2xl text-xs leading-5 text-[var(--color-text-muted)]">
        El archivo se analiza primero y no cambia el programa hasta que confirmes el preview. El adaptador traduce su contenido al modelo general; no convierte la planilla en la interfaz de trabajo.
      </p>
      {!preview ? (
        <form ref={formRef} onSubmit={handleStage} className="max-w-md space-y-3">
          <FileInput ref={fileRef} name="file" accept=".xlsx" required />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Analizando..." : "Analizar Excel"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text)]">Preview listo: {preview.source.fileName}</p>
              <p className="mt-1 font-mono text-[11px] text-[var(--color-text-subtle)]">SHA-256 {preview.source.checksumSha256.slice(0, 16)}…</p>
            </div>
            <Badge variant="info" size="sm">Sin aplicar</Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Objetivos", preview.counts.objectives], ["Actividades", preview.counts.activities],
              ["Vistas", preview.counts.views], ["Celdas P", preview.counts.plannedCells],
              ["Total P", preview.counts.plannedQuantity], ["Por clasificar", preview.counts.scheduleClassificationsPending],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2"><dt className="text-xs text-[var(--color-text-muted)]">{label}</dt><dd className="mt-0.5 font-semibold text-[var(--color-text)]">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-[var(--color-text-muted)]">
            {preview.counts.creates} altas · {preview.counts.updates} actualizaciones · {preview.counts.unchanged} sin cambios · {preview.counts.existingExtraActivitiesPreserved} actividad(es) adicionales preservadas.
          </p>
          <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 text-xs sm:grid-cols-2">
            <div>
              <p className="font-semibold text-[var(--color-text)]">Impacto en calendario y vistas</p>
              <p className="mt-1 leading-5 text-[var(--color-text-muted)]">
                Calendario: +{preview.counts.calendarCellsAdded} · ~{preview.counts.calendarCellsUpdated} · −{preview.counts.calendarCellsRemoved}. Se reemplazarán {preview.counts.scheduleRowsReplaced} fila(s) existentes.
              </p>
              <p className="leading-5 text-[var(--color-text-muted)]">
                Vistas: +{preview.counts.viewMembershipsAdded} · −{preview.counts.viewMembershipsRemoved}. Se reemplazarán {preview.counts.viewMembershipRowsReplaced} membresía(s) existentes.
              </p>
            </div>
            <div>
              <p className="font-semibold text-[var(--color-text)]">Relaciones protegidas</p>
              <p className="mt-1 leading-5 text-[var(--color-text-muted)]">
                {preview.counts.checklistBindingsPreserved} checklist(s) y {preview.counts.sourceLinksPreserved} vínculo(s) de fuente se conservan. Pérdidas previstas: {preview.counts.checklistBindingsLost + preview.counts.sourceLinksLost}.
              </p>
            </div>
            {preview.calendarChanges.length > 0 && (
              <details className="sm:col-span-2">
                <summary className="cursor-pointer font-medium text-[var(--color-text)]">Ver {preview.calendarChanges.length} actividad(es) con cambio de calendario</summary>
                <ul className="mt-2 max-h-36 overflow-y-auto space-y-1 text-[var(--color-text-subtle)]">
                  {preview.calendarChanges.map((change) => <li key={change.activityNumber}>Actividad {change.activityNumber}: +{change.added} · ~{change.updated} · −{change.removed}</li>)}
                </ul>
              </details>
            )}
          </div>
          {preview.warnings.length > 0 && <ul className="space-y-1 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">{preview.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>}

          {preview.counts.executedCells > 0 && (
            <div className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-2">
              <Field label="Faena de las cantidades ejecutadas" htmlFor="pdtp-import-worksite" required>
                <Select value={worksiteId} onValueChange={setWorksiteId}>
                  <SelectTrigger id="pdtp-import-worksite"><SelectValue placeholder="Selecciona una faena autorizada" /></SelectTrigger>
                  <SelectContent>{visibleWorksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name} · {worksite.code}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Motivo de aceptación" htmlFor="pdtp-import-reason" helper="Se conservará junto al lote y las celdas de origen.">
                <Textarea id="pdtp-import-reason" value={acceptanceReason} onChange={(event) => setAcceptanceReason(event.target.value)} rows={2} placeholder="Ej.: histórico validado por Jefatura de Prevención" />
              </Field>
              <label className="flex items-start gap-2 text-xs text-[var(--color-text-muted)] md:col-span-2">
                <input type="checkbox" className="mt-0.5" checked={acceptMissingEvidence} onChange={(event) => setAcceptMissingEvidence(event.target.checked)} />
                Acepto migrar {preview.counts.executedCells} celda(s) E como reportadas sin evidencia adjunta; no se inventará un archivo ni un ejecutor histórico.
              </label>
              <ul className="max-h-32 overflow-y-auto text-xs text-[var(--color-text-subtle)] md:col-span-2">
                {preview.executions.map((execution) => <li key={execution.sourceCell}>Actividad {execution.activityNumber} · mes {execution.month}, semana {execution.week} · {execution.executedQuantity} · celda {execution.sourceCell}</li>)}
              </ul>
            </div>
          )}
          {confirmCancel && (
            <div className="rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] p-3">
              <Field label="Motivo para cancelar el preview" htmlFor="pdtp-import-cancel-reason" helper="El lote quedará en el historial; el programa seguirá intacto.">
                <Textarea id="pdtp-import-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Ej.: el archivo no corresponde a la versión vigente" />
              </Field>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border)] pt-3">
            {confirmCancel ? (
              <>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setConfirmCancel(false); setCancelReason("") }}>Volver</Button>
                <Button type="button" variant="destructive" size="sm" disabled={pending || cancelReason.trim().length < 10} onClick={handleCancel}>{pending ? "Cancelando..." : "Confirmar cancelación"}</Button>
              </>
            ) : (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setConfirmCancel(true); setState(null) }}>Cancelar preview</Button>
            )}
            <Button type="button" size="sm" disabled={pending || preview.blockingErrors.length > 0 || (preview.counts.executedCells > 0 && (!worksiteId || !acceptMissingEvidence || acceptanceReason.trim().length < 10))} onClick={handleApply}>
              {pending ? "Aplicando..." : "Aplicar lote"}
            </Button>
          </div>
        </div>
      )}
      {state?.message && (
        <p role="status" className={`mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm ${state.ok
          ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success)]"
          : "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger)]"}`}>
          {state.message}
        </p>
      )}
    </div>
  )
}

// ── Tab Actividades: edición inline, reordenamiento, eliminación ───────────

type PdtpActivityRow = typeof pdtpActivities.$inferSelect

function ActividadesTab({ programId, activities, responsibleCatalog }: { programId: string; activities: PdtpActivityRow[]; responsibleCatalog: Array<{ slug: string; displayName: string }> }) {
  const router = useRouter()
  const [items, setItems] = React.useState(activities)
  const [editing, setEditing] = React.useState<PdtpActivityRow | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])
  const [batchOpen, setBatchOpen] = React.useState(false)

  // Ver nota en WorksiteScopePanel: `activities` cambia de identidad en cada
  // render, así que el efecto descartaba el reordenamiento optimista en curso.
  const savedActivities = JSON.stringify(activities)
  const [lastSavedActivities, setLastSavedActivities] = React.useState(savedActivities)
  if (lastSavedActivities !== savedActivities) {
    setLastSavedActivities(savedActivities)
    setItems(activities)
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setItems(next)
    setBusyId(next[target]!.id)
    setError(null)
    try {
      const result = await reorderPdtpActivitiesAction({ programId, orderedIds: next.map((a) => a.id) })
      if (!result.ok) {
        setError(result.message ?? "Error al reordenar.")
        setItems(activities)
      } else {
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(activityId: string) {
    setConfirmDeleteId(null)
    setBusyId(activityId)
    setError(null)
    try {
      const result = await deletePdtpActivityAction({ activityId })
      if (!result.ok) {
        setError(result.message ?? "Error al eliminar la actividad.")
      } else {
        setItems((s) => s.filter((a) => a.id !== activityId))
        router.refresh()
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleDuplicate(activityId: string) {
    setBusyId(activityId)
    setError(null)
    try {
      const result = await duplicatePdtpActivityAction({ activityId })
      if (!result.ok) setError(result.message ?? "Error al duplicar la actividad.")
      else router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-xs text-[var(--color-text-muted)]">{selectedIds.length} actividad(es) seleccionadas</p>
          <Button type="button" size="sm" variant="secondary" disabled={selectedIds.length === 0} onClick={() => setBatchOpen(true)}>Editar selección</Button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
          Sin actividades. Usa &ldquo;Agregar actividad&rdquo; en la vista del programa o importa un Excel desde Metadatos.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-subtle)]">
              <tr>
                <th className="w-10 px-3 py-2 text-left"><span className="sr-only">Seleccionar</span></th>
                <th className="w-12 px-3 py-2 text-left">N°</th>
                <th className="px-3 py-2 text-left">Actividad</th>
                <th className="px-3 py-2 text-left">Guía de ejecución</th>
                <th className="w-56 px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.map((activity, index) => (
                <tr key={activity.id} className="bg-[var(--color-surface)]">
                  <td className="px-3 py-2"><input type="checkbox" aria-label={`Seleccionar actividad ${activity.n}`} checked={selectedIds.includes(activity.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, activity.id] : current.filter((id) => id !== activity.id))} /></td>
                  <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-subtle)]">{activity.n}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-[var(--color-text)]">{activity.activity}</p>
                    <p className="text-xs text-[var(--color-text-subtle)]">{activity.objective}</p>
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{activity.program}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || index === 0} onClick={() => move(index, -1)} aria-label="Subir">↑</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null || index === items.length - 1} onClick={() => move(index, 1)} aria-label="Bajar">↓</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => handleDuplicate(activity.id)}>Duplicar</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setEditing(activity)}>Editar</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setConfirmDeleteId(activity.id)}>Eliminar</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditActivityDialog activity={editing} activities={activities} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
      <BatchEditActivitiesDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        programId={programId}
        activityIds={selectedIds}
        activities={activities}
        responsibleCatalog={responsibleCatalog}
        onSaved={() => { setSelectedIds([]); router.refresh() }}
      />

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => { if (!open) setConfirmDeleteId(null) }}
        title="¿Eliminar actividad?"
        description="Se perderá su planificación y ejecuciones registradas. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="destructive"
        loading={busyId !== null}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
    </div>
  )
}

function BatchEditActivitiesDialog({ open, onOpenChange, programId, activityIds, activities, responsibleCatalog, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  programId: string
  activityIds: string[]
  activities: PdtpActivityRow[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  onSaved: () => void
}) {
  const [objective, setObjective] = React.useState("keep")
  const [responsible, setResponsible] = React.useState("keep")
  const [replaceEvidence, setReplaceEvidence] = React.useState(false)
  const [evidence, setEvidence] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const objectives = [...new Map(activities.map((activity) => [activity.objectiveOrder, activity.objective])).entries()].sort(([left], [right]) => left - right)

  async function save() {
    const targetObjective = objective === "keep" ? undefined : objectives.find(([order]) => order === Number(objective))
    const targetResponsible = responsible === "keep" ? undefined : responsibleCatalog.find((item) => item.slug === responsible)
    setPending(true)
    setError(null)
    try {
      const result = await batchUpdatePdtpActivitiesAction({
        programId,
        activityIds,
        objectiveOrder: targetObjective?.[0],
        objective: targetObjective?.[1],
        responsibleSlugs: targetResponsible ? [targetResponsible.slug] : undefined,
        responsibleDisplay: targetResponsible?.displayName,
        evidenceRequirement: replaceEvidence ? evidence : undefined,
      })
      if (!result.ok) setError(result.message ?? "No se pudo editar la selección.")
      else { onOpenChange(false); onSaved() }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar {activityIds.length} actividades</DialogTitle></DialogHeader>
        <FieldGroup className="gap-4">
          <Field label="Mover al objetivo" htmlFor="batch-objective">
            <Select value={objective} onValueChange={setObjective}>
              <SelectTrigger id="batch-objective"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="keep">Sin cambio</SelectItem>{objectives.map(([order, label]) => <SelectItem key={order} value={String(order)}>{order}. {label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Cambiar responsable" htmlFor="batch-responsible">
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger id="batch-responsible"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="keep">Sin cambio</SelectItem>{responsibleCatalog.map((item) => <SelectItem key={item.slug} value={item.slug}>{item.displayName}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text)]"><input type="checkbox" checked={replaceEvidence} onChange={(event) => setReplaceEvidence(event.target.checked)} /> Reemplazar evidencia mínima</label>
          {replaceEvidence && <Textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} maxLength={3000} placeholder="Evidencia mínima común para la selección" />}
          <p className="text-xs text-[var(--color-text-muted)]">Solo se cambian los campos indicados. Calendario, vistas, checklist y ejecuciones permanecen asociados.</p>
          {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancelar</Button>
          <Button type="button" onClick={save} disabled={pending}>{pending ? "Aplicando..." : "Aplicar cambios"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditActivityDialog({ activity, activities, onClose, onSaved }: {
  activity: PdtpActivityRow | null
  activities: PdtpActivityRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [activityText, setActivityText] = React.useState("")
  const [executionGuidance, setExecutionGuidance] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [objectiveOrder, setObjectiveOrder] = React.useState("")
  const [scheduleMode, setScheduleMode] = React.useState<"scheduled" | "on_demand" | "triggered">("scheduled")
  const [frequency, setFrequency] = React.useState<PdtpRecurrenceFrequency>("monthly")
  const [interval, setInterval] = React.useState(1)
  const [plannedQuantity, setPlannedQuantity] = React.useState(1)
  const [weekOfMonth, setWeekOfMonth] = React.useState(1)
  const [triggerDescription, setTriggerDescription] = React.useState("")
  const [dueDays, setDueDays] = React.useState(5)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (activity) {
      setActivityText(activity.activity)
      setExecutionGuidance(activity.program)
      setNotes(activity.notes ?? "")
      setObjectiveOrder(String(activity.objectiveOrder))
      setScheduleMode((activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered")
      const rule = activity.recurrenceRule as PdtpRecurrenceRule | null
      setFrequency(rule?.frequency ?? "monthly")
      setInterval(rule?.interval ?? 1)
      setPlannedQuantity(rule?.plannedQuantity ?? 1)
      setWeekOfMonth(rule?.weekOfMonth ?? 1)
      setTriggerDescription(activity.triggerDescription ?? "")
      setDueDays(activity.dueDays ?? 5)
      setError(null)
    }
  }, [activity])

  async function handleSave() {
    if (!activity) return
    setPending(true)
    setError(null)
    try {
      const targetObjective = activities.find((candidate) => candidate.objectiveOrder === Number(objectiveOrder))
      const recurrenceRule: PdtpRecurrenceRule | null = scheduleMode === "scheduled"
        ? { frequency, interval, plannedQuantity, weekOfMonth }
        : null
      const result = await updatePdtpActivityAction({
        activityId: activity.id,
        activity: activityText,
        program: executionGuidance,
        notes,
        objectiveOrder: Number(objectiveOrder),
        objective: targetObjective?.objective ?? activity.objective,
        scheduleMode,
        scheduleClassificationStatus: "confirmed",
        recurrenceRule,
        triggerDescription: scheduleMode === "triggered" ? triggerDescription : null,
        dueDays: scheduleMode === "scheduled" ? null : dueDays,
      })
      if (!result.ok) {
        setError(result.message ?? "Error al guardar.")
      } else {
        onSaved()
        onClose()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={activity !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar actividad N°{activity?.n}</DialogTitle>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <Field label="Actividad preventiva" htmlFor="edit-activity">
            <Textarea id="edit-activity" value={activityText} onChange={(e) => setActivityText(e.target.value)} rows={4} maxLength={4000} />
          </Field>
          <Field label="Objetivo" htmlFor="edit-objective">
            <Select value={objectiveOrder} onValueChange={setObjectiveOrder}>
              <SelectTrigger id="edit-objective"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[...new Map(activities.map((candidate) => [candidate.objectiveOrder, candidate.objective])).entries()]
                  .sort(([left], [right]) => left - right)
                  .map(([order, objective]) => <SelectItem key={order} value={String(order)}>{order}. {objective}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Guía de ejecución" htmlFor="edit-execution-guidance">
            <Textarea id="edit-execution-guidance" value={executionGuidance} onChange={(e) => setExecutionGuidance(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <Field label="Cuándo se realiza" htmlFor="edit-schedule-mode">
            <Select value={scheduleMode} onValueChange={(value) => setScheduleMode(value as typeof scheduleMode)}>
              <SelectTrigger id="edit-schedule-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Con frecuencia</SelectItem>
                <SelectItem value="on_demand">Cuando se necesite</SelectItem>
                <SelectItem value="triggered">Cuando ocurra un evento</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scheduleMode === "scheduled" ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Frecuencia" htmlFor="edit-frequency">
                <Select value={frequency} onValueChange={(value) => setFrequency(value as PdtpRecurrenceFrequency)}>
                  <SelectTrigger id="edit-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Semanal</SelectItem>
                    <SelectItem value="monthly">Mensual</SelectItem>
                    <SelectItem value="quarterly">Trimestral</SelectItem>
                    <SelectItem value="semiannual">Semestral</SelectItem>
                    <SelectItem value="annual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Cada" htmlFor="edit-interval"><Input id="edit-interval" type="number" min={1} max={52} value={interval} onChange={(event) => setInterval(Number(event.target.value))} /></Field>
              <Field label="Cantidad" htmlFor="edit-planned-quantity"><Input id="edit-planned-quantity" type="number" min={0.01} step={0.25} value={plannedQuantity} onChange={(event) => setPlannedQuantity(Number(event.target.value))} /></Field>
              <Field label="Semana" htmlFor="edit-week"><Input id="edit-week" type="number" min={1} max={4} value={weekOfMonth} onChange={(event) => setWeekOfMonth(Number(event.target.value))} /></Field>
            </div>
          ) : scheduleMode === "triggered" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label="Evento disparador" htmlFor="edit-trigger" required><Input id="edit-trigger" value={triggerDescription} onChange={(event) => setTriggerDescription(event.target.value)} required /></Field>
              <Field label="Plazo (días)" htmlFor="edit-trigger-days"><Input id="edit-trigger-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
            </div>
          ) : (
            <Field label="Plazo objetivo cuando haya un caso" htmlFor="edit-demand-days"><Input id="edit-demand-days" type="number" min={0} max={3650} value={dueDays} onChange={(event) => setDueDays(Number(event.target.value))} /></Field>
          )}
          {activity && <RecurrenceImpactPreview
            activity={activity}
            nextMode={scheduleMode}
            nextRule={scheduleMode === "scheduled" ? { frequency, interval, plannedQuantity, weekOfMonth } : null}
          />}
          <Field label="Notas" htmlFor="edit-notes">
            <Textarea id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          {error && (
            <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={pending}>{pending ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecurrenceImpactPreview({
  activity,
  nextMode,
  nextRule,
}: {
  activity: PdtpActivityRow
  nextMode: "scheduled" | "on_demand" | "triggered"
  nextRule: PdtpRecurrenceRule | null
}) {
  const currentRule = activity.recurrenceRule as PdtpRecurrenceRule | null
  const { currentCount, nextCount, changed } = describePdtpRecurrenceImpact(
    (activity.scheduleMode ?? "scheduled") as "scheduled" | "on_demand" | "triggered",
    currentRule,
    nextMode,
    nextRule,
  )
  return (
    <p className="rounded-lg border border-[var(--color-info-line)] bg-[var(--color-info-tint)] px-3 py-2 text-xs text-[var(--color-info-ink)]">
      {changed
        ? `Impacto antes de guardar: pasará de ${currentCount} a ${nextCount} obligación(es) calendarizadas; las ejecuciones existentes no se modifican.`
        : `${nextCount} obligación(es) calendarizadas; no hay cambio de recurrencia pendiente.`}
    </p>
  )
}

// ── Tab Objetivos: renombrar el objetivo compartido por cada grupo (1-8) ───

export function ObjetivosTab({ programId, activities }: { programId: string; activities: PdtpActivityRow[] }) {
  const groups = React.useMemo(() => {
    const byOrder = new Map<number, { objective: string; count: number }>()
    for (const activity of activities) {
      const existing = byOrder.get(activity.objectiveOrder)
      if (!existing) byOrder.set(activity.objectiveOrder, { objective: activity.objective, count: 1 })
      else existing.count += 1
    }
    return [...byOrder.entries()]
      .sort(([left], [right]) => left - right)
      .map(([objectiveOrder, value]) => ({ objectiveOrder, objective: value.objective, count: value.count }))
  }, [activities])

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Los objetivos agrupan actividades que persiguen el mismo resultado. Puedes crear tantos como el programa necesite; el ejemplo 2026 usa ocho, pero no es un límite.
      </p>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--color-text)]">Aún no hay objetivos</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">En el paso Actividades podrás crear el primer objetivo y agregar una actividad dentro de él.</p>
        </div>
      ) : groups.map((group) => <ObjectiveRow key={group.objectiveOrder} programId={programId} group={group} />)}
    </div>
  )
}

function ObjectiveRow({ programId, group }: {
  programId: string
  group: { objectiveOrder: number; objective: string; count: number }
}) {
  const router = useRouter()
  const [value, setValue] = React.useState(group.objective)
  const isDirty = value.trim() !== "" && value !== group.objective

  const [lastSavedObjective, setLastSavedObjective] = React.useState(group.objective)
  if (lastSavedObjective !== group.objective) {
    setLastSavedObjective(group.objective)
    setValue(group.objective)
  }

  const { status, error, saveNow } = useDebouncedAutosave({
    watchKey: value,
    isDirty,
    onSave: async () => {
      const result = await renamePdtpObjectiveAction({ programId, objectiveOrder: group.objectiveOrder, objective: value })
      if (result.ok) router.refresh()
      return result
    },
  })
  const pending = status === "saving"

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-[var(--color-text-subtle)]">{group.objectiveOrder}</span>
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 flex-1" placeholder="Sin actividades en este objetivo aún" />
        <span aria-live="polite" className="shrink-0 text-[11px] text-[var(--color-text-subtle)]">{autosaveStatusLabel(status)}</span>
        <Button type="button" size="sm" disabled={pending || !isDirty} onClick={saveNow}>
          {pending ? "..." : "Guardar"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">
        {group.count} actividad(es)
      </p>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}

function ScheduleOverview({ activities, schedule }: { activities: PdtpActivityRow[]; schedule: PdtpScheduleRow[] }) {
  const legacyCellsByActivity = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const cell of schedule) counts.set(cell.activityId, (counts.get(cell.activityId) ?? 0) + 1)
    return counts
  }, [schedule])

  if (activities.length === 0) {
    return <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">Agrega una actividad para definir cuándo debe realizarse.</div>
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Programación comprensible</h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">La frecuencia o el evento son la fuente de verdad; la matriz semanal queda como proyección avanzada.</p>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {activities.map((activity) => {
          const mode = activity.scheduleMode ?? "scheduled"
          const needsReview = activity.scheduleClassificationStatus === "needs_review"
          const rule = activity.recurrenceRule as PdtpRecurrenceRule | null
          const description = needsReview
            ? "La planilla de origen no indicó programación. Elige al editar si ocurre con frecuencia, cuando se necesite o ante un evento."
            : mode === "scheduled"
            ? rule
              ? describePdtpRecurrence(rule)
              : `${legacyCellsByActivity.get(activity.id) ?? 0} período(s) heredado(s); define una recurrencia para usar el constructor general.`
            : mode === "on_demand"
              ? `Cuando se necesite${activity.dueDays !== null ? ` · plazo objetivo ${activity.dueDays} día(s)` : ""}.`
              : `${activity.triggerDescription || "Evento pendiente de describir"}${activity.dueDays !== null ? ` · plazo ${activity.dueDays} día(s)` : ""}.`
          const label = needsReview ? "Clasificación pendiente" : mode === "scheduled" ? "Con frecuencia" : mode === "on_demand" ? "A demanda" : "Por evento"
          return (
            <li key={activity.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]"><span className="font-mono text-xs text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
              </div>
              <Badge variant={needsReview || (mode === "scheduled" && !rule) ? "warning" : "outline"} size="sm">{label}</Badge>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ReviewTab({
  program,
  activities,
  checklists,
  responsibleCatalog,
  visibleWorksites,
  memberWorksiteIds,
  activityWorksiteExclusions,
}: {
  program: typeof pdtpPrograms.$inferSelect
  activities: PdtpActivityRow[]
  checklists: PdtpChecklistTemplate[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  visibleWorksites: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds: string[]
  activityWorksiteExclusions: Array<{ activityId: string; worksiteId: string; reason: string }>
}) {
  const objectiveCount = new Set(activities.map((activity) => activity.objectiveOrder)).size
  const missingSchedule = activities.filter((activity) => (activity.scheduleMode ?? "scheduled") === "scheduled" && !activity.recurrenceRule && activity.sourceSheetRow === 0).length
  const missingTrigger = activities.filter((activity) => activity.scheduleMode === "triggered" && !activity.triggerDescription).length
  const unresolvedScheduleClassification = activities.filter((activity) => activity.scheduleClassificationStatus === "needs_review").length
  const missingEvidence = activities.filter((activity) => !activity.evidenceRequirement && !checklists.some((checklist) => checklist.activityId === activity.id)).length
  const checks = [
    { label: "Datos básicos", ok: !!program.title.trim(), detail: program.title },
    { label: "Objetivos", ok: objectiveCount > 0, detail: objectiveCount > 0 ? `${objectiveCount} definido(s)` : "Agrega al menos un objetivo" },
    { label: "Actividades", ok: activities.length > 0, detail: activities.length > 0 ? `${activities.length} definida(s)` : "Agrega al menos una actividad" },
    { label: "Clasificación temporal", ok: unresolvedScheduleClassification === 0, detail: unresolvedScheduleClassification === 0 ? "Todas tienen una modalidad confirmada" : `${unresolvedScheduleClassification} requieren decidir cuándo se realizan` },
    { label: "Programación", ok: missingSchedule === 0 && missingTrigger === 0, detail: missingSchedule + missingTrigger === 0 ? "Todas explican cuándo se realizan" : `${missingSchedule + missingTrigger} requieren completar su regla` },
    { label: "Evidencia", ok: missingEvidence === 0, detail: missingEvidence === 0 ? "Requisitos definidos" : `${missingEvidence} sin requisito explícito o checklist` },
  ]
  const ready = checks.every((check) => check.ok)

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">Revisión antes de enviar</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Comprueba el resultado preventivo; no necesitas revisar una grilla del Excel.</p>
        </div>
        <Badge variant={ready ? "success" : "warning"} dot>{ready ? "Listo para revisar" : "Faltan datos"}</Badge>
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="font-medium text-[var(--color-text)]">{check.label}</span>
            <span className={check.ok ? "text-[var(--color-success)]" : "text-[var(--color-signal)]"}>{check.ok ? "Completo" : check.detail}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        La aprobación ocurre fuera del editor y congela una versión exacta del contenido.
      </div>
      <AudiencePreviewPanel
        activities={activities}
        responsibleCatalog={responsibleCatalog}
        visibleWorksites={visibleWorksites}
        memberWorksiteIds={memberWorksiteIds}
        exclusions={activityWorksiteExclusions}
      />
      <TemplatePublishPanel program={program} ready={ready} />
    </section>
  )
}

/**
 * Previsualiza qué actividades ve cada responsable/audiencia sin crear
 * copias ni consultas nuevas: filtra en el cliente sobre `responsibleSlugs`
 * y `audienceRoles`, que ya son datos generales por actividad (no una tabla
 * especial por hoja). La dimensión de faena reutiliza `pdtpProgramWorksites`
 * (membresía) y `pdtpActivityWorksiteExclusions` (excepción puntual), ya
 * cargadas por la página del editor — sin faena seleccionada, o sin ninguna
 * de las dos props recibida (compatibilidad), el filtro por faena no se
 * muestra y el resultado es idéntico al de antes.
 */
export function AudiencePreviewPanel({
  activities,
  responsibleCatalog,
  visibleWorksites = [],
  memberWorksiteIds = [],
  exclusions = [],
}: {
  activities: PdtpActivityRow[]
  responsibleCatalog: Array<{ slug: string; displayName: string }>
  visibleWorksites?: Array<{ id: string; name: string; code: string }>
  memberWorksiteIds?: string[]
  exclusions?: Array<{ activityId: string; worksiteId: string }>
}) {
  const ALL = "__all__"
  const [responsableSlug, setResponsableSlug] = React.useState(ALL)
  const [audienceRole, setAudienceRole] = React.useState(ALL)
  const [worksiteId, setWorksiteId] = React.useState(ALL)

  const labelBySlug = new Map(responsibleCatalog.map((r) => [r.slug, r.displayName]))
  const audienceRoles = [...new Set(activities.flatMap((activity) => (Array.isArray(activity.audienceRoles) ? activity.audienceRoles as string[] : [])))].sort()

  const worksiteSelected = worksiteId !== ALL
  const worksiteCanOperate = !worksiteSelected || memberWorksiteIds.length === 0 || memberWorksiteIds.includes(worksiteId)
  const excludedActivityIds = new Set(worksiteSelected ? exclusions.filter((e) => e.worksiteId === worksiteId).map((e) => e.activityId) : [])

  const filtered = !worksiteCanOperate ? [] : activities.filter((activity) => {
    if (worksiteSelected && excludedActivityIds.has(activity.id)) return false
    const responsibleSlugs = Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : []
    if (responsableSlug !== ALL && !responsibleSlugs.includes(responsableSlug)) return false
    if (audienceRole !== ALL) {
      const roles = Array.isArray(activity.audienceRoles) ? activity.audienceRoles as string[] : []
      if (!roles.includes(audienceRole)) return false
    }
    return true
  })

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <h4 className="text-sm font-semibold text-[var(--color-text)]">Previsualizar por responsable, audiencia o faena</h4>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Muestra exactamente qué actividades vería esa combinación, sin crear una copia del programa.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Select value={responsableSlug} onValueChange={setResponsableSlug}>
          <SelectTrigger className="w-56" aria-label="Responsable"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los responsables</SelectItem>
            {responsibleCatalog.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={audienceRole} onValueChange={setAudienceRole}>
          <SelectTrigger className="w-56" aria-label="Audiencia"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las audiencias</SelectItem>
            {audienceRoles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
          </SelectContent>
        </Select>
        {visibleWorksites.length > 0 && (
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger className="w-56" aria-label="Faena"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las faenas</SelectItem>
              {visibleWorksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      {audienceRoles.length === 0 && responsableSlug === ALL && (
        <p className="mt-2 text-xs text-[var(--color-text-subtle)]">Ninguna actividad tiene audiencia asignada todavía; el filtro por responsable sigue disponible.</p>
      )}
      {worksiteSelected && !worksiteCanOperate ? (
        <p className="mt-3 rounded-lg border border-[var(--color-warning-line)] bg-[var(--color-warning-tint)] px-3 py-2 text-xs text-[var(--color-warning-ink)]">
          Esta faena no está habilitada para este programa: la membresía declarada no la incluye.
        </p>
      ) : (
        <p className="mt-3 text-sm text-[var(--color-text)]">
          {filtered.length} de {activities.length} actividad(es) visibles para esta combinación.
        </p>
      )}
      {filtered.length > 0 && (filtered.length !== activities.length) && (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--color-text-muted)]">
          {filtered.map((activity) => (
            <li key={activity.id}>
              N°{activity.n} · {activity.responsibleDisplay || labelBySlug.get((Array.isArray(activity.responsibleSlugs) ? activity.responsibleSlugs as string[] : [])[0] ?? "") || "Sin responsable"}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TemplatePublishPanel({
  program,
  ready,
}: {
  program: typeof pdtpPrograms.$inferSelect
  ready: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action, pending] = useActionState(publishPdtpTemplateAction, null)

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      router.refresh()
    }
  }, [state, router])

  return (
    <div className="border-t border-[var(--color-border)] px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-text)]">Reutilizar esta estructura</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Publica objetivos, actividades, frecuencias, evidencias, vistas y aprobaciones como una versión inmutable. No incluye ejecuciones ni firmas.
          </p>
        </div>
        <Button type="button" variant="secondary" disabled={!ready} onClick={() => setOpen(true)}>
          Publicar como plantilla
        </Button>
      </div>
      {!ready && (
        <p className="mt-2 text-xs text-[var(--color-signal)]">Completa la revisión antes de publicar una base reutilizable.</p>
      )}
      {state?.ok && <p role="status" className="mt-2 text-xs text-[var(--color-success)]">{state.message}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar versión de plantilla</DialogTitle>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <input type="hidden" name="sourceProgramId" value={program.id} />
            <Field label="Nombre de la plantilla" htmlFor="pdtp-template-name" required>
              <Input id="pdtp-template-name" name="name" required minLength={3} maxLength={200} defaultValue={program.title} />
            </Field>
            <Field label="Descripción" htmlFor="pdtp-template-description">
              <Textarea
                id="pdtp-template-description"
                name="description"
                maxLength={1000}
                placeholder="Explica para qué tipos de operación o faena sirve esta base."
              />
            </Field>
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Si ya existe una plantilla con este nombre se publicará una versión nueva. Los programas creados con versiones anteriores no cambiarán.
            </p>
            {state?.message && !state.ok && <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={pending}>{pending ? "Publicando..." : "Publicar versión"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Tab Planificación: matriz semanal editable con bulk-fill por fila ──────

type PdtpScheduleRow = typeof pdtpActivitySchedule.$inferSelect

const PLAN_MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function scheduleKey(month: number, week: number) {
  return `${month}-${week}`
}

export function PlanificacionTab({ programId: _programId, year, periodStart, periodEnd, activities, schedule }: {
  programId: string
  year: number
  periodStart?: string | null
  periodEnd?: string | null
  activities: PdtpActivityRow[]
  schedule: PdtpScheduleRow[]
}) {
  const scheduleByActivity = React.useMemo(() => {
    const map = new Map<string, Record<string, number>>()
    for (const activity of activities) map.set(activity.id, {})
    for (const cell of schedule) {
      const row = map.get(cell.activityId)
      if (row) row[scheduleKey(cell.month, cell.week)] = cell.plannedQuantity
    }
    return map
  }, [activities, schedule])

  // El horizonte real del programa (meses que su período cubre dentro del
  // año) acota "Rellenar": sin período declarado equivale al año completo,
  // igual que antes; con un período parcial, no fabrica celdas fuera de él.
  const horizon = React.useMemo(() => deriveScheduleHorizon({ year, periodStart, periodEnd }), [year, periodStart, periodEnd])
  const horizonMonths = new Set(horizon.months)
  const visibleMonthLabels = PLAN_MONTH_LABELS.filter((_, index) => horizonMonths.has(index + 1))

  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center text-sm text-[var(--color-text-muted)]">
        Sin actividades. Agrega actividades antes de planificar cantidades.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Cantidad planificada por semana para {year}
        {horizon.months.length < 12 ? ` (período de ${horizon.months.length} mes(es))` : ""}. Cada mes tiene {horizon.weeksPerMonth} celda(s).
        &ldquo;Rellenar&rdquo; fija una cantidad en las {horizon.months.length * horizon.weeksPerMonth} semanas del período de la fila (sin guardar todavía) — revisa y presiona Guardar.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-subtle)]">
            <tr>
              <th className="sticky left-0 z-10 min-w-[16rem] border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-left">Actividad</th>
              {visibleMonthLabels.map((m) => (
                <th key={m} className="min-w-[5.5rem] border-b border-[var(--color-border)] px-1 py-2 text-center">{m}</th>
              ))}
              <th className="min-w-[13rem] border-b border-[var(--color-border)] px-2 py-2 text-left">Rellenar / Guardar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {activities.map((activity) => (
              <PlanificacionRow key={activity.id} activity={activity} initial={scheduleByActivity.get(activity.id) ?? {}} horizon={horizon} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Huella estable (orden e ausencia-vs-cero no importan) para detectar cambios reales de planificación. */
function scheduleFingerprint(values: Record<string, number>): string {
  return Object.entries(values)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, quantity]) => `${key}=${quantity}`)
    .join(",")
}

function PlanificacionRow({ activity, initial, horizon }: { activity: PdtpActivityRow; initial: Record<string, number>; horizon: PdtpScheduleHorizon }) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, number>>(initial)
  const [fillValue, setFillValue] = React.useState("")
  const savedFingerprint = React.useMemo(() => scheduleFingerprint(initial), [initial])
  const currentFingerprint = React.useMemo(() => scheduleFingerprint(values), [values])
  const isDirty = currentFingerprint !== savedFingerprint

  // savedFingerprint ya resume el contenido de `initial`; comparar contra él
  // evita re-adoptar (y perder lo tecleado) por el mero cambio de identidad.
  const [lastSavedSchedule, setLastSavedSchedule] = React.useState(savedFingerprint)
  if (lastSavedSchedule !== savedFingerprint) {
    setLastSavedSchedule(savedFingerprint)
    setValues(initial)
  }

  function setCell(month: number, week: number, raw: string) {
    const n = raw === "" ? 0 : Number(raw)
    setValues((prev) => ({ ...prev, [scheduleKey(month, week)]: Number.isFinite(n) ? n : 0 }))
  }

  function fillAll() {
    const n = Number(fillValue)
    if (!Number.isFinite(n) || n < 0) return
    const next: Record<string, number> = {}
    // Solo rellena los meses del horizonte real del programa (año completo
    // por defecto); un período parcial no fabrica celdas fuera de su rango.
    for (const m of horizon.months) for (let w = 1; w <= horizon.weeksPerMonth; w++) next[scheduleKey(m, w)] = n
    setValues(next)
  }

  const { status, error, saveNow } = useDebouncedAutosave({
    watchKey: currentFingerprint,
    isDirty,
    onSave: async () => {
      // scheduleOverrides es autoritativo para el año del programa: reemplaza
      // por completo la planificación de esta actividad (ver updatePdtpActivity
      // en lib/services/pdtp/activities.ts). Por eso la matriz mantiene las 48
      // celdas en memoria en vez de solo las que el usuario tocó.
      const scheduleOverrides = Object.entries(values)
        .map(([key, plannedQuantity]) => {
          const [month, week] = key.split("-").map(Number) as [number, number]
          return { month, week, plannedQuantity }
        })
        .filter((c) => c.plannedQuantity > 0)
      const result = await updatePdtpActivityAction({ activityId: activity.id, scheduleOverrides })
      if (result.ok) router.refresh()
      return result
    },
  })
  const pending = status === "saving"

  return (
    <tr className="bg-[var(--color-surface)] align-top">
      <td className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}
      </td>
      {horizon.months.map((month) => (
        <td key={month} className="p-1">
          <div className="grid grid-cols-2 gap-0.5">
            {Array.from({ length: horizon.weeksPerMonth }, (_, i) => i + 1).map((week) => (
              <input
                key={week}
                type="number"
                min="0"
                step="0.25"
                value={values[scheduleKey(month, week)] || ""}
                onChange={(e) => setCell(month, week, e.target.value)}
                title={`${PLAN_MONTH_LABELS[month - 1]} · Semana ${week}`}
                className="h-6 w-11 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-center text-[11px] text-[var(--color-text)]"
              />
            ))}
          </div>
        </td>
      ))}
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            step="0.25"
            placeholder="cant."
            value={fillValue}
            onChange={(e) => setFillValue(e.target.value)}
            className="h-7 w-14 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-xs text-[var(--color-text)]"
          />
          <Button type="button" variant="ghost" size="sm" onClick={fillAll} disabled={fillValue === ""}>Rellenar</Button>
          <Button type="button" size="sm" onClick={saveNow} disabled={pending || !isDirty}>{pending ? "..." : "Guardar"}</Button>
        </div>
        <p aria-live="polite" className="mt-1 text-[11px] text-[var(--color-text-subtle)]">{autosaveStatusLabel(status)}</p>
        {error && <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>}
      </td>
    </tr>
  )
}
