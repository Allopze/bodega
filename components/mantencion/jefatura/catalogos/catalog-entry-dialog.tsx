"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useOperation } from "@/lib/hooks/use-operation"
import { CATALOG_LABELS, CATALOG_NAME_MAX } from "@/lib/mantencion/catalog-labels"
import type { MantCatalogKey } from "@/lib/services/mantencion/catalogs"
import { toast } from "@/lib/toast"
import { createCatalogEntryAction, renameCatalogEntryAction } from "@/app/(app)/mantencion/catalogos/actions"

export type CatalogEntryDialogState =
  | { mode: "create" }
  | { mode: "rename"; id: string; name: string }

/** Alta o renombre de una entrada: un solo campo, con el error del servidor (duplicado, largo) bajo él. */
export function CatalogEntryDialog({ catalog, state, onClose }: { catalog: MantCatalogKey; state: CatalogEntryDialogState | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      {state && <EntryForm key={state.mode === "rename" ? state.id : "create"} catalog={catalog} state={state} onClose={onClose} />}
    </Dialog>
  )
}

function EntryForm({ catalog, state, onClose }: { catalog: MantCatalogKey; state: CatalogEntryDialogState; onClose: () => void }) {
  const labels = CATALOG_LABELS[catalog]
  const [name, setName] = React.useState(state.mode === "rename" ? state.name : "")
  const op = useOperation()
  const renaming = state.mode === "rename"

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(
      () => (state.mode === "rename"
        ? renameCatalogEntryAction({ catalog, id: state.id, name })
        : createCatalogEntryAction({ catalog, name })),
      (result) => {
        toast.success(result.message ?? "Cambio registrado")
        onClose()
      },
    )
  }

  const title = renaming ? `Renombrar ${labels.singular}` : labels.create
  return (
    <DialogContent>
      <form onSubmit={submit} noValidate>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {renaming
              ? "El cambio se ve en todo lo que ya la usa. Si el nombre ya existe en este catálogo no se guarda."
              : "Si ya existe una desactivada con ese nombre, se reactiva en vez de duplicarse."}
          </DialogDescription>
        </DialogHeader>
        <Field label={labels.nameLabel} required htmlFor="catalog-entry-name" error={op.message || undefined}>
          <Input
            id="catalog-entry-name"
            value={name}
            onChange={(event) => { setName(event.target.value); if (op.message) op.setMessage("") }}
            autoComplete="off"
            maxLength={CATALOG_NAME_MAX + 20}
            placeholder={labels.namePlaceholder}
            error={!!op.message}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={op.pending || name.trim() === ""}>{op.pending ? "Guardando…" : renaming ? "Guardar nombre" : "Agregar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
