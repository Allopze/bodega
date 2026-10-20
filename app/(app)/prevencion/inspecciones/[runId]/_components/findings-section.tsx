"use client"

import * as React from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import { closeInspectionFindingAction } from "../../actions"
import { CapaDialog, StopVehicleDialog } from "./finding-dialogs"
import { ReasonDialog } from "./run-detail-controls"
import type { RunViewModel } from "./run-view-types"

export type FindingsSectionModel = Pick<
  RunViewModel,
  "run" | "findings" | "assignees" | "canExecute" | "canReview" | "canRequestRecharge" | "canStopVehicle"
>

/**
 * Los hallazgos de una inspección ya declarada ejecutada o revisada: la tabla,
 * y por fila las acciones que correspondan (derivar a CAPA, sacar el equipo de
 * servicio, cerrar). La vista decide si se monta (`showFindings`).
 */
export function FindingsSection({ model }: { model: FindingsSectionModel }) {
  const { run, findings, assignees, canExecute, canReview, canRequestRecharge, canStopVehicle } = model
  return (
    <section id="hallazgos" className="scroll-mt-16 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Hallazgos ({findings.length})</h2>
        {findings.length > 0 && run.subjectResourceId && canRequestRecharge && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/solicitudes/nueva?tipo=otro&recursoEmergencia=${encodeURIComponent(run.subjectResourceId)}`}>
              Solicitar recarga
            </Link>
          </Button>
        )}
      </div>
      {findings.length === 0 ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-subtle)]">Sin hallazgos: todos los ítems evaluables cumplieron.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hallazgo</TableHead>
                <TableHead>Criticidad</TableHead>
                <TableHead>Estado</TableHead>
                {(canExecute || canReview) && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {findings.map((finding) => (
                <TableRow key={finding.id}>
                  <TableCell className="text-sm">{finding.description}</TableCell>
                  <TableCell><MetaBadge meta={{ label: `${FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality}`, variant: criticalityBadgeVariant(finding.criticality) }} /></TableCell>
                  <TableCell className="text-sm">
                    {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                    {finding.capaActionId && (
                      <Link href={`/prevencion/capa/${finding.capaActionId}`} className="ml-2 text-xs underline">Ver CAPA</Link>
                    )}
                  </TableCell>
                  {(canExecute || canReview) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* #20: el servidor no deriva desde un run ya revisado; reabrirlo es el camino. */}
                        {canExecute && run.status === "completed" && finding.status === "open" && <CapaDialog finding={finding} assignees={assignees} hasVehicle={!!run.subjectVehicleId} />}
                        {canStopVehicle && run.subjectVehicleId && ["high", "critical"].includes(finding.criticality) && (
                          <StopVehicleDialog finding={finding} subjectLabel={run.subjectLabel} />
                        )}
                        {/* B-06: cierre manual sólo para hallazgos sin CAPA.
                            Los que la tienen se cierran al verificar o
                            cerrar su acción, en la misma transacción. */}
                        {canReview && finding.status === "open" && !finding.capaActionId && (
                          <ReasonDialog
                            trigger="Cerrar hallazgo"
                            title="Cerrar hallazgo"
                            description={finding.description}
                            action={(reason) => closeInspectionFindingAction({ findingId: finding.id, reason })}
                            confirmVariant="default"
                            successMessage="Hallazgo cerrado."
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
