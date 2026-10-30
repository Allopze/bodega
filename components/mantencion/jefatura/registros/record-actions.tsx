"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle, ChatCircleText, FilePdf } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
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
  /**
   * Se llegó desde una lista: «Marcar revisado» sigue con el siguiente de ESA lista. `nextHref`
   * es `null` cuando no queda ninguno, y entonces se vuelve a `listHref`. Sin lista (`null`), es
   * un simple «Marcar revisado».
   */
  queue: { nextHref: string | null; listHref: string } | null
}

/**
 * Acciones del detalle (§10), todas según permiso. Van en `PageHeader.actions`
 * (regla 5 de AGENTS.md) y se leen por peso: UNA acción principal («Marcar
 * revisado», que en una lista sigue con el siguiente registro), «Observar» como
 * secundaria, las descargas ligeras y «Anular» al final y en rojo suave. Los
 * permisos que llegan aquí sólo deciden qué botones se dibujan: el servidor
 * vuelve a pedirlos en cada acción.
 *
 * Marcar revisado es rutina: no pide confirmación. Los diálogos que quedan son
 * los de escribir algo (observar) o destruir algo (anular), con el verbo en el
 * botón; nunca `window.confirm`.
 */
export function RecordActions({ recordId, folio, status, review, canExport, canObserve, canReview, canVoid, canCorrect, queue }: RecordActionsProps) {
  const router = useRouter()
  const [observeOpen, setObserveOpen] = React.useState(false)
  const [voidOpen, setVoidOpen] = React.useState(false)
  const [afterVoidOpen, setAfterVoidOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const observe = useOperation()
  const reviewOp = useOperation()
  const voidOp = useOperation()
  const active = status === "vigente"
  const label = folio ?? "el registro"

  /** Marca el registro y, si se llegó desde una lista, sigue con el siguiente de esa lista. */
  function markReviewed() {
    reviewOp.run(
      () => markRecordReviewedAction({ recordId }),
      (result) => {
        if (!queue) {
          toast.success(result.message ?? "Registro marcado como revisado.")
          return
        }
        if (queue.nextHref) {
          toast.success(result.message ?? "Registro marcado como revisado.")
          router.replace(queue.nextHref)
        } else {
          toast.success(`${result.message ?? "Registro marcado como revisado."} No quedan registros por revisar.`)
          router.push(queue.listHref)
        }
      },
      (result) => toast.error(result.message ?? "No se pudo marcar el registro como revisado."),
    )
  }

  function sendObservation(event: React.FormEvent) {
    event.preventDefault()
    observe.run(
      () => observeRecordAction({ recordId, text }),
      () => { setObserveOpen(false); setText("") },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active && canReview && review !== "revisado" && (
        <Button
          variant="primary"
          size="sm"
          loading={reviewOp.pending}
          onClick={markReviewed}
        >
          <CheckCircle className="h-4 w-4 shrink-0" weight="bold" aria-hidden />
          {queue ? "Marcar revisado y siguiente" : "Marcar revisado"}
        </Button>
      )}
      {active && canObserve && (
        <Button variant="secondary" size="sm" onClick={() => { observe.setMessage(""); setObserveOpen(true) }}>
          <ChatCircleText className="h-4 w-4 shrink-0" aria-hidden />
          Observar
        </Button>
      )}
      {canExport && (
        <Button asChild variant="ghost" size="sm">
          <a href={`/api/mantencion/registros/${recordId}/pdf`} download aria-label="Descargar PDF">
            <FilePdf className="h-4 w-4 shrink-0" aria-hidden />
            PDF
          </a>
        </Button>
      )}
      {canExport && <RecordExportButton recordId={recordId} />}
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
