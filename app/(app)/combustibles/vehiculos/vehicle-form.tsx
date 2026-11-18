"use client"

import * as React from "react"
import Link from "next/link"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ClearableDatePicker } from "@/components/ui/clearable-date-picker"
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
import { vehicleFichaHref } from "@/lib/routing/vehicle-ficha"
import { TransferButton } from "@/components/fleet/transfer/transfer-button"
import { maintenanceTypeBlock, type PadronBrandOption, type PadronMaintenance } from "@/lib/mantencion/padron-identity"

export type VehicleForEdit = {
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
  serialNumber: string | null
  worksiteId: string | null
  responsibleUserId: string | null
  operationalStatus: string
  soapExpiresAt: string | null
  technicalReviewExpiresAt: string | null
  circulationPermitExpiresAt: string | null
  insurancePolicyNumber: string | null
  insuranceExpiresAt: string | null
  notes: string | null
  /** Si está en Mantención: sus reglas de identidad (crítica 2026-11-15, paso 4b). `null` u omitido = no está. */
  maintenance?: PadronMaintenance | null
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
  /** Marcas de la lista de Mantención; sólo hacen falta si el vehículo editado está en Mantención. */
  maintenanceBrands?: PadronBrandOption[]
  /** Quien edita puede trasladar equipos (`flota:transfer` y submódulo activo): la faena de un equipo existente sólo cambia por ahí. */
  canTransfer?: boolean
}

const DAYS = [
  { value: 1, label: "L" }, { value: 2, label: "M" }, { value: 3, label: "X" },
  { value: 4, label: "J" }, { value: 5, label: "V" }, { value: 6, label: "S" }, { value: 7, label: "D" },
]

const EXPIRY_FIELDS = [
  { name: "soapExpiresAt", id: "v-soap", label: "Vencimiento SOAP", short: "SOAP" },
  { name: "technicalReviewExpiresAt", id: "v-tech", label: "Vencimiento revisión técnica", short: "revisión técnica" },
  { name: "circulationPermitExpiresAt", id: "v-circ", label: "Vencimiento permiso de circulación", short: "permiso de circulación" },
  { name: "insuranceExpiresAt", id: "v-ins-exp", label: "Vencimiento seguro", short: "seguro" },
] as const

/**
 * Las cuatro fechas de vencimiento. Cada una puede quedar vacía: «Quitar fecha»
 * hace viajar el campo vacío y el servidor lo guarda como `null`.
 *
 * El estado vive aquí y no en `VehicleForm` para que se reinicie con el sheet:
 * en `VehicleForm` sobrevivía al cierre y mostraba, al reabrir, cambios que se
 * habían cancelado.
 */
function VehicleExpiryFields({ vehicle, errors }: { vehicle?: VehicleForEdit | null; errors?: Record<string, string[]> }) {
  const [values, setValues] = React.useState<Record<(typeof EXPIRY_FIELDS)[number]["name"], string>>({
    soapExpiresAt: vehicle?.soapExpiresAt ?? "",
    technicalReviewExpiresAt: vehicle?.technicalReviewExpiresAt ?? "",
    circulationPermitExpiresAt: vehicle?.circulationPermitExpiresAt ?? "",
    insuranceExpiresAt: vehicle?.insuranceExpiresAt ?? "",
  })
  return (
    <div className="grid grid-cols-2 gap-4">
      {EXPIRY_FIELDS.map((field) => (
        <Field key={field.name} label={field.label} htmlFor={field.id} error={errors?.[field.name]?.[0]}>
          <ClearableDatePicker
            id={field.id}
            name={field.name}
            value={values[field.name]}
            onChange={(iso) => setValues((current) => ({ ...current, [field.name]: iso }))}
            error={!!errors?.[field.name]}
            // El nombre accesible del selector incluye el campo; sin él solo diría la fecha elegida.
            ariaLabel={field.label}
            clearAriaLabel={`Quitar fecha de ${field.short}`}
          />
        </Field>
      ))}
    </div>
  )
}

type VehicleFormTab = "general" | "combustible" | "estado" | "documentos"

/** Qué campos viven en cada pestaña: un error se busca en la suya. */
const TAB_FIELDS: Record<Exclude<VehicleFormTab, "documentos">, readonly string[]> = {
  general: ["plate", "code", "noPlate", "equipmentTypeId", "brand", "brandId", "model", "year", "serialNumber", "worksiteId"],
  combustible: ["meterType", "performanceUnit", "tankCapacityLiters", "comparisonGroup", "usualFuelSupplierId", "compatibleProductIds", "operatingDays", "operatingStart", "operatingEnd"],
  estado: ["operationalStatus", "operationalStatusReason", "responsibleUserId", "soapExpiresAt", "technicalReviewExpiresAt", "circulationPermitExpiresAt", "insurancePolicyNumber", "insuranceExpiresAt", "notes"],
}
const TAB_ORDER = ["general", "combustible", "estado"] as const

function tabsWithErrors(errors?: Record<string, string[] | undefined>): Set<VehicleFormTab> {
  const withErrors = new Set<VehicleFormTab>()
  for (const tab of TAB_ORDER) if (TAB_FIELDS[tab].some((field) => errors?.[field]?.length)) withErrors.add(tab)
  return withErrors
}

/**
 * Las pestañas del formulario. Un error no queda escondido en otra pestaña: al volver el
 * guardado con errores, se abre la primera pestaña que los tiene y las que tienen alguno lo
 * marcan. Pasaba al editar desde la ficha (crítica 2026-11-15, paso 4b): quien corregía un modelo
 * en «General» sólo leía «Revisa los datos», y lo que faltaba eran los productos compatibles, en
 * «Combustible».
 */
function VehicleFormTabs({ errors, isEdit, children }: { errors?: Record<string, string[] | undefined>; isEdit: boolean; children: React.ReactNode }) {
  const [tab, setTab] = React.useState<VehicleFormTab>("general")
  const [seenErrors, setSeenErrors] = React.useState(errors)
  const withErrors = tabsWithErrors(errors)
  // Ajuste durante el render (no en un efecto): sólo cuando llega un resultado nuevo, así que
  // después la persona puede moverse entre pestañas sin que la devuelvan.
  if (errors !== seenErrors) {
    setSeenErrors(errors)
    const first = TAB_ORDER.find((item) => withErrors.has(item))
    if (first && !withErrors.has(tab)) setTab(first)
  }
  const labels: Record<VehicleFormTab, string> = { general: "General", combustible: "Combustible", estado: "Estado y vigencias", documentos: "Documentos" }
  const tabs: VehicleFormTab[] = isEdit ? [...TAB_ORDER, "documentos"] : [...TAB_ORDER]
  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as VehicleFormTab)} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mb-4 w-full shrink-0">
        {tabs.map((item) => (
          <TabsTrigger key={item} value={item}>
            {labels[item]}
            {withErrors.has(item) ? (
              <>
                <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-[var(--color-danger)]" />
                <span className="sr-only"> (con errores)</span>
              </>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}

/** N.º de serie (PIN): vincula la telemetría de VisionLink. Igual con o sin Mantención. */
function SerialField({ vehicle, error }: { vehicle?: VehicleForEdit | null; error?: string }) {
  return (
    <Field label="N.º de serie (PIN)" htmlFor="v-serial" hint="Vincula la telemetría de VisionLink" error={error}>
      <Input id="v-serial" name="serialNumber" defaultValue={vehicle?.serialNumber ?? ""} placeholder="Ej. DKJ30153" autoCapitalize="characters" error={!!error} />
    </Field>
  )
}

/**
 * La pestaña «General» de un vehículo que está en Mantención (crítica 2026-11-15, paso 4b). La
 * identidad se edita sólo aquí, con las reglas de Mantención: código obligatorio, patente o «Sin
 * patente» (la patente pasa a ser el código), tipo medido en km u horas que no cambia de unidad
 * si ya tiene registros o pauta, y marca de la lista cerrada, de la que dependen las reglas de
 * las pautas. La marca y «Sin patente» son del perfil: sin `mant:equipment:manage` se ven, no se
 * cambian (el servidor conserva las actuales). Cada cambio queda en el historial del equipo.
 */
function MaintenanceIdentityFields({
  vehicle,
  maintenance,
  brands,
  equipmentTypes,
  equipmentTypeId,
  onEquipmentTypeChange,
  worksites,
  canTransfer,
  errors,
}: {
  vehicle: VehicleForEdit
  maintenance: PadronMaintenance
  brands: PadronBrandOption[]
  equipmentTypes: VehicleFormProps["equipmentTypes"]
  equipmentTypeId: string
  onEquipmentTypeChange: (id: string) => void
  worksites: VehicleFormProps["worksites"]
  canTransfer: boolean
  errors?: Record<string, string[] | undefined>
}) {
  const [noPlate, setNoPlate] = React.useState(maintenance.noPlate)
  const [code, setCode] = React.useState(vehicle.code ?? "")
  const brandOptions = brands.filter((brand) => brand.isActive || brand.id === maintenance.brandId)
  const typeHelper = maintenance.unitFixedBy?.kind === "registros"
    ? `Se mide en ${maintenance.unit === "km" ? "kilómetros" : "horas"}: no puede pasar a un tipo de otra unidad porque ya tiene registros de mantención.`
    : maintenance.unitFixedBy?.kind === "pauta"
      ? `Se mide en ${maintenance.unit === "km" ? "kilómetros" : "horas"}: para pasarlo a otra unidad, quita primero su pauta «${maintenance.unitFixedBy.scheduleName}» en la pestaña Mantención.`
      : "Sólo tipos que se miden en kilómetros u horas: los demás no pueden estar en Mantención."
  const profileHint = maintenance.canChangeProfile ? undefined : "La cambia quien administra los equipos de Mantención."
  return (
    <FieldGroup className="gap-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        Está en Mantención: estos datos siguen sus reglas y cada cambio queda en el historial del equipo.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Código interno" htmlFor="v-code" required error={errors?.code?.[0]} hint="Así lo nombran la ficha y la app del mecánico.">
          <Input id="v-code" name="code" className="font-mono" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ej. KA-63" autoComplete="off" error={!!errors?.code} />
        </Field>
        <div>
          <Field
            label="Patente"
            htmlFor="v-plate"
            required={!noPlate}
            error={errors?.plate?.[0]}
            hint={noPlate ? "Sin patente: la patente es el código interno." : "Formato ABCD-12 o AB-1234."}
          >
            {noPlate
              ? <Input id="v-plate" className="font-mono" value={code.toUpperCase().replace(/\s+/g, "")} disabled readOnly />
              : <Input id="v-plate" name="plate" className="font-mono" defaultValue={maintenance.noPlate ? "" : vehicle.plate} placeholder="ABCD-12" autoComplete="off" error={!!errors?.plate} />}
          </Field>
          <div className="mt-2">
            <Checkbox
              id="v-no-plate"
              label="Sin patente"
              checked={noPlate}
              disabled={!maintenance.canChangeProfile}
              onChange={(event) => setNoPlate(event.target.checked)}
            />
            <input type="hidden" name="noPlate" value={noPlate ? "1" : "0"} />
          </div>
        </div>
      </div>

      <Field label="Tipo de equipo" htmlFor="v-equipment-type" required error={errors?.equipmentTypeId?.[0]} hint={typeHelper}>
        <Select name="equipmentTypeId" value={equipmentTypeId} onValueChange={onEquipmentTypeChange}>
          <SelectTrigger id="v-equipment-type" error={!!errors?.equipmentTypeId}><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {equipmentTypes.map((item) => {
              const block = item.id === vehicle.equipmentTypeId ? null : maintenanceTypeBlock(maintenance, item.defaultMeterType)
              return (
                <SelectItem key={item.id} value={item.id} disabled={(!item.isActive && item.id !== vehicle.equipmentTypeId) || !!block}>
                  {item.name} · {FUEL_EQUIPMENT_CATEGORY_LABELS[item.category as keyof typeof FUEL_EQUIPMENT_CATEGORY_LABELS] ?? item.category}
                  {!item.isActive ? " (inactivo)" : block ? ` (${block})` : ""}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Marca" htmlFor="v-brand" required error={errors?.brandId?.[0]} hint={profileHint ?? "De la lista de Mantención: las reglas de las pautas dependen de ella."}>
          <Select name="brandId" defaultValue={maintenance.brandId} disabled={!maintenance.canChangeProfile}>
            <SelectTrigger id="v-brand" error={!!errors?.brandId}><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {brandOptions.map((brand) => <SelectItem key={brand.id} value={brand.id}>{brand.name}{brand.isActive ? "" : " (inactiva)"}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Modelo" htmlFor="v-model" error={errors?.model?.[0]}>
          <Input id="v-model" name="model" defaultValue={vehicle.model ?? ""} error={!!errors?.model} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Año" htmlFor="v-year" error={errors?.year?.[0]}>
          <Input id="v-year" name="year" type="number" min="1990" max="2030" defaultValue={vehicle.year?.toString() ?? ""} error={!!errors?.year} />
        </Field>
        <SerialField vehicle={vehicle} error={errors?.serialNumber?.[0]} />
      </div>

      <WorksiteField vehicle={vehicle} worksites={worksites} error={errors?.worksiteId?.[0]} canTransfer={canTransfer} />
    </FieldGroup>
  )
}

/**
 * Faena del equipo. En el alta se elige; en un equipo existente es de sólo lectura (sólo el nombre; no se
 * envía en el formulario: tras un traslado con la hoja abierta el valor sería viejo y el servidor
 * ignora la faena al editar): la faena sólo cambia por «Trasladar equipos», que deja folio, fecha y
 * motivo. Quien no puede trasladar ve el nombre sin botón.
 */
function WorksiteField({ vehicle, worksites, error, canTransfer }: {
  vehicle?: VehicleForEdit | null
  worksites: VehicleFormProps["worksites"]
  error?: string
  canTransfer: boolean
}) {
  if (!vehicle) {
    return (
      <Field label="Faena asignada" htmlFor="v-worksite" required error={error}>
        <Select name="worksiteId">
          <SelectTrigger id="v-worksite" error={!!error}><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {worksites.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    )
  }
  const name = worksites.find((w) => w.id === vehicle.worksiteId)?.name ?? "Faena actual"
  return (
    <Field label="Faena asignada" error={error}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--color-text)]">{name}</span>
        {canTransfer && <TransferButton initialVehicleId={vehicle.id} label="Trasladar" variant="ghost" />}
      </div>
    </Field>
  )
}

export function VehicleForm({ open, onClose, worksites, users, equipmentTypes, suppliers, products, editVehicle, maintenanceBrands = [], canTransfer = false }: VehicleFormProps) {
  const isEdit = !!editVehicle
  const maintenance = editVehicle?.maintenance ?? null
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
      // Se nombra como en la ficha: por su código y, sin él, por la patente.
      description={isEdit ? `Modificar ${editVehicle.code?.trim() || editVehicle.plate}` : "Registra un nuevo vehículo en el catálogo"}
      create={createFuelVehicleAction}
      update={updateFuelVehicleAction}
      submitLabel={isEdit ? "Guardar cambios" : "Crear vehículo"}
      submittingLabel={isEdit ? "Guardando..." : "Creando..."}
      successMessage={isEdit ? "Vehículo actualizado" : "Vehículo creado"}
      // El sheet mide lo que mide la pestaña activa: sin alto fijo, pasar de
      // «Documentos» a «Combustible» estiraba la caja ~600 px (reportado el
      // 2026-10-29). El cuerpo scrollea y la tira de pestañas queda fija.
      stableHeight
      bodyClassName="flex min-h-0 flex-col overflow-hidden"
    >
      {(state) => (
            <VehicleFormTabs errors={state.fieldErrors} isEdit={isEdit}>

              {/* Sólo el panel scrollea: con el `SheetBody` en `overflow-hidden`,
                  la tira queda siempre a la vista mientras se recorre el formulario. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
              {/* ── General tab ── */}
              <TabsContent value="general" forceMount>
                {maintenance ? (
                  <MaintenanceIdentityFields
                    vehicle={editVehicle!}
                    maintenance={maintenance}
                    brands={maintenanceBrands}
                    equipmentTypes={equipmentTypes}
                    equipmentTypeId={equipmentTypeId}
                    onEquipmentTypeChange={changeEquipmentType}
                    worksites={worksites}
                    canTransfer={canTransfer}
                    errors={state.fieldErrors}
                  />
                ) : (
                <FieldGroup className="gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Patente" htmlFor="v-plate" required error={state.fieldErrors?.plate?.[0]}>
                      <Input id="v-plate" name="plate" defaultValue={editVehicle?.plate ?? ""} placeholder="XX-XX-00" error={!!state.fieldErrors?.plate} />
                    </Field>
                    <Field label="Código interno" htmlFor="v-code" error={state.fieldErrors?.code?.[0]}>
                      <Input id="v-code" name="code" defaultValue={editVehicle?.code ?? ""} placeholder="Ej. KA-63" error={!!state.fieldErrors?.code} />
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
                    <Field label="Modelo" htmlFor="v-model" error={state.fieldErrors?.model?.[0]}>
                      <Input id="v-model" name="model" defaultValue={editVehicle?.model ?? ""} error={!!state.fieldErrors?.model} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Año" htmlFor="v-year" error={state.fieldErrors?.year?.[0]}>
                      <Input id="v-year" name="year" type="number" min="1990" max="2030" defaultValue={editVehicle?.year?.toString() ?? ""} error={!!state.fieldErrors?.year} />
                    </Field>
                    <SerialField vehicle={editVehicle} error={state.fieldErrors?.serialNumber?.[0]} />
                  </div>

                  <WorksiteField vehicle={editVehicle} worksites={worksites} error={state.fieldErrors?.worksiteId?.[0]} canTransfer={canTransfer} />
                </FieldGroup>
                )}
              </TabsContent>

              <TabsContent value="combustible" forceMount>
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
                  {/* Sin `key` en la edición: ahí los marcados son los guardados. En el alta, cambiar entre un
                      equipo con medidor y uno sin él reaplica el valor por defecto (diésel marcado o nada). */}
                  <fieldset key={isEdit ? "edicion" : meterType === "none" ? "alta-sin-medidor" : "alta-con-medidor"} className="space-y-2 border-t border-[var(--color-border)] pt-4" aria-describedby="v-products-help">
                    <legend className="text-sm font-medium text-[var(--color-text)]">
                      Productos compatibles{meterType === "none" ? " (opcional)" : ""}
                    </legend>
                    <p id="v-products-help" className="text-xs text-[var(--color-text-muted)]">
                      {meterType === "none"
                        ? "Un equipo sin medidor (carro, batea) no carga combustible: puedes dejarlo sin productos."
                        : "TAE sólo permitirá registrar productos habilitados para este equipo. Selecciona al menos uno."}
                    </p>
                    {state.fieldErrors?.compatibleProductIds?.[0] && (
                      <p className="text-xs text-[var(--color-danger)]" role="alert">{state.fieldErrors.compatibleProductIds[0]}</p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {products.map((product) => <div key={product.id} className="border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"><Checkbox name="compatibleProductIds" value={product.id} defaultChecked={editVehicle ? selectedProductIds.has(product.id) : meterType !== "none" && product.id === "fuel-diesel"} disabled={!product.isActive && !selectedProductIds.has(product.id)} label={product.name} /></div>)}
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
              <TabsContent value="estado" forceMount>
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

                  <VehicleExpiryFields vehicle={editVehicle} errors={state.fieldErrors} />

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
                <TabsContent value="documentos" forceMount>
                  <p className="text-sm text-text-muted mb-4">
                    Los documentos del vehículo (SOAP, revisión técnica, seguro, etc.) se suben y revisan desde su
                    ficha operacional en Flota, para no duplicar ese flujo aquí.
                  </p>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={vehicleFichaHref(editVehicle.id)}>Ir a la ficha del vehículo</Link>
                  </Button>
                </TabsContent>
              )}
              </div>
            </VehicleFormTabs>
      )}
    </CatalogFormSheet>
  )
}
