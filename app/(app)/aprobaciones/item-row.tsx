"use client"

import * as React from "react"
import {
  CheckCircle, XCircle,
} from "@phosphor-icons/react"
import { StateBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatQty, formatDate } from "@/lib/utils"
import { URGENCY_LABEL, URGENCY_CLASS } from "./types"
import type { ApprovalItem } from "./types"
import { ApproveForm } from "./approve-form"
import { ReasonForm } from "./reason-form"
import { useItemActions } from "./use-approval-actions"

type ItemAction = "idle" | "approving" | "rejecting"

export function ItemRow({ item, canApprove = true }: { item: ApprovalItem; canApprove?: boolean }) {
  const [action, setAction] = React.useState<ItemAction>("idle")
  const { approveState, approveAction, rejectState, rejectAction, decided } = useItemActions()

  if (decided) {
    const label = decided === "approved" ? "Aprobado" : "Rechazado"
    return (
      <li className="flex items-center gap-3 py-2.5 px-3 rounded-[var(--radius)] bg-[var(--color-surface-2)] opacity-60">
        <StateBadge state={decided} entity="item" size="sm" />
        <span className="text-sm text-[var(--color-text-muted)]">
          {item.productSku && (
            <span className="font-mono text-xs text-[var(--color-text-subtle)] mr-2">
              {item.productSku}
            </span>
          )}
          {item.productName}
        </span>
        <span className="ml-auto text-xs text-[var(--color-text-subtle)]">{label}</span>
      </li>
    )
  }

  return (
    <li className="rounded-[var(--radius-xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {item.productSku && (
              <span className="font-mono text-[11px] text-[var(--color-text-subtle)] bg-[var(--color-surface-2)] px-1.5 py-0.5 rounded">
                {item.productSku}
              </span>
            )}
            <span className="text-sm font-medium text-[var(--color-text)]">
              {item.productName}
            </span>
            {!item.productSku && (
              <span className="text-[11px] text-[var(--color-text-subtle)] italic">(sin catálogo)</span>
            )}
          </div>

          {item.attributes.length > 0 && (
            <div className="mt-1 flex gap-1.5 flex-wrap">
              {item.attributes.map((a, i) => (
                <span
                  key={i}
                  className="text-[11px] bg-[var(--color-surface-2)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded"
                >
                  {a.attributeName}: {a.value}
                </span>
              ))}
            </div>
          )}

          {(item.suggestedSupplierName || item.supplierHint) && (
            <div className="mt-1 flex gap-1.5 flex-wrap items-center">
              {(item.suggestedSupplierName || item.supplierHint) && (
                <Badge variant="warning" size="sm" className="font-normal shrink-0">
                  Sugerido: {item.suggestedSupplierName || item.supplierHint}
                </Badge>
              )}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span className="font-medium text-[var(--color-text)]">
              {formatQty(item.quantity, item.unitOfMeasure)}
            </span>
            <span className={URGENCY_CLASS[item.urgency] ?? URGENCY_CLASS.normal}>
              {URGENCY_LABEL[item.urgency] ?? item.urgency}
            </span>
            {item.requiredDate && (
              <span>Para: {formatDate(item.requiredDate)}</span>
            )}
          </div>

          {item.notes && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)] italic leading-snug">
              {item.notes}
            </p>
          )}
        </div>

        {action === "idle" && canApprove && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAction("approving")}
              className="gap-1"
            >
              <CheckCircle size={13} weight="bold" />
              Aprobar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAction("rejecting")}
              className="gap-1 text-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              <XCircle size={13} weight="bold" />
              Rechazar
            </Button>
          </div>
        )}
        {action === "idle" && !canApprove && (
          <span className="text-[11px] text-[var(--color-text-subtle)] italic shrink-0 max-w-[140px] text-right leading-tight">
            Requiere Jefatura o Secretaría
          </span>
        )}
      </div>

      {action === "approving" && canApprove && (
        <ApproveForm
          item={item}
          approveAction={approveAction}
          approveState={approveState}
          onCancel={() => setAction("idle")}
        />
      )}

      {action === "rejecting" && canApprove && (
        <ReasonForm
          itemId={item.id}
          actionFn={rejectAction}
          state={rejectState}
          onCancel={() => setAction("idle")}
          label="Motivo del rechazo"
          placeholder="Explica por qué este ítem no puede ser aprobado..."
          note="Una vez confirmado, el rechazo no se puede revertir desde aquí."
          submitLabel="Confirmar rechazo"
          submitLoadingLabel="Rechazando..."
          colorClass="text-[var(--color-danger)]"
        />
      )}
    </li>
  )
}
