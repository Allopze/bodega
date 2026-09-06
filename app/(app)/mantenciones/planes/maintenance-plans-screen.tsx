"use client"

import { useActionState, useState } from "react"
import { useOperation } from "@/lib/hooks/use-operation"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetaBadge } from "@/components/states/state-badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { OptionSelect } from "@/components/ui/option-select"
import { EmptyState } from "@/components/ui/empty-state"
import { formatDate } from "@/lib/utils"
import type { ActionState } from "@/lib/validation/masters"
import { materializeMaintenancePlansAction, saveMaintenancePlanAction, setMaintenancePlanActiveAction } from "../actions"

type Plan = {
  id: string
  vehicleId: string
  name: string
  maintenanceType: string
  strategy: string
  intervalDays: number | null
  intervalUnits: number | null
  advanceDays: number
  advanceUnits: number
  nextDueDate: string | null
  nextDueReading: number | null
  assignedToUserId: string | null
  supplierId: string | null
  costCenterId: string | null
  instructions: string | null
  isActive: boolean
  version: number
  vehicle: { id: string; plate: string; code: string | null; meterType: string }
  worksite: { id: string; name: string }
}
type Vehicle = { id: string; plate: string; code: string | null; worksiteId: string }
type Supplier = { id: string; name: string }
type CostCenter = { id: string; code: string; name: string; worksiteId: string | null }
type Assignee = { id: string; name: string; worksiteIds: string[] | null }

const STRATEGIES = [
  { value: "calendar", label: "Por calendario" },
  { value: "odometer", label: "Por kilometraje" },
  { value: "hour_meter", label: "Por horómetro" },
  { value: "combined", label: "Calendario y uso" },
]
const TYPES = [
  { value: "preventiva", label: "Preventiva" },
  { value: "lubricacion", label: "Lubricación" },
  { value: "neumaticos", label: "Neumáticos" },
  { value: "revision_tecnica", label: "Revisión técnica" },
]

export function MaintenancePlansScreen({ plans, vehicles, suppliers, costCenters, assignees, canEdit, canCreateOrders }: {
  plans: Plan[]
  vehicles: Vehicle[]
  suppliers: Supplier[]
  costCenters: CostCenter[]
  assignees: Assignee[]
  canEdit: boolean
  canCreateOrders: boolean
}) {
  const [editing, setEditing] = useState<Plan | "new" | null>(null)
  const materialize = useOperation()
  return <PageContainer>
    <PageHeader
      title="Planes preventivos"
      description="Reglas por activo que generan órdenes antes de vencer por fecha, kilometraje u horómetro."
      breadcrumb={<Breadcrumbs items={[{ label: "Mantenciones", href: "/mantenciones" }, { label: "Planes preventivos" }]} />}
      actions={<div className="flex gap-2">
        {canCreateOrders && <Button type="button" variant="secondary" disabled={materialize.pending} onClick={() => materialize.run(materializeMaintenancePlansAction)}>{materialize.pending ? "Evaluando…" : "Evaluar vencimientos"}</Button>}
        {canEdit && <Button type="button" onClick={() => setEditing("new")}>Nuevo plan</Button>}
      </div>}
    />
    {materialize.message && <p role="status" className="mb-3 text-sm text-[var(--color-text-muted)]">{materialize.message}</p>}
    {plans.length === 0 ? <EmptyState title="No hay planes preventivos" description="Crea una regla por activo para que la plataforma programe la OT antes del vencimiento." action={canEdit ? <Button type="button" onClick={() => setEditing("new")}>Crear primer plan</Button> : undefined} /> : (
      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((plan) => <PlanCard key={plan.id} plan={plan} canEdit={canEdit} onEdit={() => setEditing(plan)} />)}
      </div>
    )}
    <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {editing && <PlanForm key={editing === "new" ? "new" : `${editing.id}:${editing.version}`} plan={editing === "new" ? null : editing} vehicles={vehicles} suppliers={suppliers} costCenters={costCenters} assignees={assignees} onSuccess={() => setEditing(null)} />}
      </DialogContent>
    </Dialog>
  </PageContainer>
}

function PlanCard({ plan, canEdit, onEdit }: { plan: Plan; canEdit: boolean; onEdit: () => void }) {
  const operation = useOperation()
  const strategy = STRATEGIES.find((item) => item.value === plan.strategy)?.label ?? plan.strategy
  return <Card>
    <CardHeader className="flex-row items-start justify-between gap-3">
      <div><CardTitle className="text-base">{plan.name}</CardTitle><p className="mt-1 text-sm text-[var(--color-text-muted)]">{plan.vehicle.code ? `${plan.vehicle.code} · ` : ""}{plan.vehicle.plate} · {plan.worksite.name}</p></div>
      <MetaBadge meta={{ label: `${plan.isActive ? "Activo" : "Pausado"}`, variant: plan.isActive ? "success" : "outline" }} />
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-[var(--color-text-subtle)]">Estrategia</dt><dd>{strategy}</dd></div>
        <div><dt className="text-[var(--color-text-subtle)]">Próximo vencimiento</dt><dd>{plan.nextDueDate ? formatDate(plan.nextDueDate) : plan.nextDueReading != null ? `${plan.nextDueReading.toLocaleString("es-CL")} ${plan.strategy === "hour_meter" ? "h" : "km"}` : "Por definir"}</dd></div>
      </dl>
      {operation.message && <p role="status" className="text-[var(--color-text-muted)]">{operation.message}</p>}
      {canEdit && <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={onEdit}>Editar</Button><Button type="button" size="sm" variant="secondary" disabled={operation.pending} onClick={() => operation.run(() => setMaintenancePlanActiveAction({ id: plan.id, active: !plan.isActive, expectedVersion: plan.version }))}>{plan.isActive ? "Pausar" : "Activar"}</Button></div>}
    </CardContent>
  </Card>
}

function PlanForm({ plan, vehicles, suppliers, costCenters, assignees, onSuccess }: { plan: Plan | null; vehicles: Vehicle[]; suppliers: Supplier[]; costCenters: CostCenter[]; assignees: Assignee[]; onSuccess: () => void }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const result = await saveMaintenancePlanAction(previous, formData)
    if (result.ok) onSuccess()
    return result
  }, { ok: false, message: "" })
  const [vehicleId, setVehicleId] = useState(plan?.vehicleId ?? vehicles[0]?.id ?? "")
  const [strategy, setStrategy] = useState(plan?.strategy ?? "calendar")
  const [maintenanceType, setMaintenanceType] = useState(plan?.maintenanceType ?? "preventiva")
  const [supplierId, setSupplierId] = useState(plan?.supplierId ?? "")
  const [costCenterId, setCostCenterId] = useState(plan?.costCenterId ?? "")
  const [assignedToUserId, setAssignedToUserId] = useState(plan?.assignedToUserId ?? "")
  const worksiteId = vehicles.find((vehicle) => vehicle.id === vehicleId)?.worksiteId
  const centers = costCenters.filter((center) => !center.worksiteId || center.worksiteId === worksiteId)
  const responsibleOptions = assignees.filter((assignee) => assignee.worksiteIds === null || assignee.worksiteIds.includes(worksiteId ?? ""))
  return <form action={formAction} className="space-y-4">
    <DialogHeader><DialogTitle>{plan ? "Editar plan preventivo" : "Nuevo plan preventivo"}</DialogTitle><DialogDescription>La anticipación crea una OT programada; no cambia el estado del activo hasta iniciar el trabajo.</DialogDescription></DialogHeader>
    {plan && <><input type="hidden" name="id" value={plan.id} /><input type="hidden" name="expectedVersion" value={plan.version} /></>}
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Activo" htmlFor="plan-vehicle" required error={state.fieldErrors?.vehicleId?.[0]}><OptionSelect id="plan-vehicle" name="vehicleId" value={vehicleId} onValueChange={(value) => { setVehicleId(value); setCostCenterId(""); setAssignedToUserId("") }} options={vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.code ? `${vehicle.code} · ` : ""}${vehicle.plate}` }))} /></Field>
      <Field label="Nombre del plan" htmlFor="plan-name" required error={state.fieldErrors?.name?.[0]}><Input id="plan-name" name="name" defaultValue={plan?.name ?? ""} required minLength={3} /></Field>
      <Field label="Tipo de mantención" htmlFor="plan-type" required><OptionSelect id="plan-type" name="maintenanceType" value={maintenanceType} onValueChange={setMaintenanceType} options={TYPES} /></Field>
      <Field label="Estrategia" htmlFor="plan-strategy" required><OptionSelect id="plan-strategy" name="strategy" value={strategy} onValueChange={setStrategy} options={STRATEGIES} /></Field>
      {(strategy === "calendar" || strategy === "combined") && <><Field label="Intervalo (días)" htmlFor="plan-days" required error={state.fieldErrors?.intervalDays?.[0]}><Input id="plan-days" name="intervalDays" type="number" min={1} defaultValue={plan?.intervalDays ?? 180} /></Field><Field label="Anticipación (días)" htmlFor="plan-advance-days"><Input id="plan-advance-days" name="advanceDays" type="number" min={0} defaultValue={plan?.advanceDays ?? 7} /></Field><Field label="Próxima fecha" htmlFor="plan-next-date"><DatePicker id="plan-next-date" name="nextDueDate" defaultValue={plan?.nextDueDate ?? ""} /></Field></>}
      {(strategy === "odometer" || strategy === "hour_meter" || strategy === "combined") && <><Field label={`Intervalo (${strategy === "hour_meter" ? "horas" : "km"})`} htmlFor="plan-units" required error={state.fieldErrors?.intervalUnits?.[0]}><Input id="plan-units" name="intervalUnits" type="number" min={1} defaultValue={plan?.intervalUnits ?? (strategy === "hour_meter" ? 250 : 10000)} /></Field><Field label="Anticipación por uso" htmlFor="plan-advance-units"><Input id="plan-advance-units" name="advanceUnits" type="number" min={0} defaultValue={plan?.advanceUnits ?? 100} /></Field><Field label="Próxima lectura" htmlFor="plan-next-reading"><Input id="plan-next-reading" name="nextDueReading" type="number" min={0} defaultValue={plan?.nextDueReading ?? ""} /></Field></>}
      <Field label="Proveedor" htmlFor="plan-supplier"><OptionSelect id="plan-supplier" name="supplierId" value={supplierId} onValueChange={setSupplierId} emptyLabel="Sin proveedor" options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} /></Field>
      <Field label="Centro de costo" htmlFor="plan-cost-center"><OptionSelect id="plan-cost-center" name="costCenterId" value={costCenterId} onValueChange={setCostCenterId} emptyLabel="Sin centro" options={centers.map((center) => ({ value: center.id, label: `${center.code} · ${center.name}` }))} /></Field>
      <Field label="Responsable" htmlFor="plan-assignee"><OptionSelect id="plan-assignee" name="assignedToUserId" value={assignedToUserId} onValueChange={setAssignedToUserId} emptyLabel="Sin asignar" options={responsibleOptions.map((assignee) => ({ value: assignee.id, label: assignee.name }))} /></Field>
    </div>
    <Field label="Instrucciones para la OT" htmlFor="plan-instructions"><Textarea id="plan-instructions" name="instructions" defaultValue={plan?.instructions ?? ""} rows={3} /></Field>
    {state.message && <p role="status" className={state.ok ? "text-sm text-[var(--color-success)]" : "text-sm text-[var(--color-danger)]"}>{state.message}</p>}
    <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar plan"}</Button></DialogFooter>
  </form>
}
