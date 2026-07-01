"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { EquipmentDailyReport } from "@/db/schema"
import { ReporteList } from "./reporte-list"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
}

interface ReportRow extends EquipmentDailyReport {
  operator: WorkerSummary | null
}

interface Props {
  reports: ReportRow[]
  worksites: { id: string; name: string }[]
  workers: WorkerSummary[]
  canManage: boolean
}

export function ReportePanel({ reports, worksites, workers, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Reportes diarios de equipos"
        description="Reporte de uso diario (N° 25-26 PDTP)"
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Equipos", href: "/prevencion/equipos/reportes" },
            { label: "Reportes" },
          ]} />
        }
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/equipos/reportes/export" label="Exportar reportes" />
            {canManage ? (
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nuevo reporte"}
              </Button>
            ) : null}
          </>
        }
      />
      <ReporteList
        reports={reports}
        worksites={worksites}
        workers={workers}
        canManage={canManage}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  )
}
