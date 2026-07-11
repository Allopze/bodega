"use client"

import * as React from "react"
import Link from "next/link"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { createFuelVehicleAction, updateFuelVehicleAction } from "../actions"
import { FUEL_VEHICLE_TYPES, FUEL_VEHICLE_TYPE_LABELS, FUEL_VEHICLE_STATUSES, FUEL_VEHICLE_STATUS_LABELS, canonicalFuelVehicleType, formatFuelVehicleType } from "@/lib/combustibles/validation"

export interface VehicleForEdit {
  id: string
  plate: string
  code: string | null
  type: string
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
  editVehicle?: VehicleForEdit | null
}

export function VehicleForm({ open, onClose, worksites, users, editVehicle }: VehicleFormProps) {
  const isEdit = !!editVehicle

  // Los tipos del catálogo real no siempre calzan con la lista canónica (hay
  // valores legacy libres). Si el vehículo tiene un tipo fuera de la lista, se
  // agrega como opción para que se pueda ver y conservar al guardar.
  const typeOptions: Array<{ value: string; label: string }> = FUEL_VEHICLE_TYPES.map((t) => ({ value: t, label: FUEL_VEHICLE_TYPE_LABELS[t] }))
  if (editVehicle?.type && !canonicalFuelVehicleType(editVehicle.type)) {
    typeOptions.unshift({ value: editVehicle.type, label: formatFuelVehicleType(editVehicle.type) })
  } else if (editVehicle?.type && !FUEL_VEHICLE_TYPES.includes(editVehicle.type as (typeof FUEL_VEHICLE_TYPES)[number])) {
    typeOptions.unshift({ value: editVehicle.type, label: formatFuelVehicleType(editVehicle.type) })
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

                  <Field label="Tipo" htmlFor="v-type" required>
                    <Select name="type" defaultValue={editVehicle?.type}>
                      <SelectTrigger id="v-type"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {typeOptions.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
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

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vencimiento SOAP" htmlFor="v-soap">
                      <Input id="v-soap" name="soapExpiresAt" type="date" defaultValue={editVehicle?.soapExpiresAt ?? ""} />
                    </Field>
                    <Field label="Vencimiento revisión técnica" htmlFor="v-tech">
                      <Input id="v-tech" name="technicalReviewExpiresAt" type="date" defaultValue={editVehicle?.technicalReviewExpiresAt ?? ""} />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vencimiento permiso de circulación" htmlFor="v-circ">
                      <Input id="v-circ" name="circulationPermitExpiresAt" type="date" defaultValue={editVehicle?.circulationPermitExpiresAt ?? ""} />
                    </Field>
                    <Field label="Vencimiento seguro" htmlFor="v-ins-exp">
                      <Input id="v-ins-exp" name="insuranceExpiresAt" type="date" defaultValue={editVehicle?.insuranceExpiresAt ?? ""} />
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
