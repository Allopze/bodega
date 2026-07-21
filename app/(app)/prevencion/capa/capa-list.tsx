"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Pagination } from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardText } from "@phosphor-icons/react"
import { CAPA_SOURCE_LABELS, CAPA_STATUS_LABELS, capaStatusBadgeVariant } from "@/lib/prevention/capa"
import type { CapaStatus } from "@/lib/services/prevention-capa"
import type { PaginationState } from "@/lib/pagination"

interface CapaListItem {
  id: string
  code: string
  sourceType: string
  sourceId: string
  worksiteId: string
  finding: string
  actionDescription: string
  responsibleSnapshot: string | null
  responsibleUserId: string | null
  priority: string
  targetDate: string
  status: string
  reconciliationStatus: string
  requiresImmediateStop: boolean
  createdAt: string
}

interface Props {
  actions: CapaListItem[]
  worksites: { id: string; name: string }[]
  counts: { open: number; overdue: number; pendingVerification: number; unreconciled: number }
  pagination: PaginationState
}

type QuickFilter = "all" | "open" | "overdue" | "pending_verification" | "unreconciled" | "immediate_stop"

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baja", medium: "Media", high: "Alta", critical: "Crítica",
}

export function CapaList({ actions, worksites, counts, pagination }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState(sp.get("status") ?? "all")
  const [source, setSource] = React.useState(sp.get("source") ?? "all")
  const [worksite, setWorksite] = React.useState(sp.get("worksite") ?? "all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")
  const worksiteName = React.useMemo(() => new Map(worksites.map((item) => [item.id, item.name])), [worksites])
  const query = searchQuery.trim().toLocaleLowerCase("es-CL")

  function navigateToPage(p: number) {
    const params = new URLSearchParams(sp.toString())
    if (p > 1) params.set("page", String(p))
    else params.delete("page")
    const qs = params.toString()
    router.push(qs ? `?${qs}` : "")
  }

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(sp.toString())
    if (value && value !== "all") params.set(key, value)
    else params.delete(key)
    params.delete("page")
    router.push(params.toString() ? `?${params.toString()}` : "")
  }

  const filtered = actions.filter((item) => {
    if (!query) return true
    return [item.code, item.finding, item.actionDescription, item.responsibleSnapshot, worksiteName.get(item.worksiteId)]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase("es-CL").includes(query))
  })

  const metrics: Array<{ key: QuickFilter; label: string; value: number; detail: string }> = [
    { key: "immediate_stop", label: "Exigen detener la tarea", value: actions.filter((item) => item.requiresImmediateStop && !["closed", "cancelled"].includes(item.status)).length, detail: "Respuesta inmediata en terreno" },
    { key: "open", label: "Abiertas", value: counts.open, detail: "Requieren gestión" },
    { key: "overdue", label: "Vencidas", value: counts.overdue, detail: "Plazo incumplido" },
    { key: "pending_verification", label: "Por verificar", value: counts.pendingVerification, detail: "Esperan inspección" },
    { key: "unreconciled", label: "Por conciliar", value: counts.unreconciled, detail: "Histórico incompleto" },
  ]

  function clearFilters() {
    router.push("")
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.key}
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
        <Select value={status} onValueChange={(value) => { setStatus(value); applyFilter("status", value); setQuickFilter("all") }}>
          <SelectTrigger className="w-48" aria-label="Estado CAPA"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(CAPA_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => { setSource(value); applyFilter("source", value) }}>
          <SelectTrigger className="w-44" aria-label="Fuente CAPA"><SelectValue placeholder="Fuente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las fuentes</SelectItem>
            {Object.entries(CAPA_SOURCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={(value) => { setWorksite(value); applyFilter("worksite", value) }}>
          <SelectTrigger className="w-52" aria-label="Faena CAPA"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || source !== "all" || worksite !== "all" || quickFilter !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardText size={20} />}
          title={actions.length === 0 ? "Aún no hay acciones CAPA" : "No hay acciones con estos filtros"}
          description={actions.length === 0
            ? "Las acciones aparecerán al registrar hallazgos desde PPA, PDTP, evaluaciones, incidentes o riesgos."
            : "Ajusta los filtros o el texto del buscador superior para volver a ver acciones."}
          action={actions.length > 0 ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todas</Button> : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código / fuente</TableHead>
                  <TableHead>Hallazgo y acción</TableHead>
                  <TableHead>Faena</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Plazo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => {
                  const overdue = !["verified", "closed", "cancelled"].includes(item.status) && item.targetDate < new Date().toISOString().slice(0, 10)
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/prevencion/capa/${item.id}`} className="font-mono text-xs font-semibold text-[var(--color-primary-ink)] hover:underline">
                          {item.code}
                        </Link>
                        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{CAPA_SOURCE_LABELS[item.sourceType] ?? item.sourceType}</p>
                      </TableCell>
                      <TableCell className="max-w-md">
                        {item.requiresImmediateStop && (
                          <Badge variant="danger" className="mb-1">Detener la tarea</Badge>
                        )}
                        <p className="line-clamp-1 text-sm font-medium">{item.finding}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--color-text-subtle)]">{item.actionDescription}</p>
                      </TableCell>
                      <TableCell>{worksiteName.get(item.worksiteId) ?? item.worksiteId}</TableCell>
                      <TableCell>{item.responsibleSnapshot || (item.responsibleUserId ? "Usuario asignado" : "Sin asignar")}</TableCell>
                      <TableCell>
                        <span className={overdue ? "font-semibold text-[var(--color-danger)]" : "tabular-nums"}>{item.targetDate}</span>
                        <p className="text-xs text-[var(--color-text-subtle)]">{PRIORITY_LABEL[item.priority] ?? item.priority}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={capaStatusBadgeVariant(item.status)}>{CAPA_STATUS_LABELS[item.status as CapaStatus] ?? item.status}</Badge>
                        {item.reconciliationStatus !== "reconciled" && <p className="mt-1 text-xs text-[var(--color-warning)]">Por conciliar</p>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex justify-center pt-2">
              <Pagination page={pagination.page} total={pagination.totalItems} perPage={pagination.limit} onPage={navigateToPage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
