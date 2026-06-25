"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"

interface SupplierRow {
  id: string
  name: string
  rut: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  isActive: boolean
}

export function SupplierCatalogTable({ suppliers }: { suppliers: SupplierRow[] }) {
  return (
    <div className="border rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>RUT</TableHead>
            <TableHead>Contacto</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                No hay proveedores de combustible registrados
              </TableCell>
            </TableRow>
          ) : (
            suppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-semibold">{s.name}</TableCell>
                <TableCell className="font-mono text-sm">{s.rut ?? "—"}</TableCell>
                <TableCell>{s.contactName ?? "—"}</TableCell>
                <TableCell>{s.contactPhone ?? "—"}</TableCell>
                <TableCell>{s.contactEmail ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={s.isActive ? "success" : "default"}>
                    {s.isActive ? "Activo" : "Inactivo"}
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
