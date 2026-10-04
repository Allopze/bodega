"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { countOf } from "@/lib/utils"
import { useOperation } from "@/lib/hooks/use-operation"
import { PREPARATION_GROUPS, preparationGroupOf } from "@/lib/prevention/miper/preparation"
import { stepOfField, type EditorStep } from "@/lib/prevention/miper/entry-navigation"
import { hrefToEntry, hrefToFicha, hrefToMatrix } from "@/lib/prevention/miper/workspace-url"
import { WorkspaceLink } from "./workspace-nav"
import type { CompletenessIssue } from "@/lib/prevention/miper/completeness"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"
import { approveMiperFinalAction, approveMiperTechnicalAction, discardMiperDraftAction, requestMiperCorrectionsAction, returnMiperAction, submitMiperAction } from "../actions"

type Dialogs = "return" | "approveTechnical" | "requestCorrections" | "approveFinal" | "discard" | "blocking" | null

/**
 * Acciones de cabecera del espacio de trabajo (spec §4): «Ficha del documento»,
 * la decisión principal del flujo y «Más» (descargar, descartar). El estado
 * («sólo lectura», «enviaste esta ronda») lo dice ahora `NextStepCard`.
 */
export function WorkflowBar({ workspace, mode, issues, openObservations, onOpenEntry, onOpenFicha }: {
  workspace: MiperWorkspace; mode: WorkspaceMode; issues: CompletenessIssue[]; openObservations: number
  onOpenEntry?: (entryId: string, step?: EditorStep) => void
  onOpenFicha?: () => void
}) {
  const pathname = usePathname()
  const params = useSearchParams()
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
  const canDiscard = mode.canEdit && neverSubmitted

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onOpenFicha && <Button variant="secondary" onClick={onOpenFicha}>Ficha del documento</Button>}
      {canSubmit && (
        <Button onClick={() => blocking.length > 0 ? setDialog("blocking") : operation.run(() => submitMiperAction(base))} disabled={operation.pending}>
          {matrix.reviewState === "observed" ? "Reenviar a revisión" : "Enviar a revisión"}
        </Button>
      )}
      {mode.canReviewTechnical && <>
        <Button variant="secondary" onClick={() => setDialog("return")} disabled={openObservations === 0} title={openObservations === 0 ? "Registra al menos una observación antes de devolverla: el servidor la exige." : undefined}>Devolver con observaciones</Button>
        <Button onClick={() => setDialog("approveTechnical")} disabled={openObservations > 0} title={openObservations > 0 ? "Hay observaciones abiertas: devuelve la MIPER o resuélvelas." : undefined}>Aprobar revisión técnica</Button>
      </>}
      {mode.canApproveLegal && <>
        <Button variant="secondary" onClick={() => setDialog("requestCorrections")}>Solicitar correcciones</Button>
        <Button onClick={() => setDialog("approveFinal")} disabled={openObservations > 0}>Aprobar (Legal y RRHH)</Button>
      </>}
      {(latest || canDiscard) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="secondary" aria-label="Más acciones de la MIPER">Más</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {latest && <DropdownMenuItem asChild><a href={`/api/prevencion/miper/${latest.id}/export`}>Descargar v{latest.versionNumber} (Excel)</a></DropdownMenuItem>}
            {canDiscard && <DropdownMenuItem onSelect={() => setDialog("discard")}>Descartar borrador</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={dialog === "blocking"} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{blocking.length === 1 ? "Falta" : "Faltan"} {countOf(blocking.length, "dato")} para enviar</DialogTitle>
            <DialogDescription>Los cambios se guardan automáticamente. Completa estos datos antes de enviar; cada pendiente abre el lugar donde se corrige.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
            {PREPARATION_GROUPS.map((group) => {
              const items = blocking.filter((issue) => preparationGroupOf(issue) === group.key)
              if (!items.length) return null
              return <section key={group.key} aria-labelledby={`preparation-${group.key}`} className="space-y-2">
                <h3 id={`preparation-${group.key}`} className="font-semibold">{group.title} ({items.length})</h3>
                <ul className="space-y-2">
                  {items.map((issue, index) => {
                    const entry = issue.entryId ? workspace.snapshot.entries.find((item) => item.id === issue.entryId) : undefined
                    const label = <><span className="font-medium">{entry ? `Riesgo #${entry.rowNumber}` : issue.field === "entries" ? "Riesgos" : "Ficha del documento"}</span>: {issue.message}</>
                    const className = "text-left text-[var(--color-primary-ink)] underline underline-offset-2"
                    if (issue.scope === "header" && issue.field !== "entries" && onOpenFicha) {
                      return <li key={index}><button type="button" className={className} onClick={() => { close(); onOpenFicha() }}>{label}</button></li>
                    }
                    if (entry && onOpenEntry) {
                      return <li key={index}><button type="button" className={className} onClick={() => { close(); onOpenEntry(entry.id, stepOfField(issue.field)) }}>{label}</button></li>
                    }
                    return <li key={index}><WorkspaceLink className={className} onClick={close} href={entry ? hrefToEntry(pathname, params, entry.id, stepOfField(issue.field)) : issue.field === "entries" ? hrefToMatrix(pathname, params) : hrefToFicha(pathname, params, true)}>{label}</WorkspaceLink></li>
                  })}
                </ul>
              </section>
            })}
          </div>
          <DialogFooter><Button variant="secondary" onClick={close}>Cerrar y seguir completando</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={dialog === "return"} onOpenChange={(open) => { if (!open) close() }} title="Devolver con observaciones"
        description={`La MIPER vuelve a la prevencionista con ${countOf(openObservations, "observación abierta", "observaciones abiertas")}.`} confirmLabel="Devolver" variant="warning"
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

      <Link href="/prevencion/miper" className="sr-only">Volver a la lista</Link>
    </div>
  )
}
