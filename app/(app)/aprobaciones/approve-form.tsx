"use client"

import * as React from "react"
import { Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE } from "@/components/admin/form-state"
import { formatQty } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/operations"
import type { ApprovalItem } from "./types"

export function ApproveForm({
  item, approveAction, approveState, onCancel,
}: {
  item:          ApprovalItem
  approveAction: (formData: FormData) => void
  approveState:  ActionState
  onCancel:      () => void
}) {
  const [qty, setQty] = React.useState("")
  const isModified = qty !== "" && parseFloat(qty) !== item.quantity

  return (
    <div className="border-t border-(--color-border) bg-surface-2 p-3">
      <form action={approveAction} className="flex flex-col gap-2">
        <input type="hidden" name="itemId" value={item.id} />
        <div className="flex items-center gap-3">
          <label
            htmlFor={`modifiedQty-${item.id}`}
            className="text-xs text-(--color-text-muted) shrink-0"
          >
            Cantidad aprobada
          </label>
          <Input
            id={`modifiedQty-${item.id}`}
            type="number"
            name="modifiedQty"
            step="0.01"
            min="0.01"
            placeholder={String(item.quantity)}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-7 w-28 text-sm"
          />
          <span className="text-xs text-text-subtle">
            {item.unitOfMeasure} (dejar vacío para aprobar {formatQty(item.quantity)})
          </span>
        </div>
        {isModified && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`reason-${item.id}`}
              className="text-xs font-medium text-(--color-text-muted)"
            >
              Motivo del cambio de cantidad <span className="text-danger">*</span>
            </label>
            <Textarea
              id={`reason-${item.id}`}
              name="reason"
              required
              placeholder="Explica por qué se modifica la cantidad solicitada..."
              className="text-xs resize-none"
              rows={2}
            />
          </div>
        )}
        <p className="text-[11px] text-text-subtle">
          Una vez confirmada, la aprobación no se puede revertir desde aquí.
        </p>
        {approveState.ok === false && approveState.message && approveState !== INITIAL_STATE && (
          <p className="text-xs text-danger flex items-center gap-1">
            <Warning size={12} /> {approveState.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <SubmitButton
            label="Confirmar aprobación"
            loadingLabel="Aprobando..."
            variant="primary"
            size="sm"
          />
        </div>
      </form>
    </div>
  )
}
