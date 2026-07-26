"use client"

import * as React from "react"
import { UserPlus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { listOperationalAssignmentCandidatesAction, saveOperationalAssignmentAction } from "./actions"

const ASSIGNABLE_ACTIONS = new Set(["complete", "follow_up", "approve", "create_order", "issue", "send", "receive_office", "receive_worksite", "deliver"])

export function WorkAssignmentControl({ item, showAssignee = false }: { item: OperationalWorkItem; showAssignee?: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [candidates, setCandidates] = React.useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState("")
  const [assigneeUserId, setAssigneeUserId] = React.useState(item.assignee?.source === "assignment" ? item.assignee.userId : "unassigned")
  const [committedDueAt, setCommittedDueAt] = React.useState(item.committedDueAt ?? "")
  const { pending, message, run } = useOperation()

  async function loadCandidates(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen || candidates.length > 0 || loading || !ASSIGNABLE_ACTIONS.has(item.actionKey)) return
    setLoading(true)
    setLoadError("")
    const result = await listOperationalAssignmentCandidatesAction({
      sourceType: item.sourceType as "purchase_request" | "purchase_request_item" | "purchase_order",
      sourceId: item.sourceId,
      actionKey: item.actionKey as "complete" | "follow_up" | "approve" | "create_order" | "issue" | "send" | "receive_office" | "receive_worksite" | "deliver",
    })
    setLoading(false)
    if (result.ok) setCandidates(result.candidates)
    else setLoadError(result.message ?? "No fue posible cargar personas elegibles.")
  }

  if (!item.assignable) return null

  return (
    <Dialog open={open} onOpenChange={loadCandidates}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => void loadCandidates(true)}
        aria-label={`${item.assignee?.source === "assignment" ? "Reasignar" : "Asignar"} responsable para ${item.title}`}
      >
        <UserPlus size={15} />
        {showAssignee && item.assignee?.source === "assignment"
          ? `Responsable: ${item.assignee.name}`
          : item.assignee?.source === "assignment" ? "Reasignar" : "Asignar"}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar pendiente</DialogTitle>
          <DialogDescription>
            La asignación complementa el flujo original. La fecha nativa se mantiene como prioridad si vence antes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">{item.title}</span> · {item.worksiteName}
          </p>
          <Field label="Responsable" helper="Sólo aparecen personas activas con permiso para esta etapa y faena.">
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId} disabled={loading || Boolean(loadError)}>
              <SelectTrigger><SelectValue placeholder={loading ? "Cargando personas…" : "Selecciona una persona"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Sin responsable complementario</SelectItem>
                {candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fecha de compromiso" htmlFor={`commitment-${item.id}`} helper={item.sourceDueAt ? `Fecha nativa: ${item.sourceDueAt.slice(0, 10)}.` : "Opcional; no reemplaza una fecha nativa."}>
            <DatePicker
              id={`commitment-${item.id}`}
              value={committedDueAt}
              onChange={setCommittedDueAt}
              placeholder="Sin fecha adicional"
            />
          </Field>
          {loadError && <p role="alert" className="text-sm text-[var(--color-danger)]">{loadError}</p>}
          {message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            type="button"
            disabled={loading || pending || Boolean(loadError)}
            onClick={() => run(
              () => saveOperationalAssignmentAction({
                sourceType: item.sourceType as "purchase_request" | "purchase_request_item" | "purchase_order",
                sourceId: item.sourceId,
                actionKey: item.actionKey as "complete" | "follow_up" | "approve" | "create_order" | "issue" | "send" | "receive_office" | "receive_worksite" | "deliver",
                assigneeUserId: assigneeUserId === "unassigned" ? null : assigneeUserId,
                committedDueAt: committedDueAt || null,
              }),
              () => setOpen(false),
            )}
          >
            {pending ? "Guardando…" : "Guardar asignación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
