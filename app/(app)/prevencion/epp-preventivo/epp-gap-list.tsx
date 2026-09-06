"use client"

import * as React from "react"
import { addDaysToPlainDate, todayInChile } from "@/lib/utils"
import Link from "next/link"
import { HardHat } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FilterToolbar, type ActiveFilterChip } from "@/components/ui/filter-toolbar"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EPP_GAP_TYPE_LABELS, type EppCoverageGap } from "@/lib/prevention/epp"
import { escalateBlockingEppGapsAction } from "./actions"

const ENFORCEMENT_LABELS: Record<string, string> = { blocking: "Bloqueante", warning: "Advertencia" }

interface Props {
  gaps: EppCoverageGap[]
  canEscalate: boolean
}

function defaultTargetDate() {
  // Desde el día civil chileno: `new Date()` + `toISOString()` mide en UTC, así
  // que después de las 20:00 de Chile sugería hoy+31. Esquivaba la regla de
  // ESLint porque el `.toISOString()` va sobre un `Date` ya mutado.
  return addDaysToPlainDate(todayInChile(), 30)
}

export function EppGapList({ gaps, canEscalate }: Props) {
  const { searchQuery } = useSafeShellHeader()
  // Filtros client-side en la URL (shareables + sobreviven refresh) vía useUrlFilters.
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const enforcement = getFilter("exigibilidad") || "all"
  const gapType = getFilter("tipo") || "all"
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = gaps.filter((gap) => {
    if (enforcement !== "all" && gap.enforcement !== enforcement) return false
    if (gapType !== "all" && gap.gapType !== gapType) return false
    if (!query) return true
    return `${gap.workerName} ${gap.eppTypeLabel} ${gap.position ?? ""}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const blockingCount = gaps.filter((gap) => gap.enforcement === "blocking").length

  const GAP_TYPE_LABELS = EPP_GAP_TYPE_LABELS as Record<string, string>
  const activeChips: ActiveFilterChip[] = []
  if (enforcement !== "all") activeChips.push({ key: "exigibilidad", label: "Exigibilidad", value: enforcement, displayValue: ENFORCEMENT_LABELS[enforcement] ?? enforcement })
  if (gapType !== "all") activeChips.push({ key: "tipo", label: "Tipo", value: gapType, displayValue: GAP_TYPE_LABELS[gapType] ?? gapType })
  function handleRemoveChip(key: string) {
    setFilters({ [key]: null })
  }
  function clearFilters() {
    clearUrlFilters()
  }

  function escalate() {
    setMessage(null)
    startTransition(async () => {
      const result = await escalateBlockingEppGapsAction({ targetDate: defaultTargetDate() })
      setMessage(result.ok
        ? "Brechas bloqueantes escaladas a CAPA. Las que ya tenían una acción abierta no se duplicaron."
        : result.message ?? "No se pudo escalar.")
    })
  }

  return (
    <div className="space-y-4">
      {blockingCount > 0 && (
        <div className="rounded-lg border border-[var(--color-danger-border,var(--color-border))] bg-[var(--color-surface-2)] p-4">
          <h2 className="text-sm font-semibold">{blockingCount} brecha(s) bloqueante(s)</h2>
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            Estas personas no deben ser asignadas a la tarea que exige el EPP hasta regularizar la entrega.
            Escalar crea una acción CAPA por persona y tipo de EPP; no cierra la brecha por sí mismo.
          </p>
          {canEscalate && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={pending} onClick={escalate}>
                Escalar brechas bloqueantes a CAPA
              </Button>
              <Button size="sm" variant="secondary" asChild>
                <Link href="/solicitudes/nueva?reposicion=1">Crear solicitud de reposición</Link>
              </Button>
            </div>
          )}{message && <p role="status" className="mt-2 text-sm">{message}</p>}
        </div>
      )}

      <FilterToolbar
        activeChips={activeChips}
        onRemoveChip={handleRemoveChip}
        onClearAll={clearUrlFilters}
        hasActiveFilters={enforcement !== "all" || gapType !== "all"}
      >
        <Select value={enforcement} onValueChange={(value) => setFilters({ exigibilidad: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Exigibilidad"><SelectValue placeholder="Exigibilidad" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda exigibilidad</SelectItem>
            <SelectItem value="blocking">Bloqueante</SelectItem>
            <SelectItem value="warning">Advertencia</SelectItem>
          </SelectContent>
        </Select>
        <Select value={gapType} onValueChange={(value) => setFilters({ tipo: value === "all" ? null : value })}>
          <SelectTrigger className="w-52" aria-label="Tipo de brecha"><SelectValue placeholder="Tipo de brecha" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo tipo</SelectItem>
            {Object.entries(EPP_GAP_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterToolbar>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<HardHat size={20} />}
          title={gaps.length === 0 ? "Sin brechas de cobertura de EPP" : "No hay brechas con estos filtros"}
          description={gaps.length === 0
            ? "Toda la dotación activa alcanzada por un requisito vigente tiene el EPP entregado y vigente. Si esperabas ver brechas, revisa que existan requisitos declarados."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={gaps.length === 0
            ? undefined
            : <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trabajador</TableHead>
                <TableHead>EPP exigido</TableHead>
                <TableHead>Tipo de brecha</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Última entrega</TableHead>
                <TableHead>Fundamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((gap) => (
                <TableRow key={`${gap.workerId}-${gap.requirementId}`}>
                  <TableCell>
                    <Link href={`/prevencion/trabajador/${gap.workerId}`} className="text-sm font-medium underline-offset-2 hover:underline">
                      {gap.workerName}
                    </Link>
                    <span className="block text-xs text-[var(--color-text-subtle)]">{gap.position ?? "Sin cargo"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{gap.eppTypeLabel}</TableCell>
                  <TableCell className="text-sm">{EPP_GAP_TYPE_LABELS[gap.gapType]}</TableCell>
                  <TableCell>
                    <MetaBadge meta={{ label: `${gap.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}`, variant: gap.enforcement === "blocking" ? "danger" : "warning" }} />
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{gap.lastDeliveredAt ?? "—"}</TableCell>
                  <TableCell className="max-w-md text-xs text-[var(--color-text-subtle)]">{gap.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
