"use client"

import * as React from "react"
import Link from "next/link"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { createFuelVehicleAction, updateFuelVehicleAction } from "../actions"
import {
  FUEL_EQUIPMENT_CATEGORY_LABELS,
  FUEL_METER_TYPES,
  FUEL_METER_TYPE_LABELS,
  FUEL_PERFORMANCE_UNITS,
  FUEL_PERFORMANCE_UNIT_LABELS,
  FUEL_VEHICLE_STATUSES,
  FUEL_VEHICLE_STATUS_LABELS,
} from "@/lib/combustibles/validation"

export interface VehicleForEdit {
  id: string
  plate: string
  code: string | null
  type: string
  equipmentTypeId: string
  meterType: string
  performanceUnit: string
  tankCapacityLiters: number | null
  comparisonGroup: string | null
  usualFuelSupplierId: string | null
  compatibleProductIds: string[]
  operatingSchedule: { timezone: string; days: number[]; start: string; end: string } | null
  brand: string | null
  model: string | null
  year: number | null
  worksiteId: string | null
  responsibleUserId: string | null
  operationalStatus: string
  soapExpiresAt: string | null
  technicalReviewExpiresAt: string | null
  circulationPermitExpiresAt: string | null
  insurancePolicyNumber: string | null
  insuranceExpiresAt: string | null
  notes: string | null
}

interface VehicleFormProps {
  open: boolean
  onClose: () => void
  worksites: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  equipmentTypes: Array<{ id: string; name: string; category: string; defaultMeterType: string; defaultPerformanceUnit: string; isActive: boolean }>
  suppliers: Array<{ id: string; name: string }>
  products: Array<{ id: string; name: string; unit: string; isActive: boolean }>
  editVehicle?: VehicleForEdit | null
}

const DAYS = [
  { value: 1, label: "L" }, { value: 2, label: "M" }, { value: 3, label: "X" },
  { value: 4, label: "J" }, { value: 5, label: "V" }, { value: 6, label: "S" }, { value: 7, label: "D" },
]

export function VehicleForm({ open, onClose, worksites, users, equipmentTypes, suppliers, products, editVehicle }: VehicleFormProps) {
  const isEdit = !!editVehicle
  const initialType = equipmentTypes.find((item) => item.id === editVehicle?.equipmentTypeId)
    ?? equipmentTypes.find((item) => item.isActive)
  const [equipmentTypeId, setEquipmentTypeId] = React.useState(initialType?.id ?? "")
  const [meterType, setMeterType] = React.useState(editVehicle?.meterType ?? initialType?.defaultMeterType ?? "none")
  const [performanceUnit, setPerformanceUnit] = React.useState(editVehicle?.performanceUnit ?? initialType?.defaultPerformanceUnit ?? "not_applicable")
  const selectedProductIds = React.useMemo(() => new Set(editVehicle?.compatibleProductIds ?? []), [editVehicle?.compatibleProductIds])

  function changeEquipmentType(id: string) {
    setEquipmentTypeId(id)
    const selected = equipmentTypes.find((item) => item.id === id)
    if (!selected) return
    setMeterType(selected.defaultMeterType)
    setPerformanceUnit(selected.defaultPerformanceUnit)
  }

  return (
    <CatalogFormSheet
      open={open}
      onClose={onClose}
      isEdit={isEdit}
      entityId={editVehicle?.id}
      title={isEdit ? "Editar vehículo" : "Nuevo vehículo"}
      description={isEdit ? `Modificar ${editVehicle.plate}` : "Registra un nuevo vehículo en el catálogo"}
      create={createFuelVehicleAction}
      update={updateFuelVehicleAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear vehículo"}
      submittingLabel={isEdit ? "Guardando..." : "Creando..."}
      successMessage={isEdit ? "Vehículo actualizado" : "Vehículo creado"}
    >
      {(state) => (
            <Tabs defaultValue="general">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="combustible">Combustible</TabsTrigger>
                <TabsTrigger value="estado">Estado y vigencias</TabsTrigger>
                {isEdit && <TabsTrigger value="documentos">Documentos</TabsTrigger>}
              </TabsList>

              {/* ── General tab ── */}
              <TabsContent value="general">
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Patente" htmlFor="v-plate" required error={state.fieldErrors?.plate?.[0]}>
                      <Input id="v-plate" name="plate" defaultValue={editVehicle?.plate ?? ""} placeholder="XX-XX-00" error={!!state.fieldErrors?.plate} />
                    </Field>
                    <Field label="Código interno" htmlFor="v-code">
                      <Input id="v-code" name="code" defaultValue={editVehicle?.code ?? ""} placeholder="Ej. KA-63" />
                    </Field>
                  </div>

                  <Field label="Tipo de equipo" htmlFor="v-equipment-type" required error={state.fieldErrors?.equipmentTypeId?.[0]}>
                    <Select name="equipmentTypeId" value={equipmentTypeId} onValueChange={changeEquipmentType}>
                      <SelectTrigger id="v-equipment-type" error={!!state.fieldErrors?.equipmentTypeId}><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {equipmentTypes.map((item) => (
                          <SelectItem key={item.id} value={item.id} disabled={!item.isActive && item.id !== editVehicle?.equipmentTypeId}>
                            {item.name} · {FUEL_EQUIPMENT_CATEGORY_LABELS[item.category as keyof typeof FUEL_EQUIPMENT_CATEGORY_LABELS] ?? item.category}{!item.isActive ? " (inactivo)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Marca" htmlFor="v-brand">
                      <Input id="v-brand" name="brand" defaultValue={editVehicle?.brand ?? ""} />
                    </Field>
                    <Field label="Modelo" htmlFor="v-model">
                      <Input id="v-model" name="model" defaultValue={editVehicle?.model ?? ""} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Año" htmlFor="v-year">
                      <Input id="v-year" name="year" type="number" min="1990" max="2030" defaultValue={editVehicle?.year?.toString() ?? ""} />
                    </Field>
                    <Field label="Faena asignada" htmlFor="v-worksite" required error={state.fieldErrors?.worksiteId?.[0]}>
                      <Select name="worksiteId" defaultValue={editVehicle?.worksiteId ?? undefined}>
                        <SelectTrigger id="v-worksite" error={!!state.fieldErrors?.worksiteId}><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                        <SelectContent>
                          {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="combustible">
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Tipo de medidor" htmlFor="v-meter" required error={state.fieldErrors?.meterType?.[0]}>
                      <Select name="meterType" value={meterType} onValueChange={setMeterType}>
                        <SelectTrigger id="v-meter" error={!!state.fieldErrors?.meterType}><SelectValue /></SelectTrigger>
                        <SelectContent>{FUEL_METER_TYPES.map((item) => <SelectItem key={item} value={item}>{FUEL_METER_TYPE_LABELS[item]}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                    <Field label="Unidad de rendimiento" htmlFor="v-performance" required error={state.fieldErrors?.performanceUnit?.[0]}>
                      <Select name="performanceUnit" value={performanceUnit} onValueChange={setPerformanceUnit}>
                        <SelectTrigger id="v-performance" error={!!state.fieldErrors?.performanceUnit}><SelectValue /></SelectTrigger>
                        <SelectContent>{FUEL_PERFORMANCE_UNITS.map((item) => <SelectItem key={item} value={item}>{FUEL_PERFORMANCE_UNIT_LABELS[item]}</SelectItem>)}</SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Capacidad de estanque (L)" htmlFor="v-capacity" error={state.fieldErrors?.tankCapacityLiters?.[0]}>
                      <Input id="v-capacity" name="tankCapacityLiters" type="number" min="0.01" step="0.01" defaultValue={editVehicle?.tankCapacityLiters ?? ""} error={!!state.fieldErrors?.tankCapacityLiters} />
                    </Field>
                    <Field label="Grupo comparable" htmlFor="v-comparison" helper="Ej.: camiones 6x4 faena forestal.">
                      <Input id="v-comparison" name="comparisonGroup" defaultValue={editVehicle?.comparisonGroup ?? ""} />
                    </Field>
                  </div>
                  <Field label="Proveedor habitual" htmlFor="v-usual-supplier">
                    <Select name="usualFuelSupplierId" defaultValue={editVehicle?.usualFuelSupplierId ?? undefined}>
                      <SelectTrigger id="v-usual-supplier"><SelectValue placeholder="Sin proveedor habitual" /></SelectTrigger>
                      <SelectContent>{suppliers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                  <fieldset className="space-y-2 border-t border-[var(--color-border)] pt-4">
                    <legend className="text-sm font-medium text-[var(--color-text)]">Productos compatibles</legend>
                    <p className="text-xs text-[var(--color-text-muted)]">TAE sólo permitirá registrar productos habilitados para este equipo.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {products.map((product) => <label key={product.id} className="flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"><input type="checkbox" name="compatibleProductIds" value={product.id} defaultChecked={editVehicle ? selectedProductIds.has(product.id) : product.id === "fuel-diesel"} disabled={!product.isActive && !selectedProductIds.has(product.id)} />{product.name}</label>)}
                    </div>
                  </fieldset>
                  <fieldset className="space-y-3 border-t border-[var(--color-border)] pt-4">
                    <legend className="text-sm font-medium text-[var(--color-text)]">Horario operativo habitual</legend>
                    <div className="flex flex-wrap gap-2">
                      {DAYS.map((day) => (
                        <label key={day.value} className="flex h-9 w-9 cursor-pointer items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium has-[:checked]:border-[var(--color-primary)] has-[:checked]:bg-[var(--color-primary-tint)] has-[:checked]:text-[var(--color-primary-ink)]">
                          <input className="sr-only" type="checkbox" name="operatingDays" value={day.value} defaultChecked={editVehicle?.operatingSchedule?.days.includes(day.value)} />
                          {day.label}
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Desde" htmlFor="v-operating-start" error={state.fieldErrors?.operatingStart?.[0]}>
                        <Input id="v-operating-start" name="operatingStart" type="time" defaultValue={editVehicle?.operatingSchedule?.start ?? ""} error={!!state.fieldErrors?.operatingStart} />
                      </Field>
                      <Field label="Hasta" htmlFor="v-operating-end">
                        <Input id="v-operating-end" name="operatingEnd" type="time" defaultValue={editVehicle?.operatingSchedule?.end ?? ""} />
                      </Field>
                    </div>
                    <input type="hidden" name="operatingTimezone" value={editVehicle?.operatingSchedule?.timezone ?? "America/Santiago"} />
                  </fieldset>
                </FieldGroup>
              </TabsContent>

              {/* ── Estado y vigencias tab ── */}
              <TabsContent value="estado">
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Estado operacional" htmlFor="v-status">
                      <Select name="operationalStatus" defaultValue={editVehicle?.operationalStatus}>
                        <SelectTrigger id="v-status"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                        <SelectContent>
                          {FUEL_VEHICLE_STATUSES.map((s) => <SelectItem key={s} value={s}>{FUEL_VEHICLE_STATUS_LABELS[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Responsable" htmlFor="v-responsible">
                      <Select name="responsibleUserId" defaultValue={editVehicle?.responsibleUserId ?? undefined}>
                        <SelectTrigger id="v-responsible"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                        <SelectContent>
                          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>

                  {isEdit && (
                    <Field label="Motivo del cambio de estado" htmlFor="v-status-reason" error={state.fieldErrors?.operationalStatusReason?.[0]}>
                      <Textarea
                        id="v-status-reason"
                        name="operationalStatusReason"
                        placeholder="Obligatorio cuando el estado operacional cambia"
                        rows={2}
                        error={!!state.fieldErrors?.operationalStatusReason}
                      />
                    </Field>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vencimiento SOAP" htmlFor="v-soap">
                      <DatePicker id="v-soap" name="soapExpiresAt" defaultValue={editVehicle?.soapExpiresAt ?? ""} />
                    </Field>
                    <Field label="Vencimiento revisión técnica" htmlFor="v-tech">
                      <DatePicker id="v-tech" name="technicalReviewExpiresAt" defaultValue={editVehicle?.technicalReviewExpiresAt ?? ""} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vencimiento permiso de circulación" htmlFor="v-circ">
                      <DatePicker id="v-circ" name="circulationPermitExpiresAt" defaultValue={editVehicle?.circulationPermitExpiresAt ?? ""} />
                    </Field>
                    <Field label="Vencimiento seguro" htmlFor="v-ins-exp">
                      <DatePicker id="v-ins-exp" name="insuranceExpiresAt" defaultValue={editVehicle?.insuranceExpiresAt ?? ""} />
                    </Field>
                  </div>

                  <Field label="N° de póliza de seguro" htmlFor="v-policy">
                    <Input id="v-policy" name="insurancePolicyNumber" defaultValue={editVehicle?.insurancePolicyNumber ?? ""} />
                  </Field>

                  <Field label="Notas" htmlFor="v-notes">
                    <Textarea id="v-notes" name="notes" defaultValue={editVehicle?.notes ?? ""} placeholder="Observaciones..." rows={2} />
                  </Field>
                </FieldGroup>
              </TabsContent>

              {/* ── Documentos tab ── */}
              {isEdit && (
                <TabsContent value="documentos">
                  <p className="text-sm text-text-muted mb-4">
                    Los documentos del vehículo (SOAP, revisión técnica, seguro, etc.) se suben y revisan desde su
                    ficha operacional en Flota, para no duplicar ese flujo aquí.
                  </p>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/flota/${editVehicle.id}`}>Ir a la ficha del vehículo</Link>
                  </Button>
                </TabsContent>
              )}
            </Tabs>
      )}
    </CatalogFormSheet>
  )
}
