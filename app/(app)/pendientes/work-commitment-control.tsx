"use client"

import * as React from "react"
import { CalendarCheck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { saveOperationalCommitmentAction } from "./actions"

type CommitmentSource = "purchase_request" | "purchase_request_item" | "purchase_order"
type CommitmentAction = "complete" | "follow_up" | "approve" | "create_order" | "issue" | "send" | "receive_office" | "receive_worksite" | "deliver"

export function WorkCommitmentControl({ item }: { item: OperationalWorkItem }) {
  const [open, setOpen] = React.useState(false)
  const [committedDueAt, setCommittedDueAt] = React.useState(item.committedDueAt ?? "")
  const { pending, message, run } = useOperation()

  if (!item.assignable) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Como DialogTrigger, no con un onClick suelto: sin trigger registrado
          Radix no sabe a qué devolver el foco al cerrar y quedaba en el <body>,
          obligando a tabular desde el principio de la página. */}
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`${item.committedDueAt ? "Cambiar" : "Fijar"} fecha de compromiso para ${item.title}`}
        >
          <CalendarCheck size={15} />
          {item.committedDueAt ? `Compromiso: ${item.committedDueAt}` : "Comprometer fecha"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fecha de compromiso</DialogTitle>
          <DialogDescription>
            El compromiso complementa el flujo original. La fecha nativa se mantiene como prioridad si vence antes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="rounded-[var(--radius)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">{item.title}</span> · {item.worksiteName}
          </p>
          <Field label="Fecha de compromiso" htmlFor={`commitment-${item.id}`} helper={item.sourceDueAt ? `Fecha nativa: ${item.sourceDueAt.slice(0, 10)}.` : "Opcional; no reemplaza una fecha nativa."}>
            <DatePicker
              id={`commitment-${item.id}`}
              value={committedDueAt}
              onChange={setCommittedDueAt}
              placeholder="Sin fecha adicional"
            />
          </Field>
          {message && <p role="status" className="text-sm text-[var(--color-text-muted)]">{message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => run(
              () => saveOperationalCommitmentAction({
                sourceType: item.sourceType as CommitmentSource,
                sourceId: item.sourceId,
                actionKey: item.actionKey as CommitmentAction,
                committedDueAt: committedDueAt || null,
              }),
              () => setOpen(false),
            )}
          >
            {pending ? "Guardando…" : "Guardar compromiso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
