"use client"

import { useActionState, useMemo, useState } from "react"
import { Plus, WarningCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { INITIAL_STATE, type ActionState } from "@/lib/form-state"
import { toast } from "@/lib/toast"
import { toLocalInputValue } from "@/lib/utils"
import { createFuelCycleMovementAction } from "./actions"

type Item = { id: string; name?: string | null; worksiteId?: string; productId?: string; plate?: string | null; code?: string | null }
type Props = { worksites: Item[]; products: Item[]; suppliers: Item[]; locations: Item[]; vehicles: Item[]; canCreate: boolean }

export function CycleWorkbench({ worksites, products, suppliers, locations, vehicles, canCreate }: Props) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState("received")
  const [worksiteId, setWorksiteId] = useState(worksites[0]?.id ?? "")
  const [productId, setProductId] = useState(products[0]?.id ?? "")
  const [supplierId, setSupplierId] = useState("")
  const [sourceLocationId, setSourceLocationId] = useState("")
  const [targetLocationId, setTargetLocationId] = useState("")
  const [vehicleId, setVehicleId] = useState("")
  // Cierre y aviso dentro de la acción, sobre el resultado que acaba de volver.
  // El mensaje de éxito no se pinta en el formulario: el diálogo sigue montado
  // y lo mostraría sobre un formulario vacío al volver a abrirlo.
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await createFuelCycleMovementAction(prev, formData)
    if (result.ok) {
      setOpen(false)
      toast.success(result.message ?? "Movimiento registrado")
    }
    return result
  }, INITIAL_STATE)
  const usableLocations = useMemo(() => locations.filter((item) => item.worksiteId === worksiteId && item.productId === productId), [locations, productId, worksiteId])
  const usableVehicles = useMemo(() => vehicles.filter((item) => item.worksiteId === worksiteId), [vehicles, worksiteId])
  if (!canCreate) return null
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus size={16} />Registrar movimiento</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <p className="text-eyebrow">Ciclo físico</p>
            <DialogTitle>Registrar movimiento</DialogTitle>
            <DialogDescription>El registro queda auditado y alimenta la conciliación del período.</DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-5">
            {state.message && !state.ok && <p className="flex gap-2 text-sm text-[var(--color-danger)]"><WarningCircle size={18} />{state.message}</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Tipo de evento" htmlFor="eventType">
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="eventType"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Recepción en estanque</SelectItem>
                    <SelectItem value="transfer">Transferencia entre estanques</SelectItem>
                    <SelectItem value="tank_delivery">Entrega desde estanque</SelectItem>
                    <SelectItem value="direct_delivery">Entrega directa</SelectItem>
                  </SelectContent>
                </Select>
                <input type="hidden" name="eventType" value={type} />
              </Field>
              <Field label="Fecha y hora" htmlFor="occurredAt" required>
                <Input id="occurredAt" name="occurredAt" type="datetime-local" required defaultValue={toLocalInputValue(new Date())} />
              </Field>
              <Field label="Faena" htmlFor="worksiteId">
                <Select value={worksiteId} onValueChange={(v) => { setWorksiteId(v); setSourceLocationId(""); setTargetLocationId(""); setVehicleId("") }}>
                  <SelectTrigger id="worksiteId"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="worksiteId" value={worksiteId} />
              </Field>
              <Field label="Producto" htmlFor="productId">
                <Select value={productId} onValueChange={(v) => { setProductId(v); setSourceLocationId(""); setTargetLocationId("") }}>
                  <SelectTrigger id="productId"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {products.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="productId" value={productId} />
              </Field>
              <Field label="Litros" htmlFor="quantity" required>
                <Input id="quantity" name="quantity" type="number" min="0.01" step="0.01" required />
              </Field>
              <Field label="Documento / guía" htmlFor="documentNumber">
                <Input id="documentNumber" name="documentNumber" maxLength={120} />
              </Field>
              {(type === "received" || type === "direct_delivery") && <Field label="Proveedor" htmlFor="supplierId">
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="supplierId"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="supplierId" value={supplierId} />
              </Field>}
              {(type === "transfer" || type === "tank_delivery") && <Field label="Estanque origen" htmlFor="sourceLocationId">
                <Select value={sourceLocationId} onValueChange={setSourceLocationId}>
                  <SelectTrigger id="sourceLocationId"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableLocations.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="sourceLocationId" value={sourceLocationId} />
              </Field>}
              {(type === "received" || type === "transfer") && <Field label="Estanque destino" htmlFor="targetLocationId">
                <Select value={targetLocationId} onValueChange={setTargetLocationId}>
                  <SelectTrigger id="targetLocationId"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableLocations.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="targetLocationId" value={targetLocationId} />
              </Field>}
              {(type === "tank_delivery" || type === "direct_delivery") && <Field label="Equipo" htmlFor="vehicleId">
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger id="vehicleId"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableVehicles.map((item) => <SelectItem key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.plate}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="vehicleId" value={vehicleId} />
              </Field>}
            </div>
            {usableLocations.length === 0 && (type === "received" || type === "transfer" || type === "tank_delivery") && <p className="rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] p-3 text-sm text-[var(--color-signal-ink)]">No hay estanques activos para esta faena y producto. Solicita su alta en el catálogo antes de registrar este evento.</p>}
            <Field label="Observaciones" htmlFor="notes">
              <Textarea id="notes" name="notes" maxLength={1000} rows={3} className="min-h-0" />
            </Field>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" loading={pending}>Registrar movimiento</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
