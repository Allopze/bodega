"use client"

import { useActionState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { createMaintenanceRecordAction } from "./actions"
import type { ActionState } from "@/lib/validation/masters"
import { toast } from "@/lib/toast"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
}

export function MaintenanceForm({
  vehicles,
  suppliers,
  worksites,
  costCenters,
}: {
  vehicles: VehicleOption[]
  suppliers: Option[]
  worksites: Option[]
  costCenters: Array<Option & { code: string }>
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createMaintenanceRecordAction,
    { ok: false, message: "" },
  )

  useEffect(() => {
    if (!state.message) return
    if (state.ok) toast.success(state.message)
    else toast.error(state.message)
  }, [state])

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div>
        <Label htmlFor="vehicleId" required>Vehículo</Label>
        <select id="vehicleId" name="vehicleId" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Seleccionar</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} ({vehicle.type})</option>
          ))}
        </select>
        {state.fieldErrors?.vehicleId && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.vehicleId[0]}</p>}
      </div>

      <div>
        <Label htmlFor="maintenanceDate" required>Fecha</Label>
        <Input id="maintenanceDate" name="maintenanceDate" type="date" required />
      </div>

      <div>
        <Label htmlFor="maintenanceType" required>Tipo</Label>
        <select id="maintenanceType" name="maintenanceType" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Seleccionar</option>
          <option value="preventiva">Preventiva</option>
          <option value="correctiva">Correctiva</option>
          <option value="neumaticos">Neumáticos</option>
          <option value="lubricacion">Lubricación</option>
          <option value="revision_tecnica">Revisión técnica</option>
        </select>
      </div>

      <div>
        <Label htmlFor="status">Estado</Label>
        <select id="status" name="status" defaultValue="completed" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="scheduled">Programada</option>
          <option value="in_progress">En curso</option>
          <option value="completed">Completada</option>
          <option value="cancelled">Cancelada</option>
        </select>
      </div>

      <div>
        <Label htmlFor="supplierId">Proveedor</Label>
        <select id="supplierId" name="supplierId" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Sin proveedor</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="worksiteId">Faena</Label>
        <select id="worksiteId" name="worksiteId" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Usar faena del vehículo</option>
          {worksites.map((worksite) => (
            <option key={worksite.id} value={worksite.id}>{worksite.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="costCenterId">Centro de costo</Label>
        <select id="costCenterId" name="costCenterId" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Sin centro</option>
          {costCenters.map((center) => (
            <option key={center.id} value={center.id}>{center.code} - {center.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="documentNumber">Documento</Label>
        <Input id="documentNumber" name="documentNumber" placeholder="Factura, OT o guía" />
      </div>

      <div>
        <Label htmlFor="odometerReading">Kilometraje</Label>
        <Input id="odometerReading" name="odometerReading" type="number" min="0" step="0.01" inputMode="decimal" />
      </div>

      <div>
        <Label htmlFor="hourMeterReading">Horómetro</Label>
        <Input id="hourMeterReading" name="hourMeterReading" type="number" min="0" step="0.01" inputMode="decimal" />
      </div>

      <div>
        <Label htmlFor="netAmount">Neto</Label>
        <Input id="netAmount" name="netAmount" type="number" min="0" step="1" defaultValue="0" />
      </div>

      <div>
        <Label htmlFor="taxAmount">IVA</Label>
        <Input id="taxAmount" name="taxAmount" type="number" min="0" step="1" defaultValue="0" />
      </div>

      <div>
        <Label htmlFor="totalAmount" required>Total</Label>
        <Input id="totalAmount" name="totalAmount" type="number" min="0" step="1" defaultValue="0" required />
      </div>

      <div className="lg:col-span-3">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>

      <div className="flex items-end justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Registrar"}
        </Button>
      </div>
    </form>
  )
}
