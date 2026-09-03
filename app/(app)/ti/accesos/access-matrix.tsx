"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { Check } from "@phosphor-icons/react"
import { upsertSystemAccessAction } from "./actions"
import { IT_ACCESS_STATUS_META } from "@/lib/services/ti/constants"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"

interface WorkerAccess {
  id: string
  name: string
  worksiteId: string
  worksiteName: string
  accesses: { systemId: string; systemName: string; status: string; notes?: string | null }[]
}

interface AccessMatrixProps {
  workers: WorkerAccess[]
  systems: { id: string; name: string }[]
  worksites: { id: string; name: string }[]
  workersList: { id: string; name: string; lastName: string }[]
  canManage: boolean
}

export function AccessMatrix({ workers, systems, canManage }: AccessMatrixProps) {
  const [editing, setEditing] = React.useState<{ workerId: string; systemId: string; status?: string } | null>(null)

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2">Matriz de accesos por trabajador</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {workers.length} trabajadores activos. Haz clic en una celda para registrar el acceso.
          </p>
        </div>
      </div>

      {systems.length === 0 ? (
        <EmptyState
          compact
          title="Aún no hay sistemas"
          description="Crea un sistema en el catálogo superior para comenzar a registrar accesos."
          align="start"
        />
      ) : workers.length === 0 ? (
        <EmptyState
          compact
          title="No hay trabajadores para estos filtros"
          description="Ajusta la faena o la búsqueda para encontrar trabajadores activos."
          align="start"
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 bg-[var(--color-surface)] px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Trabajador</th>
                {systems.map((system) => (
                  <th key={system.id} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{system.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workers.map((worker) => (
                <tr key={worker.id} className="border-t border-[var(--color-border)]">
                  <td className="sticky left-0 bg-[var(--color-surface)] px-2 py-2">
                    <span className="font-medium text-[var(--color-text)]">{worker.name}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{worker.worksiteName}</span>
                  </td>
                  {systems.map((system) => {
                    const access = worker.accesses.find((a) => a.systemId === system.id)
                    return (
                      <td key={system.id} className="px-1 py-2 text-center">
                        {access ? (
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => setEditing({ workerId: worker.id, systemId: system.id, status: access.status })}
                            className="inline-flex items-center gap-1"
                            title={access.status}
                          >
                            {access.status === "activo" && <Check size={14} className="text-[var(--color-success-ink)]" />}
                            {access.status === "suspendido" && <Badge variant="warning" size="sm">Suspendido</Badge>}
                            {access.status === "baja" && <Badge variant="default" size="sm">Baja</Badge>}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!canManage}
                            onClick={() => setEditing({ workerId: worker.id, systemId: system.id })}
                            className="text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
                            aria-label={`Registrar acceso de ${worker.name} a ${system.name}`}
                          >
                            —
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && canManage && (
        <AccessEditSheet
          workerId={editing.workerId}
          systemId={editing.systemId}
          status={editing.status}
          systems={systems}
          workerName={workers.find((w) => w.id === editing.workerId)?.name ?? ""}
          notes={workers.find((w) => w.id === editing.workerId)?.accesses.find((a) => a.systemId === editing.systemId)?.notes}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function AccessEditSheet({ workerId, systemId, systems, workerName, status = "activo", notes, onClose }: {
  workerId: string
  systemId: string
  systems: { id: string; name: string }[]
  workerName: string
  status?: string
  notes?: string | null
  onClose: () => void
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await upsertSystemAccessAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Acceso actualizado")
      onClose()
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="workerId" value={workerId} />
          <input type="hidden" name="systemId" value={systemId} />
          <SheetHeader>
            <div>
              <SheetTitle>Acceso de {workerName}</SheetTitle>
              <SheetDescription>Sistema: {systems.find((s) => s.id === systemId)?.name ?? ""}</SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>
          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}
            <FieldGroup>
              <Field label="Estado" required>
                <div className="flex gap-2">
                  {Object.entries(IT_ACCESS_STATUS_META).map(([value, meta]) => (
                    <label key={value} className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-2 text-xs has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-tint)]">
                      <input type="radio" name="status" value={value} defaultChecked={value === status} className="sr-only" />
                      {meta.label}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Notas" helper="Fecha de alta, ticket asociado, motivo…">
                <Input name="notes" maxLength={300} defaultValue={notes ?? ""} />
              </Field>
            </FieldGroup>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label="Guardar acceso" loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
