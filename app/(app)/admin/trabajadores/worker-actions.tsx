"use client"

import * as React from "react"
import { DownloadSimple, Plus, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { CatalogImportPanel } from "@/components/admin/catalog-import-panel"
import { WorkerForm } from "./worker-form"
import { importWorkersFromXlsx } from "./actions"
import type { SizeFamilyOption } from "@/app/(app)/admin/productos/product-form.types"

interface WorksiteOption { id: string; name: string }

export function WorkerActions({ worksites, sizeFamilies }: { worksites: WorksiteOption[]; sizeFamilies: SizeFamilyOption[] }) {
  const [formOpen, setFormOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/admin/catalogos/export?tipo=trabajadores"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
      >
        <DownloadSimple size={14} />Exportar Excel
      </a>
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
