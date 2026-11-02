"use client"

import Link from "next/link"
import { DataTable } from "@/components/ui/data-table"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import type { OperationalAsset } from "@/lib/services/operational-control"

type Variant = "success" | "signal" | "warning" | "neutral" | "outline"

/**
 * B-01: el estado de vehículo se pinta con etiqueta humana (regla A6). El
 * variant del badge se deriva de la etiqueta, no del enum crudo, así "En
 * mantención" cae en `warning` y "Fuera de servicio" en `signal` — sin
 * enumerar valores que el modelo aún no soporta.
 */
function statusVariant(label: string): Variant {
  if (label === "Operativo") return "success"
  if (label === "En mantención") return "warning"
  if (label === "Fuera de servicio") return "signal"
  if (label === "Inactivo") return "outline"
  return "neutral"
}

const COLUMNS = (canViewInspections: boolean) => {
  return [
    { key: "code", label: "Código", sortable: true },
    { key: "name", label: "Activo", sortable: true },
    { key: "worksiteName", label: "Faena", sortable: true },
    { key: "operationalStatusLabel", label: "Estado", sortable: true },
    ...(canViewInspections
      ? [{ key: "inspectionCount", label: "Inspecciones", sortable: true, numeric: true }]
      : []),
    { key: "_action", label: "", sortable: false, numeric: true },
  ]
}

const SEARCH_KEYS = ["code", "name", "worksiteName", "operationalStatusLabel"] as const

function assetHref(asset: OperationalAsset): string {
  return asset.kind === "vehicle" ? `/flota/${asset.id}` : `/admin/equipos/${asset.id}`
}

export function OperationalAssetsTable({
  assets,
  canViewInspections,
}: {
  assets: OperationalAsset[]
  canViewInspections: boolean
}) {
  const renderMobileCard = (asset: OperationalAsset) => (
    <article className="rounded-2xl border border-[var(--color-border)] bg-white p-4">
      <div className="flex justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold">{asset.code}</p>
          <p className="text-sm text-[var(--color-text-muted)]">{asset.name}</p>
        </div>
        <MetaBadge meta={{ label: asset.operationalStatusLabel, variant: statusVariant(asset.operationalStatusLabel) }} />
      </div>
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {canViewInspections && (
          <div>
            <dt className="text-[var(--color-text-subtle)]">Inspecciones</dt>
            <dd>{asset.inspectionCount}</dd>
          </div>
        )}
      </dl>
      <Button asChild size="sm" variant="ghost" className="mt-3 w-full">
        <Link href={assetHref(asset)}>Ver ficha</Link>
      </Button>
    </article>
  )

  const renderRow = (asset: OperationalAsset) => (
    <TableRow key={asset.key}>
      <TableCell className="font-mono">{asset.code}</TableCell>
      <TableCell>
        {asset.name}
        <span className="block text-xs text-[var(--color-text-subtle)]">
          {asset.kind === "vehicle" ? "Vehículo / equipo móvil" : "Instrumento de servicio"}
        </span>
      </TableCell>
      <TableCell>{asset.worksiteName}</TableCell>
      <TableCell>
        <MetaBadge meta={{ label: asset.operationalStatusLabel, variant: statusVariant(asset.operationalStatusLabel) }} />
      </TableCell>
      {canViewInspections && (
        <TableCell className="text-right font-mono">{asset.inspectionCount}</TableCell>
      )}
      <TableCell className="text-right">
        <Button asChild size="sm" variant="ghost">
          <Link href={assetHref(asset)}>Ver</Link>
        </Button>
      </TableCell>
    </TableRow>
  )

  return (
    <DataTable
      caption="Activos operacionales"
      columns={COLUMNS(canViewInspections)}
      rows={assets}
      // M-06: el `searchKeys` apunta a la etiqueta humana del estado
      // (`operationalStatusLabel`) para que la búsqueda del TopBar encuentre
      // "En mantención" o "Fuera de servicio" — antes era el enum crudo
      // (`mantencion`, `fuera_servicio`) y el operador no podía buscar en
      // español. El matcher del DataTable sigue siendo `toLowerCase` literal.
      searchKeys={SEARCH_KEYS as unknown as (keyof OperationalAsset)[]}
      pageSize={25}
      emptyTitle="No hay activos visibles"
      emptyDescription="El alcance de faena y los permisos determinan qué activos aparecen."
      renderMobileCard={renderMobileCard}
      renderRow={renderRow}
    />
  )
}
