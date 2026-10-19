"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { assessRunReview } from "@/lib/prevention/inspections"
import { reviewInspectionRunAction } from "../../actions"
import { Field } from "@/components/ui/field"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import type { RunInfo, FindingInfo } from "./types"
import { CapaDialog } from "./finding-dialogs"

/* ── Revisar y cerrar ─────────────────────────────────────────────────────── */

export function ReviewDialog({ run, findings, currentUserId, version, assignees, canExecute }: {
  run: RunInfo
  findings: FindingInfo[]
  currentUserId: string
  /** Versión vigente del run: desde C-02 el guardado la avanza, así que las props pueden estar atrasadas. */
  version: number
  /** I-07: para poder derivar a CAPA sin salir del diálogo de revisión. */
  assignees: { id: string; name: string }[]
  canExecute: boolean
}) {
  const [open, setOpen] = React.useState(false)
  // Hallazgo que se está derivando. Un solo `CapaDialog` para toda la lista de
  // bloqueos, y fuera del `<form>`: anidado dentro, su `submit` se propagaba por
  // el árbol de React hasta el formulario de revisión (P1-3).
  const [capaFindingId, setCapaFindingId] = React.useState<string | null>(null)
  const operation = useOperation()
  const review = React.useMemo(() => assessRunReview({
    executedByUserId: run.executedByUserId,
    reviewerUserId: currentUserId,
    findings: findings.map((item) => ({ id: item.id, description: item.description, criticality: item.criticality, capaActionId: item.capaActionId, status: item.status })),
    // Sin esto la vista pedía una independencia que el servidor no exige (#47).
    executorOfRecord: run.executorOfRecord,
  }), [run.executedByUserId, run.executorOfRecord, currentUserId, findings])
  const capaFinding = capaFindingId ? findings.find((item) => item.id === capaFindingId) : undefined

  function changeOpen(next: boolean) {
    operation.setMessage("")
    if (!next) setCapaFindingId(null)
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary">Revisar y cerrar{!review.allowed ? ` · ${review.blockers.length} bloqueo${review.blockers.length === 1 ? "" : "s"}` : ""}</Button></DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            operation.run(() => reviewInspectionRunAction({
              runId: run.id,
              expectedVersion: version,
              reviewComment: form.get("reviewComment"),
            }), () => {
              toast.success("Inspección revisada y cerrada.")
              changeOpen(false)
            })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Revisar y cerrar {run.code}</DialogTitle>
            <DialogDescription>Exige independencia de quien ejecutó y que todo hallazgo alto o crítico tenga CAPA enlazada.</DialogDescription>
          </DialogHeader>
          {!review.allowed && (
            <div className="space-y-2 rounded-md border border-[var(--color-danger-line)] p-3 text-sm">
              <p className="font-medium">No se puede cerrar:</p>
              <ul className="list-disc space-y-2 pl-4">
                {review.blockers.map((item) => {
                  // I-07: el bloqueador trae el hallazgo que falta derivar — se
                  // ofrece derivarlo ACÁ, sin cerrar este diálogo (el comentario
                  // de revisión es un textarea no controlado y se perdería si se
                  // desmontara). El diálogo de CAPA se monta una sola vez, abajo.
                  const finding = item.findingId ? findings.find((f) => f.id === item.findingId) : undefined
                  return (
                    <li key={item.detail} className="flex flex-wrap items-center gap-2">
                      <span>{item.detail}</span>
                      {finding && (canExecute
                        ? <Button type="button" size="sm" variant="secondary" onClick={() => setCapaFindingId(finding.id)}>Derivar a CAPA</Button>
                        : <a href="#hallazgos" className="text-xs underline">Ver en Hallazgos</a>)}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <Field label="Comentario de revisión" hint="Mínimo 10 caracteres." error={operation.fieldError("reviewComment")}>
            <Textarea name="reviewComment" required minLength={10} maxLength={3000} />
          </Field>
          {operation.messageTone === "error" && operation.message && <Callout tone="danger" role="alert">{operation.message}</Callout>}
          <DialogFooter><Button type="submit" loading={operation.pending} disabled={!review.allowed}>Revisar y cerrar</Button></DialogFooter>
        </form>
        {capaFinding && (
          <CapaDialog
            key={capaFinding.id}
            finding={capaFinding}
            assignees={assignees}
            hasVehicle={!!run.subjectVehicleId}
            open
            onOpenChange={(next) => { if (!next) setCapaFindingId(null) }}
            trigger={null}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
