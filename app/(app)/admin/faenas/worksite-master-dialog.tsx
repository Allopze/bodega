"use client"

import * as React from "react"
import { X } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import { WORKSITE_KINDS, WORKSITE_KIND_LABELS, type WorksiteKind } from "@/lib/worksites/worksite-kind"
import { addWorksiteAliasAction, removeWorksiteAliasAction, setWorksiteKindAction } from "./actions"

export interface WorksiteMasterTarget {
  id: string
  name: string
  kind: WorksiteKind
  aliases: Array<{ id: string; aliasText: string }>
}

/**
 * «Tipo y alias» de una faena (Trinorma): el tipo es un rótulo (operación, depósito,
 * administración) y los alias son los otros nombres con que llega la faena en las
 * planillas. El servidor rechaza un alias repetido o que se llame como otra faena.
 */
export function WorksiteMasterDialog({ worksite, onClose }: { worksite: WorksiteMasterTarget | null; onClose: () => void }) {
  const kindOp = useOperation({ feedback: "toast" })
  const aliasOp = useOperation()
  const removeOp = useOperation({ feedback: "toast" })
  const [kind, setKind] = React.useState<WorksiteKind>(worksite?.kind ?? "operacion")
  const [alias, setAlias] = React.useState("")
  const [removing, setRemoving] = React.useState<{ id: string; aliasText: string } | null>(null)

  const id = worksite?.id ?? ""

  function saveKind(next: WorksiteKind) {
    const previous = kind
    setKind(next)
    kindOp.run(
      async () => {
        const data = new FormData()
        data.set("id", id)
        data.set("kind", next)
        return setWorksiteKindAction({ ok: false }, data)
      },
      undefined,
      // Si el servidor lo rechaza, el selector no puede quedar mostrando un tipo que no se guardó.
      () => setKind(previous),
    )
  }

  function addAlias(event: React.FormEvent) {
    event.preventDefault()
    aliasOp.run(
      async () => {
        const data = new FormData()
        data.set("id", id)
        data.set("alias", alias)
        return addWorksiteAliasAction({ ok: false }, data)
      },
      (done) => { setAlias(""); aliasOp.setMessage(done.message ?? "Alias agregado.", "success") },
    )
  }

  function removeAlias(aliasId: string) {
    removeOp.run(
      async () => {
        const data = new FormData()
        data.set("id", id)
        data.set("aliasId", aliasId)
        return removeWorksiteAliasAction({ ok: false }, data)
      },
      () => setRemoving(null),
      () => setRemoving(null),
    )
  }

  return (
    <Dialog open={worksite !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tipo y alias de {worksite?.name}</DialogTitle>
          <DialogDescription>
            El tipo es un rótulo: no cambia permisos ni dónde se imputa el costo. Los alias son otros nombres
            con que llega esta faena en las planillas.
          </DialogDescription>
        </DialogHeader>

        <Field label="Tipo de faena" htmlFor="ws-kind">
          <Select value={kind} onValueChange={(value) => saveKind(value as WorksiteKind)} disabled={kindOp.pending}>
            <SelectTrigger id="ws-kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WORKSITE_KINDS.map((option) => (
                <SelectItem key={option} value={option}>{WORKSITE_KIND_LABELS[option]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="mt-4">
          <p className="text-sm font-medium">Alias</p>
          {worksite && worksite.aliases.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Alias registrados">
              {worksite.aliases.map((item) => (
                <li key={item.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] py-0.5 pl-3 pr-1 text-sm">
                  {item.aliasText}
                  <button
                    type="button"
                    onClick={() => setRemoving(item)}
                    disabled={removeOp.pending}
                    aria-label={`Quitar el alias ${item.aliasText}`}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Esta faena no tiene alias. Agrega los nombres con que aparece en las planillas para que se reconozca al importarlas.
            </p>
          )}
        </div>

        <form onSubmit={addAlias} className="mt-3 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Nuevo alias" htmlFor="ws-alias" error={aliasOp.messageTone === "error" ? aliasOp.message : undefined}>
              <Input
                id="ws-alias"
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                maxLength={120}
                placeholder="Horcones"
                error={aliasOp.messageTone === "error"}
              />
            </Field>
          </div>
          <Button type="submit" size="sm" className="mt-6" disabled={aliasOp.pending || alias.trim().length === 0}>
            Agregar alias
          </Button>
        </form>
        {aliasOp.messageTone === "success" ? <p role="status" className="mt-2 text-sm text-[var(--color-success)]">{aliasOp.message}</p> : null}
      </DialogContent>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title="Quitar alias"
        description={`Las planillas que traigan «${removing?.aliasText ?? ""}» dejarán de reconocerse como ${worksite?.name ?? "esta faena"} al importarlas.`}
        confirmLabel="Quitar alias"
        variant="destructive"
        loading={removeOp.pending}
        onConfirm={() => { if (removing) removeAlias(removing.id) }}
      />
    </Dialog>
  )
}
