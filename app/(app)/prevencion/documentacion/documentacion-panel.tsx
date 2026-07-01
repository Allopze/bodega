"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { LegalDocument, LegalDocumentVersion, DocumentDelivery } from "@/db/schema"
import { DocumentacionList } from "./documentacion-list"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
  rut: string | null
}

interface EnrichedDelivery extends DocumentDelivery {
  worker: Omit<WorkerSummary, "id"> | null
}

interface Props {
  documents: LegalDocument[]
  versions: LegalDocumentVersion[]
  deliveries: EnrichedDelivery[]
  activeWorkers: WorkerSummary[]
  canManage: boolean
  canSign: boolean
}

export function DocumentacionPanel({ documents, versions, deliveries, activeWorkers, canManage, canSign }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Documentación legal"
        description="RIOHS, ODI, IRL, carpetas de arranque y programas (N° 15, 18, 19 PDTP)"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Documentación" },
          ]} />
        }
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/documentacion/export" label="Exportar docs" />
            {canManage ? (
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nuevo registro"}
              </Button>
            ) : null}
          </>
        }
      />
      <DocumentacionList
        documents={documents}
        versions={versions}
        deliveries={deliveries}
        activeWorkers={activeWorkers}
        canManage={canManage}
        canSign={canSign}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  )
}
