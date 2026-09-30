"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { approveMiperFinalAction, approveMiperTechnicalAction, discardMiperDraftAction, requestMiperCorrectionsAction, returnMiperAction, submitMiperAction } from "../actions"

type Dialogs = "return" | "approveTechnical" | "requestCorrections" | "approveFinal" | "discard" | "blocking" | null

export function WorkflowBar({ workspace, mode, issues, openObservations }: { workspace: MiperWorkspace; mode: WorkspaceMode; issues: CompletenessIssue[]; openObservations: number }) {
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [changeSummary, setChangeSummary] = useState("")
  const operation = useOperation({ feedback: "toast" })
  const { matrix } = workspace
  const blocking = issues.filter((issue) => issue.severity === "error")
  const base = { matrixId: matrix.id, expectedVersion: matrix.version }
  const close = () => setDialog(null)
  const canSubmit = mode.canEdit && ["none", "observed"].includes(matrix.reviewState) && (matrix.status === "draft" || matrix.reviewState === "observed" || workspace.pendingDiff.hasChanges)
  const neverSubmitted = matrix.status === "draft" && matrix.reviewState === "none" && workspace.versions.length === 0 && !workspace.openRound
  const latest = workspace.versions[0]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {latest && <Button asChild variant="secondary"><a href={`/api/prevencion/miper/${latest.id}/export`}>Descargar v{latest.versionNumber} (Excel)</a></Button>}
      {mode.canEdit && neverSubmitted && <Button variant="secondary" onClick={() => setDialog("discard")}>Descartar borrador</Button>}
      {canSubmit && (
        <Button onClick={() => blocking.length > 0 ? setDialog("blocking") : operation.run(() => submitMiperAction(base))} disabled={operation.pending}>
          {matrix.reviewState === "observed" ? "Reenviar a revisión" : "Enviar a revisión"}{blocking.length > 0 ? ` (${blocking.length} pendientes)` : ""}
        </Button>
      )}
      {mode.canReviewTechnical && <>
        <Button variant="secondary" onClick={() => setDialog("return")}>Devolver con observaciones</Button>
        <Button onClick={() => setDialog("approveTechnical")} disabled={openObservations > 0} title={openObservations > 0 ? "Hay observaciones abiertas: devuelve la MIPER o resuélvelas." : undefined}>Aprobar revisión técnica</Button>
      </>}
      {mode.canApproveLegal && <>
        <Button variant="secondary" onClick={() => setDialog("requestCorrections")}>Solicitar correcciones</Button>
        <Button onClick={() => setDialog("approveFinal")} disabled={openObservations > 0}>Aprobar (Legal y RRHH)</Button>
      </>}

      <Dialog open={dialog === "blocking"} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Faltan {blocking.length} datos para enviar</DialogTitle>
            <DialogDescription>Corrige lo siguiente en la matriz o en los antecedentes. Cada fila marcada en la grilla muestra su detalle.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm">
            {blocking.slice(0, 40).map((issue, index) => {
              const row = issue.entryId ? workspace.snapshot.entries.find((entry) => entry.id === issue.entryId)?.rowNumber : null
              return <li key={index}>{row ? `Riesgo #${row}: ` : "Antecedentes: "}{issue.message}</li>
            })}
          </ul>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={dialog === "return"} onOpenChange={(open) => { if (!open) close() }} title="Devolver con observaciones"
        description={`La MIPER vuelve a la prevencionista con ${openObservations} observación(es) abierta(s).`} confirmLabel="Devolver" variant="warning"
        reasonLabel="Comentario para la prevencionista" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => returnMiperAction({ ...base, comment: reason }), close)} />
      <ConfirmDialog open={dialog === "approveTechnical"} onOpenChange={(open) => { if (!open) close() }} title="Aprobar revisión técnica"
        description="La MIPER pasa a aprobación de Legal y RRHH. Las observaciones respondidas quedan resueltas." confirmLabel="Aprobar revisión técnica" loading={operation.pending}
        onConfirm={() => operation.run(() => approveMiperTechnicalAction(base), close)} />
      <ConfirmDialog open={dialog === "requestCorrections"} onOpenChange={(open) => { if (!open) close() }} title="Solicitar correcciones"
        description="La MIPER vuelve a la prevencionista; después de corregirla pasa otra vez por la revisión técnica." confirmLabel="Solicitar correcciones" variant="warning"
        reasonLabel="Qué debe corregirse" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => requestMiperCorrectionsAction({ ...base, comment: reason }), close)} />
      <ConfirmDialog open={dialog === "discard"} onOpenChange={(open) => { if (!open) close() }} title="Descartar borrador"
        description="El borrador se elimina. Queda registrado en la auditoría." confirmLabel="Descartar" variant="destructive" reasonLabel="Motivo" loading={operation.pending}
        onConfirm={(reason) => operation.run(() => discardMiperDraftAction({ ...base, reason }), () => { window.location.assign("/prevencion/miper") })} />

      <Dialog open={dialog === "approveFinal"} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar la MIPER (Legal y RRHH)</DialogTitle>
            <DialogDescription>Se sella la versión v{(latest?.versionNumber ?? 0) + 1} con lo revisado técnicamente. La versión anterior se conserva.</DialogDescription>
          </DialogHeader>
          <Field label="Resumen de cambios (hoja Modificaciones)" required>
            <Textarea value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} minLength={10} maxLength={3000} placeholder={latest ? "Qué cambió respecto de la versión anterior" : "Emisión inicial del documento."} />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>Cancelar</Button>
            <Button disabled={operation.pending || changeSummary.trim().length < 10} onClick={() => operation.run(() => approveMiperFinalAction({ ...base, changeSummary }), () => { close(); setChangeSummary("") })}>Aprobar y sellar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {mode.readOnlyReason && <span className="text-sm text-[var(--color-text-subtle)]">{mode.readOnlyReason}</span>}
      {mode.isSubmitter && workspace.openRound && <span className="text-sm text-[var(--color-text-subtle)]">Enviaste esta ronda: la revisa otra persona.</span>}
      <Link href="/prevencion/miper" className="sr-only">Volver a la lista</Link>
    </div>
  )
}
