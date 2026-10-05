"use client"

import * as React from "react"
import Link from "next/link"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { Plus, Check } from "@phosphor-icons/react"
import { createChecklistAction, revokeSystemAccessAction, toggleChecklistTaskAction } from "./actions"
import { revokeLicenseAction } from "../licencias/actions"
import { IT_ACCESS_STATUS_META, IT_CHECKLIST_KIND_META } from "@/lib/services/ti/constants"
import type { EgressContext } from "@/lib/services/ti/access"
import { formatDate, formatDateTime } from "@/lib/utils"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"

interface ChecklistRow {
  id: string
  workerId: string
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
  /** Solo en egresos abiertos: lo que la persona aún tiene de TI. */
  context: EgressContext | null
}

/**
 * Acción de página "Nuevo ingreso o egreso" (`PageHeader.actions`, pestaña
 * Ingresos y egresos). "Alta/Baja" nombraban también el estado del activo y la
 * revocación de un acceso; Ingreso/Egreso es el vocabulario de personas.
 */
export function NewChecklistCta({ workers }: { workers: { id: string; name: string; lastName: string }[] }) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createChecklistAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Registro creado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus size={14} className="mr-1.5" /> Nuevo ingreso o egreso
      </Button>
      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={formAction} className="flex flex-col flex-1 min-h-0">
            <SheetHeader>
              <div>
                <SheetTitle>Nuevo ingreso o egreso</SheetTitle>
                <SheetDescription>Un ingreso prepara correo, accesos y equipos; un egreso los cierra.</SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {state.message && !state.ok && !state.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
              )}
              <FieldGroup>
                <Field label="Trabajador" required error={state.fieldErrors?.workerId?.[0]}>
                  <OptionSelect
                    name="workerId"
                    placeholder="Selecciona un trabajador"
                    aria-label="Trabajador"
                    options={workers.map((w) => ({ value: w.id, label: `${w.name} ${w.lastName}` }))}
                  />
                </Field>
                <Field label="Tipo" required error={state.fieldErrors?.kind?.[0]}>
                  <OptionSelect
                    name="kind"
                    placeholder="Selecciona el tipo"
                    aria-label="Tipo"
                    options={[
                      { value: "onboarding", label: IT_CHECKLIST_KIND_META.onboarding ?? "Ingreso" },
                      { value: "offboarding", label: IT_CHECKLIST_KIND_META.offboarding ?? "Egreso" },
                    ]}
                  />
                </Field>
                <Field label="Notas">
                  <Textarea name="notes" maxLength={500} rows={3} />
                </Field>
              </FieldGroup>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Crear" loadingLabel="Creando..." />
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}

type PendingRevoke =
  | { kind: "access"; workerId: string; workerName: string; systemId: string; systemName: string }
  | { kind: "license"; assignmentId: string; workerName: string; licenseName: string }

export function ChecklistsPanel({ checklists, workers, canManage, canRevokeLicenses }: {
  checklists: ChecklistRow[]
  workers: { id: string; name: string; lastName: string }[]
  canManage: boolean
  canRevokeLicenses: boolean
}) {
  const [taskToggleState, taskToggleAction] = useActionState(toggleChecklistTaskAction, INITIAL_STATE)
  const [pendingRevoke, setPendingRevoke] = React.useState<PendingRevoke | null>(null)
  const revoke = useOperation({ feedback: "toast" })

  React.useEffect(() => {
    if (taskToggleState.message) {
      if (taskToggleState.ok) toast.success(taskToggleState.message)
      else toast.error(taskToggleState.message)
    }
  }, [taskToggleState])

  // Los completos se pliegan: son historia, no trabajo pendiente.
  const open = checklists.filter((c) => !c.completedAt)
  const closed = checklists.filter((c) => c.completedAt)

  function confirmRevoke() {
    const target = pendingRevoke
    if (!target) return
    setPendingRevoke(null)
    void revoke.run(async () => {
      const formData = new FormData()
      if (target.kind === "access") {
        formData.set("workerId", target.workerId)
        formData.set("systemId", target.systemId)
        return revokeSystemAccessAction(INITIAL_STATE, formData)
      }
      formData.set("assignmentId", target.assignmentId)
      return revokeLicenseAction(INITIAL_STATE, formData)
    })
  }

  const card = (checklist: ChecklistRow, defaultOpen: boolean) => (
    <ChecklistCard
      key={checklist.id}
      checklist={checklist}
      defaultOpen={defaultOpen}
      canManage={canManage}
      canRevokeLicenses={canRevokeLicenses}
      taskToggleAction={taskToggleAction}
      onRevoke={setPendingRevoke}
    />
  )

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div>
        <h2 className="text-h2">Ingresos y egresos</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
          Cuando alguien ingresa o se retira de CHOME: correo, accesos, equipos y licencias. En un egreso ves lo que la persona aún tiene y lo cierras aquí mismo.
        </p>
      </div>

      {checklists.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Aún no hay ingresos ni egresos"
          description={canManage
            ? "Registra un ingreso cuando alguien parte, para preparar su correo, accesos y equipos, o un egreso cuando se va, para cerrarlos."
            : "Los ingresos y egresos aparecerán aquí cuando se registren."}
          action={canManage ? <NewChecklistCta workers={workers} /> : undefined}
        />
      ) : (
        <div className="mt-4 space-y-3">
          {open.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">No hay ingresos ni egresos en curso.</p>
          )}
          {open.map((checklist) => card(checklist, true))}
          {closed.length > 0 && (
            <details className="group rounded-xl border border-dashed border-[var(--color-border)] p-1">
              <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:min-h-9">
                Completados ({closed.length})
              </summary>
              <div className="space-y-3 p-2">
                {closed.map((checklist) => card(checklist, false))}
              </div>
            </details>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(v) => { if (!v) setPendingRevoke(null) }}
        title={pendingRevoke?.kind === "license"
          ? `¿Revocar ${pendingRevoke.licenseName}?`
          : `¿Revocar el acceso a ${pendingRevoke?.systemName ?? "este sistema"}?`}
        description={pendingRevoke?.kind === "license"
          ? `${pendingRevoke.workerName} dejará de usar ${pendingRevoke.licenseName} y el cupo vuelve a quedar disponible.`
          : pendingRevoke
            ? `${pendingRevoke.workerName} perderá el acceso a ${pendingRevoke.systemName}. Queda registrado como Revocado y se puede volver a otorgar.`
            : ""}
        confirmLabel="Revocar"
        variant="destructive"
        loading={revoke.pending}
        onConfirm={confirmRevoke}
      />
    </section>
  )
}

function ChecklistCard({ checklist, defaultOpen, canManage, canRevokeLicenses, taskToggleAction, onRevoke }: {
  checklist: ChecklistRow
  defaultOpen: boolean
  canManage: boolean
  canRevokeLicenses: boolean
  taskToggleAction: (payload: FormData) => void
  onRevoke: (target: PendingRevoke) => void
}) {
  const kindLabel = IT_CHECKLIST_KIND_META[checklist.kind] ?? checklist.kind
  const progress = checklist.totalTasks > 0 ? Math.round((checklist.doneTasks / checklist.totalTasks) * 100) : 0
  const context = checklist.context

  return (
    <details open={defaultOpen} className="group rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <summary className="cursor-pointer list-none rounded-xl p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">{kindLabel} — {checklist.workerName}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {checklist.worksiteName}
              {" · creado"}{checklist.createdByName ? ` por ${checklist.createdByName}` : ""} el {formatDate(checklist.startedAt)}
              {checklist.completedAt && ` · completado el ${formatDate(checklist.completedAt)}`}
            </p>
          </div>
          <MetaBadge meta={{
            label: `${checklist.doneTasks} de ${checklist.totalTasks} tareas`,
            variant: checklist.completedAt ? "success" : progress > 0 ? "warning" : "default",
          }} />
        </div>
        <Progress
          className="mt-2"
          size="sm"
          value={checklist.doneTasks}
          max={Math.max(1, checklist.totalTasks)}
          label={`Avance de ${kindLabel.toLowerCase()} de ${checklist.workerName}: ${checklist.doneTasks} de ${checklist.totalTasks} tareas`}
        />
      </summary>

      <div className="space-y-4 px-4 pb-4">
        {checklist.notes && <p className="text-sm text-[var(--color-text-muted)]">{checklist.notes}</p>}

        {context && (
          <EgressContextBlock
            workerId={checklist.workerId}
            workerName={checklist.workerName}
            context={context}
            canManage={canManage}
            canRevokeLicenses={canRevokeLicenses}
            onRevoke={onRevoke}
          />
        )}

        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {checklist.tasks.map((task) => (
            <li key={task.id}>
              <TaskLine task={task} canManage={canManage} action={taskToggleAction} />
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

function TaskLine({ task, canManage, action }: {
  task: ChecklistRow["tasks"][number]
  canManage: boolean
  action: (payload: FormData) => void
}) {
  const text = (
    <span className="min-w-0 py-2">
      <span className={`text-sm ${task.done ? "text-[var(--color-text-subtle)] line-through" : "text-[var(--color-text)]"}`}>{task.name}</span>
      {task.done && task.doneAt && (
        <span className="block text-xs text-[var(--color-text-muted)]">
          Completada{task.doneByName ? ` por ${task.doneByName}` : ""} el {formatDateTime(task.doneAt)}
        </span>
      )}
      {task.notes && <span className="block text-xs text-[var(--color-text-muted)]">{task.notes}</span>}
    </span>
  )
  const box = (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded border ${task.done ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border-control)] bg-[var(--color-surface)]"}`}
      aria-hidden
    >
      {task.done && <Check size={12} weight="bold" />}
    </span>
  )

  if (!canManage) {
    return (
      <div className="flex items-start gap-2">
        <span className="flex h-9 w-5 shrink-0 items-center">{box}</span>
        {text}
        <span className="sr-only">{task.done ? "Completada" : "Pendiente"}</span>
      </div>
    )
  }
  return (
    <form action={action} className="flex items-start gap-1">
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="done" value={task.done ? "" : "on"} />
      {/* Objetivo táctil de 44 px en móvil; la caja visible sigue siendo de 20 px. */}
      <button
        type="submit"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--color-primary)] sm:h-9 sm:w-9"
        aria-label={task.done ? `Reabrir ${task.name}` : `Completar ${task.name}`}
      >
        {box}
      </button>
      {text}
    </form>
  )
}

/**
 * TIUX-19. El checklist de egreso eran casillas ("Revocar accesos", "Cerrar
 * licencias asignadas", "Recuperar notebook") que no listaban ni cambiaban
 * nada. Acá se ve lo que la plataforma sabe que la persona todavía tiene, y
 * cada fila trae su acción: las mismas acciones y guardas que la pantalla
 * normal de accesos y de licencias.
 */
function EgressContextBlock({ workerId, workerName, context, canManage, canRevokeLicenses, onRevoke }: {
  workerId: string
  workerName: string
  context: EgressContext
  canManage: boolean
  canRevokeLicenses: boolean
  onRevoke: (target: PendingRevoke) => void
}) {
  const nothingLeft = context.accesses.length === 0 && context.licenses.length === 0 && context.assets.length === 0
  const rowClass = "flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface)] px-3 py-1.5 text-sm sm:min-h-9"
  const revokeClass = "inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--color-danger-ink)] hover:underline sm:min-h-0 sm:px-0"

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Lo que {workerName} aún tiene</h3>
      {nothingLeft ? (
        <p className="mt-1 text-sm text-[var(--color-success-ink)]">
          No quedan accesos, licencias ni equipos por cerrar.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {context.accesses.length > 0 && (
            <section aria-label="Accesos vigentes">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Accesos vigentes ({context.accesses.length})</h4>
              <ul className="mt-1 space-y-1">
                {context.accesses.map((access) => (
                  <li key={access.systemId} className={rowClass}>
                    <span className="text-[var(--color-text)]">
                      {access.systemName}{" "}
                      <MetaBadge meta={IT_ACCESS_STATUS_META[access.status] ?? { label: access.status, variant: "default" }} />
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        className={revokeClass}
                        aria-label={`Revocar el acceso de ${workerName} a ${access.systemName}`}
                        onClick={() => onRevoke({ kind: "access", workerId, workerName, systemId: access.systemId, systemName: access.systemName })}
                      >
                        Revocar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {context.licenses.length > 0 && (
            <section aria-label="Licencias asignadas">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Licencias asignadas ({context.licenses.length})</h4>
              <ul className="mt-1 space-y-1">
                {context.licenses.map((license) => (
                  <li key={license.assignmentId} className={rowClass}>
                    <span className="text-[var(--color-text)]">{license.licenseName}</span>
                    {canRevokeLicenses && (
                      <button
                        type="button"
                        className={revokeClass}
                        aria-label={`Revocar la licencia ${license.licenseName} de ${workerName}`}
                        onClick={() => onRevoke({ kind: "license", assignmentId: license.assignmentId, workerName, licenseName: license.licenseName })}
                      >
                        Revocar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {context.assets.length > 0 && (
            <section aria-label="Equipos en custodia">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Equipos en custodia ({context.assets.length})</h4>
              <ul className="mt-1 space-y-1">
                {context.assets.map((asset) => (
                  <li key={asset.assignmentId} className={rowClass}>
                    <span className="text-[var(--color-text)]">
                      <span className="font-mono text-xs">{asset.code}</span> · {asset.label}
                    </span>
                    {/* La devolución se registra en la ficha del equipo; aquí
                        solo se lleva a ella. */}
                    <Link
                      href={`/ti/activos/${asset.assetId}`}
                      className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-[var(--color-primary)] hover:underline sm:min-h-0 sm:px-0"
                    >
                      Devolver en la ficha<span className="sr-only"> de {asset.code}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
