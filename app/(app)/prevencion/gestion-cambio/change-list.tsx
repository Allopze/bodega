"use client"

import * as React from "react"
import Link from "next/link"
import { DataTable } from "@/components/admin/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  CHANGE_DIMENSIONS,
  CHANGE_RISK_LEVEL_LABELS,
  CHANGE_STATUS_LABELS,
  CHANGE_TYPE_LABELS,
  changeStatusBadgeVariant,
} from "@/lib/prevention/change"
import { NewChangeDialog } from "./change-dialogs"

type ChangeItem = {
  id: string
  code: string
  title: string
  changeType: string
  status: string
  riskLevel: string
  worksiteName: string
  evaluatedCount: number
}

interface Props {
  changes: ChangeItem[]
  worksites: { id: string; name: string }[]
  canManage: boolean
}

const COLUMNS = [
  { key: "code", label: "Cambio / faena", sortable: true },
  { key: "changeType", label: "Tipo", sortable: true },
  { key: "riskLevel", label: "Riesgo", sortable: true },
  { key: "status", label: "Estado", sortable: true },
  { key: "evaluatedCount", label: "Dimensiones evaluadas", sortable: true, numeric: true },
]

export function ChangeList({ changes, worksites, canManage }: Props) {
  const rows = changes

  const metrics = [
    { id: "open", label: "Abiertos", value: changes.filter((item) => item.status === "draft" || item.status === "under_evaluation").length, detail: "En preparación o evaluación" },
    { id: "approved", label: "Aprobados", value: changes.filter((item) => item.status === "approved").length, detail: "Listos para implementar" },
    { id: "rejected", label: "Rechazados", value: changes.filter((item) => item.status === "rejected").length, detail: "Sin proceder" },
    { id: "high_risk", label: "Riesgo alto o crítico", value: changes.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical").length, detail: "Requieren atención prioritaria" },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="border-r border-[var(--color-border)] px-4 py-3">
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-[var(--color-text-subtle)]">{changes.length} solicitud(es)</span>
        {canManage && worksites.length > 0 && <NewChangeDialog worksites={worksites} />}
      </div>

      <DataTable
        caption="Solicitudes de gestión del cambio"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["code", "title", "worksiteName"]}
        emptyTitle={changes.length === 0 ? "Aún no hay solicitudes de gestión del cambio" : "Ninguna solicitud coincide con la búsqueda"}
        emptyDescription={changes.length === 0 ? "Un cambio de proceso, instalación, equipo, sustancia, proveedor, requisito legal, dotación, software o procedimiento debe evaluar su impacto en las seis dimensiones antes de aprobarse." : "Ajusta el texto del buscador superior."}
        emptyAction={canManage && worksites.length > 0 ? <NewChangeDialog worksites={worksites} /> : undefined}
        renderMobileCard={(item) => {
          return (
            <ResponsiveDataListCard
              title={<Link href={`/prevencion/gestion-cambio/${item.id}`} className="hover:underline">{item.title}</Link>}
              description={<span className="font-mono">{item.code}</span>}
              status={<Badge variant={changeStatusBadgeVariant(item.status)}>{CHANGE_STATUS_LABELS[item.status] ?? item.status}</Badge>}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/prevencion/gestion-cambio/${item.id}`}>Ver cambio</Link></Button>}
            >
              <ResponsiveDataListField label="Faena">{item.worksiteName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Tipo">{CHANGE_TYPE_LABELS[item.changeType] ?? item.changeType}</ResponsiveDataListField>
              <ResponsiveDataListField label="Riesgo">
                <Badge variant={item.riskLevel === "critical" || item.riskLevel === "high" ? "danger" : "outline"}>{CHANGE_RISK_LEVEL_LABELS[item.riskLevel] ?? item.riskLevel}</Badge>
              </ResponsiveDataListField>
              <ResponsiveDataListField label="Dimensiones evaluadas">
                <span className="font-mono tabular-nums text-[var(--color-text)]">{item.evaluatedCount} / {CHANGE_DIMENSIONS.length}</span>
              </ResponsiveDataListField>
            </ResponsiveDataListCard>
          )
        }}
        renderRow={(item) => {
          return (
            <TableRow key={item.id}>
              <TableCell>
                <Link href={`/prevencion/gestion-cambio/${item.id}`} className="hover:underline">
                  <span className="font-mono text-xs">{item.code}</span>
                  <span className="block text-sm font-medium">{item.title}</span>
                </Link>
                <span className="block text-xs text-[var(--color-text-subtle)]">{item.worksiteName}</span>
              </TableCell>
              <TableCell className="text-sm">{CHANGE_TYPE_LABELS[item.changeType] ?? item.changeType}</TableCell>
              <TableCell>
                <Badge variant={item.riskLevel === "critical" || item.riskLevel === "high" ? "danger" : "outline"}>
                  {CHANGE_RISK_LEVEL_LABELS[item.riskLevel] ?? item.riskLevel}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={changeStatusBadgeVariant(item.status)}>{CHANGE_STATUS_LABELS[item.status] ?? item.status}</Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">{item.evaluatedCount} / {CHANGE_DIMENSIONS.length}</TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
