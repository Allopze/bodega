"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { toast } from "@/lib/toast"
import { formatDateSafe } from "@/lib/sst/date"
import { acknowledgeEppDeliveryAction } from "./actions"

interface Delivery {
  id: string
  workerId: string
  eppProductId: string
  deliveredAt: string
  evidenceUrl: string | null
  acknowledgedAt: string | null
}

interface Props {
  deliveries: Delivery[]
  workers: { id: string; firstName: string; lastName: string }[]
  canManage: boolean
}

export function EppDeliveriesList({ deliveries, workers, canManage }: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  const workerName = React.useCallback(
    (id: string) => {
      const w = workers.find((worker) => worker.id === id)
      return w ? `${w.firstName} ${w.lastName}` : id
    },
    [workers],
  )

  async function onAcknowledge(id: string) {
    setPendingId(id)
    const result = await acknowledgeEppDeliveryAction(id)
    setPendingId(null)
    if (!result.ok) {
      toast.error(result.message ?? "No se pudo registrar el acuse de recibo.")
      return
    }
    toast.success(result.message ?? "Acuse de recibo registrado.")
    router.refresh()
  }

  if (deliveries.length === 0) {
    return <EmptyState compact title="Sin entregas registradas" description="Aún no se han registrado entregas de EPP para esta faena." />
  }

  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trabajador</TableHead>
            <TableHead>EPP</TableHead>
            <TableHead>Entregado</TableHead>
            <TableHead>Acta</TableHead>
            <TableHead>Acuse de recibo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{workerName(d.workerId)}</TableCell>
              <TableCell className="font-mono text-xs">{d.eppProductId}</TableCell>
              <TableCell>{formatDateSafe(d.deliveredAt)}</TableCell>
              <TableCell>
                {d.evidenceUrl ? (
                  <a href={d.evidenceUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-primary)] underline">
                    Ver acta
                  </a>
                ) : "-"}
              </TableCell>
              <TableCell>
                {d.acknowledgedAt ? (
                  <Badge variant="success">Firmado {formatDateSafe(d.acknowledgedAt)}</Badge>
                ) : canManage ? (
                  <Button size="sm" variant="secondary" disabled={pendingId === d.id} onClick={() => onAcknowledge(d.id)}>
                    {pendingId === d.id ? "Guardando…" : "Registrar acuse"}
                  </Button>
                ) : (
                  <Badge variant="warning">Pendiente</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
