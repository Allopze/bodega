"use client"

import { useState } from "react"
import { Plus, DownloadSimple, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SupplierForm } from "./supplier-form"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { importSuppliersFromXlsx } from "./actions"

export function SupplierActions() {
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/admin/catalogos/export?tipo=proveedores"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <DownloadSimple size={14} />Exportar XLSX
      </a>
      <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
        <UploadSimple size={14} />Importar XLSX
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
        title="Importar proveedores desde XLSX"
        description="Importa proveedores exportados desde el catálogo. La columna ID determina si se crea o actualiza."
        action={importSuppliersFromXlsx}
        helperText="Usa el botón Exportar XLSX para obtener la plantilla con los datos actuales."
      />
    </>
  )
}
