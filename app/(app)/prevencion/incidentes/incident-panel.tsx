"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { PreventionIncident } from "@/db/schema"
import { IncidentList } from "./incident-list"

interface WorkerSummary {
  firstName: string
  lastName: string
  rut: string | null
}

interface IncidentRow extends PreventionIncident {
  worker: WorkerSummary | null
}

interface Props {
  incidents: IncidentRow[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  canClose: boolean
}

export function IncidentPanel({ incidents, worksites, canManage, canClose }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Incidentes"
        description="Registro e investigación de accidentes, incidentes, cuasi accidentes y enfermedad profesional."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Incidentes" },
          ]} />
        }
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/incidentes/export" label="Exportar incidentes" />
            {canManage ? (
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Registrar incidente"}
              </Button>
            ) : null}
          </>
        }
      />
      <IncidentList
        incidents={incidents}
        worksites={worksites}
        canManage={canManage}
        canClose={canClose}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  )
}
