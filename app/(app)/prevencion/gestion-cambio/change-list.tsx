"use client"

import * as React from "react"
import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
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
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
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

type QuickFilter = "open" | "approved" | "rejected" | "high_risk"

// Cada tile es también el predicado con el que filtra: así el número que se
// ve y las filas que deja son, por construcción, el mismo conjunto.
const QUICK_FILTERS: Record<QuickFilter, (item: ChangeItem) => boolean> = {
  open: (item) => item.status === "draft" || item.status === "under_evaluation",
  approved: (item) => item.status === "approved",
  rejected: (item) => item.status === "rejected",
  high_risk: (item) => item.riskLevel === "high" || item.riskLevel === "critical",
}

function isQuickFilter(value: string): value is QuickFilter {
  return value in QUICK_FILTERS
}

export function ChangeList({ changes, worksites, canManage }: Props) {
  // El filtro rápido viaja en la URL (`?vista=`), como en inspecciones: se
  // comparte, sobrevive al refresco y vuelve intacto con "atrás" desde el
  // detalle. `useUrlFilters` ya usa `router.replace` + `scroll: false`.
  const { getFilter, setFilters } = useUrlFilters()
  const rawView = getFilter("vista")
  const quickFilter: QuickFilter | null = isQuickFilter(rawView) ? rawView : null
  const rows = quickFilter ? changes.filter(QUICK_FILTERS[quickFilter]) : changes

  // A1: los cuatro tiles filtran esta misma lista. A5: el estado ya tiene esta
  // representación interactiva, así que no hay además un Select de estado.
  // `emptyDetail`: un "0" pelado con el subtítulo de siempre no distinguía
  // "todo en orden" de "no hay datos"; en cero el tile afirma el estado y deja
  // de ser clicable (sólo podía llevar a una lista vacía).
  const metrics: Array<{ key: QuickFilter; label: string; detail: string; emptyDetail: string }> = [
    { key: "open", label: "Abiertos", detail: "En preparación o evaluación", emptyDetail: "Nada en preparación ni evaluación" },
    { key: "approved", label: "Aprobados", detail: "Listos para implementar", emptyDetail: "Ninguno aprobado todavía" },
    { key: "rejected", label: "Rechazados", detail: "Sin proceder", emptyDetail: "Ninguno rechazado" },
    { key: "high_risk", label: "Riesgo alto o crítico", detail: "Requieren atención prioritaria", emptyDetail: "Ninguno de riesgo alto ni crítico" },
  ]
  const activeMetric = metrics.find((metric) => metric.key === quickFilter)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const value = changes.filter(QUICK_FILTERS[metric.key]).length
          const active = quickFilter === metric.key
          // Activo sigue pulsable aunque quede en cero: si no, el usuario no
          // podría apagar el filtro desde el mismo control.
          const inert = value === 0 && !active
          return (
            <button
              key={metric.key}
              type="button"
              disabled={inert}
              aria-pressed={active}
              onClick={() => setFilters({ vista: active ? null : metric.key })}
              className="min-w-0 border-r border-[var(--color-border)] px-4 py-3 text-left enabled:hover:bg-[var(--color-surface-2)] disabled:cursor-default aria-pressed:bg-[var(--color-primary-tint)]"
            >
              <span className="text-eyebrow">{metric.label}</span>
              <span className={inert
                ? "mt-1 block font-mono text-xl font-semibold tabular-nums text-[var(--color-text-subtle)]"
                : "mt-1 block font-mono text-xl font-semibold tabular-nums"}>{value}</span>
              <span className="text-xs text-[var(--color-text-subtle)]">{inert ? metric.emptyDetail : metric.detail}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--color-text-subtle)]">
          {activeMetric ? `${rows.length} de ${changes.length} solicitud(es) · ${activeMetric.label}` : `${changes.length} solicitud(es)`}
        </span>
        {activeMetric && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setFilters({ vista: null })}>
            Ver todas
          </Button>
        )}
      </div>

      <DataTable
        caption="Solicitudes de gestión del cambio"
        columns={COLUMNS}
        rows={rows}
        searchKeys={["code", "title", "worksiteName"]}
        emptyTitle={changes.length === 0 ? "Aún no hay solicitudes de gestión del cambio" : "Ninguna solicitud coincide con la búsqueda"}
        emptyDescription={changes.length === 0 ? "Un cambio de proceso, instalación, equipo, sustancia, proveedor, requisito legal, dotación, software o procedimiento debe evaluar su impacto en las seis dimensiones antes de aprobarse." : activeMetric ? "Ajusta el texto del buscador superior o quita el filtro del indicador con \"Ver todas\"." : "Ajusta el texto del buscador superior."}
        emptyAction={canManage && worksites.length > 0 ? <NewChangeDialog worksites={worksites} /> : undefined}
        renderMobileCard={(item) => {
          return (
            <ResponsiveDataListCard
              title={<Link href={`/prevencion/gestion-cambio/${item.id}`} className="hover:underline">{item.title}</Link>}
              description={<span className="font-mono">{item.code}</span>}
              status={<MetaBadge meta={{ label: `${CHANGE_STATUS_LABELS[item.status] ?? item.status}`, variant: changeStatusBadgeVariant(item.status) }} />}
              actions={<Button asChild type="button" variant="ghost" size="sm"><Link href={`/prevencion/gestion-cambio/${item.id}`}>Ver cambio</Link></Button>}
            >
              <ResponsiveDataListField label="Faena">{item.worksiteName}</ResponsiveDataListField>
              <ResponsiveDataListField label="Tipo">{CHANGE_TYPE_LABELS[item.changeType] ?? item.changeType}</ResponsiveDataListField>
              <ResponsiveDataListField label="Riesgo">
                <MetaBadge meta={{ label: `${CHANGE_RISK_LEVEL_LABELS[item.riskLevel] ?? item.riskLevel}`, variant: item.riskLevel === "critical" || item.riskLevel === "high" ? "danger" : "outline" }} />
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
                <MetaBadge meta={{ label: `${CHANGE_RISK_LEVEL_LABELS[item.riskLevel] ?? item.riskLevel}`, variant: item.riskLevel === "critical" || item.riskLevel === "high" ? "danger" : "outline" }} />
              </TableCell>
              <TableCell>
                <MetaBadge meta={{ label: `${CHANGE_STATUS_LABELS[item.status] ?? item.status}`, variant: changeStatusBadgeVariant(item.status) }} />
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums">{item.evaluatedCount} / {CHANGE_DIMENSIONS.length}</TableCell>
            </TableRow>
          )
        }}
      />
    </div>
  )
}
