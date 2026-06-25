"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

interface VehicleRow {
  id: string
  plate: string
  type: string
  brand: string | null
  model: string | null
  year: number | null
  isActive: boolean
  worksite: { name: string } | null
}

export function VehicleCatalogTable({ vehicles }: { vehicles: VehicleRow[] }) {
  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patente</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Marca</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Año</TableHead>
            <TableHead>Faena asignada</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vehicles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No hay vehículos registrados
              </TableCell>
            </TableRow>
          ) : (
            vehicles.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-semibold">{v.plate}</TableCell>
                <TableCell className="capitalize">{v.type}</TableCell>
                <TableCell>{v.brand ?? "—"}</TableCell>
                <TableCell>{v.model ?? "—"}</TableCell>
                <TableCell>{v.year ?? "—"}</TableCell>
                <TableCell>{v.worksite?.name ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={v.isActive ? "success" : "default"}>
                    {v.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
