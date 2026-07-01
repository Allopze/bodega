"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Siren, Plus, CaretRight } from "@phosphor-icons/react"
import type { PreventionIncident } from "@/db/schema"
import { IncidentForm } from "./incident-form"
import { formatDateDisplay } from "@/lib/sst/date"
import { INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_VARIANTS, INCIDENT_STATUS_LABELS, incidentStatusVariant } from "@/lib/prevention/badges"

interface WorkerSummary {
  firstName: string
  lastName: string
  rut: string | null
}

interface IncidentRow extends PreventionIncident {
  worker: WorkerSummary | null
}

interface Props {
  incidents: IncidentRow[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  canClose: boolean
  showForm: boolean
  onShowFormChange: (show: boolean) => void
}

export function IncidentList({ incidents, worksites, canManage, showForm, onShowFormChange }: Props) {
  const router = useRouter()

  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  function fullName(w: WorkerSummary | null) {
    if (!w) return "—"
    return `${w.firstName} ${w.lastName}`.trim()
  }

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Siren size={28} />}
          title="Sin incidentes registrados"
          description="No hay eventos de seguridad registrados para tu alcance."
          action={
            canManage ? (
              <Button onClick={() => onShowFormChange(true)}>
                <Plus size={16} className="mr-1" />
                Registrar incidente
              </Button>
            ) : undefined
          }
        />
        {canManage && showForm ? (
          <IncidentForm worksites={worksites} onDone={() => onShowFormChange(false)} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && showForm ? (
        <IncidentForm worksites={worksites} onDone={() => onShowFormChange(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Trabajador</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Gravedad</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead><span className="sr-only">Ver</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((i) => (
              <TableRow
                key={i.id}
                role="link"
                tabIndex={0}
                aria-label={`Ver incidente ${i.title}`}
                className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
                onClick={() => router.push(`/prevencion/incidentes/${i.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    router.push(`/prevencion/incidentes/${i.id}`)
                  }
                }}
              >
                <TableCell className="font-mono text-xs">{formatDateDisplay(i.occurredAt.slice(0, 10))}</TableCell>
                <TableCell>{INCIDENT_TYPE_LABELS[i.type] ?? i.type}</TableCell>
                <TableCell className="font-medium">{i.title}</TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{fullName(i.worker)}</span>
                    {i.worker?.rut ? (
                      <span className="text-xs text-[var(--color-text-subtle)] font-mono">{i.worker.rut}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>{worksiteName(i.worksiteId)}</TableCell>
                <TableCell>
                  <Badge variant={INCIDENT_SEVERITY_VARIANTS[i.severity] ?? "default"}>{i.severity}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={incidentStatusVariant(i.status)}>
                    {INCIDENT_STATUS_LABELS[i.status] ?? i.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/prevencion/incidentes/${i.id}`} className="text-[var(--color-primary)]">
                    <CaretRight size={16} />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
