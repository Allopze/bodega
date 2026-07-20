"use client"

import * as React from "react"
import Link from "next/link"
import { GearSix } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  CHANGE_DIMENSIONS,
  CHANGE_RISK_LEVEL_LABELS,
  CHANGE_STATUS_LABELS,
  CHANGE_TYPE_LABELS,
  changeStatusBadgeVariant,
} from "@/lib/prevention/change"
import { NewChangeDialog } from "./change-dialogs"

interface ChangeItem {
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

export function ChangeList({ changes, worksites, canManage }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = changes.filter((item) =>
    !query || `${item.code} ${item.title} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query))

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

      {filtered.length === 0 ? (
        <EmptyState
          icon={<GearSix size={20} />}
          title={changes.length === 0 ? "Aún no hay solicitudes de gestión del cambio" : "Ninguna solicitud coincide con la búsqueda"}
          description={changes.length === 0
            ? "Un cambio de proceso, instalación, equipo, sustancia, proveedor, requisito legal, dotación, software o procedimiento debe evaluar su impacto en las seis dimensiones antes de aprobarse."
            : "Ajusta el texto del buscador superior."}
          action={canManage && worksites.length > 0 ? <NewChangeDialog worksites={worksites} /> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cambio / faena</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Dimensiones evaluadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
