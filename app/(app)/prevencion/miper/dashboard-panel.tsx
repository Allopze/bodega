"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { DataTable } from "@/components/ui/data-table"
import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { RiskClassificationBadge } from "@/components/prevention/risk-classification-badge"
import { RISK_CLASSIFICATIONS } from "@/lib/prevention/miper/methodology"
import type { MiperDashboard, MiperDashboardRow, MiperDashboardStrip, MiperDashboardTile } from "@/lib/services/miper/dashboard"

/**
 * Pestaña «Resumen» de la portada del MIPER (§8.6, F3).
 *
 * Respeta la regla A1: cuatro tiles **accionables** —cada uno es un enlace a su
 * subconjunto ya filtrado, no una tarjeta de número suelto—, las cifras
 * secundarias en una franja de TEXTO (`<dl>`, como `summary-strip.tsx`) y la
 * distribución por faena en la tabla. Nada de KPIs estáticos sobre la matriz.
 */
export function MiperDashboardPanel({ dashboard, filtersActive, onClearFilters }: {
  dashboard: MiperDashboard
  filtersActive: boolean
  onClearFilters: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dashboard.tiles.map((tile) => <Tile key={tile.key} tile={tile} />)}
      </div>

      <Strip strip={dashboard.strip} />

      <DataTable
        caption="Estado del MIPER por faena"
        columns={[
          { key: "worksiteName", label: "Faena", sortable: true },
          { key: "stateLabel", label: "Estado" },
          { key: "versionNumber", label: "Versión", numeric: true, sortable: true },
          { key: "distribution", label: "Clasificación" },
          { key: "uncontrolledCount", label: "Sin controlar", numeric: true, sortable: true },
          { key: "avance", label: "Avance", numeric: true },
          { key: "alertCount", label: "Alertas", numeric: true, sortable: true },
        ]}
        rows={dashboard.rows}
        searchKeys={["worksiteName", "stateLabel"]}
        emptyTitle="Sin MIPER para estos filtros"
        emptyDescription="Cambia los filtros para ver otras faenas, períodos o responsables."
        emptyAction={filtersActive ? <Button type="button" variant="secondary" size="sm" onClick={onClearFilters}>Limpiar filtros</Button> : undefined}
        renderRow={(row) => <SummaryRow key={row.matrixId} row={row} />}
      />
    </div>
  )
}

/** Tile accionable: el número va con su enlace a la lista ya filtrada (A1). */
function Tile({ tile }: { tile: MiperDashboardTile }) {
  return (
    <Link
      href={tile.href}
      className="group flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
    >
      <span className="text-eyebrow text-[var(--color-text-subtle)]">{tile.label}</span>
      <span className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">{tile.count}</span>
      <span className="mt-1 text-xs text-[var(--color-text-subtle)]">{tile.hint}</span>
      <span className="mt-2 text-xs font-medium text-[var(--color-signal-ink)] group-hover:underline">Ver el detalle</span>
    </Link>
  )
}

/** Franja secundaria en texto: mismas cifras, sin tarjetas (regla A1). */
function Strip({ strip }: { strip: MiperDashboardStrip }) {
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-sm">
      <Figure label="MIPER vigentes" value={strip.vigentes} />
      <Figure label="Con observaciones" value={strip.conObservaciones} />
      <Figure label="Tolerables" value={strip.tolerables} />
      <Figure label="Moderados" value={strip.moderados} />
      <Figure label="Medidas pendientes" value={strip.medidasPendientes} />
      <Figure label="Actividades vencidas" value={strip.actividadesVencidas} />
    </dl>
  )
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="inline text-[var(--color-text-subtle)]">{label} </dt>
      <dd className="inline tabular-nums">{value}</dd>
    </div>
  )
}

/** Distribución por banda —de la más grave a la más leve— igual que la lista. */
function Distribution({ row }: { row: MiperDashboardRow }) {
  const present = [...RISK_CLASSIFICATIONS].reverse().filter((classification) => row.classificationCounts[classification] > 0)
  if (present.length === 0) return <span className="text-xs text-[var(--color-text-subtle)]">Sin riesgos evaluados</span>
  return (
    <span className="flex flex-wrap gap-1">
      {present.map((classification) => (
        <span key={classification} className="inline-flex items-center gap-1">
          <RiskClassificationBadge classification={classification} size="sm" />
          <span className="text-xs tabular-nums">{row.classificationCounts[classification]}</span>
        </span>
      ))}
    </span>
  )
}

function SummaryRow({ row }: { row: MiperDashboardRow }) {
  const router = useRouter()
  const avance = row.progress.ratio === null
    ? "—"
    : `${Math.round(row.progress.ratio * 100)}% · ${row.progress.done}/${row.progress.planned}`
  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(`/prevencion/miper/${row.matrixId}`)}>
      <TableCell>
        <Link href={`/prevencion/miper/${row.matrixId}`} className="font-medium hover:underline">{row.worksiteName}</Link>
      </TableCell>
      <TableCell>{row.stateLabel}</TableCell>
      <TableCell className="tabular-nums">{row.versionNumber ?? "—"}</TableCell>
      <TableCell><Distribution row={row} /></TableCell>
      <TableCell className="tabular-nums">{row.uncontrolledCount}</TableCell>
      <TableCell className="tabular-nums">{avance}</TableCell>
      <TableCell className="tabular-nums">
        {row.alertCount === 0 ? <span className="text-[var(--color-text-subtle)]">Sin alertas</span> : row.alertCount}
      </TableCell>
    </TableRow>
  )
}
