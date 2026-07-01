"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCellNum,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Truck, Plus, Check } from "@phosphor-icons/react"
import { toast } from "@/lib/toast"
import type { EquipmentDailyReport } from "@/db/schema"
import { ReporteForm } from "./reporte-form"
import { reviewEquipmentReportAction } from "../actions"

interface WorkerSummary {
  id: string
  firstName: string
  lastName: string
}

interface ReportRow extends EquipmentDailyReport {
  operator: WorkerSummary | null
}

interface Props {
  reports: ReportRow[]
  worksites: { id: string; name: string }[]
  workers: WorkerSummary[]
  canManage: boolean
  showForm: boolean
  onShowFormChange: (show: boolean) => void
}

const STATUS_VARIANT: Record<string, "default" | "warning" | "danger"> = {
  ok: "default",
  observado: "warning",
  fuera_servicio: "danger",
}

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  observado: "Observado",
  fuera_servicio: "Fuera de servicio",
}

export function ReporteList({ reports, worksites, workers, canManage, showForm, onShowFormChange }: Props) {
  const router = useRouter()
  const [reviewing, setReviewing] = React.useState<string | null>(null)

  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  function operatorName(w: WorkerSummary | null) {
    if (!w) return "—"
    return `${w.firstName} ${w.lastName}`.trim()
  }

  async function onApprove(reportId: string) {
    setReviewing(reportId)
    const result = await reviewEquipmentReportAction({ reportId, status: "aprobado", findings: {} })
    setReviewing(null)
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success("Reporte aprobado.")
    router.refresh()
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Truck size={28} />}
          title="Sin reportes diarios"
          description="No hay reportes de uso diario de equipos registrados para tu alcance."
          action={
            canManage ? (
              <Button onClick={() => onShowFormChange(true)}>
                <Plus size={16} className="mr-1" />
                Nuevo reporte
              </Button>
            ) : undefined
          }
        />
        {canManage && showForm ? (
          <ReporteForm worksites={worksites} workers={workers} onDone={() => onShowFormChange(false)} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && showForm ? (
        <ReporteForm worksites={worksites} workers={workers} onDone={() => onShowFormChange(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipo</TableHead>
              <TableHead>Operador</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Odómetro</TableHead>
              <TableHead>Horómetro</TableHead>
              <TableHead>Fecha</TableHead>
              {canManage ? <TableHead><span className="sr-only">Acciones</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.equipmentId}</TableCell>
                <TableCell>{operatorName(r.operator)}</TableCell>
                <TableCell>{worksiteName(r.worksiteId)}</TableCell>
                <TableCell>{r.shift}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "default"}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </TableCell>
                <TableCellNum>{r.odometer ?? "—"}</TableCellNum>
                <TableCellNum>{r.hourmeter ?? "—"}</TableCellNum>
                <TableCell className="font-mono text-xs">{r.reportedAt?.slice(0, 10)}</TableCell>
                {canManage ? (
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={reviewing === r.id}
                      onClick={() => onApprove(r.id)}
                    >
                      <Check size={14} className="mr-1" />
                      {reviewing === r.id ? "Aprobando…" : "Aprobar"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
