"use client"

import * as React from "react"
import Link from "next/link"
import { Buildings } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  CONTRACTOR_RELATIONSHIP_LABELS,
  CONTRACT_STATUS_LABELS,
} from "@/lib/prevention/contractors"

interface ContractItem {
  id: string
  code: string
  status: string
  relationship: string
  accessBlocked: boolean
  accessBlockReason: string | null
  startsOn: string
  endsOn: string | null
  worksiteId: string
  worksiteName: string
  companyName: string
  companyRut: string
  workerCount: number
  accreditedCount: number
}

interface Props {
  contracts: ContractItem[]
  blockingGapCount: number
}

type QuickFilter = "all" | "blocked" | "active"

function statusBadgeVariant(status: string): "default" | "success" | "warning" | "outline" {
  if (status === "active") return "success"
  if (status === "suspended") return "warning"
  if (status === "finished") return "outline"
  return "default"
}

export function ContractorContractList({ contracts, blockingGapCount }: Props) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")
  const [worksite, setWorksite] = React.useState("all")
  const [relationship, setRelationship] = React.useState("all")
  const [quickFilter, setQuickFilter] = React.useState<QuickFilter>("all")

  const worksites = React.useMemo(() => {
    const map = new Map(contracts.map((item) => [item.worksiteId, item.worksiteName]))
    return [...map].map(([id, name]) => ({ id, name }))
  }, [contracts])

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = contracts.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (worksite !== "all" && item.worksiteId !== worksite) return false
    if (relationship !== "all" && item.relationship !== relationship) return false
    if (quickFilter === "blocked" && !item.accessBlocked) return false
    if (quickFilter === "active" && item.status !== "active") return false
    if (!query) return true
    return `${item.code} ${item.companyName} ${item.companyRut} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  const blockedCount = contracts.filter((item) => item.accessBlocked).length
  const pendingWorkers = contracts.reduce((total, item) => total + Math.max(0, item.workerCount - item.accreditedCount), 0)

  const metrics = [
    { id: "blocked-contracts", key: "blocked" as const, label: "Contratos con acceso bloqueado", value: blockedCount, detail: "No pueden ingresar a faena", href: null },
    { id: "blocking-gaps", key: "all" as const, label: "Brechas bloqueantes", value: blockingGapCount, detail: "Evidencia exigida sin aprobar", href: "/prevencion/contratistas/brechas" },
    { id: "active-contracts", key: "active" as const, label: "Contratos vigentes", value: contracts.filter((item) => item.status === "active").length, detail: "En ejecución", href: null },
    { id: "pending-workers", key: "all" as const, label: "Personas sin acreditar", value: pendingWorkers, detail: "Registradas y no habilitadas", href: "/prevencion/contratistas/brechas" },
  ]

  function clearFilters() {
    setStatus("all"); setWorksite("all"); setRelationship("all"); setQuickFilter("all")
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden border-y border-[var(--color-border)] lg:grid-cols-4">
        {metrics.map((metric) => metric.href ? (
          <Link
            key={metric.id}
            href={metric.href}
            className="border-r border-[var(--color-border)] px-4 py-3 text-left hover:bg-[var(--color-surface-2)]"
          >
            <span className="text-eyebrow">{metric.label}</span>
            <span className="mt-1 block font-mono text-xl font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-[var(--color-text-subtle)]">{metric.detail}</span>
          </Link>
        ) : (
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
          <SelectTrigger className="w-48" aria-label="Estado del contrato"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(CONTRACT_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={relationship} onValueChange={setRelationship}>
          <SelectTrigger className="w-52" aria-label="Tipo de relación"><SelectValue placeholder="Relación" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda relación</SelectItem>
            {Object.entries(CONTRACTOR_RELATIONSHIP_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={worksite} onValueChange={setWorksite}>
          <SelectTrigger className="w-52" aria-label="Faena"><SelectValue placeholder="Faena" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las faenas</SelectItem>
            {worksites.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {(status !== "all" || worksite !== "all" || relationship !== "all" || quickFilter !== "all") && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Buildings size={20} />}
          title={contracts.length === 0 ? "Aún no hay contratos registrados" : "No hay contratos con estos filtros"}
          description={contracts.length === 0
            ? "El registro de faena del DS 76 parte al dar de alta una empresa contratista y su contrato. Un contrato nuevo nace con el acceso bloqueado hasta acreditar."
            : "Ajusta los filtros o el texto del buscador superior."}
          action={contracts.length > 0
            ? <Button type="button" variant="secondary" onClick={clearFilters}>Ver todos</Button>
            : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato / empresa</TableHead>
                <TableHead>Relación</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acceso a faena</TableHead>
                <TableHead className="text-right" title="Personas acreditadas sobre el total registrado">Acreditadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.companyName}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">{item.companyRut}</span>
                  </TableCell>
                  <TableCell className="text-sm">{CONTRACTOR_RELATIONSHIP_LABELS[item.relationship] ?? item.relationship}</TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.status)}>
                      {CONTRACT_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.accessBlocked ? "danger" : "success"}>
                      {item.accessBlocked ? "Bloqueado" : "Liberado"}
                    </Badge>
                    {item.accessBlockReason && (
                      <span className="mt-1 block max-w-xs text-xs text-[var(--color-text-subtle)]">{item.accessBlockReason}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.accreditedCount} / {item.workerCount}
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
