"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import type { IperMatrix } from "@/db/schema"
import { IperList } from "./iper-list"

interface Props {
  matrices: IperMatrix[]
  worksites: { id: string; name: string }[]
  canManage: boolean
}

export function IperPanel({ matrices, worksites, canManage }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Matriz de riesgos"
        description="Identificación de peligros y evaluación de riesgos por faena, proceso y tarea."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Prevención", href: "/prevencion" },
            { label: "Matriz de riesgos" },
          ]} />
        }
        actions={
          canManage ? (
            <>
              <PreventionExportButton href="/api/prevencion/iper/export" label="Exportar matriz" />
              <Button onClick={() => setShowForm((current) => !current)} size="sm">
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nueva matriz"}
              </Button>
            </>
          ) : undefined
        }
      />
      <IperList
        matrices={matrices}
        worksites={worksites}
        canManage={canManage}
        showForm={showForm}
        onShowFormChange={setShowForm}
      />
    </>
  )
}
