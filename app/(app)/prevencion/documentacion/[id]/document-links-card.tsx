"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { LinkSimple, Trash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/lib/toast"
import { createSstDocumentLinkAction, removeSstDocumentLinkAction } from "../actions"

const ENTITY_TYPES = [
  { value: "worker", label: "Trabajador" },
  { value: "worksite", label: "Faena" },
  { value: "pdtp_activity", label: "Actividad PDTP" },
  { value: "pdtp_execution", label: "Ejecución PDTP" },
  { value: "sst_evaluation", label: "Evaluación SST" },
  { value: "corrective_action", label: "Acción CAPA" },
  { value: "ppa", label: "PPA" },
  { value: "committee", label: "Comité Paritario" },
] as const

const ENTITY_LABELS = Object.fromEntries(ENTITY_TYPES.map((item) => [item.value, item.label]))

interface Props {
  documentId: string
  links: Array<{ id: string; entityType: string; entityId: string; notes: string | null }>
  canLink: boolean
  onMutated?: () => void
}

export function DocumentLinksCard({ documentId, links, canLink, onMutated }: Props) {
  const router = useRouter()
  const refresh = () => {
    router.refresh()
    onMutated?.()
  }
  const [entityType, setEntityType] = React.useState("worker")
  const [entityId, setEntityId] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [pending, startTransition] = React.useTransition()
  // Vínculo a retirar. El motivo se pide en un diálogo accesible —antes, un
  // `window.prompt`— y el diálogo sólo se cierra si el retiro prosperó, para no
  // perder lo escrito cuando el servidor lo rechaza.
  const [removingId, setRemovingId] = React.useState<string | null>(null)

  function addLink() {
    startTransition(async () => {
      const result = await createSstDocumentLinkAction({ documentId, entityType, entityId, notes })
      if (!result.ok) {
        toast.error(result.message ?? "No se pudo crear el vínculo.")
        return
      }
      setEntityId("")
      setNotes("")
      toast.success(result.message ?? "Vínculo registrado.")
      refresh()
    })
  }

  function removeLink(linkId: string, reason: string) {
    startTransition(async () => {
      const result = await removeSstDocumentLinkAction({ documentId, linkId, reason })
      if (!result.ok) {
        toast.error(result.message ?? "No se pudo retirar el vínculo.")
        return
      }
      setRemovingId(null)
      toast.success(result.message ?? "Vínculo retirado.")
      refresh()
    })
  }

  return (
    <Card>
      <ConfirmDialog
        open={removingId !== null}
        onOpenChange={(open) => { if (!open) setRemovingId(null) }}
        title="Retirar vínculo"
        description="El documento deja de estar asociado a esta entidad. El retiro queda en la trazabilidad del documento."
        variant="destructive"
        confirmLabel="Retirar vínculo"
        reasonLabel="Motivo del retiro"
        loading={pending}
        onConfirm={(reason) => { if (removingId) removeLink(removingId, reason) }}
      />
      <CardHeader><CardTitle>Vínculos operacionales</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {links.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">Sin entidades vinculadas.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {links.map((link) => (
              <li key={link.id} className="flex items-start justify-between gap-2 border-b border-(--color-border) pb-2 last:border-0">
                <div className="min-w-0">
                  <p className="font-medium">{ENTITY_LABELS[link.entityType] ?? link.entityType}</p>
                  <p className="break-all text-xs text-(--color-text-muted)">{link.entityId}{link.notes ? ` · ${link.notes}` : ""}</p>
                </div>
                {canLink ? (
                  <Button type="button" size="icon" variant="ghost" aria-label="Retirar vínculo" disabled={pending} onClick={() => setRemovingId(link.id)}>
                    <Trash size={15} />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canLink ? (
          <div className="space-y-2 border-t border-(--color-border) pt-3">
            <Field label="Tipo de entidad" htmlFor="document-link-type">
              <Select value={entityType} onValueChange={setEntityType} disabled={pending}>
                <SelectTrigger id="document-link-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Identificador exacto" htmlFor="document-link-id" required>
              <Input id="document-link-id" value={entityId} onChange={(event) => setEntityId(event.target.value)} maxLength={160} disabled={pending} />
            </Field>
            <Field label="Notas" htmlFor="document-link-notes">
              <Textarea id="document-link-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={1000} disabled={pending} />
            </Field>
            <Button type="button" size="sm" variant="secondary" disabled={pending || !entityId.trim()} onClick={addLink}>
              <LinkSimple size={15} className="mr-1" /> {pending ? "Validando…" : "Validar y vincular"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
