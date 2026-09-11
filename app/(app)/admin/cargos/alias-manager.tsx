"use client"

import { useActionState } from "react"
import { Trash } from "@phosphor-icons/react"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetDescription } from "@/components/admin/sheet"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SubmitButton } from "@/components/ui/submit-button"
import { useActionStateToast } from "@/lib/hooks/use-action-watchers"
import { INITIAL_STATE } from "@/lib/form-state"
import { addWorkerPositionAliasAction, removeWorkerPositionAliasAction } from "./actions"
import type { WorkerPositionCatalogRow } from "./types"

export function AliasManager({ position, open, onClose }: { position: WorkerPositionCatalogRow | null; open: boolean; onClose: () => void }) {
  const [addState, addAction] = useActionState(addWorkerPositionAliasAction, INITIAL_STATE)
  const [removeState, removeAction] = useActionState(removeWorkerPositionAliasAction, INITIAL_STATE)

  useActionStateToast([addState, removeState])

  if (!position) return null
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <div>
            <SheetTitle>Alias de {position.name}</SheetTitle>
            <SheetDescription>Las importaciones reconocerán estas variantes como el cargo {position.code}.</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody>
          <form action={addAction} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4">
            <input type="hidden" name="positionId" value={position.id} />
            <Field label="Nuevo alias" htmlFor="position-alias" error={addState.fieldErrors?.alias?.[0]} helper='Ejemplo: "Chofer" para el cargo "Conductor".'>
              <Input id="position-alias" name="alias" autoComplete="off" error={Boolean(addState.fieldErrors?.alias)} />
            </Field>
            <div className="mt-3 flex justify-end">
              <SubmitButton label="Agregar alias" loadingLabel="Agregando..." />
            </div>
          </form>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Alias registrados</h3>
            {position.aliases.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">Este cargo todavía no tiene alias.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-[var(--radius-lg)] border border-[var(--color-border)]">
                {position.aliases.map((alias) => (
                  <li key={alias.id} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm text-[var(--color-text)]">{alias.alias}</span>
                    <form action={removeAction}>
                      <input type="hidden" name="id" value={alias.id} />
                      <Button type="submit" variant="ghost" size="icon-sm" className="text-[var(--color-danger)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]" aria-label={`Eliminar alias ${alias.alias}`}>
                        <Trash size={16} />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetBody>
        <SheetFooter><Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
