"use client"

import * as React from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  INSPECTION_KIND_LABELS,
  INSPECTION_RUN_STATUS_LABELS,
  runStatusBadgeVariant,
} from "@/lib/prevention/inspections"
import { formatDateTime } from "@/lib/utils"

interface RunItem {
  id: string
  code: string
  status: string
  templateName: string
  templateKind: string
  subjectLabel: string | null
  worksiteId: string
  worksiteName: string
  executedAt: string | null
  compliancePercent: number | null
  nonConformingCount: number
  openFindings: number
  criticalFindings: number
}

type QuickFilter = "all" | "pending_review" | "open_findings" | "critical"

export function InspectionRunList({ runs, overdueProgramCount }: { runs: RunItem[]; overdueProgramCount: number }) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")
  const [worksite, setWorksite] = React.useState("all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")

  const worksites = React.useMemo(() => {
    const map = new Map(runs.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [runs])

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = runs.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    if (quickFilter === "pending_review" && item.status !== "completed") return false
    if (quickFilter === "open_findings" && item.openFindings === 0) return false
    if (quickFilter === "critical" && item.criticalFindings === 0) return false
    if (!query) return true
    return `${item.code} ${item.templateName} ${item.subjectLabel ?? ""} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const metrics = [
    { id: "pending-review", key: "pending_review" as const, label: "Esperando revisión", value: runs.filter((item) => item.status === "completed").length, detail: "Ejecutadas sin cerrar" },
    { id: "open-findings", key: "open_findings" as const, label: "Con hallazgos abiertos", value: runs.filter((item) => item.openFindings > 0).length, detail: "Requieren acción" },
    { id: "critical", key: "critical" as const, label: "Con hallazgo grave", value: runs.filter((item) => item.criticalFindings > 0).length, detail: "Alto o crítico" },
    { id: "overdue", key: "all" as const, label: "Programaciones vencidas", value: overdueProgramCount, detail: "Inspección no ejecutada a tiempo" },
  ]

  function clearFilters() {
    setStatus("all"); setWorksite("all"); setQuickFilter("all")
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.id}
            type="button"
            onClick={() => setQuickFilter((current) => current === metric.key ? "all" : metric.key)}
            aria-pressed={quickFilter === metric.key}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)] aria-pressed:bg-[var(--color-primary-tint)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select value={status} onValueChange={(value) => { setStatus(value); setQuickFilter("all") }}>
          <SelectTrigger className="w-56" aria-label="Estado de la inspección"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(INSPECTION_RUN_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={setWorksite}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || worksite !== "all" || quickFilter !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlass size={20} />}
          title={runs.length === 0 ? "Aún no hay inspecciones ejecutadas" : "No hay inspecciones con estos filtros"}
          description={runs.length === 0
            ? "Incorpora una plantilla del catálogo, apruébala y prográmala por faena. Cada incumplimiento genera un hallazgo, y los graves exigen una acción CAPA antes de cerrar."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={runs.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button>
            : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / plantilla</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Faena / sujeto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ejecutada</TableHead>
                <TableHead className="text-right" title="Porcentaje sobre ítems evaluables; excluye los no aplica">Cumplimiento</TableHead>
                <TableHead className="text-right" title="Hallazgos abiertos y, entre paréntesis, los graves">Hallazgos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.templateName}</span>
                  </TableCell>
                  <TableCell className="text-sm">{INSPECTION_KIND_LABELS[item.templateKind] ?? item.templateKind}</TableCell>
                  <TableCell className="text-sm">
                    {item.worksiteName}
                    {item.subjectLabel && <span className="block text-xs text-[var(--color-text-subtle)]">{item.subjectLabel}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={runStatusBadgeVariant(item.status)}>
                      {INSPECTION_RUN_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">{item.executedAt ? formatDateTime(item.executedAt) : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.compliancePercent === null ? "No calculable" : `${item.compliancePercent}%`}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.openFindings}{item.criticalFindings > 0 && ` (${item.criticalFindings})`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
