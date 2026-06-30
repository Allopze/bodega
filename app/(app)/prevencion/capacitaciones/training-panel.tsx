"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { TrainingCourse, WorkerTrainingAssignment } from "@/db/schema"
import { TrainingList } from "./training-list"

interface WorkerSummary {
  firstName: string
  lastName: string
  rut: string | null
}

interface EnrichedExpired extends WorkerTrainingAssignment {
  worker: WorkerSummary | null
  course: { id: string; code: string; name: string } | null
}

interface Props {
  expired: EnrichedExpired[]
  courses: TrainingCourse[]
  canManage: boolean
}

export function TrainingPanel({ expired, courses, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Capacitaciones"
        description="Cursos, asignaciones, vencimientos y competencias vencidas por faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Capacitaciones" },
          ]} />
        }
        actions={
          <>
            <PreventionExportButton href="/api/prevencion/capacitaciones/export" label="Exportar capacitaciones" />
            {canManage ? (
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Asignar capacitación"}
              </Button>
            ) : null}
          </>
        }
      />
      <TrainingList
        expired={expired}
        courses={courses}
        canManage={canManage}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  )
}
