"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SubmitButton } from "@/components/admin/submit-button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  updatePdtpProgramAction,
  deletePdtpProgramAction,
  createPdtpSheetAction,
  deletePdtpSheetAction,
  updatePdtpActivityAction,
  deletePdtpActivityAction,
  reorderPdtpActivitiesAction,
  renamePdtpObjectiveAction,
} from "../../actions"

import type { pdtpPrograms, pdtpSheets, pdtpActivities, pdtpActivitySchedule } from "@/db/schema"

type PdtpBuilderTabsProps = {
  program: typeof pdtpPrograms.$inferSelect
  sheets: Array<typeof pdtpSheets.$inferSelect>
  activities: Array<typeof pdtpActivities.$inferSelect>
  schedule: Array<typeof pdtpActivitySchedule.$inferSelect>
  userId: string
  canDelete: boolean
}

export function PdtpBuilderTabs({ program, sheets, activities, schedule, userId, canDelete }: PdtpBuilderTabsProps) {
  return (
    <Tabs defaultValue="metadatos">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="metadatos">Metadatos</TabsTrigger>
        <TabsTrigger value="hojas">Hojas</TabsTrigger>
        <TabsTrigger value="objetivos">Objetivos</TabsTrigger>
        <TabsTrigger value="actividades">Actividades</TabsTrigger>
        <TabsTrigger value="planificacion">Planificación</TabsTrigger>
      </TabsList>

      <TabsContent value="metadatos">
        <MetadataTab program={program} canDelete={canDelete} />
      </TabsContent>
      <TabsContent value="hojas">
        <SheetsTab programId={program.id} sheets={sheets} userId={userId} />
      </TabsContent>
      <TabsContent value="objetivos">
        <ObjetivosTab programId={program.id} activities={activities} />
      </TabsContent>
      <TabsContent value="actividades">
        <ActividadesTab programId={program.id} activities={activities} />
      </TabsContent>
      <TabsContent value="planificacion">
        <PlanificacionTab programId={program.id} year={program.year} activities={activities} schedule={schedule} />
      </TabsContent>
    </Tabs>
  )
}

function MetadataTab({ program, canDelete }: { program: typeof pdtpPrograms.$inferSelect; canDelete: boolean }) {
  const router = useRouter()
  const [updateState, updateAction] = useActionState(updatePdtpProgramAction, null)
  const [deleteState, deleteAction, deletePending] = useActionState(deletePdtpProgramAction, null)

  // Bug A: llamar router.refresh()/push() en el cuerpo del componente los
  // dispara en cada render (useActionState no limpia su estado solo), lo
  // que producía un loop de refetch. En un efecto, corren una sola vez por
  // transición de estado.
  React.useEffect(() => {
    if (updateState?.ok) router.refresh()
  }, [updateState, router])

  React.useEffect(() => {
    if (deleteState?.ok) router.push("/prevencion/pdtp")
  }, [deleteState, router])

  return (
    <div className="space-y-6">
      <form action={updateAction} className="max-w-md space-y-4">
        <input type="hidden" name="programId" value={program.id} />

        <FieldGroup className="gap-4">
          <Field label="Título" htmlFor="meta-title" required>
            <Input id="meta-title" name="title" defaultValue={program.title} required />
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
              defaultValue={program.complianceTarget}
              required
            />
          </Field>
        </FieldGroup>

        <SubmitButton label="Guardar cambios" loadingLabel="Guardando..." size="sm" />
      </form>

      <ImportExcelSection programId={program.id} />

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

function ImportExcelSection({ programId }: { programId: string }) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)
  const [state, setState] = React.useState<{ ok: boolean; message: string } | null>(null)

  // Va contra una API route, no un Server Action: el workbook real
  // ("PROGRAMA DE TRABAJO PREVENTIVO SG-SST.xlsx") pesa ~4-5 MB y Next.js
  // limita el body de los Server Actions a 1 MB por defecto — con un
  // Server Action esto fallaba en runtime con "Body exceeded 1 MB limit"
  // para cualquier archivo real (mismo patrón que pdtp-execution-form.tsx).
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setPending(true)
    setState(null)
    try {
      const fd = new FormData()
      fd.set("programId", programId)
      fd.set("file", file)
      const res = await fetch("/api/prevencion/pdtp/import", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) {
        setState({ ok: false, message: json.error ?? "Error al importar el Excel." })
      } else {
        setState({ ok: true, message: json.message })
        formRef.current?.reset()
        router.refresh()
      }
    } catch {
      setState({ ok: false, message: "Error de red al importar el Excel." })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md border-t border-[var(--color-border)] pt-6">
      <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Importar desde Excel</h3>
      <p className="mb-3 text-xs text-[var(--color-text-muted)]">
        Sube el archivo &ldquo;PROGRAMA DE TRABAJO PREVENTIVO SG-SST.xlsx&rdquo; para poblar hojas y
        actividades. Reemplaza por completo las actividades actuales del programa — no se acumulan.
      </p>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
        <input ref={fileRef} type="file" name="file" accept=".xlsx,.xls" required className="text-sm text-[var(--color-text)]" />
        {state?.message && (
          <p className={`rounded-[var(--radius)] border px-3 py-2 text-sm ${
            state.ok
              ? "border-[var(--color-success-line)] bg-[var(--color-success-tint)] text-[var(--color-success)]"
              : "border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] text-[var(--color-danger)]"
          }`}>
            {state.message}
          </p>
        )}
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Importando..." : "Importar Excel"}
        </Button>
      </form>
    </div>
  )
}

// ── Tab Actividades: edición inline, reordenamiento, eliminación ───────────

type PdtpActivityRow = typeof pdtpActivities.$inferSelect

function ActividadesTab({ programId, activities }: { programId: string; activities: PdtpActivityRow[] }) {
  const router = useRouter()
  const [items, setItems] = React.useState(activities)
  const [editing, setEditing] = React.useState<PdtpActivityRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => { setItems(activities) }, [activities])

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
    if (!confirm("¿Eliminar esta actividad? Se perderá su planificación y ejecuciones registradas.")) return
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

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-[var(--radius)] border border-[var(--color-danger-line)] bg-[var(--color-danger-tint)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
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
                <th className="w-12 px-3 py-2 text-left">N°</th>
                <th className="px-3 py-2 text-left">Actividad</th>
                <th className="px-3 py-2 text-left">Programa</th>
                <th className="w-56 px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.map((activity, index) => (
                <tr key={activity.id} className="bg-[var(--color-surface)]">
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
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setEditing(activity)}>Editar</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busyId !== null} onClick={() => handleDelete(activity.id)}>Eliminar</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditActivityDialog activity={editing} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
    </div>
  )
}

function EditActivityDialog({ activity, onClose, onSaved }: {
  activity: PdtpActivityRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [activityText, setActivityText] = React.useState("")
  const [program, setProgram] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (activity) {
      setActivityText(activity.activity)
      setProgram(activity.program)
      setNotes(activity.notes ?? "")
      setError(null)
    }
  }, [activity])

  async function handleSave() {
    if (!activity) return
    setPending(true)
    setError(null)
    try {
      const result = await updatePdtpActivityAction({ activityId: activity.id, activity: activityText, program, notes })
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
          <Field label="Actividad" htmlFor="edit-activity">
            <Textarea id="edit-activity" value={activityText} onChange={(e) => setActivityText(e.target.value)} rows={3} />
          </Field>
          <Field label="Programa" htmlFor="edit-program">
            <Input id="edit-program" value={program} onChange={(e) => setProgram(e.target.value)} />
          </Field>
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

// ── Tab Objetivos: renombrar el objetivo compartido por cada grupo (1-8) ───

function ObjetivosTab({ programId, activities }: { programId: string; activities: PdtpActivityRow[] }) {
  const groups = React.useMemo(() => {
    const byOrder = new Map<number, { objective: string; count: number }>()
    for (const activity of activities) {
      const existing = byOrder.get(activity.objectiveOrder)
      if (!existing) byOrder.set(activity.objectiveOrder, { objective: activity.objective, count: 1 })
      else existing.count += 1
    }
    return Array.from({ length: 8 }, (_, i) => i + 1).map((order) => ({
      objectiveOrder: order,
      objective: byOrder.get(order)?.objective ?? "",
      count: byOrder.get(order)?.count ?? 0,
    }))
  }, [activities])

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        El objetivo es compartido por todas las actividades del mismo grupo (1-8): renombrarlo aquí actualiza todas sus actividades a la vez.
      </p>
      {groups.map((group) => (
        <ObjectiveRow key={group.objectiveOrder} programId={programId} group={group} />
      ))}
    </div>
  )
}

function ObjectiveRow({ programId, group }: {
  programId: string
  group: { objectiveOrder: number; objective: string; count: number }
}) {
  const router = useRouter()
  const [value, setValue] = React.useState(group.objective)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => setValue(group.objective), [group.objective])

  async function handleSave() {
    if (!value.trim() || value === group.objective) return
    setPending(true)
    setError(null)
    try {
      const result = await renamePdtpObjectiveAction({ programId, objectiveOrder: group.objectiveOrder, objective: value })
      if (!result.ok) {
        setError(result.message ?? "Error al renombrar el objetivo.")
      } else {
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-[var(--color-text-subtle)]">{group.objectiveOrder}</span>
        <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 flex-1" placeholder="Sin actividades en este objetivo aún" />
        <Button type="button" size="sm" disabled={pending || !value.trim() || value === group.objective} onClick={handleSave}>
          {pending ? "..." : "Guardar"}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-text-subtle)]">
        {group.count > 0 ? `${group.count} actividad(es)` : "Aún sin actividades — se asignarán al agregar una con este orden de objetivo."}
      </p>
      {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  )
}

// ── Tab Planificación: matriz semanal editable con bulk-fill por fila ──────

type PdtpScheduleRow = typeof pdtpActivitySchedule.$inferSelect

const PLAN_MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function scheduleKey(month: number, week: number) {
  return `${month}-${week}`
}

function PlanificacionTab({ programId: _programId, year, activities, schedule }: {
  programId: string
  year: number
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
        Cantidad planificada por semana para {year}. Cada mes tiene 4 celdas (S1-S4). &ldquo;Rellenar&rdquo;
        fija una cantidad en las 48 semanas de la fila (sin guardar todavía) — revisa y presiona Guardar.
      </p>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--color-surface-2)] text-xs text-[var(--color-text-subtle)]">
            <tr>
              <th className="sticky left-0 z-10 min-w-[16rem] border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-left">Actividad</th>
              {PLAN_MONTH_LABELS.map((m) => (
                <th key={m} className="min-w-[5.5rem] border-b border-[var(--color-border)] px-1 py-2 text-center">{m}</th>
              ))}
              <th className="min-w-[13rem] border-b border-[var(--color-border)] px-2 py-2 text-left">Rellenar / Guardar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {activities.map((activity) => (
              <PlanificacionRow key={activity.id} activity={activity} initial={scheduleByActivity.get(activity.id) ?? {}} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlanificacionRow({ activity, initial }: { activity: PdtpActivityRow; initial: Record<string, number> }) {
  const router = useRouter()
  const [values, setValues] = React.useState<Record<string, number>>(initial)
  const [fillValue, setFillValue] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => setValues(initial), [initial])

  function setCell(month: number, week: number, raw: string) {
    const n = raw === "" ? 0 : Number(raw)
    setValues((prev) => ({ ...prev, [scheduleKey(month, week)]: Number.isFinite(n) ? n : 0 }))
  }

  function fillAll() {
    const n = Number(fillValue)
    if (!Number.isFinite(n) || n < 0) return
    const next: Record<string, number> = {}
    for (let m = 1; m <= 12; m++) for (let w = 1; w <= 4; w++) next[scheduleKey(m, w)] = n
    setValues(next)
  }

  async function handleSave() {
    const scheduleOverrides = Object.entries(values)
      .map(([key, plannedQuantity]) => {
        const [month, week] = key.split("-").map(Number) as [number, number]
        return { month, week, plannedQuantity }
      })
      .filter((c) => c.plannedQuantity > 0)

    setPending(true)
    setError(null)
    try {
      // scheduleOverrides es autoritativo para el año del programa: reemplaza
      // por completo la planificación de esta actividad (ver updatePdtpActivity
      // en lib/services/pdtp/activities.ts). Por eso la matriz mantiene las 48
      // celdas en memoria en vez de solo las que el usuario tocó.
      const result = await updatePdtpActivityAction({ activityId: activity.id, scheduleOverrides })
      if (!result.ok) {
        setError(result.message ?? "Error al guardar la planificación.")
      } else {
        router.refresh()
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <tr className="bg-[var(--color-surface)] align-top">
      <td className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        <span className="font-mono text-[var(--color-text-subtle)]">N°{activity.n}</span> {activity.activity}
      </td>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
        <td key={month} className="p-1">
          <div className="grid grid-cols-2 gap-0.5">
            {[1, 2, 3, 4].map((week) => (
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
          <Button type="button" size="sm" onClick={handleSave} disabled={pending}>{pending ? "..." : "Guardar"}</Button>
        </div>
        {error && <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>}
      </td>
    </tr>
  )
}
