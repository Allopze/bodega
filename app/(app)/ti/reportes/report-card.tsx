"use client"

import * as React from "react"
import { ExportButton } from "@/components/ui/export-button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FileXls } from "@phosphor-icons/react"
import { exportTiReport, type TiReportType } from "./actions"

interface ReportCardProps {
  type: TiReportType
  title: string
  description: string
  needsAsset: boolean
  assets: { id: string; code: string }[]
  enabled: boolean
}

export function ReportCard({ type, title, description, needsAsset, assets, enabled }: ReportCardProps) {
  const [assetId, setAssetId] = React.useState("")

  return (
    <section className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary-tint)] text-[var(--color-primary-ink)]">
          <FileXls size={16} />
        </span>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      </div>
      <p className="mt-2 flex-1 text-xs text-[var(--color-text-muted)]">{description}</p>

      {needsAsset && (
        <div className="mt-3">
          <Select value={assetId || "_none"} onValueChange={setAssetId}>
            <SelectTrigger aria-label="Activo para historial" className="h-9 w-full text-xs">
              <SelectValue placeholder="Selecciona un activo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Selecciona un activo</SelectItem>
              {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mt-4">
        {!enabled ? (
          <p className="text-center text-xs text-[var(--color-text-subtle)]">Sin permiso de exportación</p>
        ) : needsAsset && !assetId ? (
          <span className="flex h-8 w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-text-subtle)]">
            <FileXls className="h-4 w-4" /> Selecciona un activo
          </span>
        ) : (
          <ExportButton
            action={() => exportTiReport(type, needsAsset ? assetId : undefined)}
            size="sm"
            className="w-full"
          />
        )}
      </div>
    </section>
  )
}
