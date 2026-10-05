"use client"

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { Callout } from "@/components/ui/callout"
import { Field, FieldGroup } from "@/components/ui/field"
import { Combobox } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { OptionSelect } from "@/components/ui/option-select"
import { Plus } from "@phosphor-icons/react"
import { createTicketAction } from "./actions"
import { useFocusFirstInvalid } from "./use-focus-first-invalid"
import { IT_TICKET_CATEGORIES, IT_TICKET_PRIORITIES } from "@/lib/validation/ti"
import { IT_TICKET_CATEGORY_META, IT_TICKET_PRIORITY_META } from "@/lib/services/ti/constants"
import { TICKET_SLA_HOURS, formatTicketSpan, type TiTicketPriority } from "@/lib/services/ti/ticket-sla"

interface TicketSheetProps {
  trigger: React.ReactNode
  workers: { id: string; name: string; lastName: string; worksiteId?: string }[]
  worksites: { id: string; name: string }[]
  assets?: { id: string; code: string; typeName: string; worksiteId?: string | null }[]
}

/** Cuándo corresponde cada prioridad, para que quien reporta elija sin adivinar. */
const PRIORITY_GUIDE: Record<string, string> = {
  critica: "Detiene la operación o a varias personas a la vez.",
  alta: "Impide trabajar a una persona.",
  normal: "Se puede seguir trabajando, con molestias.",
  baja: "Consulta o mejora sin urgencia.",
}

function slaSpan(priority: string): string {
  return formatTicketSpan(TICKET_SLA_HOURS[priority as TiTicketPriority] * 3_600_000)
}

/**
 * CTA del encabezado. El botón se construye acá, en el cliente, y no lo recibe
 * la página: ver la nota de `SheetTrigger` en `@/components/ui/sheet`.
 */
export function TicketCta({ workers, worksites, assets = [] }: Omit<TicketSheetProps, "trigger">) {
  return (
    <TicketSheet
      trigger={<Button><Plus size={14} className="mr-1.5" /> Nuevo ticket</Button>}
      workers={workers}
      worksites={worksites}
      assets={assets}
    />
  )
}

export function TicketSheet({ trigger, workers, worksites, assets = [] }: TicketSheetProps) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [open, setOpen] = React.useState(false)
  // Sin categoría preseleccionada: «Hardware» por defecto sesgaba los reportes
  // hacia esa categoría. La prioridad sí parte en «Normal» (el caso común) y
  // dice cuál es su plazo.
  const [category, setCategory] = React.useState("")
  const [priority, setPriority] = React.useState("normal")
  // Quien solo tiene una faena (el caso del representante) no debería tener
  // que elegirla.
  const [worksiteId, setWorksiteId] = React.useState(worksites.length === 1 ? worksites[0]!.id : "")
  const [workerId, setWorkerId] = React.useState("")
  const [assetId, setAssetId] = React.useState("")

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createTicketAction(prev, formData)
    if (result.ok) {
      const ticketId = String(result.data?.ticketId ?? "")
      const created = String(result.data?.priority ?? "normal")
      toast.success(result.message ?? "Ticket creado", {
        description: `Plazo de atención: ${slaSpan(created)}.`,
        action: ticketId
          ? { label: "Ver ticket", onClick: () => router.push(`/ti/tickets/${ticketId}`) }
          : undefined,
      })
      setOpen(false)
      setCategory("")
      setPriority("normal")
      setWorkerId("")
      setAssetId("")
    }
    // Los errores se muestran en el formulario (bajo su campo o en la alerta),
    // no además en un toast: el mismo aviso dos veces solo confunde.
    return result
  }, INITIAL_STATE)

  // Lo escrito antes de un envío fallido vuelve como valor inicial: los campos
  // no controlados se reinician al terminar la acción y vaciaban el formulario.
  const kept = (state.ok ? {} : (state.data?.values ?? {})) as Record<string, string>

  useFocusFirstInvalid(formRef, state)

  // Un trabajador o un equipo de otra faena no es válido para el ticket: se
  // ofrecen solo los de la faena elegida (o todos mientras no haya una).
  const workerOptions = workers
    .filter((w) => !worksiteId || !w.worksiteId || w.worksiteId === worksiteId)
    .map((w) => ({ value: w.id, label: `${w.name} ${w.lastName}` }))
  const assetOptions = assets
    .filter((a) => !worksiteId || !a.worksiteId || a.worksiteId === worksiteId)
    .map((a) => ({ value: a.id, label: `${a.code} · ${a.typeName}` }))

  function changeWorksite(next: string) {
    setWorksiteId(next)
    // Solo se descarta lo que deja de ser válido en la faena nueva.
    if (workerId && !workers.some((w) => w.id === workerId && (!w.worksiteId || w.worksiteId === next))) setWorkerId("")
    if (assetId && !assets.some((a) => a.id === assetId && (!a.worksiteId || a.worksiteId === next))) setAssetId("")
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="sm:max-w-xl">
        <form ref={formRef} action={formAction} className="flex flex-col flex-1 min-h-0">
          <SheetHeader>
            <div>
              <SheetTitle>Nuevo ticket</SheetTitle>
              <SheetDescription>
                Cuéntale a TI qué está pasando. El ticket queda a tu nombre y te avisamos cuando haya novedades.
                Si reportas por otra persona, indícala como trabajador afectado.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p role="alert" tabIndex={-1} data-form-alert className="text-sm text-[var(--color-danger-ink)]">{state.message}</p>
            )}

            <FieldGroup>
              <Field label="Asunto" required error={state.fieldErrors?.subject?.[0]}>
                <Input name="subject" maxLength={120} defaultValue={kept.subject} placeholder="Ej. notebook no enciende" />
              </Field>
              <Field label="Descripción" required error={state.fieldErrors?.description?.[0]} helper="Describe el problema con detalle (mínimo 10 caracteres).">
                <Textarea name="description" maxLength={2000} defaultValue={kept.description} placeholder="Qué pasa, desde cuándo, qué se intentó…" rows={4} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Categoría" required error={state.fieldErrors?.category?.[0]}>
                  <Select name="category" value={category} onValueChange={setCategory}>
                    <SelectTrigger aria-label="Categoría">
                      <SelectValue placeholder="Selecciona una categoría" />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_TICKET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{IT_TICKET_CATEGORY_META[c] ?? c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  label="Prioridad"
                  required
                  error={state.fieldErrors?.priority?.[0]}
                  helper={`${PRIORITY_GUIDE[priority] ?? ""} Plazo de atención: ${slaSpan(priority)}.`.trim()}
                >
                  <Select name="priority" value={priority} onValueChange={setPriority}>
                    <SelectTrigger aria-label="Prioridad">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_TICKET_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {IT_TICKET_PRIORITY_META[p]?.label ?? p} · atención en {slaSpan(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {category === "plataforma" && (
                <Callout tone="info" title="¿Falla la plataforma Chome?">
                  Si es un error de pantallas, datos o permisos de la plataforma, repórtalo en{" "}
                  <Link href="/soporte" className="font-semibold underline underline-offset-2">Soporte</Link>.
                  Esta mesa atiende equipos, cuentas y accesos.
                </Callout>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Faena" required error={state.fieldErrors?.worksiteId?.[0]}>
                  <Select name="worksiteId" value={worksiteId} onValueChange={changeWorksite}>
                    <SelectTrigger aria-label="Faena">
                      <SelectValue placeholder="Selecciona una faena" />
                    </SelectTrigger>
                    <SelectContent>
                      {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Trabajador afectado" helper="Opcional. Déjalo vacío si el problema es tuyo.">
                  <input type="hidden" name="workerId" value={workerId} />
                  <Combobox
                    options={workerOptions}
                    value={workerId}
                    onChange={setWorkerId}
                    placeholder="Buscar trabajador…"
                    clearLabel="Sin trabajador específico"
                    aria-label="Trabajador afectado"
                  />
                </Field>
              </div>

              <Field label="Activo relacionado" helper="Opcional: el equipo que presenta el problema.">
                <OptionSelect
                  name="assetId"
                  emptyLabel="Sin activo"
                  placeholder="Sin activo"
                  aria-label="Activo relacionado"
                  options={assetOptions}
                  value={assetId}
                  onValueChange={setAssetId}
                />
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
