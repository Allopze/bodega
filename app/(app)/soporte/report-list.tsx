"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody,
  TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { StateBadge } from "@/components/states/state-badge"
import { FEEDBACK_TIPO_LABELS } from "@/components/states/state-badge"
import { ChatCircleText } from "@phosphor-icons/react"
import type { FeedbackListRow } from "@/lib/services/feedback"
import type { FeedbackTipo, FeedbackEstado } from "@/lib/validation/feedback"

import { formatDate } from "@/lib/utils"

interface Props {
  reports:   FeedbackListRow[]
  canCreate: boolean
  canViewAll: boolean
}

export function ReportList({ reports, canCreate, canViewAll }: Props) {
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
    <TableRoot stickyHeader>
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
            <TableRow key={r.id}>
              <TableCell>
                <span className="text-sub">
                  {FEEDBACK_TIPO_LABELS[r.tipo as FeedbackTipo] ?? r.tipo}
                </span>
              </TableCell>
              <TableCell className="font-medium max-w-[32ch] truncate">
                <Link href={`/soporte/${r.id}`} className="underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
                  {r.titulo}
                </Link>
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
