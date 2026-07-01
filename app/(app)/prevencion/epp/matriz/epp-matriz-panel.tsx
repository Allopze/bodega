"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { EppMatrixList } from "./epp-matrix-list"
import { EppDeliveryForm } from "./epp-delivery-form"
import { EppDeliveriesList } from "./epp-deliveries-list"

interface EppMatrixEntry {
  id: string
  position: string
  eppProductId: string
  riskId: string | null
  notes: string | null
}

interface Delivery {
  id: string
  workerId: string
  eppProductId: string
  deliveredAt: string
  evidenceUrl: string | null
  acknowledgedAt: string | null
}

interface Props {
  entries: EppMatrixEntry[]
  deliveries: Delivery[]
  worksites: { id: string; name: string }[]
  workers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  selectedWorksiteId?: string
  canManage: boolean
  exportHref: string
}

export function EppMatrizPanel({ entries, deliveries, worksites, workers, selectedWorksiteId, canManage, exportHref }: Props) {
  const [showMatrixForm, setShowMatrixForm] = React.useState(false)
  const [showDeliveryForm, setShowDeliveryForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Matriz EPP por cargo"
        description="Elementos de protección personal requeridos por cargo y faena (N° 61-62 PDTP)"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Matriz EPP" }]} />}
        actions={
          <>
            <PreventionExportButton href={exportHref} label="Exportar matriz" />
            {canManage ? (
              <Button size="sm" onClick={() => setShowMatrixForm((s) => !s)}>
                <Plus size={16} className="mr-1" />
                {showMatrixForm ? "Cancelar" : "Nueva entrada"}
              </Button>
            ) : null}
          </>
        }
      />

      <EppMatrixList
        entries={entries}
        worksites={worksites}
        selectedWorksiteId={selectedWorksiteId}
        canManage={canManage}
        showForm={showMatrixForm}
        onShowFormChange={setShowMatrixForm}
      />

      <div className="mt-8 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Entregas de EPP (recambio)</h2>
          {canManage ? (
            <Button size="sm" variant="secondary" onClick={() => setShowDeliveryForm((s) => !s)}>
              <Plus size={14} className="mr-1" />
              {showDeliveryForm ? "Cancelar" : "Registrar entrega"}
            </Button>
          ) : null}
        </div>
        {canManage && showDeliveryForm ? (
          <EppDeliveryForm workers={workers} onDone={() => setShowDeliveryForm(false)} />
        ) : null}
        <EppDeliveriesList deliveries={deliveries} workers={workers} canManage={canManage} />
      </div>
    </>
  )
}
