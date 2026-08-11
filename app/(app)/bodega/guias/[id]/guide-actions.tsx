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
import { Input } from "@/components/ui/input"
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
  reconciliationItems?: Array<{
    id: string
    name: string
    quantity: number
    unitOfMeasure: string
    receivedQuantity?: number | null
  }>
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
  reconciliationItems = [],
  permissions,
}: GuideActionsProps) {
  const router = useRouter()
  const { pending, run } = useOperation()
  const [dispatchOpen, setDispatchOpen] = React.useState(false)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [receiverWorkerId, setReceiverWorkerId] = React.useState(defaultReceiverWorkerId)
  const [reason, setReason] = React.useState("")
  const [receivedQuantities, setReceivedQuantities] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(reconciliationItems.map((item) => [item.id, String(Math.max(0, item.quantity - (item.receivedQuantity ?? 0)))])),
  )
  const [differenceReasons, setDifferenceReasons] = React.useState<Record<string, string>>({})
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
  const isDispatched = status === "dispatched" || status === "partially_received"
  const canCancel = permissions.cancel
    && status !== "cancelled"
    // Una GDI enlazada ya cotejada tiene acumuladores en la OC; el backend
    // rechaza su anulación para no borrar historia ni desincronizar estados.
    && !(reconciliationItems.length > 0 && (status === "partially_received" || status === "received"))
  const hasInvalidReconciliation = reconciliationItems.some((item) => {
    const received = Number(receivedQuantities[item.id])
    const remaining = Math.max(0, item.quantity - (item.receivedQuantity ?? 0))
    const difference = remaining - received
    return !Number.isFinite(received) || received < 0 || received > remaining || (difference > 1e-9 && (differenceReasons[item.id]?.trim().length ?? 0) < 5)
  })

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
          {reconciliationItems.length > 0 && (
            <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">Cotejo despachado vs. recibido</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Ajusta sólo lo que efectivamente llegó a faena. Si hay diferencia, registra el motivo.
                </p>
              </div>
              {reconciliationItems.map((item) => {
                const received = Number(receivedQuantities[item.id])
                const remaining = Math.max(0, item.quantity - (item.receivedQuantity ?? 0))
                const hasDifference = Number.isFinite(received) && received < remaining
                return (
                  <div key={item.id} className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">{item.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Despachado: {item.quantity} {item.unitOfMeasure}
                        {(item.receivedQuantity ?? 0) > 0 && ` · ya cotejado: ${item.receivedQuantity} ${item.unitOfMeasure}`}
                      </p>
                    </div>
                    <Field label="Recibido en faena" htmlFor={`gdi-recibido-${item.id}`}>
                      <Input
                        id={`gdi-recibido-${item.id}`}
                        type="number"
                        min={0}
                        max={remaining}
                        step="any"
                        value={receivedQuantities[item.id] ?? ""}
                        onChange={(event) => setReceivedQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                      />
                    </Field>
                    {hasDifference && (
                      <div className="sm:col-span-2">
                        <Field label="Motivo de la diferencia" htmlFor={`gdi-diferencia-${item.id}`} required hint="Mínimo 5 caracteres.">
                          <Input
                            id={`gdi-diferencia-${item.id}`}
                            value={differenceReasons[item.id] ?? ""}
                            onChange={(event) => setDifferenceReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                            placeholder="Ej.: faltó una caja en la entrega"
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReceiveOpen(false)} disabled={pending}>Cancelar</Button>
            <Button
              loading={pending}
              disabled={pending || hasInvalidReconciliation}
              onClick={() => handle(
                () => receiveGuideAction(
                  guideId,
                  receiverWorkerId || null,
                  reconciliationItems.length > 0
                    ? reconciliationItems.map((item) => ({
                        guideItemId: item.id,
                        quantityReceived: Number(receivedQuantities[item.id]),
                        differenceReason: differenceReasons[item.id] || null,
                      }))
                    : undefined,
                ),
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
