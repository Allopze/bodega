"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableCellNum, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { PreventionExportButton } from "@/components/prevention/export-button"
import { StockThresholdForm } from "./stock-threshold-form"

interface Threshold {
  id: string
  eppProductId: string
  minStock: number
  criticalStock: number
}

interface Props {
  thresholds: Threshold[]
  worksiteId: string
  canManage: boolean
  exportHref: string
}

export function EppStockPanel({ thresholds, worksiteId, canManage, exportHref }: Props) {
  const [showForm, setShowForm] = React.useState(false)

  return (
    <>
      <PageHeader
        title="Stock crítico EPP"
        description="Umbrales de stock mínimo y crítico por faena (N° 65 PDTP)"
        breadcrumb={<Breadcrumbs items={[{ label: "Prevención", href: "/prevencion" }, { label: "Stock EPP" }]} />}
        actions={
          <>
            <PreventionExportButton href={exportHref} label="Exportar stock" />
            {canManage ? (
              <Button size="sm" onClick={() => setShowForm((s) => !s)}>
                <Plus size={16} className="mr-1" />
                {showForm ? "Cancelar" : "Nuevo umbral"}
              </Button>
            ) : null}
          </>
        }
      />

      {canManage && showForm ? (
        <StockThresholdForm worksiteId={worksiteId} onDone={() => setShowForm(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>EPP</TableHead>
              <TableHead className="text-right">Stock mínimo</TableHead>
              <TableHead className="text-right">Stock crítico</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {thresholds.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <EmptyState compact title="Sin umbrales configurados" />
                </TableCell>
              </TableRow>
            ) : thresholds.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.eppProductId}</TableCell>
                <TableCellNum>{t.minStock}</TableCellNum>
                <TableCellNum>{t.criticalStock}</TableCellNum>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </>
  )
}
