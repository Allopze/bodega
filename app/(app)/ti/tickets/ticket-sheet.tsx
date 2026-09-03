"use client"

import * as React from "react"
import { useActionState } from "react"
import { toast } from "@/lib/toast"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import {
  Sheet, SheetContent, SheetHeader, SheetBody, SheetFooter,
  SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
import { SubmitButton } from "@/components/ui/submit-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createTicketAction } from "./actions"
import { IT_TICKET_CATEGORIES, IT_TICKET_PRIORITIES } from "@/lib/validation/ti"
import { IT_TICKET_CATEGORY_META, IT_TICKET_PRIORITY_META } from "@/lib/services/ti/constants"

interface TicketSheetProps {
  trigger: React.ReactNode
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  assets?: { id: string; code: string; typeName: string }[]
}

export function TicketSheet({ trigger, workers, worksites, assets = [] }: TicketSheetProps) {
  const [open, setOpen] = React.useState(false)
  const [category, setCategory] = React.useState("hardware")
  const [priority, setPriority] = React.useState("normal")

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createTicketAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Ticket creado")
      setOpen(false)
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setOpen(false) }}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <SheetHeader>
            <div>
              <SheetTitle>Nuevo ticket</SheetTitle>
              <SheetDescription>
                Reporta un problema a TI a nombre de un trabajador de tu faena. El ticket queda con tu usuario como solicitante.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              <Field label="Asunto" required error={state.fieldErrors?.subject?.[0]}>
                <Input name="subject" maxLength={120} placeholder="Ej. notebook no enciende" />
              </Field>
              <Field label="Descripción" required error={state.fieldErrors?.description?.[0]} helper="Describe el problema con detalle (mínimo 10 caracteres).">
                <Input name="description" maxLength={2000} placeholder="Qué pasa, desde cuándo, qué se intentó…" />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Categoría" required>
                  <Select name="category" value={category} onValueChange={setCategory}>
                    <SelectTrigger aria-label="Categoría">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_TICKET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{IT_TICKET_CATEGORY_META[c] ?? c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Prioridad" required>
                  <Select name="priority" value={priority} onValueChange={setPriority}>
                    <SelectTrigger aria-label="Prioridad">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_TICKET_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{IT_TICKET_PRIORITY_META[p]?.label ?? p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Faena" required error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select name="worksiteId">
                    <SelectTrigger aria-label="Faena">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Trabajador afectado" helper="Opcional: el trabajador que tiene el problema.">
                  <Select name="workerId">
                    <SelectTrigger aria-label="Trabajador afectado">
                      <SelectValue placeholder="Sin trabajador específico" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Sin trabajador</SelectItem>
                      {workers.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name} {w.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Activo relacionado" helper="Opcional: el equipo que presenta el problema.">
                <Select name="assetId">
                  <SelectTrigger aria-label="Activo relacionado">
                    <SelectValue placeholder="Sin activo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Sin activo</SelectItem>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} · {a.typeName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <SubmitButton label="Crear ticket" loadingLabel="Creando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
