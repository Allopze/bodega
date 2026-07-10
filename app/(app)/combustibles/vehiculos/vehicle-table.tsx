"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash } from "@phosphor-icons/react"
import { deleteFuelVehicleAction } from "../actions"
import { EditVehicleDialog } from "./edit-vehicle-dialog"
import { toast } from "@/lib/toast"
import { FUEL_VEHICLE_TYPE_LABELS } from "@/lib/combustibles/validation"

interface VehicleRow {
  id: string
  plate: string
  code: string | null
  type: string
  brand: string | null
  model: string | null
  year: number | null
  worksiteId: string | null
  isActive: boolean
  worksite: { name: string } | null
}

export function VehicleCatalogTable({ vehicles, worksites }: { vehicles: VehicleRow[]; worksites: Array<{ id: string; name: string }> }) {
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (!confirm("¿Desactivar este vehículo?")) return
    setDeleting(id)
    const result = await deleteFuelVehicleAction(id)
    if (result.ok) {
      toast.success(result.message)
    } else {
      toast.error(result.message)
    }
    setDeleting(null)
  }

  return (
    <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <Table className="min-w-[600px]">
        <TableHeader>
          <TableRow>
            <TableHead>Patente</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Año</TableHead>
            <TableHead>Faena asignada</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                No hay vehículos registrados
              </TableCell>
            </TableRow>
          ) : (
            vehicles.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-semibold">{v.plate}</TableCell>
                <TableCell className="font-mono text-sm">{v.code ?? "—"}</TableCell>
                <TableCell>{FUEL_VEHICLE_TYPE_LABELS[v.type as keyof typeof FUEL_VEHICLE_TYPE_LABELS] ?? v.type}</TableCell>
                <TableCell>{v.brand ?? "—"}</TableCell>
                <TableCell>{v.model ?? "—"}</TableCell>
                <TableCell>{v.year ?? "—"}</TableCell>
                <TableCell>{v.worksite?.name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={v.isActive ? "success" : "default"}>
                    {v.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <EditVehicleDialog vehicle={v} worksites={worksites} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(v.id)}
                      disabled={deleting === v.id || !v.isActive}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
