"use client"

import * as React from "react"
import { Plus, PencilSimple, Power } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/lib/toast"
import { FUEL_EQUIPMENT_CATEGORY_LABELS, FUEL_METER_TYPE_LABELS, FUEL_PERFORMANCE_UNIT_LABELS } from "@/lib/combustibles/validation"
import { setFuelEquipmentTypeStatusAction } from "./actions"
import { EquipmentTypeForm, type EquipmentTypeRow } from "./equipment-type-form"

export function EquipmentTypeCatalog({ rows }: { rows: EquipmentTypeRow[] }) {
  const [editRow, setEditRow] = React.useState<EquipmentTypeRow | null>(null)
  const [open, setOpen] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  function create() { setEditRow(null); setOpen(true) }
  function edit(row: EquipmentTypeRow) { setEditRow(row); setOpen(true) }
  function close() { setOpen(false); setEditRow(null) }

  async function toggle(row: EquipmentTypeRow) {
    setPendingId(row.id)
    const result = await setFuelEquipmentTypeStatusAction(row.id, !row.isActive)
    if (result.ok) toast.success(result.message ?? "Estado actualizado")
    else toast.error(result.message ?? "No se pudo cambiar el estado")
    setPendingId(null)
  }

  return <>
    <div className="mb-3 flex justify-end"><Button size="sm" onClick={create}><Plus size={15} />Nuevo tipo</Button></div>
    <div className="overflow-x-auto border border-[var(--color-border)]">
      <Table className="min-w-[880px]">
        <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Familia</TableHead><TableHead>Medidor</TableHead><TableHead>Rendimiento</TableHead><TableHead>Equipos</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
        <TableBody>{rows.length === 0 ? <TableRow><TableCell colSpan={7} className="py-10 text-center text-[var(--color-text-muted)]">No hay tipos de equipo configurados.</TableCell></TableRow> : rows.map((row) => <TableRow key={row.id}>
          <TableCell><span className="font-medium">{row.name}</span><span className="block font-mono text-xs text-[var(--color-text-muted)]">{row.slug}</span></TableCell>
          <TableCell>{FUEL_EQUIPMENT_CATEGORY_LABELS[row.category as keyof typeof FUEL_EQUIPMENT_CATEGORY_LABELS] ?? row.category}</TableCell>
          <TableCell>{FUEL_METER_TYPE_LABELS[row.defaultMeterType as keyof typeof FUEL_METER_TYPE_LABELS] ?? row.defaultMeterType}</TableCell>
          <TableCell>{FUEL_PERFORMANCE_UNIT_LABELS[row.defaultPerformanceUnit as keyof typeof FUEL_PERFORMANCE_UNIT_LABELS] ?? row.defaultPerformanceUnit}</TableCell>
          <TableCell className="font-mono">{row.vehicleCount.toLocaleString("es-CL")}</TableCell>
          <TableCell><Badge variant={row.isActive ? "success" : "default"}>{row.isActive ? "Activo" : "Inactivo"}</Badge></TableCell>
          <TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => edit(row)}><PencilSimple size={15} />Editar</Button><Button size="sm" variant="secondary" disabled={pendingId === row.id} onClick={() => toggle(row)}><Power size={15} />{row.isActive ? "Desactivar" : "Activar"}</Button></div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <EquipmentTypeForm key={editRow?.id ?? "new"} open={open} onClose={close} editRow={editRow} />
  </>
}
