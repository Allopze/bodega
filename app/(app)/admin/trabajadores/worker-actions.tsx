"use client"

import * as React from "react"
import { Plus, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ExportLink } from "@/components/ui/export-button"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { WorkerForm } from "./worker-form"
import { importWorkersFromXlsx } from "./actions"
import type { SizeFamilyOption } from "@/app/(app)/admin/productos/product-form.types"
import type { WorkerPositionOption } from "@/app/(app)/admin/cargos/types"

interface WorksiteOption { id: string; name: string }

export function WorkerActions({ worksites, sizeFamilies, positions }: { worksites: WorksiteOption[]; sizeFamilies: SizeFamilyOption[]; positions: WorkerPositionOption[] }) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  return (
    <>
      <ExportLink href="/api/admin/catalogos/export?tipo=trabajadores" />
      <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
        <UploadSimple size={14} />Importar Excel
      </Button>
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus size={14} />Nuevo trabajador
      </Button>

      <WorkerForm
        key="nuevo"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editWorker={null}
        worksites={worksites}
        sizeFamilies={sizeFamilies}
        positions={positions}
      />

      <CatalogImportPanel
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar trabajadores desde Excel"
        description="Importa trabajadores exportados desde el catálogo. La columna ID determina si se crea o actualiza."
        action={importWorkersFromXlsx}
        helperText="Usa el botón Exportar Excel para obtener la plantilla con los datos actuales."
      />
    </>
  )
}
