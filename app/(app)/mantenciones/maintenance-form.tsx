"use client"

import { useActionState, useEffect, useState } from "react"
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

export interface MaintenanceDefaults {
  id?: string
  vehicleId?: string
  supplierId?: string | null
  worksiteId?: string | null
  costCenterId?: string | null
  maintenanceDate?: string
  maintenanceType?: string
  status?: string
  odometerReading?: number | null
  hourMeterReading?: number | null
  netAmount?: number
  taxAmount?: number
  documentNumber?: string | null
  notes?: string | null
}

type MaintenanceAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

export function MaintenanceForm({
  vehicles,
  suppliers,
  worksites,
  costCenters,
  action = createMaintenanceRecordAction,
  defaults,
  submitLabel = "Registrar",
  onSuccess,
}: {
  vehicles: VehicleOption[]
  suppliers: Option[]
  worksites: Option[]
  costCenters: Array<Option & { code: string }>
  action?: MaintenanceAction
  defaults?: MaintenanceDefaults
  submitLabel?: string
  onSuccess?: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    action,
    { ok: false, message: "" },
  )

  // El total se deriva de neto + IVA para evitar montos incoherentes.
  const [netAmount, setNetAmount] = useState(defaults?.netAmount ?? 0)
  const [taxAmount, setTaxAmount] = useState(defaults?.taxAmount ?? 0)
  const totalAmount = netAmount + taxAmount

  useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      onSuccess?.()
    } else {
      toast.error(state.message)
    }
    // onSuccess intentionally omitted: only react to action state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}
      <div>
        <Label htmlFor="vehicleId" required>Vehículo</Label>
        <select id="vehicleId" name="vehicleId" required defaultValue={defaults?.vehicleId ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Seleccionar</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} ({vehicle.type})</option>
          ))}
        </select>
        {state.fieldErrors?.vehicleId && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.vehicleId[0]}</p>}
      </div>

      <div>
        <Label htmlFor="maintenanceDate" required>Fecha</Label>
        <Input id="maintenanceDate" name="maintenanceDate" type="date" required defaultValue={defaults?.maintenanceDate ?? ""} />
      </div>

      <div>
        <Label htmlFor="maintenanceType" required>Tipo</Label>
        <select id="maintenanceType" name="maintenanceType" required defaultValue={defaults?.maintenanceType ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
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
        <select id="status" name="status" defaultValue={defaults?.status ?? "completed"} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="scheduled">Programada</option>
          <option value="in_progress">En curso</option>
          <option value="completed">Completada</option>
          <option value="cancelled">Cancelada</option>
        </select>
      </div>

      <div>
        <Label htmlFor="supplierId">Proveedor</Label>
        <select id="supplierId" name="supplierId" defaultValue={defaults?.supplierId ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Sin proveedor</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="worksiteId">Faena</Label>
        <select id="worksiteId" name="worksiteId" defaultValue={defaults?.worksiteId ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Usar faena del vehículo</option>
          {worksites.map((worksite) => (
            <option key={worksite.id} value={worksite.id}>{worksite.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="costCenterId">Centro de costo</Label>
        <select id="costCenterId" name="costCenterId" defaultValue={defaults?.costCenterId ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="">Sin centro</option>
          {costCenters.map((center) => (
            <option key={center.id} value={center.id}>{center.code} - {center.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="documentNumber">Documento</Label>
        <Input id="documentNumber" name="documentNumber" placeholder="Factura, OT o guía" defaultValue={defaults?.documentNumber ?? ""} />
      </div>

      <div>
        <Label htmlFor="odometerReading">Kilometraje</Label>
        <Input id="odometerReading" name="odometerReading" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={defaults?.odometerReading ?? ""} />
      </div>

      <div>
        <Label htmlFor="hourMeterReading">Horómetro</Label>
        <Input id="hourMeterReading" name="hourMeterReading" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={defaults?.hourMeterReading ?? ""} />
      </div>

      <div>
        <Label htmlFor="netAmount">Neto</Label>
        <Input id="netAmount" name="netAmount" type="number" min="0" step="1" inputMode="numeric"
          value={netAmount || ""} onChange={(e) => setNetAmount(Number(e.target.value) || 0)} />
      </div>

      <div>
        <Label htmlFor="taxAmount">IVA</Label>
        <Input id="taxAmount" name="taxAmount" type="number" min="0" step="1" inputMode="numeric"
          value={taxAmount || ""} onChange={(e) => setTaxAmount(Number(e.target.value) || 0)} />
      </div>

      <div>
        <Label htmlFor="totalAmount" required>Total (neto + IVA)</Label>
        <Input id="totalAmount" name="totalAmount" type="number" value={totalAmount} readOnly tabIndex={-1} className="bg-muted" />
        {state.fieldErrors?.totalAmount && <p className="mt-1 text-xs text-destructive">{state.fieldErrors.totalAmount[0]}</p>}
      </div>

      <div className="lg:col-span-3">
        <Label htmlFor="notes">Notas</Label>
        <Textarea id="notes" name="notes" rows={2} defaultValue={defaults?.notes ?? ""} />
      </div>

      <div className="flex items-end justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : submitLabel}
        </Button>
      </div>
    </form>
  )
}
