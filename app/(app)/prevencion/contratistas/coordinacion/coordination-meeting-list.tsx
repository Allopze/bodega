"use client"

import * as React from "react"
import Link from "next/link"
import { UsersThree } from "@phosphor-icons/react"
import { useSafeShellHeader } from "@/components/layout/header-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { COORDINATION_STATUS_LABELS } from "@/lib/prevention/contractors"
import { formatDateTime } from "@/lib/utils"

interface MeetingItem {
  id: string
  code: string
  heldAt: string
  subject: string
  status: string
  worksiteName: string
  riskExchangeSummary: string | null
  convenedCount: number
  attendedCount: number
}

function statusBadgeVariant(status: string): "default" | "info" | "success" | "outline" {
  if (status === "closed") return "success"
  if (status === "held") return "info"
  if (status === "cancelled") return "outline"
  return "default"
}

export function CoordinationMeetingList({ meetings }: { meetings: MeetingItem[] }) {
  const { searchQuery } = useSafeShellHeader()
  const [status, setStatus] = React.useState("all")

  const query = searchQuery.trim().toLocaleLowerCase("es-CL")
  const filtered = meetings.filter((item) => {
    if (status !== "all" && item.status !== status) return false
    if (!query) return true
    return `${item.code} ${item.subject} ${item.worksiteName}`.toLocaleLowerCase("es-CL").includes(query)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-52" aria-label="Estado de la reunión"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(COORDINATION_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        {status !== "all" && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setStatus("all")}>Limpiar filtros</Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<UsersThree size={20} />}
          title={meetings.length === 0 ? "Aún no hay reuniones de coordinación" : "No hay reuniones con estos filtros"}
          description={meetings.length === 0
            ? "El DS 76 exige coordinación efectiva entre la empresa principal y sus contratistas. Al cerrar un acta, cada acuerdo se convierte en una acción CAPA con responsable y plazo."
            : "Ajusta el estado o el texto del buscador superior."}
          action={meetings.length === 0
            ? <Button asChild variant="secondary"><Link href="/prevencion/contratistas">Ver contratos</Link></Button>
            : <Button type="button" variant="secondary" onClick={() => setStatus("all")}>Ver todas</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código / asunto</TableHead>
                <TableHead>Faena</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right" title="Contratos convocados y asistentes">Convocados / Asistentes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{item.code}</span>
                    <span className="block text-sm">{item.subject}</span>
                    {item.riskExchangeSummary && (
                      <span className="block max-w-md text-xs text-[var(--color-text-subtle)]">{item.riskExchangeSummary}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{item.worksiteName}</TableCell>
                  <TableCell className="text-sm tabular-nums">{formatDateTime(item.heldAt)}</TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(item.status)}>
                      {COORDINATION_STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {item.convenedCount} / {item.attendedCount}
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
