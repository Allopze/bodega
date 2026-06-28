"use client"

import { useActionState, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createFuelLoadAction } from "../actions"
import type { ActionState } from "@/lib/validation/masters"
import { calculateFuelAmounts } from "@/lib/combustibles/calculations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { toast } from "@/lib/toast"

interface NewFuelLoadData {
  vehicles: Array<{ id: string; plate: string; type: string }>
  suppliers: Array<{ id: string; name: string }>
  worksites: Array<{ id: string; name: string }>
}

export function NewFuelLoadForm({ data }: { data: NewFuelLoadData }) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createFuelLoadAction, { ok: false, message: "" })

  const [liters, setLiters] = useState(0)
  const [baseAmount, setBaseAmount] = useState(0)
  const [iecFixed, setIecFixed] = useState(0)
  const [iecVariable, setIecVariable] = useState(0)
  const [iecTotal, setIecTotal] = useState(0)
  const [ivaAmount, setIvaAmount] = useState(0)
  const [totalAmount, setTotalAmount] = useState(0)

  // Auto-calculate on liters/baseAmount change
  useEffect(() => {
    const calc = calculateFuelAmounts({ liters, baseAmount, iecFixedRate: null, iecVariableRate: null })
    setIecFixed(calc.iecFixed)
    setIecVariable(calc.iecVariable)
    setIecTotal(calc.iecTotal)
    setIvaAmount(calc.ivaAmount)
    setTotalAmount(calc.totalAmount)
  }, [liters, baseAmount])

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message)
      router.push("/combustibles")
    } else if (state.message && !state.ok) {
      toast.error(state.message)
    }
  }, [state, router])

  const formatCLP = (n: number) => new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(n)

  return (
    <PageContainer>
      <PageHeader
        title="Nueva carga de combustible"
        breadcrumb={<Breadcrumbs items={[{ label: "Combustibles", href: "/combustibles" }, { label: "Nueva carga" }]} />}
      />

      <form action={formAction} className="space-y-6">
        <input type="hidden" name="autoCalc" value="true" />
        <input type="hidden" name="iecFixed" value={iecFixed} />
        <input type="hidden" name="iecVariable" value={iecVariable} />
        <input type="hidden" name="iecTotal" value={iecTotal} />
        <input type="hidden" name="ivaAmount" value={ivaAmount} />
        <input type="hidden" name="totalAmount" value={totalAmount} />

        <Card>
          <CardHeader><CardTitle>Datos de la carga</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loadDate">Fecha *</Label>
              <Input id="loadDate" name="loadDate" type="date" required />
              {state.fieldErrors?.loadDate && <p className="text-sm text-destructive">{state.fieldErrors.loadDate[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label>Servicio *</Label>
              <Select name="serviceType" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TCT">TCT</SelectItem>
                  <SelectItem value="TAE">TAE</SelectItem>
                </SelectContent>
              </Select>
              {state.fieldErrors?.serviceType && <p className="text-sm text-destructive">{state.fieldErrors.serviceType[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label>Vehículo *</Label>
              <Select name="vehicleId" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {data.vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.plate} ({v.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.fieldErrors?.vehicleId && <p className="text-sm text-destructive">{state.fieldErrors.vehicleId[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label>Proveedor *</Label>
              <Select name="fuelSupplierId" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {data.suppliers.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.fieldErrors?.fuelSupplierId && <p className="text-sm text-destructive">{state.fieldErrors.fuelSupplierId[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label>Faena *</Label>
              <Select name="worksiteId" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {data.worksites.map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.fieldErrors?.worksiteId && <p className="text-sm text-destructive">{state.fieldErrors.worksiteId[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label>Producto *</Label>
              <Select name="product" required>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PETROLEO DIESEL">Petróleo Diésel</SelectItem>
                  <SelectItem value="BLUEMAX">BlueMax</SelectItem>
                </SelectContent>
              </Select>
              {state.fieldErrors?.product && <p className="text-sm text-destructive">{state.fieldErrors.product[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="receiptNumber">Nro Factura/Boleta</Label>
              <Input id="receiptNumber" name="receiptNumber" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="odometerReading">Kilometraje</Label>
              <Input id="odometerReading" name="odometerReading" type="number" step="0.01" min="0" inputMode="decimal" />
              {state.fieldErrors?.odometerReading && <p className="text-sm text-destructive">{state.fieldErrors.odometerReading[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="hourMeterReading">Horómetro</Label>
              <Input id="hourMeterReading" name="hourMeterReading" type="number" step="0.01" min="0" inputMode="decimal" />
              {state.fieldErrors?.hourMeterReading && <p className="text-sm text-destructive">{state.fieldErrors.hourMeterReading[0]}</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Montos</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="liters">Litros *</Label>
              <Input id="liters" name="liters" type="number" step="0.01" min="0" required
                value={liters} onChange={(e) => setLiters(Number(e.target.value))} />
              {state.fieldErrors?.liters && <p className="text-sm text-destructive">{state.fieldErrors.liters[0]}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseAmount">Base Afecta (CLP) *</Label>
              <Input id="baseAmount" name="baseAmount" type="number" step="0.01" min="0" required
                value={baseAmount} onChange={(e) => setBaseAmount(Number(e.target.value))} />
              {state.fieldErrors?.baseAmount && <p className="text-sm text-destructive">{state.fieldErrors.baseAmount[0]}</p>}
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
            <Textarea name="notes" placeholder="Observaciones opcionales..." rows={3} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button type="submit" disabled={isPending}>{isPending ? "Guardando..." : "Registrar carga"}</Button>
        </div>
      </form>
    </PageContainer>
  )
}
