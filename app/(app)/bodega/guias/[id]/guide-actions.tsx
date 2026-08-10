"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { FilePdf, PencilSimple, Prohibit, SealCheck, Truck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { cancelGuideAction, dispatchGuideAction, receiveGuideAction } from "../actions"

interface GuideActionsProps {
  guideId: string
  code: string
  status: string
  destinationWorksiteName: string
  itemCount: number
  receiverOptions: ComboboxOption[]
  defaultReceiverWorkerId: string
  permissions: {
    edit: boolean
    dispatch: boolean
    receive: boolean
    cancel: boolean
  }
}

/**
 * Acciones de la ficha. Cada una aparece solo si el estado la permite **y** el
 * usuario tiene el permiso: el servidor vuelve a comprobar ambas cosas, así que
 * esto es la capa de claridad, no la de seguridad.
 */
export function GuideActions({
  guideId,
  code,
  status,
  destinationWorksiteName,
  itemCount,
  receiverOptions,
  defaultReceiverWorkerId,
  permissions,
}: GuideActionsProps) {
  const router = useRouter()
  const { pending, run } = useOperation()
  const [dispatchOpen, setDispatchOpen] = React.useState(false)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [receiverWorkerId, setReceiverWorkerId] = React.useState(defaultReceiverWorkerId)
  const [reason, setReason] = React.useState("")
  const receiveContentRef = React.useRef<HTMLDivElement>(null)

  function handle(operation: () => Promise<{ ok: boolean; message?: string }>, onDone: () => void) {
    run(async () => {
      const result = await operation()
      if (result.ok) {
        toast.success(result.message ?? "Listo")
        onDone()
        router.refresh()
      } else {
        toast.error(result.message ?? "No se pudo completar la acción")
      }
      return result
    })
  }

  const isDraft = status === "draft"
  const isDispatched = status === "dispatched"
  const canCancel = permissions.cancel && status !== "cancelled"

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" asChild className="gap-1.5">
        <a href={`/bodega/guias/${guideId}/print`} target="_blank" rel="noopener noreferrer">
          <FilePdf size={15} aria-hidden />
          Ver / descargar PDF
        </a>
      </Button>

      {isDraft && permissions.edit && (
        <Button variant="secondary" asChild className="gap-1.5">
          <Link href={`/bodega/guias/${guideId}/editar`}>
            <PencilSimple size={15} aria-hidden />
            Editar
          </Link>
        </Button>
      )}

      {isDraft && permissions.dispatch && (
        <Button onClick={() => setDispatchOpen(true)} disabled={pending} className="gap-1.5">
          <Truck size={15} aria-hidden />
          Despachar
        </Button>
      )}

      {isDispatched && permissions.receive && (
        <Button onClick={() => setReceiveOpen(true)} disabled={pending} className="gap-1.5">
          <SealCheck size={15} aria-hidden />
          Confirmar recepción
        </Button>
      )}

      {canCancel && (
        <Button variant="secondary" onClick={() => setCancelOpen(true)} disabled={pending} className="gap-1.5">
          <Prohibit size={15} aria-hidden />
          Anular
        </Button>
      )}

      <ConfirmDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        title={`Despachar guía ${code}`}
        description={`Se descontarán ${itemCount} ${itemCount === 1 ? "línea" : "líneas"} del stock de la oficina y se abonarán en ${destinationWorksiteName}. Después de esto la guía no puede editarse.`}
        confirmLabel="Despachar"
        variant="warning"
        loading={pending}
        onConfirm={() => handle(() => dispatchGuideAction(guideId), () => setDispatchOpen(false))}
      />

      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        {/* El primer control del diálogo es un combobox que se despliega al
            recibir el foco, y con el autofoco de Radix su lista de
            colaboradores tapaba los botones del pie al abrir. El foco va al
            contenedor (Radix le pone tabIndex=-1), que es además lo que hace
            que el lector de pantalla anuncie el título. */}
        <DialogContent
          ref={receiveContentRef}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            receiveContentRef.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirmar recepción en faena</DialogTitle>
            <DialogDescription>
              Registra que los bienes de la guía {code} llegaron a {destinationWorksiteName}. No vuelve a mover
              stock: el traslado ya se registró al despachar.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Colaborador que recibió"
            htmlFor="gdi-receptor-real"
            hint="Opcional. Si lo dejas vacío queda el responsable indicado en la guía."
          >
            <Combobox
              id="gdi-receptor-real"
              options={receiverOptions}
              value={receiverWorkerId}
              onChange={setReceiverWorkerId}
              clearLabel="Sin indicar"
              placeholder="Buscar colaborador…"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReceiveOpen(false)} disabled={pending}>Cancelar</Button>
            <Button
              loading={pending}
              disabled={pending}
              onClick={() => handle(
                () => receiveGuideAction(guideId, receiverWorkerId || null),
                () => setReceiveOpen(false),
              )}
            >
              Confirmar recepción
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular guía {code}</DialogTitle>
            <DialogDescription>
              La guía no se elimina: queda anulada con el motivo, quién y cuándo.
              {status !== "draft" && " Si ya descontó stock, se registrarán los movimientos de reversa."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Motivo de la anulación" htmlFor="gdi-motivo" required hint="Mínimo 5 caracteres.">
            <Textarea
              id="gdi-motivo"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej.: la carga no salió de oficina, se emitió por error…"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={pending}>Volver</Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={pending || reason.trim().length < 5}
              onClick={() => handle(
                () => cancelGuideAction(guideId, reason),
                () => { setCancelOpen(false); setReason("") },
              )}
            >
              Anular guía
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
