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
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { todayInChile } from "@/lib/utils"
import { Callout } from "@/components/ui/callout"
import { Archive, Info } from "@phosphor-icons/react"
import { retireAssetAction } from "./actions"
import { IT_RETIREMENT_REASONS } from "@/lib/validation/ti"
import { IT_RETIREMENT_REASON_META } from "@/lib/services/ti/constants"

/** Activo que se puede dar de baja. Los campos de contexto son opcionales: quien no los tiene sigue funcionando. */
export interface RetirementAssetOption {
  id: string
  code: string
  typeName: string
  brand?: string | null
  model?: string | null
  /** Custodio vigente, si lo hay. */
  workerName?: string | null
  worksiteName?: string | null
}

interface RetirementSheetProps {
  trigger: React.ReactNode
  assets: RetirementAssetOption[]
  users: { id: string; name: string }[]
  /** Preselecciona y bloquea el activo (la ficha ya sabe cuál es). */
  assetId?: string
}

const assetModelLabel = (a: RetirementAssetOption) => [a.brand, a.model].filter(Boolean).join(" ")

/** "TI-NB-0042 · Dell Latitude · Ana Pérez": con qué equipo y de quién se trata, no solo el código. */
function assetOptionLabel(a: RetirementAssetOption) {
  return [a.code, assetModelLabel(a) || a.typeName, a.workerName].filter(Boolean).join(" · ")
}

/**
 * CTA del encabezado. El botón se construye acá, en el cliente, y no lo recibe
 * la página: ver la nota de `SheetTrigger` en `@/components/ui/sheet`.
 */
export function RetirementCta({ assets, users }: Omit<RetirementSheetProps, "trigger">) {
  return (
    <RetirementSheet
      trigger={<Button variant="destructive"><Archive size={14} className="mr-1.5" /> Dar de baja</Button>}
      assets={assets}
      users={users}
    />
  )
}

export function RetirementSheet({ trigger, assets, users, assetId }: RetirementSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [selectedAssetId, setSelectedAssetId] = React.useState(assetId ?? "")
  // Sin motivo por defecto: "Venta" preseleccionado hacía que una baja por
  // pérdida o robo —que además cierra la custodia— se registrara con el
  // motivo equivocado si el usuario no miraba el campo.
  const [reason, setReason] = React.useState("")
  const [date, setDate] = React.useState(todayInChile())

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await retireAssetAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Baja registrada")
      setOpen(false)
      setReason("")
      if (!assetId) setSelectedAssetId("")
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  const selectedAsset = assets.find((a) => a.id === selectedAssetId)
  const locked = Boolean(assetId)
  const closesCustody = reason === "perdida" || reason === "robo"

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
              {locked && <input type="hidden" name="assetId" value={assetId} />}
              <Field label="Activo" required error={state.fieldErrors?.assetId?.[0]}>
                {locked ? (
                  <p className="flex min-h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-text)]">
                    {selectedAsset ? assetOptionLabel(selectedAsset) : "Activo seleccionado"}
                  </p>
                ) : (
                  <Select name="assetId" value={selectedAssetId} onValueChange={setSelectedAssetId}>
                    <SelectTrigger aria-label="Activo">
                      <SelectValue placeholder="Selecciona un activo" />
                    </SelectTrigger>
                    <SelectContent>
                      {assets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{assetOptionLabel(a)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              {selectedAsset && (
                <Callout tone="info" icon={<Info size={16} />} title="Qué se va a dar de baja">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-[var(--color-text-muted)]">Equipo</dt>
                    <dd>{assetModelLabel(selectedAsset) || selectedAsset.typeName}</dd>
                    <dt className="text-[var(--color-text-muted)]">Faena</dt>
                    <dd>{selectedAsset.worksiteName ?? "—"}</dd>
                    <dt className="text-[var(--color-text-muted)]">Custodio</dt>
                    <dd>{selectedAsset.workerName ?? "Sin custodio vigente"}</dd>
                  </dl>
                  {selectedAsset.workerName && (
                    <p className="mt-2 text-sm">
                      {closesCustody
                        ? `Por ${reason === "robo" ? "robo" : "pérdida"}, la baja cierra la custodia vigente de ${selectedAsset.workerName}.`
                        : `Tiene custodia vigente de ${selectedAsset.workerName}: con este motivo hay que registrar su devolución antes de la baja. Solo la pérdida y el robo cierran la custodia al dar de baja.`}
                    </p>
                  )}
                </Callout>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha de baja" required error={state.fieldErrors?.date?.[0]}>
                  <DatePicker name="date" value={date} onChange={setDate} max={todayInChile()} />
                </Field>
                <Field label="Motivo" required error={state.fieldErrors?.reason?.[0]}>
                  <Select name="reason" value={reason} onValueChange={setReason}>
                    <SelectTrigger aria-label="Motivo de baja">
                      <SelectValue placeholder="Selecciona un motivo" />
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
                <Textarea name="observations" maxLength={500} rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Confirmar baja" loadingLabel="Registrando..." variant="destructive" />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
