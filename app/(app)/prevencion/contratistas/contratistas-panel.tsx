"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { Contractor, ContractorWorker, ContractorDocument } from "@/db/schema"
import { ContratistasList } from "./contratistas-list"
import { ContractorForm } from "./contractor-form"

interface Props {
  contractors: Contractor[]
  workers: ContractorWorker[]
  documents: ContractorDocument[]
  availableWorkers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  expiringDocumentIds: Set<string>
  canManage: boolean
}

export function ContratistasPanel({ contractors, workers, documents, availableWorkers, expiringDocumentIds, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Contratistas"
        description="Padrón de contratistas, trabajadores y documentación habilitante (N° 20 PDTP, Ley 20.123)"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Contratistas" }]} />}
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/contratistas/export" label="Exportar contratistas" />
            {canManage ? (
              <Button size="sm" onClick={() => setShowForm((s) => !s)}>
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nuevo contratista"}
              </Button>
            ) : null}
          </>
        }
      />
      {canManage && showForm ? (
        <ContractorForm onDone={() => setShowForm(false)} />
      ) : null}
      <ContratistasList
        contractors={contractors}
        workers={workers}
        documents={documents}
        availableWorkers={availableWorkers}
        expiringDocumentIds={expiringDocumentIds}
        canManage={canManage}
      />
    </>
  )
}
