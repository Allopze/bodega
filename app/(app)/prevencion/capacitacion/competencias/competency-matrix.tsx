"use client"

import * as React from "react"
import Link from "next/link"
import { Certificate } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterToolbar } from "@/components/ui/filter-toolbar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import {
  COMPETENCY_SCOPE_LABELS,
  COMPETENCY_STATUS_LABELS,
  TRAINING_KIND_LABELS,
  competencyStatusBadgeVariant,
} from "@/lib/prevention/training"
import { revokeCompetencyAction } from "../actions"

interface CompetencyItem {
  id: string
  workerId: string
  workerName: string
  workerPosition: string | null
  worksiteName: string
  courseName: string
  courseKind: string
  status: string
  sourceType: string
  grantedAt: string
  expiresAt: string | null
  externalIssuer: string | null
  evidenceReference: string | null
  revocationReason: string | null
}

interface RequirementItem {
  id: string
  courseName: string
  scopeType: string
  scopeValue: string | null
  worksiteName: string | null
  enforcement: string
  reason: string
  isActive: boolean
}

interface Props {
  competencies: CompetencyItem[]
  requirements: RequirementItem[]
  courseCount: number
  canRevoke: boolean
  filteredWorkerId: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  session: "Sesión interna",
  convalidation: "Convalidación",
  external_certificate: "Certificado externo",
}

export function CompetencyMatrix({ competencies, requirements, courseCount, canRevoke, filteredWorkerId }: Props) {
  const { getFilter, setFilters, clearFilters: clearUrlFilters } = useUrlFilters()
  const status = getFilter("status") || "all"
  const [tab, setTab] = React.useState<"competencies" | "requirements">("competencies")
  const [pending, startTransition] = React.useTransition()
  const [message, setMessage] = React.useState<string | null>(null)

  const filtered = competencies.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    return true
  })

  function revoke(id: string) {
    const reason = window.prompt("Motivo de la revocación (mínimo 5 caracteres):")
    if (!reason || reason.trim().length < 5) return
    setMessage(null)
    startTransition(async () => {
      const result = await revokeCompetencyAction({ competencyId: id, reason: reason.trim() })
      setMessage(result.ok ? "Competencia revocada." : result.message ?? "No se pudo revocar.")
    })
  }

  return (
    <div className="space-y-4">
      {filteredWorkerId && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-sm">
          <span>Mostrando sólo las competencias de una persona.</span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/prevencion/capacitacion/competencias">Ver toda la dotación</Link>
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-[var(--color-border)] p-1">
          <button
            type="button"
            onClick={() => setTab("competencies")}
            aria-pressed={tab === "competencies"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]"
          >
            Competencias ({competencies.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("requirements")}
            aria-pressed={tab === "requirements"}
            className="rounded px-3 py-1 text-sm aria-pressed:bg-[var(--color-primary-tint)]"
          >
            Requisitos ({requirements.length})
          </button>
        </div>
      </div>

      {tab === "competencies" && (
        <FilterToolbar
          activeChips={status !== "all" ? [{ key: "status", label: "Estado", value: status, displayValue: (COMPETENCY_STATUS_LABELS as Record<string, string>)[status] ?? status }] : []}
          onRemoveChip={(key) => setFilters({ [key]: null })}
          onClearAll={clearUrlFilters}
          hasActiveFilters={status !== "all"}
        >
          <Select value={status} onValueChange={(value) => setFilters({ status: value === "all" ? null : value })}>
            <SelectTrigger className="w-48" aria-label="Estado de la competencia"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(COMPETENCY_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterToolbar>
      )}

      {message && <p role="status" className="text-sm">{message}</p>}

      {tab === "competencies" ? (
        filtered.length === 0 ? (
          <EmptyState
            icon={<Certificate size={20} />}
            title={competencies.length === 0 ? "Aún no hay competencias registradas" : "No hay competencias con estos filtros"}
            description={competencies.length === 0
              ? `Hay ${courseCount} curso(s) en catálogo. Una competencia se otorga al cerrar una sesión con asistencia y evaluación aprobada, o al convalidar un certificado externo.`
              : "Ajusta el estado o el texto del buscador superior."}
            action={competencies.length === 0
              ? <Button asChild><Link href="/prevencion/capacitacion">Ver sesiones</Link></Button>
              : <Button type="button" variant="secondary" onClick={() => clearUrlFilters()}>Ver todas</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trabajador</TableHead>
                  <TableHead>Curso</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Otorgada</TableHead>
                  <TableHead>Vence</TableHead>
                  {canRevoke && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="text-sm font-medium">{item.workerName}</span>
                      <span className="block text-xs text-[var(--color-text-subtle)]">{item.workerPosition ?? "Sin cargo"} · {item.worksiteName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{item.courseName}</span>
                      <span className="block text-xs text-[var(--color-text-subtle)]">{TRAINING_KIND_LABELS[item.courseKind] ?? item.courseKind}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {SOURCE_LABELS[item.sourceType] ?? item.sourceType}
                      {item.externalIssuer && <span className="block text-xs text-[var(--color-text-subtle)]">{item.externalIssuer}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={competencyStatusBadgeVariant(item.status)}>
                        {COMPETENCY_STATUS_LABELS[item.status] ?? item.status}
                      </Badge>
                      {item.revocationReason && <span className="block text-xs text-[var(--color-text-subtle)]">{item.revocationReason}</span>}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{item.grantedAt}</TableCell>
                    <TableCell className="text-sm tabular-nums">{item.expiresAt ?? "Sin vencimiento"}</TableCell>
                    {canRevoke && (
                      <TableCell className="text-right">
                        {item.status === "valid" && (
                          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => revoke(item.id)}>
                            Revocar
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : requirements.length === 0 ? (
        <EmptyState
          icon={<Certificate size={20} />}
          title="Aún no hay requisitos de competencia"
          description="Un requisito declara qué curso exige qué población (cargo, faena o toda la organización) y si su incumplimiento bloquea o sólo advierte."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Curso exigido</TableHead>
                <TableHead>Alcance</TableHead>
                <TableHead>Exigibilidad</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead>Fundamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requirements.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.courseName}</TableCell>
                  <TableCell className="text-sm">
                    {COMPETENCY_SCOPE_LABELS[item.scopeType] ?? item.scopeType}
                    {(item.scopeValue || item.worksiteName) && (
                      <span className="block text-xs text-[var(--color-text-subtle)]">{item.scopeValue ?? item.worksiteName}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.enforcement === "blocking" ? "danger" : "warning"}>
                      {item.enforcement === "blocking" ? "Bloqueante" : "Advertencia"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{item.isActive ? "Sí" : "No"}</TableCell>
                  <TableCell className="max-w-md text-xs text-[var(--color-text-subtle)]">{item.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
