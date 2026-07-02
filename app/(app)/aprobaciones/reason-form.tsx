"use client"

import { Warning } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SubmitButton } from "@/components/admin/submit-button"
import { Textarea } from "@/components/ui/textarea"
import { INITIAL_STATE } from "@/components/admin/form-state"
import type { ActionState } from "@/lib/validation/operations"

export function ReasonForm({
  itemId, actionFn, state, onCancel,
  label, placeholder, note, submitLabel, submitLoadingLabel, colorClass,
}: {
  itemId:             string
  actionFn:           (formData: FormData) => void
  state:              ActionState
  onCancel:           () => void
  label:              string
  placeholder:        string
  note?:              string
  submitLabel:        string
  submitLoadingLabel: string
  colorClass:         string
}) {
  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <form action={actionFn} className="flex flex-col gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        <label className={`text-xs font-medium ${colorClass}`}>{label}</label>
        <Textarea
          name="reason"
          placeholder={placeholder}
          rows={2}
          className="text-sm"
          required
        />
        {note && (
          <p className="text-[11px] text-[var(--color-text-subtle)]">{note}</p>
        )}
        {state.ok === false && state.message && state !== INITIAL_STATE && (
          <p className="text-xs text-[var(--color-danger)] flex items-center gap-1">
            <Warning size={12} /> {state.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <SubmitButton
            label={submitLabel}
            loadingLabel={submitLoadingLabel}
            variant="destructive"
            size="sm"
          />
        </div>
      </form>
    </div>
  )
}
