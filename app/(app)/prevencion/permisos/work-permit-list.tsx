"use client"

import * as React from "react"
import { ShieldCheck } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PERMIT_STATUS_LABELS, permitStatusBadgeVariant } from "@/lib/prevention/permits"
import { formatDateTime } from "@/lib/utils"

interface PermitItem {
  id: string
  code: string
  status: string
  taskDescription: string
  location: string
  plannedStartAt: string
  plannedEndAt: string
  extendedUntilAt: string | null
  suspensionReason: string | null
  worksiteId: string
  worksiteName: string
  typeName: string
  crewCount: number
  acknowledgedCount: number
  openIsolationCount: number
}

type QuickFilter = "all" | "active" | "pending" | "isolations"

export function WorkPermitList({ permits }: { permits: PermitItem[] }) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")
  const [worksite, setWorksite] = React.useState("all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")

  const worksites = React.useMemo(() => {
    const map = new Map(permits.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [permits])

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = permits.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    if (quickFilter === "active" && item.status !== "active") return false
    if (quickFilter === "pending" && item.status !== "pending_approval") return false
    if (quickFilter === "isolations" && item.openIsolationCount === 0) return false
    if (!query) return true
    return `${item.code} ${item.typeName} ${item.taskDescription} ${item.location} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const metrics = [
    { id: "active", key: "active" as const, label: "Vigentes en terreno", value: permits.filter((item) => item.status === "active").length, detail: "Trabajo habilitado ahora" },
    { id: "pending", key: "pending" as const, label: "Esperando aprobación", value: permits.filter((item) => item.status === "pending_approval").length, detail: "Requieren revisión" },
    { id: "isolations", key: "isolations" as const, label: "Con energías bloqueadas", value: permits.filter((item) => item.openIsolationCount > 0).length, detail: "LOTO aplicado sin retirar" },
    { id: "suspended", key: "all" as const, label: "Suspendidos", value: permits.filter((item) => item.status === "suspended").length, detail: "Detenidos por desviación o vencimiento" },
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
          <SelectTrigger className="w-56" aria-label="Estado del permiso"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(PERMIT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
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
          icon={<ShieldCheck size={20} />}
          title={permits.length === 0 ? "Aún no hay permisos de trabajo" : "No hay permisos con estos filtros"}
          description={permits.length === 0
            ? "Un permiso autoriza una tarea crítica sólo cuando su AST está escrito, los controles verificados, las energías aisladas y toda la cuadrilla habilitada."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={permits.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todos</Button>
            : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / tarea</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Faena / lugar</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Ventana</TableHead>
                <TableHead className="text-right" title="Cuadrilla que acusó el AST sobre el total">Acuses</TableHead>
                <TableHead className="text-right" title="Aislamientos aplicados sin retirar">LOTO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block max-w-sm text-sm">{item.taskDescription}</span>
                  </TableCell>
                  <TableCell className="text-sm">{item.typeName}</TableCell>
                  <TableCell className="text-sm">
                    {item.worksiteName}
                    <span className="block text-xs text-[var(--color-text-subtle)]">{item.location}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={permitStatusBadgeVariant(item.status)}>
                      {PERMIT_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                    {item.suspensionReason && (
                      <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{item.suspensionReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatDateTime(item.plannedStartAt)}
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      hasta {formatDateTime(item.extendedUntilAt ?? item.plannedEndAt)}
                      {item.extendedUntilAt && " (extendido)"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.acknowledgedCount} / {item.crewCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.openIsolationCount > 0 ? item.openIsolationCount : "—"}
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
