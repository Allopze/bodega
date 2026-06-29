"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { StateBadge } from "@/components/states/state-badge"
import { FEEDBACK_TIPO_LABELS } from "@/components/states/state-badge"
import { ChatCircleText } from "@phosphor-icons/react"
import type { FeedbackRow } from "@/lib/services/feedback"
import type { FeedbackTipo, FeedbackEstado } from "@/lib/validation/feedback"

interface Props {
  reports:   FeedbackRow[]
  canCreate: boolean
  canViewAll: boolean
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  })
}

export function ReportList({ reports, canCreate, canViewAll }: Props) {
  const router = useRouter()

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={<ChatCircleText size={28} />}
        title="Sin reportes"
        description={
          canViewAll
            ? "Aún no hay reportes de soporte en la plataforma."
            : "No has enviado ningún reporte aún."
        }
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/soporte/nuevo">Nuevo reporte</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Título</TableHead>
            {canViewAll && <TableHead>Autor</TableHead>}
            <TableHead>Prioridad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>SLA</TableHead>
            <TableHead>Fecha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow
              key={r.id}
              className="cursor-pointer"
              onClick={() => router.push(`/soporte/${r.id}`)}
            >
              <TableCell>
                <span className="text-sub">
                  {FEEDBACK_TIPO_LABELS[r.tipo as FeedbackTipo] ?? r.tipo}
                </span>
              </TableCell>
              <TableCell className="font-medium max-w-[32ch] truncate">
                {r.titulo}
              </TableCell>
              {canViewAll && (
                <TableCell className="text-sub">{r.authorName}</TableCell>
              )}
              <TableCell className="capitalize">{r.priority}</TableCell>
              <TableCell>
                <StateBadge state={r.estado as FeedbackEstado} entity="feedback" />
              </TableCell>
              <TableCell className="text-sub whitespace-nowrap">
                {r.dueAt ? formatDate(r.dueAt) : "—"}
              </TableCell>
              <TableCell className="text-sub whitespace-nowrap">
                {formatDate(r.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
