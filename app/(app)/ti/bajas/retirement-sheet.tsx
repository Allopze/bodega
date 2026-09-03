"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton, SheetTrigger,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { todayInChile } from "@/lib/utils"
import { retireAssetAction } from "./actions"
import { IT_RETIREMENT_REASONS } from "@/lib/validation/ti"
import { IT_RETIREMENT_REASON_META } from "@/lib/services/ti/constants"

interface RetirementSheetProps {
  trigger: React.ReactNode
  assets: { id: string; code: string; typeName: string }[]
  users: { id: string; name: string }[]
}

export function RetirementSheet({ trigger, assets, users }: RetirementSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("venta")
  const [date, setDate] = React.useState(todayInChile())

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await retireAssetAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Baja registrada")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <SheetHeader>
            <div>
              <SheetTitle>Dar de baja un activo</SheetTitle>
              <SheetDescription>
                El activo conserva su historial completo para siempre; solo cambia su estado y queda fuera del inventario activo.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              <Field label="Activo" required error={state.fieldErrors?.assetId?.[0]}>
                <Select name="assetId">
                  <SelectTrigger aria-label="Activo">
                    <SelectValue placeholder="Selecciona un activo" />
                  </SelectTrigger>
                  <SelectContent>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} · {a.typeName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha de baja" required error={state.fieldErrors?.date?.[0]}>
                  <DatePicker name="date" value={date} onChange={setDate} max={todayInChile()} />
                </Field>
                <Field label="Motivo" required error={state.fieldErrors?.reason?.[0]}>
                  <Select name="reason" value={reason} onValueChange={setReason}>
                    <SelectTrigger aria-label="Motivo de baja">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_RETIREMENT_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>{IT_RETIREMENT_REASON_META[r] ?? r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Responsable" required error={state.fieldErrors?.responsibleUserId?.[0]}>
                  <Select name="responsibleUserId">
                    <SelectTrigger aria-label="Responsable">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Autorizado por" required error={state.fieldErrors?.authorizedByUserId?.[0]}>
                  <Select name="authorizedByUserId">
                    <SelectTrigger aria-label="Autorizado por">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Destino final" helper="Ej. venta a terceros, reciclaje certificado, destrucción física.">
                <Input name="destination" maxLength={200} />
              </Field>
              <Field label="Observaciones">
                <Input name="observations" maxLength={500} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Confirmar baja" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
