"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle, Eye, FilePdf } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MantRecordStatus, MantReview } from "@/lib/mantencion/types"
import { markRecordReviewedAction, observeRecordAction, voidRecordAction } from "@/app/(app)/mantencion/registros/[id]/actions"
import { RecordExportButton } from "@/app/(app)/mantencion/registros/[id]/record-export-button"

export interface RecordActionsProps {
  recordId: string
  folio: string | null
  status: MantRecordStatus
  review: MantReview
  canExport: boolean
  canObserve: boolean
  canReview: boolean
  canVoid: boolean
  /** Quien puede abrir la app del mecánico puede crear el registro corregido. */
  canCorrect: boolean
}

/**
 * Acciones del detalle (§10), todas según permiso: Descargar PDF, Exportar a
 * Excel, Observar, Marcar revisado y Anular. Van en `PageHeader.actions`
 * (regla 5 de AGENTS.md). Los permisos que llegan aquí sólo deciden qué botones
 * se dibujan: el servidor vuelve a pedirlos en cada acción.
 *
 * Los diálogos son propios, con el verbo en el botón; nunca `window.confirm`.
 */
export function RecordActions({ recordId, folio, status, review, canExport, canObserve, canReview, canVoid, canCorrect }: RecordActionsProps) {
  const [observeOpen, setObserveOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [afterVoidOpen, setAfterVoidOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const observe = useOperation()
  const reviewOp = useOperation({ feedback: "toast" })
  const voidOp = useOperation()
  const active = status === "vigente"
  const label = folio ?? "el registro"

  function sendObservation(event: React.FormEvent) {
    event.preventDefault()
    observe.run(
      () => observeRecordAction({ recordId, text }),
      () => { setObserveOpen(false); setText("") },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canExport && (
        <Button asChild variant="secondary" size="sm">
          <a href={`/api/mantencion/registros/${recordId}/pdf`} download>
            <FilePdf className="h-4 w-4 shrink-0" aria-hidden />
            Descargar PDF
          </a>
        </Button>
      )}
      {canExport && <RecordExportButton recordId={recordId} />}
      {active && canObserve && (
        <Button variant="secondary" size="sm" onClick={() => { observe.setMessage(""); setObserveOpen(true) }}>
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          Observar
        </Button>
      )}
      {active && canReview && review !== "revisado" && (
        <Button
          variant="secondary"
          size="sm"
          loading={reviewOp.pending}
          onClick={() => reviewOp.run(() => markRecordReviewedAction({ recordId }))}
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
          Marcar revisado
        </Button>
      )}
      {active && canVoid && (
        <Button variant="ghost-danger" size="sm" onClick={() => { voidOp.setMessage(""); setVoidOpen(true) }}>
          Anular
        </Button>
      )}

      <Dialog open={observeOpen} onOpenChange={(next) => { if (!observe.pending) setObserveOpen(next) }}>
        <DialogContent>
          <form onSubmit={sendObservation}>
            <DialogHeader>
              <DialogTitle>Observar {label}</DialogTitle>
              <DialogDescription>
                El mecánico verá la observación en su inicio y podrá responderla. Quedan registradas con tu nombre.
              </DialogDescription>
            </DialogHeader>
            <Field label="¿Qué hay que revisar?" htmlFor="mant-observation-text" required>
              <Textarea
                id="mant-observation-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Por ejemplo: falta la lectura del horómetro en la foto del sticker."
                autoFocus
              />
            </Field>
            {observe.message && <p role="alert" className="mt-2 text-sm text-[var(--color-danger-ink)]">{observe.message}</p>}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setObserveOpen(false)} disabled={observe.pending}>Cancelar</Button>
              <Button type="submit" loading={observe.pending} disabled={text.trim().length < 3}>Enviar observación</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={`Anular ${label}`}
        description="El registro sigue visible, marcado como anulado, pero deja de contar en las lecturas, el estado de los equipos y los indicadores. No se puede deshacer."
        variant="destructive"
        confirmLabel="Anular registro"
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Por ejemplo: se registró en el equipo equivocado."
        loading={voidOp.pending}
        error={voidOp.message}
        onConfirm={(reason) => voidOp.run(
          () => voidRecordAction({ recordId, reason }),
          () => { setVoidOpen(false); setAfterVoidOpen(true) },
        )}
      />

      <Dialog open={afterVoidOpen} onOpenChange={setAfterVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registro anulado</DialogTitle>
            <DialogDescription>
              {label} ya no cuenta en los cálculos. Si el trabajo se hizo bien pero se registró mal, crea el registro corregido: queda enlazado con este.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAfterVoidOpen(false)}>Cerrar</Button>
            {canCorrect && (
              <Button asChild>
                <Link href={`/m/mantencion?corregir=${encodeURIComponent(recordId)}`}>Crear registro corregido</Link>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
