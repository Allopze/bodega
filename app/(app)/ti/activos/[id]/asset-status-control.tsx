"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { changeAssetStatusAction } from "../actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { IT_ASSET_STATUS_META, itStatusLabel } from "@/lib/services/ti/constants"
import { MANUAL_ASSET_STATUSES } from "@/lib/validation/ti"
import { ArrowsClockwise } from "@phosphor-icons/react"

export function AssetStatusControl({ assetId, currentStatus }: { assetId: string; currentStatus: string }) {
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState(currentStatus)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await changeAssetStatusAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Estado actualizado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const available = MANUAL_ASSET_STATUSES.filter((s) => s !== currentStatus)

  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Cambiar estado</h3>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Actual: <span className="font-semibold text-[var(--color-text)]">{itStatusLabel(currentStatus)}</span>. El cambio queda en el historial con su motivo.
      </p>

      <form ref={formRef} action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="assetId" value={assetId} />
        <Field label="Nuevo estado" required error={state.fieldErrors?.status?.[0]}>
          <Select name="status" value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Nuevo estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map((s) => (
                <SelectItem key={s} value={s}>{IT_ASSET_STATUS_META[s]?.label ?? s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Motivo" required error={state.fieldErrors?.reason?.[0]} helper="Queda visible en la línea de tiempo del activo.">
          <Textarea name="reason" maxLength={300} placeholder="Ej. enviado a laboratorio externo para diagnóstico" rows={2} />
        </Field>
        {state.message && !state.ok && !state.fieldErrors && (
          <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
        )}
      </form>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
        disabled={available.length === 0}
      >
        <ArrowsClockwise size={14} className="mr-1.5" /> Cambiar estado
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirmar cambio de estado"
        description="El cambio quedará registrado en el historial del activo y en la auditoría."
        confirmLabel={pending ? "Cambiando..." : "Confirmar cambio"}
        loading={pending}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
    </section>
  )
}
