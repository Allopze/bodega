"use client"

import { useActionState, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { updateFuelLoadAction, type ActionState } from "../actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/lib/toast"
import { deleteFuelLoadAction, registerFuelLoadAction } from "../actions"

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
  const [iecFixed, _setIecFixed] = useState(load.iecFixed)
  const [iecVariable, _setIecVariable] = useState(load.iecVariable)
  const [iecTotal, _setIecTotal] = useState(load.iecTotal)
  const [ivaAmount, setIvaAmount] = useState(load.ivaAmount)
  const [totalAmount, setTotalAmount] = useState(load.totalAmount)

  useEffect(() => {
    // IEC components are preserved from the existing load (rates aren't available client-side).
    // Only IVA (always 19%) and total are recalculated when baseAmount changes.
    const iva = Math.round(baseAmount * 0.19 * 100) / 100
    setIvaAmount(iva)
    setTotalAmount(Math.round((baseAmount + iecTotal + iva) * 100) / 100)
  }, [baseAmount, iecTotal])

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message)
      router.push("/combustibles")
    } else if (state.message && !state.ok) {
      toast.error(state.message)
    }
  }, [state, router])

  const isEditable = load.status === "draft"
  const formatCLP = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)

  async function handleDelete() {
    if (!confirm("¿Eliminar esta carga?")) return
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
              <Input name="loadDate" type="date" defaultValue={load.loadDate} disabled={!isEditable} required />
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
              <Input value={formatCLP(iecFixed)} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>IEC Variable</Label>
              <Input value={formatCLP(iecVariable)} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>IVA (19%)</Label>
              <Input value={formatCLP(ivaAmount)} disabled className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label className="text-lg font-semibold">Total</Label>
              <Input value={formatCLP(totalAmount)} disabled className="bg-muted text-lg font-bold" />
            </div>
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
            <Button type="button" variant="destructive" onClick={handleDelete}>Eliminar</Button>
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
