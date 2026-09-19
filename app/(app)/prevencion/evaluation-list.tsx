"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { ClipboardText, CaretRight } from "@phosphor-icons/react"
import {
  RESULTADO_LABELS,
  estadoLabel,
  estadoBadgeVariant,
  resultadoBadgeVariant,
} from "@/lib/sst/badges"
import type { WorkerEvaluationGroup } from "@/lib/services/sst"
import { ADMIN_CONTRATO_DEFAULT_LABEL } from "@/lib/prevention/admin-contrato-label"

interface Props {
  workerGroups: WorkerEvaluationGroup[]
  canCreate: boolean
  canDelete: boolean
}

export function EvaluationList({ workerGroups, canCreate }: Props) {
  const router = useRouter()

  if (workerGroups.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardText size={28} />}
        title="Sin evaluaciones"
        description="No hay evaluaciones SST registradas para tu faena."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/prevencion/nueva">Nueva Evaluación</Link>
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
            <TableHead>Trabajador</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Prevencionista</TableHead>
            <TableHead>{ADMIN_CONTRATO_DEFAULT_LABEL}</TableHead>
            <TableHead>Conductor Líder</TableHead>
            <TableHead><span className="sr-only">Ver</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workerGroups.map((group) => {
            const href = `/prevencion/trabajador/${group.workerId}`

            // Find evaluations for each role
            const prevEval = group.evaluations.find(e => e.evaluatorRole === 'prevencionista_faena' || e.evaluatorRole === null)
            const adminEval = group.evaluations.find(e => e.evaluatorRole === 'admin_contrato')
            const condEval = group.evaluations.find(e => e.evaluatorRole === 'conductor_lider')

            return (
              <TableRow
                key={group.workerId}
                role="link"
                tabIndex={0}
                aria-label={`Ver evaluaciones SST de ${group.workerName || "trabajador sin nombre"}`}
                className="cursor-pointer hover:bg-[var(--color-primary-tint)]"
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    router.push(href)
                  }
                }}
              >
                <TableCell>
                  <div>
                    <Link
                      href={href}
                      onClick={(event) => event.stopPropagation()}
                      // 24px de alto minimo (WCAG 2.5.8): el enlace media 13px
                      // y era el objetivo principal de la fila.
                      className="inline-flex min-h-6 items-center font-medium text-(--color-text) hover:underline"
                    >
                      {group.workerName || <span className="text-text-subtle italic">Sin nombre</span>}
                    </Link>
                    {group.workerRut && (
                      <div className="text-xs text-(--color-text-muted)">
                        RUT: {group.workerRut}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-(--color-text-muted)">
                  {group.worksiteName || <span className="italic">—</span>}
                </TableCell>
                <TableCell>
                  {prevEval ? (
                    <div className="flex flex-col gap-1 items-start">
                      <MetaBadge meta={{ label: `${estadoLabel(prevEval.estado)}`, variant: estadoBadgeVariant(prevEval.estado) }} />
                      {prevEval.resultadoFinal && (
                        <MetaBadge meta={{ label: `${RESULTADO_LABELS[prevEval.resultadoFinal] ?? prevEval.resultadoFinal}`, variant: resultadoBadgeVariant(prevEval.resultadoFinal) }} />
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-(--color-text-muted) italic">Pendiente</span>
                  )}
                </TableCell>
                <TableCell>
                  {adminEval ? (
                    <div className="flex flex-col gap-1 items-start">
                      <MetaBadge meta={{ label: `${estadoLabel(adminEval.estado)}`, variant: estadoBadgeVariant(adminEval.estado) }} />
                      {adminEval.resultadoFinal && (
                        <MetaBadge meta={{ label: `${RESULTADO_LABELS[adminEval.resultadoFinal] ?? adminEval.resultadoFinal}`, variant: resultadoBadgeVariant(adminEval.resultadoFinal) }} />
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-(--color-text-muted) italic">Pendiente</span>
                  )}
                </TableCell>
                <TableCell>
                  {condEval ? (
                    <div className="flex flex-col gap-1 items-start">
                      <MetaBadge meta={{ label: `${estadoLabel(condEval.estado)}`, variant: estadoBadgeVariant(condEval.estado) }} />
                      {condEval.resultadoFinal && (
                        <MetaBadge meta={{ label: `${RESULTADO_LABELS[condEval.resultadoFinal] ?? condEval.resultadoFinal}`, variant: resultadoBadgeVariant(condEval.resultadoFinal) }} />
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-(--color-text-muted) italic">Pendiente</span>
                  )}
                </TableCell>
                <TableCell className="w-12 text-right text-(--color-text-muted)">
                  <CaretRight size={16} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
