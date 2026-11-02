"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CheckCircle, FilePdf, ListChecks, Truck, UserPlus } from "@phosphor-icons/react"
import { unassignWorkOrderAction, voidWorkOrderAction } from "@/app/(app)/mantencion/ot/[id]/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MantUnit } from "@/lib/mantencion/types"
import type { OtStatus, OtTransition } from "@/lib/mantencion/work-order-states"
import type { WorkOrderDetail, WorkOrderItemDetail } from "@/lib/services/mantencion/work-orders/types"
import { toast } from "@/lib/toast"
import {
  AssignDialog, EntryDialog, EstimateDialog, FinishDialog, ItemsDialog, ReasonDialog, ReceiptDialog, type OtBase,
} from "./ot-action-dialogs"

/**
 * Lo que las acciones necesitan de la OT. Es un subconjunto de `WorkOrderDetail`
 * a propósito: al cliente no viaja el historial ni los datos que sólo se leen.
 */
export interface OtActionsProps {
  workOrderId: string
  folio: string
  version: number
  status: OtStatus
  allowedTransitions: OtTransition[]
  canEditExecution: boolean
  unit: MantUnit
  entry: WorkOrderDetail["entry"]
  estimatedDeliveryDate: string | null
  items: WorkOrderItemDetail[]
  assignedToUserId: string | null
  /** Sólo se carga cuando `assign` está permitida. */
  mechanics: Array<{ id: string; name: string; worksiteNames: string[] }> | null
  /** Sólo se carga cuando se puede registrar o corregir el ingreso. */
  entryCatalogs: { workshops: Array<{ id: string; name: string }>; drivers: Array<{ id: string; name: string }> } | null
  /** Quien actúa: «Sr.» por defecto al recepcionar. */
  actorName: string
  pdfHref: string
}

type DialogName = "assign" | "entry" | "estimate" | "items" | "finish" | "receive" | "conform" | "reject" | "reopen" | "void" | null

/**
 * Acciones del detalle de la OT. Van en `PageHeader.actions` (regla 5 de
 * AGENTS.md) y SÓLO se dibujan las que `allowedTransitions` permite (el servicio
 * las calcula con permiso, alcance y estado); el servidor vuelve a validar en
 * cada acción, así que esto es presentación, no control de acceso. Cada acción
 * lleva `expectedVersion`: si otra sesión cambió la OT, el diálogo muestra el
 * conflicto y la página se refresca.
 *
 * Es rutina: no pide confirmación. Sólo «Anular» usa `ConfirmDialog` (destructiva);
 * rechazar, reabrir y los cambios de fecha piden un motivo escrito porque quedan
 * en el historial.
 */
export function OtActions(props: OtActionsProps) {
  const router = useRouter()
  const [dialog, setDialog] = React.useState<DialogName>(null)
  const unassignOp = useOperation()
  const voidOp = useOperation()
  const allowed = new Set(props.allowedTransitions)
  const base: OtBase = { workOrderId: props.workOrderId, expectedVersion: props.version }
  const dialogProps = { open: true, onOpenChange: (open: boolean) => { if (!open) setDialog(null) }, base, folio: props.folio }
  const editExecution = props.canEditExecution && props.status === "en_ejecucion"
  const canReject = allowed.has("reject_receipt") || allowed.has("reject_conformity")

  function unassign() {
    unassignOp.run(
      () => unassignWorkOrderAction(base),
      (result) => { toast.success(result.message ?? "Asignación retirada"); router.refresh() },
      (result) => { toast.error(result.message ?? "No se pudo retirar la asignación"); if (/otra sesi[oó]n/i.test(result.message ?? "")) router.refresh() },
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.has("start") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("entry")}>
          <Truck className="h-4 w-4 shrink-0" aria-hidden /> Registrar ingreso
        </Button>
      )}
      {allowed.has("finish") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("finish")}>
          <CheckCircle className="h-4 w-4 shrink-0" weight="bold" aria-hidden /> Registrar salida
        </Button>
      )}
      {allowed.has("receive") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("receive")}>Recepcionar</Button>
      )}
      {allowed.has("conform") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("conform")}>
          <CheckCircle className="h-4 w-4 shrink-0" weight="bold" aria-hidden /> Dar conformidad
        </Button>
      )}

      {allowed.has("assign") && (
        <Button variant={props.status === "solicitada" ? "primary" : "secondary"} size="sm" onClick={() => setDialog("assign")}>
          <UserPlus className="h-4 w-4 shrink-0" aria-hidden /> {props.assignedToUserId ? "Reasignar" : "Asignar"}
        </Button>
      )}
      {allowed.has("unassign") && (
        <Button variant="secondary" size="sm" loading={unassignOp.pending} onClick={unassign}>Desasignar</Button>
      )}
      {editExecution && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("items")}>
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden /> Marcar ítems
        </Button>
      )}
      {editExecution && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("estimate")}>Cambiar entrega estimada</Button>
      )}
      {editExecution && props.entry && props.entryCatalogs && (
        <Button variant="ghost" size="sm" onClick={() => setDialog("entry")}>Corregir ingreso</Button>
      )}
      {canReject && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("reject")}>Rechazar</Button>
      )}
      {allowed.has("reopen") && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("reopen")}>
          <ArrowsClockwise className="h-4 w-4 shrink-0" aria-hidden /> Reabrir
        </Button>
      )}
      <Button asChild variant="ghost" size="sm">
        <a href={props.pdfHref} download><FilePdf className="h-4 w-4 shrink-0" aria-hidden /> Descargar PDF</a>
      </Button>
      {allowed.has("void") && (
        <Button variant="ghost-danger" size="sm" onClick={() => { voidOp.setMessage(""); setDialog("void") }}>Anular</Button>
      )}

      {unassignOp.message && <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{unassignOp.message}</p>}

      {dialog === "assign" && props.mechanics && (
        <AssignDialog {...dialogProps} mechanics={props.mechanics} currentUserId={props.assignedToUserId} />
      )}
      {dialog === "entry" && props.entryCatalogs && (
        <EntryDialog {...dialogProps} unit={props.unit} entry={props.entry} catalogs={props.entryCatalogs} correcting={!!props.entry} />
      )}
      {dialog === "estimate" && <EstimateDialog {...dialogProps} current={props.estimatedDeliveryDate} />}
      {dialog === "items" && <ItemsDialog {...dialogProps} items={props.items} />}
      {dialog === "finish" && <FinishDialog {...dialogProps} entryAt={props.entry?.entryAt ?? null} />}
      {dialog === "receive" && <ReceiptDialog {...dialogProps} mode="receive" defaultName={props.actorName} />}
      {dialog === "conform" && <ReceiptDialog {...dialogProps} mode="conform" defaultName={props.actorName} />}
      {dialog === "reject" && <ReasonDialog {...dialogProps} mode="reject" />}
      {dialog === "reopen" && <ReasonDialog {...dialogProps} mode="reopen" />}

      <ConfirmDialog
        open={dialog === "void"}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        title={`Anular ${props.folio}`}
        description="La orden sigue visible, marcada como anulada, con su motivo. Si el equipo estaba en taller, vuelve a su estado anterior. No se puede deshacer."
        variant="destructive"
        confirmLabel="Anular orden"
        reasonLabel="Motivo de la anulación"
        reasonPlaceholder="Por ejemplo: se pidió para el equipo equivocado."
        loading={voidOp.pending}
        error={voidOp.message}
        onConfirm={(reason) => voidOp.run(
          () => voidWorkOrderAction({ ...base, reason }),
          (result) => { toast.success(result.message ?? "Orden anulada"); setDialog(null); router.refresh() },
          (result) => { if (/otra sesi[oó]n/i.test(result.message ?? "")) router.refresh() },
        )}
      />
    </div>
  )
}
