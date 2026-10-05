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
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DatePicker } from "@/components/ui/date-picker"
import { Field, FieldGroup } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toLocalInputValue } from "@/lib/utils"
import { X, Plus } from "@phosphor-icons/react"
import { createAssignmentAction } from "./actions"
import { EvidencePhotos, useEvidencePhotos } from "./evidence-photos"
import { PhysicalStateChoice } from "./physical-state-choice"
import { IT_ASSIGNMENT_KINDS, IT_PHYSICAL_STATES } from "@/lib/validation/ti"
import { IT_ASSIGNMENT_KIND_META, ACCESSORY_SUGGESTIONS } from "@/lib/services/ti/constants"

interface AssignmentSheetProps {
  /** Opcional: la hoja puede abrirse desde fuera con `open`/`onOpenChange`. */
  trigger?: React.ReactNode
  /** Control externo del estado abierto (opcional; sin él la hoja se abre sola con `trigger`). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  assetId?: string
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  assets?: { id: string; code: string; status: string; typeName: string }[]
}

const ALL = "_all"

/**
 * CTA del encabezado. El botón se construye acá, en el cliente, y no lo recibe
 * la página: ver la nota de `SheetTrigger` en `@/components/ui/sheet`.
 */
export function AssignmentCta({
  workers,
  worksites,
  assets = [],
}: Omit<AssignmentSheetProps, "trigger" | "assetId" | "open" | "onOpenChange">) {
  return (
    <AssignmentSheet
      trigger={<Button><Plus size={14} className="mr-1.5" /> Nueva entrega</Button>}
      workers={workers}
      worksites={worksites}
      assets={assets}
    />
  )
}

export function AssignmentSheet({ trigger, open: openProp, onOpenChange, assetId, workers, worksites, assets = [] }: AssignmentSheetProps) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = (value: boolean) => {
    if (openProp === undefined) setOpenState(value)
    onOpenChange?.(value)
  }
  const [selectedAsset, setSelectedAsset] = React.useState(assetId ?? "")
  const [kind, setKind] = React.useState("delivery")
  const [deliveredAt, setDeliveredAt] = React.useState(toLocalInputValue(new Date()))
  const [expectedReturnDate, setExpectedReturnDate] = React.useState("")
  // TIUX-09: sin estado preseleccionado; quien entrega el equipo lo declara.
  const [physicalState, setPhysicalState] = React.useState<string | null>(null)
  const [accessories, setAccessories] = React.useState<string[]>([])
  const [accessoryDraft, setAccessoryDraft] = React.useState("")
  const evidence = useEvidencePhotos({ stage: "delivery" })

  function closeSheet() {
    evidence.discardAll()
    setOpen(false)
  }

  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createAssignmentAction(prev, formData)
    if (result.ok) {
      toast.success(result.message ?? "Entrega registrada")
      evidence.releaseAfterSubmit()
      setOpen(false)
      setAccessories([])
      // La hoja sigue montada: el activo recién entregado ya no está disponible
      // y la próxima entrega debe partir del formulario en blanco.
      setSelectedAsset(assetId ?? "")
      setKind("delivery")
      setExpectedReturnDate("")
      setPhysicalState(null)
      setAccessoryDraft("")
    } else if (result.message && !result.fieldErrors) {
      toast.error(result.message)
    }
    return result
  }, INITIAL_STATE)

  function openSheet() {
    // La hora por defecto es la de apertura, no la de montaje de la página.
    setDeliveredAt(toLocalInputValue(new Date()))
    setOpen(true)
  }

  const availableAssets = assetId ? assets : assets.filter((a) => ["disponible", "en_bodega"].includes(a.status))

  function addAccessory() {
    const name = accessoryDraft.trim()
    if (!name) return
    if (accessories.some((a) => a.toLowerCase() === name.toLowerCase())) return
    setAccessories((prev) => [...prev, name])
    setAccessoryDraft("")
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) closeSheet(); else openSheet() }}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent className="sm:max-w-xl">
        <form action={formAction} className="flex flex-col flex-1 min-h-0">
          <input type="hidden" name="accessoriesJson" value={JSON.stringify(accessories)} />
          <input type="hidden" name="assetId" value={selectedAsset} />

          <SheetHeader>
            <div>
              <SheetTitle>Nueva entrega</SheetTitle>
              <SheetDescription>
                Registra la entrega del equipo con su estado físico, accesorios y evidencia fotográfica. Se genera el acta al guardar.
              </SheetDescription>
            </div>
            <SheetCloseButton />
          </SheetHeader>

          <SheetBody className="space-y-4">
            {state.message && !state.ok && !state.fieldErrors && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">{state.message}</p>
            )}

            <FieldGroup>
              {!assetId && (
                <Field label="Activo" required error={state.fieldErrors?.assetId?.[0]} helper="Solo se listan activos disponibles o en bodega.">
                  <Select value={selectedAsset || ALL} onValueChange={(value) => setSelectedAsset(value === ALL ? "" : value)}>
                    <SelectTrigger aria-label="Activo">
                      <SelectValue placeholder="Selecciona un activo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Selecciona un activo</SelectItem>
                      {availableAssets.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.code} · {a.typeName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Trabajador" required error={state.fieldErrors?.workerId?.[0]}>
                  <Select name="workerId">
                    <SelectTrigger aria-label="Trabajador">
                      <SelectValue placeholder="Selecciona" />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name} {w.lastName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
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
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tipo" required error={state.fieldErrors?.kind?.[0]}>
                  <Select name="kind" value={kind} onValueChange={setKind}>
                    <SelectTrigger aria-label="Tipo de entrega">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IT_ASSIGNMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>{IT_ASSIGNMENT_KIND_META[k] ?? k}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {/* TIUX-14: solo un préstamo vence; la fecha de vuelta es lo que permite reclamarlo. */}
                {kind === "loan" && (
                  <Field
                    label="Devolver a más tardar"
                    required
                    error={state.fieldErrors?.expectedReturnDate?.[0]}
                    helper="Pasada esta fecha el préstamo aparece como vencido."
                  >
                    <DatePicker
                      name="expectedReturnDate"
                      value={expectedReturnDate}
                      onChange={setExpectedReturnDate}
                      min={deliveredAt.slice(0, 10)}
                      ariaLabel="Devolver a más tardar"
                    />
                  </Field>
                )}
              </div>

              {/* TIUX-23: fila propia. En un tercio de columna el selector quedaba en ~30 px, solo con el ícono. */}
              <Field label="Fecha y hora de entrega" required error={state.fieldErrors?.deliveredAt?.[0]}>
                <DateTimePicker name="deliveredAt" value={deliveredAt} onChange={setDeliveredAt} />
              </Field>

              <PhysicalStateChoice
                name="physicalState"
                label="Estado físico al entregar"
                states={IT_PHYSICAL_STATES}
                value={physicalState}
                onChange={setPhysicalState}
                error={state.fieldErrors?.physicalState?.[0]}
                helper="Cómo recibe el equipo el trabajador."
              />

              {/*
                TIA-001 (auditoría 2026-09-14): aquí había una casilla
                —"confirmada por el técnico TI en representación del
                trabajador"— con la que quien entrega el equipo declaraba
                aceptada su propia acta. El acuse se registra ahora desde la
                lista de actas y lo hace una persona distinta del entregador.
              */}
              <Field label="Aceptación del trabajador" helper="El acta nace pendiente de acuse: lo registra después alguien distinto de quien entrega.">
                <p className="text-sm text-[var(--color-text-subtle)]">
                  Pendiente de acuse hasta que se registre desde la lista de entregas.
                </p>
              </Field>

              <Field label="Accesorios incluidos" helper="Cargador, mouse, bolso, dock…">
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={accessoryDraft}
                      onChange={(e) => setAccessoryDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccessory() } }}
                      placeholder="Escribe un accesorio y presiona Enter"
                      list="ti-accessory-suggestions"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={addAccessory} aria-label="Agregar accesorio">
                      <Plus size={14} />
                    </Button>
                    <datalist id="ti-accessory-suggestions">
                      {ACCESSORY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  {accessories.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {accessories.map((acc) => (
                        <span key={acc} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs text-[var(--color-text)]">
                          {acc}
                          <button type="button" onClick={() => setAccessories((prev) => prev.filter((a) => a !== acc))} aria-label={`Quitar ${acc}`}>
                            <X size={11} className="text-[var(--color-text-subtle)]" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Field>

              <Field
                label="Evidencia fotográfica"
                helper="Fotos del estado físico al entregar: pantalla, tapa, teclado, costados, cargador y accesorios. Quedan asociadas a esta entrega para siempre."
              >
                <EvidencePhotos controller={evidence} alt="Evidencia de entrega" />
              </Field>

              <Field label="Observaciones">
                <Textarea name="observations" maxLength={500} placeholder="Rayas, detalles estéticos, funcionamiento…" rows={3} />
              </Field>
            </FieldGroup>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={closeSheet}>Cancelar</Button>
            <SubmitButton label="Registrar entrega y acta" loadingLabel="Registrando..." />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
