"use client"

import { useActionState, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { updateFuelLoadAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { toast } from "@/lib/toast"
import { deleteFuelLoadAction, registerFuelLoadAction } from "../actions"
import { formatCLP } from "@/lib/utils"

interface LoadData {
  id: string
  loadDate: string
  month: string
  serviceType: string
  vehicleId: string
  fuelSupplierId: string
  worksiteId: string
  product: string
  receiptNumber: string | null
  odometerReading: number | null
  hourMeterReading: number | null
  liters: number
  iecFixed: number
  iecVariable: number
  baseAmount: number
  iecTotal: number
  ivaAmount: number
  totalAmount: number
  status: string
  notes: string | null
}

interface EditFuelLoadFormProps {
  load: LoadData
  vehicles: Array<{ id: string; plate: string; type: string }>
  suppliers: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
}

export function EditFuelLoadForm({ load, vehicles, suppliers, worksites }: EditFuelLoadFormProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(updateFuelLoadAction, { ok: false, message: "" })

  const [liters, setLiters] = useState(load.liters)
  const [baseAmount, setBaseAmount] = useState(load.baseAmount)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  // Las tasas de IEC (CLP/litro) viven en system_settings y no están disponibles
  // en el cliente: acá se muestra el IEC vigente de la carga. Si cambian los
  // litros, el servidor lo recalcula al guardar — de ahí el aviso de abajo.
  const { iecFixed, iecVariable, iecTotal } = load
  const ivaAmount = Math.round(baseAmount * 0.19 * 100) / 100
  const totalAmount = Math.round((baseAmount + iecTotal + ivaAmount) * 100) / 100
  const litersChanged = Number(liters) !== Number(load.liters)

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message)
      router.push("/combustibles")
    } else if (state.message && !state.ok) {
      toast.error(state.message)
    }
  }, [state, router])

  const isEditable = load.status === "draft"

  async function handleDelete() {
    setConfirmDeleteOpen(false)
    const result = await deleteFuelLoadAction(load.id)
    if (result.ok) {
      toast.success(result.message)
      router.push("/combustibles")
    } else {
      toast.error(result.message)
    }
  }

  async function handleRegister() {
    const result = await registerFuelLoadAction(load.id)
    if (result.ok) {
      toast.success(result.message)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Badge variant={load.status === "draft" ? "default" : load.status === "registered" ? "primary" : load.status === "reconciled" ? "outline" : "danger"}>
          {load.status === "draft" ? "Borrador" : load.status === "registered" ? "Registrado" : load.status === "reconciled" ? "Conciliado" : "Anulado"}
        </Badge>
        {isEditable && (
          <Button size="sm" onClick={handleRegister}>Registrar</Button>
        )}
      </div>

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="id" value={load.id} />
        <input type="hidden" name="iecFixed" value={iecFixed} />
        <input type="hidden" name="iecVariable" value={iecVariable} />
        <input type="hidden" name="iecTotal" value={iecTotal} />
        <input type="hidden" name="ivaAmount" value={ivaAmount} />
        <input type="hidden" name="totalAmount" value={totalAmount} />

        <Card>
          <CardHeader><CardTitle>Datos de la carga</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Fecha *</Label>
              <DatePicker name="loadDate" defaultValue={load.loadDate} disabled={!isEditable} />
            </div>
            <div className="space-y-2">
              <Label>Servicio *</Label>
              <Select name="serviceType" defaultValue={load.serviceType} disabled={!isEditable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TCT">TCT</SelectItem>
                  <SelectItem value="TAE">TAE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Vehículo *</Label>
              <Select name="vehicleId" defaultValue={load.vehicleId} disabled={!isEditable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate} ({v.type})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Proveedor *</Label>
              <Select name="fuelSupplierId" defaultValue={load.fuelSupplierId} disabled={!isEditable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Faena *</Label>
              <Select name="worksiteId" defaultValue={load.worksiteId} disabled={!isEditable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {worksites.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Producto *</Label>
              <Select name="product" defaultValue={load.product} disabled={!isEditable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PETROLEO DIESEL">Petróleo Diésel</SelectItem>
                  <SelectItem value="BLUEMAX">BlueMax</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Nro Factura/Boleta</Label>
              <Input name="receiptNumber" defaultValue={load.receiptNumber ?? ""} disabled={!isEditable} />
            </div>
            <div className="space-y-2">
              <Label>Kilometraje</Label>
              <Input name="odometerReading" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={load.odometerReading ?? ""} disabled={!isEditable} />
            </div>
            <div className="space-y-2">
              <Label>Horómetro</Label>
              <Input name="hourMeterReading" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={load.hourMeterReading ?? ""} disabled={!isEditable} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Montos</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Litros *</Label>
              <Input name="liters" type="number" step="0.01" min="0" required
                value={liters} onChange={(e) => setLiters(Number(e.target.value))} disabled={!isEditable} />
            </div>
            <div className="space-y-2">
              <Label>Base Afecta (CLP) *</Label>
              <Input name="baseAmount" type="number" step="0.01" min="0" required
                value={baseAmount} onChange={(e) => setBaseAmount(Number(e.target.value))} disabled={!isEditable} />
            </div>
            <div className="space-y-2">
              <Label>IEC Fijo</Label>
              <Input value={formatCLP(iecFixed)} disabled className="bg-[var(--color-surface-2)]" />
            </div>
            <div className="space-y-2">
              <Label>IEC Variable</Label>
              <Input value={formatCLP(iecVariable)} disabled className="bg-[var(--color-surface-2)]" />
            </div>
            <div className="space-y-2">
              <Label>IVA (19%)</Label>
              <Input value={formatCLP(ivaAmount)} disabled className="bg-[var(--color-surface-2)]" />
            </div>
            <div className="space-y-2">
              <Label className="text-lg font-semibold">Total</Label>
              <Input value={formatCLP(totalAmount)} disabled className="bg-[var(--color-surface-2)] text-lg font-bold" />
            </div>
            {litersChanged && (
              <p className="sm:col-span-2 text-xs text-[var(--color-warning-ink)]">
                Cambiaste los litros: el IEC (CLP por litro) y el total se recalculan al guardar con las tasas vigentes. Los valores de arriba son los de la carga actual.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notas</CardTitle></CardHeader>
          <CardContent>
            <Textarea name="notes" defaultValue={load.notes ?? ""} disabled={!isEditable} rows={3} />
          </CardContent>
        </Card>

        {isEditable && (
          <div className="flex justify-between">
            <Button type="button" variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>Eliminar</Button>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="¿Eliminar carga de combustible?"
        description="Esta acción no se puede deshacer. La carga y sus montos asociados serán eliminados permanentemente."
        confirmLabel="Eliminar"
        variant="destructive"
        loading={isPending}
        onConfirm={handleDelete}
      />
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>{isPending ? "Guardando..." : "Guardar cambios"}</Button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
