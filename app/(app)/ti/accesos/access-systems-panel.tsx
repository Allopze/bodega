"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { useOperation } from "@/lib/hooks/use-operation"
import { Plus } from "@phosphor-icons/react"
import { createAccessSystemAction, toggleAccessSystemAction } from "./actions"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"

interface SystemRow {
  id: string
  name: string
  description: string | null
  isActive: boolean
  accessCount: number
}

export function AccessSystemsPanel({ systems, canManage }: { systems: SystemRow[]; canManage: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createAccessSystemAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Sistema creado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) toast.error(result.message)
    return result
  }, INITIAL_STATE)
  const [toggleState, toggleAction] = useActionState(toggleAccessSystemAction, INITIAL_STATE)

  // Desactivar un sistema lo saca de la matriz sin revocar los accesos
  // vigentes: se confirma explícitamente diciendo cuántos quedan activos.
  const [pendingDeactivation, setPendingDeactivation] = React.useState<SystemRow | null>(null)
  const deactivate = useOperation({ feedback: "toast" })

  React.useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2">Sistemas</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Catálogo configurable de sistemas a los que CHOME da acceso: correo, VPN, Ariba, Chipax, SIDREP…
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} className="mr-1.5" /> Nuevo sistema
          </Button>
        )}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {systems.map((system) => (
          <li key={system.id} className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5">
            <span className={`text-sm ${system.isActive ? "text-[var(--color-text)]" : "text-[var(--color-text-subtle)] line-through"}`}>{system.name}</span>
            <MetaBadge meta={{ label: `${system.accessCount} activos`, variant: "outline" }} />
            {canManage && (
              system.isActive ? (
                <button
                  type="button"
                  onClick={() => setPendingDeactivation(system)}
                  className="text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  title="Desactivar sistema"
                >
                  Desactivar
                </button>
              ) : (
                <form action={toggleAction} className="flex items-center">
                  <input type="hidden" name="systemId" value={system.id} />
                  <input type="hidden" name="isActive" value="on" />
                  <button type="submit" className="text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Activar sistema">
                    Activar
                  </button>
                </form>
              )
            )}
          </li>
        ))}
        {systems.length === 0 && (
          <li className="w-full">
            <EmptyState
              compact
              align="start"
              title="Sin sistemas configurados"
              description={canManage ? "Crea el primer sistema para registrar los accesos de los trabajadores." : "El catálogo de sistemas aparecerá aquí cuando se configure."}
            />
          </li>
        )}
      </ul>

      <ConfirmDialog
        open={pendingDeactivation !== null}
        onOpenChange={(v) => { if (!v) setPendingDeactivation(null) }}
        title={`¿Desactivar ${pendingDeactivation?.name ?? "el sistema"}?`}
        description={
          pendingDeactivation && pendingDeactivation.accessCount > 0
            ? `${pendingDeactivation.accessCount} trabajador(es) mantienen su acceso activo a este sistema. Desactivarlo lo saca del catálogo y de la matriz, pero NO revoca esos accesos: revócalos primero si el sistema se dio de baja de verdad.`
            : "El sistema saldrá del catálogo y ya no podrá otorgarse a nuevos trabajadores. Podrás reactivarlo cuando quieras."
        }
        confirmLabel="Desactivar"
        variant={pendingDeactivation && pendingDeactivation.accessCount > 0 ? "destructive" : "warning"}
        loading={deactivate.pending}
        onConfirm={() => {
          const target = pendingDeactivation
          if (!target) return
          setPendingDeactivation(null)
          void deactivate.run(async () => {
            const formData = new FormData()
            formData.set("systemId", target.id)
            formData.set("isActive", "")
            // `feedback: "toast"` deja el aviso en manos del hook.
            return toggleAccessSystemAction(INITIAL_STATE, formData)
          })
        }}
      />

      <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
        <SheetContent className="sm:max-w-md">
          <form action={formAction} className="flex flex-col flex-1 min-h-0">
            <SheetHeader>
              <div>
                <SheetTitle>Nuevo sistema</SheetTitle>
                <SheetDescription>Un sistema o aplicación al que los trabajadores pueden tener acceso.</SheetDescription>
              </div>
              <SheetCloseButton />
            </SheetHeader>
            <SheetBody className="space-y-4">
              {state.message && !state.ok && !state.fieldErrors && (
                <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
              )}
              <FieldGroup>
                <Field label="Nombre" required error={state.fieldErrors?.name?.[0]}>
                  <Input name="name" maxLength={80} placeholder="Microsoft 365, VPN, Chipax…" />
                </Field>
                <Field label="Descripción">
                  <Textarea name="description" maxLength={300} rows={3} />
                </Field>
              </FieldGroup>
            </SheetBody>
            <SheetFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton label="Crear sistema" loadingLabel="Creando..." />
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  )
}
