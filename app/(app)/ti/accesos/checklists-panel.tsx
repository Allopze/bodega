"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { Plus, Check } from "@phosphor-icons/react"
import { createChecklistAction, toggleChecklistTaskAction } from "./actions"
import { IT_CHECKLIST_KIND_META } from "@/lib/services/ti/constants"
import { formatDate } from "@/lib/utils"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface ChecklistRow {
  id: string
  workerName: string
  worksiteName: string
  kind: string
  startedAt: string
  completedAt: string | null
  createdByName: string | null
  notes: string | null
  totalTasks: number
  doneTasks: number
  tasks: { id: string; name: string; done: boolean; doneAt: string | null; doneByName: string | null; notes: string | null }[]
}

export function ChecklistsPanel({ checklists, workers, canManage }: {
  checklists: ChecklistRow[]
  workers: { id: string; name: string; lastName: string }[]
  canManage: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createChecklistAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Checklist creado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [taskToggleState, taskToggleAction] = useActionState(toggleChecklistTaskAction, INITIAL_STATE)

  React.useEffect(() => {
    if (taskToggleState.message) {
      if (taskToggleState.ok) toast.success(taskToggleState.message)
      else toast.error(taskToggleState.message)
    }
  }, [taskToggleState])

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2">Checklists de alta y baja</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Cuando un trabajador ingresa o se retira de CHOME: correo, accesos, equipos, licencias.
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} className="mr-1.5" /> Nuevo checklist
          </Button>
        )}
      </div>

      {checklists.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Sin checklists todavía"
          description={canManage ? "Crea un checklist de alta o baja para comenzar a registrar las tareas." : "Los checklists de alta y baja aparecerán aquí cuando se registren."}
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {checklists.map((checklist) => {
            const progress = checklist.totalTasks > 0 ? Math.round((checklist.doneTasks / checklist.totalTasks) * 100) : 0
            return (
              <li key={checklist.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {IT_CHECKLIST_KIND_META[checklist.kind] ?? checklist.kind} — {checklist.workerName}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {checklist.worksiteName} · iniciado {formatDate(checklist.startedAt)}
                      {checklist.completedAt && ` · completado ${formatDate(checklist.completedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <MetaBadge meta={{ label: `${checklist.doneTasks}/${checklist.totalTasks}`, variant: checklist.completedAt ? "success" : progress > 0 ? "warning" : "default" }} />
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${progress}%` }} />
                </div>
                <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {checklist.tasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-2">
                      {canManage ? (
                        <form action={taskToggleAction} className="flex w-full items-start gap-2">
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="done" value={task.done ? "" : "on"} />
                          <button
                            type="submit"
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${task.done ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"}`}
                            aria-label={task.done ? `Reabrir ${task.name}` : `Completar ${task.name}`}
                          >
                            {task.done && <Check size={10} weight="bold" />}
                          </button>
                          <span className={`text-sm ${task.done ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-text)]"}`}>{task.name}</span>
                        </form>
                      ) : (
                        <span className={`text-sm ${task.done ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-text)]"}`}>
                          {task.done ? "✓ " : "○ "}{task.name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={formAction} className="flex flex-col flex-1 min-h-0">
            <SheetHeader>
              <div>
                <SheetTitle>Nuevo checklist</SheetTitle>
                <SheetDescription>Alta (onboarding) o baja (offboarding) de un trabajador.</SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {state.message && !state.ok && !state.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
              )}
              <FieldGroup>
                <Field label="Trabajador" required error={state.fieldErrors?.workerId?.[0]}>
                  <Select name="workerId">
                    <SelectTrigger aria-label="Trabajador">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.name} {w.lastName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tipo" required error={state.fieldErrors?.kind?.[0]}>
                  <Select name="kind">
                    <SelectTrigger aria-label="Tipo de checklist">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onboarding">Alta</SelectItem>
                      <SelectItem value="offboarding">Baja</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Notas">
                  <Input name="notes" maxLength={500} />
                </Field>
              </FieldGroup>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Crear checklist" loadingLabel="Creando..." />
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}
