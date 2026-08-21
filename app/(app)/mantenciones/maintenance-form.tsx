"use client"

import { useActionState, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Label } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { OptionSelect } from "@/components/ui/option-select"
import { createMaintenanceRecordAction } from "./actions"
import type { ActionState } from "@/lib/validation/masters"
import { MAINTENANCE_INITIAL_STATUSES, MAINTENANCE_STATUS_LABELS } from "@/lib/validation/maintenance"
import { toast } from "@/lib/toast"

interface Option {
  id: string
  name: string
}

interface VehicleOption {
  id: string
  plate: string
  type: string
  worksiteId: string
}

type CostCenterOption = Option & { code: string; worksiteId: string | null }

export interface MaintenanceDefaults {
  id?: string
  vehicleId?: string
  supplierId?: string | null
  costCenterId?: string | null
  /** Centro ya imputado, aunque hoy esté inactivo o sea de otra faena. */
  costCenterOption?: CostCenterOption | null
  maintenanceDate?: string
  maintenanceType?: string
  status?: string
  odometerReading?: number | null
  hourMeterReading?: number | null
  netAmount?: number | null
  taxAmount?: number | null
  documentNumber?: string | null
  /** Sin campo visible, pero se reenvía: si no viaja, el update lo pone en NULL. */
  documentName?: string | null
  notes?: string | null
}

const MAINTENANCE_TYPES = [
  { value: "preventiva", label: "Preventiva" },
  { value: "correctiva", label: "Correctiva" },
  { value: "neumaticos", label: "Neumáticos" },
  { value: "lubricacion", label: "Lubricación" },
  { value: "revision_tecnica", label: "Revisión técnica" },
]

type MaintenanceAction = (prev: ActionState, formData: FormData) => Promise<ActionState>

export function MaintenanceForm({
  vehicles,
  suppliers,
  costCenters,
  action = createMaintenanceRecordAction,
  defaults,
  submitLabel = "Registrar",
  onSuccess,
  canViewCosts,
}: {
  vehicles: VehicleOption[]
  suppliers: Option[]
  costCenters: CostCenterOption[]
  action?: MaintenanceAction
  defaults?: MaintenanceDefaults
  submitLabel?: string
  onSuccess?: () => void
  canViewCosts: boolean
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await action(prev, formData)
      if (result.message) {
        if (result.ok) {
          toast.success(result.message)
          onSuccess?.()
        } else {
          toast.error(result.message)
        }
      }
      return result
    },
    { ok: false, message: "" },
  )

  // El total se deriva de neto + IVA para evitar montos incoherentes.
  const [netAmount, setNetAmount] = useState(defaults?.netAmount ?? 0)
  const [taxAmount, setTaxAmount] = useState(defaults?.taxAmount ?? 0)
  const totalAmount = netAmount + taxAmount

  const [vehicleId, setVehicleId] = useState(defaults?.vehicleId ?? "")
  const [maintenanceType, setMaintenanceType] = useState(defaults?.maintenanceType ?? "")
  const [status, setStatus] = useState(defaults?.status === "in_progress" ? "in_progress" : "scheduled")
  const [supplierId, setSupplierId] = useState(defaults?.supplierId ?? "")
  const [costCenterId, setCostCenterId] = useState(defaults?.costCenterId ?? "")

  // El servidor valida el centro contra la faena del EQUIPO. Ofrecer el catálogo
  // completo del alcance del actor —que para un rol global son todas las faenas—
  // dejaba elegir imputaciones que el guardado rechaza. Los transversales
  // (`worksiteId` nulo) siempre están disponibles, y el centro ya imputado se
  // conserva para que editar otros campos no lo borre ni deje el selector en
  // blanco.
  const vehicleWorksiteId = vehicles.find((vehicle) => vehicle.id === vehicleId)?.worksiteId
  const availableCostCenters = costCenters.filter(
    (center) => !center.worksiteId || center.worksiteId === vehicleWorksiteId,
  )
  const inheritedCenter = defaults?.costCenterOption
  const costCenterChoices = inheritedCenter && !availableCostCenters.some((center) => center.id === inheritedCenter.id)
    ? [inheritedCenter, ...availableCostCenters]
    : availableCostCenters

  function handleVehicleChange(nextVehicleId: string) {
    setVehicleId(nextVehicleId)
    const nextWorksiteId = vehicles.find((vehicle) => vehicle.id === nextVehicleId)?.worksiteId
    const chosen = costCenters.find((center) => center.id === costCenterId)
    // Cambiar de equipo cambia la faena: una imputación de la faena anterior
    // dejaría de ser válida y el servidor la rechazaría al guardar.
    if (chosen?.worksiteId && chosen.worksiteId !== nextWorksiteId) setCostCenterId("")
  }

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}
      {defaults?.documentName && <input type="hidden" name="documentName" value={defaults.documentName} />}
      <div>
        <Label htmlFor="vehicleId" required>Vehículo</Label>
        <OptionSelect
          id="vehicleId"
          name="vehicleId"
          value={vehicleId}
          onValueChange={handleVehicleChange}
          placeholder="Seleccionar"
          error={Boolean(state.fieldErrors?.vehicleId)}
          options={vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.plate} (${vehicle.type})` }))}
        />
        <FieldError message={state.fieldErrors?.vehicleId?.[0]} />
      </div>

      <div>
        <Label htmlFor="maintenanceDate" required>Fecha</Label>
        <DatePicker id="maintenanceDate" name="maintenanceDate" defaultValue={defaults?.maintenanceDate ?? ""} />
        <FieldError message={state.fieldErrors?.maintenanceDate?.[0]} />
      </div>

      <div>
        <Label htmlFor="maintenanceType" required>Tipo</Label>
        <OptionSelect
          id="maintenanceType"
          name="maintenanceType"
          value={maintenanceType}
          onValueChange={setMaintenanceType}
          placeholder="Seleccionar"
          error={Boolean(state.fieldErrors?.maintenanceType)}
          options={MAINTENANCE_TYPES}
        />
        <FieldError message={state.fieldErrors?.maintenanceType?.[0]} />
      </div>

      {!defaults?.id && <div>
        <Label htmlFor="status">Estado</Label>
        <OptionSelect
          id="status"
          name="status"
          value={status}
          onValueChange={setStatus}
          options={MAINTENANCE_INITIAL_STATUSES.map((item) => ({ value: item, label: MAINTENANCE_STATUS_LABELS[item] }))}
        />
        <FieldError message={state.fieldErrors?.status?.[0]} />
      </div>}

      {/* `emptyLabel` es lo que faltaba: con un Select de Radix a secas, una vez
          elegido un proveedor/faena/centro no había forma de volver a dejarlo
          vacío — no existe opción para "sin valor". */}
      <div>
        <Label htmlFor="supplierId">Proveedor</Label>
        <OptionSelect
          id="supplierId"
          name="supplierId"
          value={supplierId}
          onValueChange={setSupplierId}
          placeholder="Sin proveedor"
          emptyLabel="Sin proveedor"
          options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
        />
      </div>

      {/* Sin selector de faena: la mantención pertenece a la faena del equipo.
          Elegir otra sólo repartía el mismo gasto entre dos agregados. */}
      <div>
        <Label htmlFor="costCenterId">Centro de costo</Label>
        <OptionSelect
          id="costCenterId"
          name="costCenterId"
          value={costCenterId}
          onValueChange={setCostCenterId}
          placeholder="Sin centro"
          emptyLabel="Sin centro"
          options={costCenterChoices.map((center) => ({ value: center.id, label: `${center.code} - ${center.name}` }))}
        />
      </div>

      <div>
        <Label htmlFor="documentNumber">Documento</Label>
        <Input id="documentNumber" name="documentNumber" placeholder="Factura, OT o guía" defaultValue={defaults?.documentNumber ?? ""} />
        <FieldError message={state.fieldErrors?.documentNumber?.[0]} />
      </div>

      <div>
        <Label htmlFor="odometerReading">Kilometraje (km)</Label>
        <Input id="odometerReading" name="odometerReading" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={defaults?.odometerReading ?? ""} />
        <FieldError message={state.fieldErrors?.odometerReading?.[0]} />
      </div>

      <div>
        <Label htmlFor="hourMeterReading">Horómetro (h)</Label>
        <Input id="hourMeterReading" name="hourMeterReading" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={defaults?.hourMeterReading ?? ""} />
        <FieldError message={state.fieldErrors?.hourMeterReading?.[0]} />
      </div>

      {canViewCosts && <div>
        <Label htmlFor="netAmount">Neto</Label>
        <Input id="netAmount" name="netAmount" type="number" min="0" step="1" inputMode="numeric"
          value={netAmount || ""} onChange={(e) => setNetAmount(Number(e.target.value) || 0)} />
        <FieldError message={state.fieldErrors?.netAmount?.[0]} />
      </div>}

      {canViewCosts && <div>
        <Label htmlFor="taxAmount">IVA</Label>
        <Input id="taxAmount" name="taxAmount" type="number" min="0" step="1" inputMode="numeric"
          value={taxAmount || ""} onChange={(e) => setTaxAmount(Number(e.target.value) || 0)} />
        <FieldError message={state.fieldErrors?.taxAmount?.[0]} />
      </div>}

      {canViewCosts && <div>
        <Label htmlFor="totalAmount" required>Total (neto + IVA)</Label>
        <Input id="totalAmount" name="totalAmount" type="number" value={totalAmount} readOnly tabIndex={-1} className="bg-[var(--color-surface-2)]" />
        <FieldError message={state.fieldErrors?.totalAmount?.[0]} />
      </div>}

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

/**
 * `text-destructive` no existe en el tema (`@theme` de app/globals.css no define
 * `--color-destructive`), así que la clase no generaba ninguna utilidad y los
 * errores salían en color de cuerpo. Además sólo dos campos los mostraban.
 */
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-[var(--color-danger-ink)]">{message}</p>
}
