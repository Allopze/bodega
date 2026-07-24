"use client"

import { useActionState, useMemo, useState } from "react"
import { Plus, WarningCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { INITIAL_STATE } from "@/components/admin/form-state"
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
  const [state, action, pending] = useActionState(createFuelCycleMovementAction, INITIAL_STATE)
  const usableLocations = useMemo(() => locations.filter((item) => item.worksiteId === worksiteId && item.productId === productId), [locations, productId, worksiteId])
  const usableVehicles = useMemo(() => vehicles.filter((item) => item.worksiteId === worksiteId), [vehicles, worksiteId])
  if (!canCreate) return null
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Plus size={16} />Registrar movimiento</Button>
      {open && <div className="fixed inset-0 z-40 grid place-items-end bg-black/30 p-0 md:place-items-center md:p-6" role="dialog" aria-modal="true" aria-label="Registrar movimiento físico">
        <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl md:rounded-xl">
          <form action={async (data) => { await action(data); if (state.ok) setOpen(false) }} className="space-y-5 p-5 md:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="text-eyebrow">Ciclo físico</p><h2 className="text-lg font-semibold tracking-tight">Registrar movimiento</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">El registro queda auditado y alimenta la conciliación del período.</p></div><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cerrar</Button></div>
            {state.message && <p className={state.ok ? "text-sm text-[var(--color-primary-ink)]" : "flex gap-2 text-sm text-[var(--color-danger)]"}>{!state.ok && <WarningCircle size={18} />}{state.message}</p>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Tipo de evento">
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Recepción en estanque</SelectItem>
                    <SelectItem value="transfer">Transferencia entre estanques</SelectItem>
                    <SelectItem value="tank_delivery">Entrega desde estanque</SelectItem>
                    <SelectItem value="direct_delivery">Entrega directa</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fecha y hora"><input name="occurredAt" type="datetime-local" required defaultValue={new Date().toISOString().slice(0, 16)} aria-label="Fecha y hora" className="control" /></Field>
              <Field label="Faena">
                <Select value={worksiteId} onValueChange={(v) => { setWorksiteId(v); setSourceLocationId(""); setTargetLocationId(""); setVehicleId("") }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Producto">
                <Select value={productId} onValueChange={(v) => { setProductId(v); setSourceLocationId(""); setTargetLocationId("") }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {products.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Litros"><input name="quantity" type="number" min="0.01" step="0.01" required aria-label="Litros" className="control" /></Field>
              <Field label="Documento / guía"><input name="documentNumber" maxLength={120} aria-label="Documento / guía" className="control" /></Field>
              {(type === "received" || type === "direct_delivery") && <Field label="Proveedor">
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="supplierId" value={supplierId} />
              </Field>}
              {(type === "transfer" || type === "tank_delivery") && <Field label="Estanque origen">
                <Select value={sourceLocationId} onValueChange={setSourceLocationId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableLocations.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="sourceLocationId" value={sourceLocationId} />
              </Field>}
              {(type === "received" || type === "transfer") && <Field label="Estanque destino">
                <Select value={targetLocationId} onValueChange={setTargetLocationId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableLocations.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="targetLocationId" value={targetLocationId} />
              </Field>}
              {(type === "tank_delivery" || type === "direct_delivery") && <Field label="Equipo">
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
                  <SelectContent>
                    {usableVehicles.map((item) => <SelectItem key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ""}{item.plate}</SelectItem>)}
                  </SelectContent>
                </Select>
                <input type="hidden" name="vehicleId" value={vehicleId} />
              </Field>}
            </div>
            {usableLocations.length === 0 && (type === "received" || type === "transfer" || type === "tank_delivery") && <p className="rounded-[var(--radius)] border border-[var(--color-signal-line)] bg-[var(--color-signal-tint)] p-3 text-sm text-[var(--color-signal-ink)]">No hay estanques activos para esta faena y producto. Solicita su alta en el catálogo antes de registrar este evento.</p>}
            <Field label="Observaciones"><textarea name="notes" maxLength={1000} rows={3} aria-label="Observaciones" className="control" /></Field>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" loading={pending}>Registrar movimiento</Button></div>
          </form>
        </div>
      </div>}
    </>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium text-[var(--color-text)]"><span>{label}</span>{children}</label> }
