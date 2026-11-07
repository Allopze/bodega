"use client"

import { useState } from "react"
import { Plus, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ExportLink } from "@/components/ui/export-button"
import { SupplierForm } from "./supplier-form"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { importSuppliersFromXlsx } from "./actions"

export function SupplierActions() {
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <ExportLink href="/api/admin/catalogos/export?tipo=proveedores" />
      <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
        <UploadSimple size={14} />Importar Excel
      </Button>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo proveedor
      </Button>
      <SupplierForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editSupplier={null}
      />
      <CatalogImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar proveedores desde Excel"
        description="Importa proveedores exportados desde el catálogo. La columna ID determina si se crea o actualiza."
        action={importSuppliersFromXlsx}
        helperText="Usa el botón Exportar Excel para obtener la plantilla con los datos actuales."
      />
    </>
  )
}
