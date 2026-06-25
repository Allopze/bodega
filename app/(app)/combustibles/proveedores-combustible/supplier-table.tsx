"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash } from "@phosphor-icons/react"
import { EditSupplierDialog } from "./edit-supplier-dialog"
import { deleteFuelSupplierAction } from "../actions"
import { toast } from "@/lib/toast"

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
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(id: string) {
    if (!confirm("¿Desactivar este proveedor?")) return
    setDeleting(id)
    const result = await deleteFuelSupplierAction(id)
    if (result.ok) toast.success(result.message)
    else toast.error(result.message)
    setDeleting(null)
  }

  return (
    <div className="border rounded-lg overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <Table className="min-w-[600px]">
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>RUT</TableHead>
            <TableHead>Contacto</TableHead>
            <TableHead>Teléfono</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                <TableCell>
                  <div className="flex gap-1">
                    <EditSupplierDialog supplier={s} />
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} disabled={deleting === s.id || !s.isActive}>
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
