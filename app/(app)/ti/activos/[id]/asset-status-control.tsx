"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { changeAssetStatusAction } from "../actions"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { MetaBadge } from "@/components/states/state-badge"
import { IT_ASSET_STATUS_META, itStatusLabel } from "@/lib/services/ti/constants"
import { MANUAL_ASSET_STATUSES } from "@/lib/validation/ti"
import { ArrowRight } from "@phosphor-icons/react"

interface CorrectStatusDialogProps {
  assetId: string
  currentStatus: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Corregir estado»: antes era un formulario permanente en la ficha que
 * confirmaba ANTES de validar (el error quedaba detrás del diálogo). Ahora los
 * campos viven dentro del diálogo, se validan ahí y el diálogo muestra
 * «Estado actual → Nuevo» para que se vea qué se está cambiando (TIUX-07).
 * El control no se ofrece en estados terminales ni con una entrega abierta:
 * quien lo abre ya sabe que el servidor lo aceptará.
 */
export function CorrectStatusDialog({ assetId, currentStatus, open, onOpenChange }: CorrectStatusDialogProps) {
  const [status, setStatus] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [clientErrors, setClientErrors] = React.useState<{ status?: string; reason?: string }>({})

  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await changeAssetStatusAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Estado actualizado")
      onOpenChange(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const options = MANUAL_ASSET_STATUSES.filter((s) => s !== currentStatus)

  // Cada apertura parte limpia: no arrastra el motivo de un intento anterior.
  React.useEffect(() => {
    if (open) {
      setStatus("")
      setReason("")
      setClientErrors({})
    }
  }, [open])

  function validate(event: React.FormEvent<HTMLFormElement>) {
    const errors: { status?: string; reason?: string } = {}
    if (!status) errors.status = "Elige el nuevo estado"
    if (reason.trim().length < 3) errors.reason = "Indica el motivo (mínimo 3 caracteres)"
    setClientErrors(errors)
    if (errors.status || errors.reason) event.preventDefault()
  }

  const newMeta = status ? IT_ASSET_STATUS_META[status] : undefined
  const currentMeta = IT_ASSET_STATUS_META[currentStatus]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction} onSubmit={validate} noValidate>
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="status" value={status} />
          <DialogHeader>
            <DialogTitle>Corregir estado</DialogTitle>
            <DialogDescription>
              Úsalo cuando el estado no refleja la realidad. Las entregas, devoluciones y bajas cambian el estado por su propio flujo. El cambio queda en el historial con su motivo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-surface-2)] px-3 py-2 text-sm" aria-live="polite">
              <MetaBadge meta={currentMeta ?? { label: itStatusLabel(currentStatus), variant: "default" }} dot />
              <ArrowRight size={14} className="text-[var(--color-text-subtle)]" aria-hidden />
              {newMeta
                ? <MetaBadge meta={newMeta} dot />
                : <span className="text-[var(--color-text-muted)]">Elige el nuevo estado</span>}
            </div>

            <Field label="Nuevo estado" required error={clientErrors.status ?? state.fieldErrors?.status?.[0]}>
              <Select value={status} onValueChange={(v) => { setStatus(v); setClientErrors((e) => ({ ...e, status: undefined })) }}>
                <SelectTrigger aria-label="Nuevo estado">
                  <SelectValue placeholder="Selecciona el estado" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((s) => (
                    <SelectItem key={s} value={s}>{IT_ASSET_STATUS_META[s]?.label ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Motivo" required error={clientErrors.reason ?? state.fieldErrors?.reason?.[0]} helper="Queda visible en el historial del activo.">
              <Textarea
                name="reason"
                maxLength={300}
                rows={3}
                value={reason}
                onChange={(e) => { setReason(e.target.value); setClientErrors((er) => ({ ...er, reason: undefined })) }}
                placeholder="Ej. enviado a laboratorio externo para diagnóstico"
              />
            </Field>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger-ink)]" role="alert">{state.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" loading={pending}>{pending ? "Guardando..." : "Guardar cambio"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
