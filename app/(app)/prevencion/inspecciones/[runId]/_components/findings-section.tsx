"use client"

import * as React from "react"
import Link from "next/link"
import { MetaBadge } from "@/components/states/state-badge"
import { Button } from "@/components/ui/button"
import { ResponsiveDataListCard, ResponsiveDataListField } from "@/components/ui/responsive-data-list"
import { TableRoot, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  criticalityBadgeVariant,
  FINDING_CRITICALITY_LABELS,
  FINDING_STATUS_LABELS,
} from "@/lib/prevention/inspections"
import { closeInspectionFindingAction } from "../../actions"
import { CapaDialog, StopVehicleDialog } from "./finding-dialogs"
import { FindingEvidence } from "./inspection-evidence"
import { ReasonDialog } from "./run-detail-controls"
import type { RunViewModel } from "./run-view-types"
import type { FindingInfo } from "./types"

export type FindingsSectionModel = Pick<
  RunViewModel,
  "run" | "findings" | "assignees" | "canExecute" | "canReview" | "canRequestRecharge" | "canStopVehicle"
>

/** Qué acciones corresponden a un hallazgo, según el estado de la ejecución y los permisos de quien mira. */
export function findingActionFlags(
  finding: Pick<FindingInfo, "status" | "criticality" | "capaActionId">,
  model: Pick<FindingsSectionModel, "run" | "canExecute" | "canReview" | "canStopVehicle">,
) {
  const { run, canExecute, canReview, canStopVehicle } = model
  return {
    // #20: el servidor no deriva desde un run ya revisado; reabrirlo es el camino.
    derive: canExecute && run.status === "completed" && finding.status === "open",
    stop: canStopVehicle && !!run.subjectVehicleId && ["high", "critical"].includes(finding.criticality),
    // B-06: cierre manual sólo para hallazgos sin CAPA. Los que la tienen se cierran
    // al verificar o cerrar su acción, en la misma transacción.
    close: canReview && finding.status === "open" && !finding.capaActionId,
    viewCapa: !!finding.capaActionId,
  }
}

type FindingAction = "derive" | "stop" | "close"

const STATUS_VARIANT: Record<string, "warning" | "info" | "success"> = {
  open: "warning",
  capa_linked: "info",
  closed: "success",
}

function FindingStatus({ finding }: { finding: FindingInfo }) {
  return <MetaBadge meta={{ label: FINDING_STATUS_LABELS[finding.status] ?? finding.status, variant: STATUS_VARIANT[finding.status] ?? "default" }} />
}

function FindingSeverity({ finding }: { finding: FindingInfo }) {
  return <MetaBadge meta={{ label: FINDING_CRITICALITY_LABELS[finding.criticality] ?? finding.criticality, variant: criticalityBadgeVariant(finding.criticality) }} />
}

/**
 * Los botones de un hallazgo. Sólo piden abrir un diálogo (`onAction`): los
 * diálogos se montan una vez, arriba, y no uno por fila. Los botones miden 44 px
 * en el teléfono (`Button` ya lo hace) y «Ver CAPA» es un botón y no un enlace
 * suelto de 12 px.
 */
function FindingActions({ finding, model, onAction, className }: {
  finding: FindingInfo
  model: Pick<FindingsSectionModel, "run" | "canExecute" | "canReview" | "canStopVehicle">
  onAction: (action: FindingAction, finding: FindingInfo) => void
  className?: string
}) {
  const flags = findingActionFlags(finding, model)
  if (!flags.derive && !flags.stop && !flags.close && !flags.viewCapa) return null
  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      {flags.viewCapa && (
        <Button asChild size="sm" variant="secondary">
          <Link href={`/prevencion/capa/${finding.capaActionId}`}>Ver CAPA</Link>
        </Button>
      )}
      {flags.derive && <Button type="button" size="sm" variant="secondary" onClick={() => onAction("derive", finding)}>Derivar a CAPA</Button>}
      {flags.stop && <Button type="button" size="sm" variant="secondary" onClick={() => onAction("stop", finding)}>Sacar de servicio</Button>}
      {flags.close && <Button type="button" size="sm" variant="ghost" onClick={() => onAction("close", finding)}>Cerrar hallazgo</Button>}
    </div>
  )
}

/**
 * Los hallazgos de una inspección ya declarada ejecutada o revisada. Bajo `md`,
 * una tarjeta por hallazgo con sus acciones a la vista (la tabla se desbordaba a
 * 390 px y dejaba «Derivar a CAPA» fuera de la pantalla); desde `md`, la tabla.
 * Los diálogos de derivar a CAPA, sacar de servicio y cerrar se montan UNA vez y
 * se abren desde cualquier fila de cualquiera de los dos árboles. La vista decide
 * si se monta (`showFindings`).
 */
export function FindingsSection({ model }: { model: FindingsSectionModel }) {
  const { run, findings, assignees, canRequestRecharge } = model
  const [capaId, setCapaId] = React.useState<string | null>(null)
  const [stopId, setStopId] = React.useState<string | null>(null)
  const [closeId, setCloseId] = React.useState<string | null>(null)
  const byId = (id: string | null) => (id ? findings.find((item) => item.id === id) : undefined)
  const capaFinding = byId(capaId)
  const stopFinding = byId(stopId)
  const closeFinding = byId(closeId)

  const onAction = React.useCallback((action: FindingAction, finding: FindingInfo) => {
    if (action === "derive") setCapaId(finding.id)
    else if (action === "stop") setStopId(finding.id)
    else setCloseId(finding.id)
  }, [])

  const showActionColumn = findings.some((finding) => {
    const flags = findingActionFlags(finding, model)
    return flags.derive || flags.stop || flags.close || flags.viewCapa
  })

  return (
    <section id="hallazgos" aria-labelledby="hallazgos-titulo" className="scroll-mt-16 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hallazgos-titulo" className="text-h2">Hallazgos ({findings.length})</h2>
        {findings.length > 0 && run.subjectResourceId && canRequestRecharge && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/solicitudes/nueva?tipo=otro&recursoEmergencia=${encodeURIComponent(run.subjectResourceId)}`}>
              Solicitar recarga
            </Link>
          </Button>
        )}
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-[var(--color-text-subtle)]">Sin hallazgos: todos los ítems evaluables cumplieron.</p>
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {findings.map((finding) => (
              <li key={finding.id}>
                <ResponsiveDataListCard
                  title={<span className="block whitespace-normal break-words leading-snug">{finding.description}</span>}
                  status={<FindingSeverity finding={finding} />}
                  actions={<FindingActions finding={finding} model={model} onAction={onAction} className="flex flex-wrap items-center justify-end gap-2" />}
                >
                  <ResponsiveDataListField label="Estado"><FindingStatus finding={finding} /></ResponsiveDataListField>
                  {finding.evidence.length > 0 && (
                    <ResponsiveDataListField label="Evidencia" className="col-span-2">
                      <FindingEvidence findingId={finding.id} evidence={finding.evidence} editable={false} />
                    </ResponsiveDataListField>
                  )}
                </ResponsiveDataListCard>
              </li>
            ))}
          </ul>

          <TableRoot aria-label="Hallazgos de la inspección" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hallazgo</TableHead>
                  <TableHead>Gravedad</TableHead>
                  <TableHead>Estado</TableHead>
                  {showActionColumn && <TableHead className="text-right">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {findings.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell className="align-top text-sm">
                      <p className="break-words">{finding.description}</p>
                      {finding.evidence.length > 0 && <div className="mt-2"><FindingEvidence findingId={finding.id} evidence={finding.evidence} editable={false} /></div>}
                    </TableCell>
                    <TableCell className="align-top"><FindingSeverity finding={finding} /></TableCell>
                    <TableCell className="align-top"><FindingStatus finding={finding} /></TableCell>
                    {showActionColumn && (
                      <TableCell className="align-top">
                        <FindingActions finding={finding} model={model} onAction={onAction} className="flex flex-wrap items-center justify-end gap-2" />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableRoot>
        </>
      )}

      {capaFinding && (
        <CapaDialog
          key={capaFinding.id}
          finding={capaFinding}
          assignees={assignees}
          hasVehicle={!!run.subjectVehicleId}
          open
          onOpenChange={(next) => { if (!next) setCapaId(null) }}
          trigger={null}
        />
      )}
      {stopFinding && (
        <StopVehicleDialog
          key={stopFinding.id}
          finding={stopFinding}
          subjectLabel={run.subjectLabel}
          open
          onOpenChange={(next) => { if (!next) setStopId(null) }}
          trigger={null}
        />
      )}
      {closeFinding && (
        <ReasonDialog
          key={closeFinding.id}
          trigger={null}
          open
          onOpenChange={(next) => { if (!next) setCloseId(null) }}
          title="Cerrar hallazgo"
          description={closeFinding.description}
          confirmLabel="Cerrar hallazgo"
          action={(reason) => closeInspectionFindingAction({ findingId: closeFinding.id, reason })}
          confirmVariant="default"
          successMessage="Hallazgo cerrado."
        />
      )}
    </section>
  )
}
