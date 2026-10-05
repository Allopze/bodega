"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ExportButton } from "@/components/ui/export-button"
import { Combobox } from "@/components/ui/combobox"
import { FileXls } from "@phosphor-icons/react"
import type { WorksiteOption } from "@/components/ui/worksite-select"
import { exportTiReport, type TiReportType } from "./actions"
import { TiExportDialog } from "./ti-export-dialog"

interface ReportCardProps {
  type: TiReportType
  title: string
  description: string
  needsAsset?: boolean
  assets?: { id: string; code: string }[]
  enabled: boolean
  /** Filtros del reporte; sin ellos se exporta directo. */
  filters?: { period?: boolean; worksite?: boolean; system?: boolean }
  worksites?: WorksiteOption[]
  systems?: { id: string; name: string }[]
}

export function ReportCard({
  type, title, description, needsAsset = false, assets = [], enabled, filters, worksites = [], systems = [],
}: ReportCardProps) {
  const [assetId, setAssetId] = React.useState("")
  const uid = React.useId()
  const options = React.useMemo(() => assets.map((a) => ({ value: a.id, label: a.code })), [assets])

  return (
    <article className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]">
          <FileXls size={16} />
        </span>
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      </div>
      <p className="mt-2 flex-1 text-xs text-[var(--color-text-muted)]">{description}</p>

      {needsAsset && (
        <div className="mt-3">
          {/* Con búsqueda: el inventario puede tener cientos de códigos. */}
          <Combobox
            id={`${uid}-activo`}
            aria-label="Activo del historial"
            options={options}
            value={assetId}
            onChange={setAssetId}
            placeholder="Buscar un activo por código…"
            clearLabel="Quitar selección"
          />
        </div>
      )}

      <div className="mt-4">
        {!enabled ? (
          <p className="text-center text-xs text-[var(--color-text-muted)]">Sin permiso de exportación</p>
        ) : filters ? (
          <TiExportDialog
            type={type}
            title={title}
            withPeriod={filters.period}
            worksites={filters.worksite ? worksites : []}
            systems={filters.system ? systems : undefined}
          />
        ) : needsAsset && !assetId ? (
          // Sin activo no hay nada que exportar: botón realmente deshabilitado
          // (antes era un <span> que imitaba uno y repetía el texto del campo).
          <Button variant="secondary" size="sm" className="w-full" disabled>
            <FileXls className="mr-1 h-4 w-4" /> Exportar Excel
          </Button>
        ) : (
          <ExportButton
            action={() => exportTiReport(type, needsAsset ? assetId : undefined)}
            size="sm"
            className="w-full"
          />
        )}
      </div>
    </article>
  )
}
