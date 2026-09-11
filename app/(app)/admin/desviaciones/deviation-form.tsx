"use client"

import { useActionState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { saveDeviationAction } from "./actions"
import { DANO_LABELS, type DeviationRow } from "./deviation-list"

interface DeviationFormProps {
  open: boolean
  onClose: () => void
  editRow?: DeviationRow | null
}

export function DeviationForm({ open, onClose, editRow }: DeviationFormProps) {
  const isEdit = !!editRow

  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await saveDeviationAction(prev, formData)
      if (result.ok) {
        toast.success(result.message ?? "Desviación guardada")
        onClose()
      } else if (result.message && !result.fieldErrors) {
        toast.error(result.message)
      }
      return result
    },
    INITIAL_STATE,
  )

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent>
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          {isEdit && <input type="hidden" name="id" value={editRow!.id} />}
          <SheetHeader>
            <div>
              <SheetTitle>{isEdit ? "Editar desviación" : "Nueva desviación"}</SheetTitle>
              <SheetDescription>
                Cómo se le va a ofrecer a quien inspecciona, y con qué gravedad. De la gravedad sale el plazo de la
                acción correctiva, así que no la decide quien registra en terreno.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody>
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="mb-4 text-sm text-[var(--color-danger)]">{state.message}</p>
            )}
            <FieldGroup className="gap-4">
              <Field
                label="Desviación"
                htmlFor="dev-label"
                required
                error={state.fieldErrors?.label?.[0]}
                helper="Ej: «Extintor obstruido o sin acceso libre». Es el texto que verá quien registra."
              >
                <Input
                  id="dev-label"
                  name="label"
                  defaultValue={editRow?.label ?? ""}
                  error={!!state.fieldErrors?.label}
                  minLength={3}
                  maxLength={300}
                  required
                />
              </Field>
              <Field
                label="Gravedad"
                htmlFor="dev-dano"
                required
                error={state.fieldErrors?.danoPotencial?.[0]}
                helper="Un instrumento puede ajustarla para su caso; esta es la que rige por defecto."
              >
                <Select name="danoPotencial" defaultValue={editRow?.danoPotencial ?? "moderado"}>
                  <SelectTrigger id="dev-dano" aria-label="Gravedad de la desviación"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DANO_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {isEdit && editRow!.offeredBy > 0 && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Cambiar la gravedad acá rige para los {editRow!.offeredBy} instrumento(s) que la ofrecen sin un
                  ajuste propio, y desde ahora: los hallazgos ya levantados conservan la que tenían.
                </p>
              )}
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <SubmitButton label={isEdit ? "Guardar cambios" : "Crear desviación"} loadingLabel="Guardando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
