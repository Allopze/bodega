"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { reconcilePdtpDeclaredActorAction } from "../actions"

type Candidate = { id: string; name: string }

const UNLINKED = "__unlinked__"

export function ReconcileDeclaredActorButton({
  programId,
  historyEntryId,
  declaredActorName,
  linkedUserId,
  candidates,
}: {
  programId: string
  historyEntryId: string
  declaredActorName: string
  linkedUserId: string | null
  candidates: Candidate[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState(linkedUserId ?? UNLINKED)
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)
    let result
    try {
      result = await reconcilePdtpDeclaredActorAction({
        programId,
        historyEntryId,
        linkedUserId: selected === UNLINKED ? null : selected,
        reason,
      })
    } finally {
      setPending(false)
    }
    if (!result.ok) { setError(result.message ?? "No se pudo guardar el vínculo."); return }
    setOpen(false)
    setReason("")
    router.refresh()
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {linkedUserId ? "Cambiar vínculo" : "Vincular a una persona"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reconciliar identidad declarada</DialogTitle>
            <DialogDescription>
              &ldquo;{declaredActorName}&rdquo; es el nombre que declara el documento fuente. Vincularlo a una persona
              usuaria de Chome no reemplaza ese nombre original; solo permite navegar a su perfil.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Persona en Chome" htmlFor="reconcile-user">
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger id="reconcile-user"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLINKED}>Sin vincular</SelectItem>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Motivo"
              htmlFor="reconcile-reason"
              required
              helper="Explica a qué persona corresponde el nombre declarado, o por qué se desvincula."
            >
              <Textarea
                id="reconcile-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                minLength={10}
                maxLength={1000}
                required
              />
            </Field>
            {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button type="button" onClick={save} disabled={pending || reason.trim().length < 10}>
              {pending ? "Guardando..." : "Guardar vínculo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
