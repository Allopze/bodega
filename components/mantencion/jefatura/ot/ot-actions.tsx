"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowsClockwise, CaretDown, CheckCircle, FilePdf, ListChecks, NotePencil, Package, Truck, UserPlus } from "@phosphor-icons/react"
import { unassignWorkOrderAction, voidWorkOrderAction } from "@/app/(app)/mantencion/ot/[id]/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useOperation } from "@/lib/hooks/use-operation"
import type { MantUnit } from "@/lib/mantencion/types"
import type { OtStatus, OtTransition } from "@/lib/mantencion/work-order-states"
import type { WorkOrderRecordForm } from "@/lib/services/mantencion/web-record"
import type { WorkOrderDetail, WorkOrderItemDetail } from "@/lib/services/mantencion/work-orders/types"
import type { WorkOrderAvailablePart } from "@/lib/services/mantencion/parts/types"
import { toast } from "@/lib/toast"
import { reservedUnusedText, type ReservedUnusedNotice } from "../notas-pedido/reserved-unused"
import { EditOtSheet, type OtRequestSnapshot } from "./edit-ot-sheet"
import {
  AssignDialog, EntryDialog, EstimateDialog, FinishDialog, ItemsDialog, ReasonDialog, ReceiptDialog, ReclassifyDialog, type OtBase,
} from "./ot-action-dialogs"
import type { EntryReadings } from "./ot-entry-reading"
import { OtRecordSheet, type RecordKind } from "./record/ot-record-sheet"

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
  /**
   * Las lecturas del equipo, para que «Registrar ingreso» diga la última y valide la que se escribe como la app. Se
   * carga con `entryCatalogs`; `null` si no se pudo cargar (el diálogo igual lee bien el número, sin compararlo).
   */
  entryReadings?: EntryReadings | null
  /** Quien actúa: «Recibió» por defecto al recibir el equipo. */
  actorName: string
  pdfHref: string
  /**
   * El PDF exige `mant:ot:view_worksite|view_all` (la hoja imprimible expone el
   * trabajo enlazado), así que el botón se dibuja sólo para quien puede pedirlo.
   */
  canDownloadPdf: boolean
  /** Tipo de la OT: qué registro se ofrece (reparación → correctiva, mantención → preventiva). */
  repair: boolean
  maintenance: boolean
  /** En taller y sin el registro que exige la salida: «Registrar trabajo» pasa a ser la acción de la etapa. */
  needsLinkedRecord: boolean
  /** Equipo y catálogos del formulario de registro; sólo se carga si quien mira puede registrar (`canRegisterRecord`). */
  recordForm: WorkOrderRecordForm | null
  actorUserId: string
  /**
   * Destino de «Solicitar compra» (`/solicitudes/nueva?tipo=repuestos&ot=<id>`), que
   * precarga equipo, faena y OT. La página lo calcula con `repuestos:create` y la OT
   * no cerrada ni anulada; `null` oculta la acción. Es presentación: la página de
   * solicitudes vuelve a validar permiso, alcance y estado de la OT.
   */
  partsRequestHref: string | null
  /** «Editar orden»: estados «Por asignar» y «Asignada», jefatura o quien creó la OT (`detail.canEditRequest`). */
  canEditRequest: boolean
  /** «Corregir tipo de acción»: jefatura, cualquier estado menos anulada, sólo cuando no aplica «Editar orden» (`detail.canReclassify`). */
  canReclassify: boolean
  /** Lo guardado de la solicitud y la clasificación: precarga «Editar orden», «Corregir tipo de acción» y la salida. */
  request: OtRequestSnapshot
  /** Faenas elegibles como «Faena de ejecución»; sólo se cargan si se puede editar o corregir (`null` si no). */
  executionWorksites: Array<{ id: string; name: string }> | null
  /** `ops.mantencion.ot_action_type_required` encendido: marca el tipo de acción como obligatorio. */
  actionTypeRequired: boolean
  /**
   * Repuestos reservados para la OT y sin usar: «Dar conformidad» y «Anular» avisan que pasan a stock libre de la
   * faena. `null` o ausente = nada reservado (o quien mira no ve las notas de pedido).
   */
  reservedUnused?: ReservedUnusedNotice | null
  /** Repuestos reservados disponibles: los chips «Disponibles para esta OT» del registro web. */
  availableParts?: WorkOrderAvailablePart[]
}

type RecordOption = { kind: RecordKind; disabled: boolean }

/**
 * Qué registros ofrece la OT: correctiva si pide reparación, preventiva si pide
 * mantención (las dos si no dice). La preventiva exige pauta; si es lo único que
 * pide y el equipo no la tiene, igual se ofrece la correctiva.
 */
export function recordOptions(input: { repair: boolean; maintenance: boolean; hasSchedule: boolean }): RecordOption[] {
  const kinds: RecordKind[] = []
  if (input.repair || !input.maintenance) kinds.push("C")
  if (input.maintenance || !input.repair) kinds.push("P")
  const options = kinds.map((kind) => ({ kind, disabled: kind === "P" && !input.hasSchedule }))
  return options.every((option) => option.disabled) ? [{ kind: "C", disabled: false }, ...options] : options
}

const KIND_TEXT: Record<RecordKind, string> = { C: "Correctiva", P: "Preventiva" }

type DialogName = "edit" | "reclassify" | "assign" | "entry" | "estimate" | "items" | "finish" | "receive" | "conform" | "reject" | "reopen" | "void" | null

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
 *
 * A la vista quedan la acción de la etapa (ingreso, salida, recepción,
 * conformidad), asignar una OT por asignar, marcar ítems, rechazar, reabrir y
 * «Descargar PDF» (secundaria, igual que en el registro: antes se escondía en el
 * menú y no se encontraba). En taller, mientras falta el registro que exige la
 * salida, la acción de la etapa es «Registrar trabajo» (correctiva o preventiva,
 * desde el PC) y la salida queda secundaria; con el registro hecho, «Registrar
 * otra…» pasa al menú. El resto (reasignar, desasignar, editar la orden o corregir
 * su tipo de acción, cambiar la entrega estimada, corregir el ingreso, solicitar
 * compra y anular) va en «Más acciones», que no se dibuja si no tiene nada: con
 * todo a la vista, una OT en taller llegaba a siete botones y apretaba el título
 * en la barra superior.
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
  const [recordKind, setRecordKind] = React.useState<RecordKind | null>(null)
  const recordForm = props.status === "en_ejecucion" ? props.recordForm : null
  const options = recordForm
    ? recordOptions({ repair: props.repair, maintenance: props.maintenance, hasSchedule: (recordForm.schedule?.intervals.length ?? 0) > 0 })
    : []
  const recordFirst = !!recordForm && props.needsLinkedRecord
  const direct = options.length === 1 && !options[0]?.disabled ? options[0] : null
  // «Más acciones» sólo existe si tiene algo: una OT cerrada de quien sólo puede descargar el PDF no lleva un menú vacío.
  const canAssignFromMenu = allowed.has("assign") && props.status !== "solicitada"
  const showReclassify = !props.canEditRequest && props.canReclassify
  const showCorrectEntry = editExecution && !!props.entry && !!props.entryCatalogs
  const moreRecordOptions = !!recordForm && !recordFirst ? options.filter((option) => !option.disabled) : []
  const hasRoutineItems = canAssignFromMenu || allowed.has("unassign") || props.canEditRequest || showReclassify || editExecution
    || showCorrectEntry || moreRecordOptions.length > 0 || !!props.partsRequestHref
  const hasMenu = hasRoutineItems || allowed.has("void")

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
      {recordFirst && (direct ? (
        <Button variant="primary" size="sm" onClick={() => setRecordKind(direct.kind)}>
          <NotePencil className="h-4 w-4 shrink-0" aria-hidden /> Registrar trabajo
        </Button>
      ) : (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="primary" size="sm">
              <NotePencil className="h-4 w-4 shrink-0" aria-hidden /> Registrar trabajo
              <CaretDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {options.map((option) => (
              <DropdownMenuItem key={option.kind} disabled={option.disabled} onSelect={() => setRecordKind(option.kind)}>
                {option.disabled ? `${KIND_TEXT[option.kind]} · el equipo no tiene pauta` : KIND_TEXT[option.kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      {allowed.has("finish") && (
        <Button variant={recordFirst ? "secondary" : "primary"} size="sm" onClick={() => setDialog("finish")}>
          <CheckCircle className="h-4 w-4 shrink-0" weight="bold" aria-hidden /> Registrar salida
        </Button>
      )}
      {allowed.has("receive") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("receive")}>Recibir equipo</Button>
      )}
      {allowed.has("conform") && (
        <Button variant="primary" size="sm" onClick={() => setDialog("conform")}>
          <CheckCircle className="h-4 w-4 shrink-0" weight="bold" aria-hidden /> Dar conformidad
        </Button>
      )}

      {allowed.has("assign") && props.status === "solicitada" && (
        <Button variant="primary" size="sm" onClick={() => setDialog("assign")}>
          <UserPlus className="h-4 w-4 shrink-0" aria-hidden /> {props.assignedToUserId ? "Reasignar" : "Asignar"}
        </Button>
      )}
      {editExecution && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("items")}>
          <ListChecks className="h-4 w-4 shrink-0" aria-hidden /> Marcar ítems
        </Button>
      )}
      {canReject && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("reject")}>Rechazar</Button>
      )}
      {allowed.has("reopen") && (
        <Button variant="secondary" size="sm" onClick={() => setDialog("reopen")}>
          <ArrowsClockwise className="h-4 w-4 shrink-0" aria-hidden /> Reabrir
        </Button>
      )}

      {props.canDownloadPdf && (
        <Button asChild variant="secondary" size="sm">
          <a href={props.pdfHref} download>
            <FilePdf className="mr-1 h-4 w-4 shrink-0" aria-hidden />
            Descargar PDF
          </a>
        </Button>
      )}

      {/* No modal: los ítems abren diálogos. Un menú modal deja `pointer-events: none`
          en el body justo cuando monta el diálogo, y la página quedaba sin responder. */}
      {hasMenu && (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" loading={unassignOp.pending}>
              Más acciones
              <CaretDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canAssignFromMenu && (
              <DropdownMenuItem onSelect={() => setDialog("assign")}>{props.assignedToUserId ? "Reasignar" : "Asignar"}</DropdownMenuItem>
            )}
            {allowed.has("unassign") && <DropdownMenuItem onSelect={unassign}>Desasignar</DropdownMenuItem>}
            {props.canEditRequest && <DropdownMenuItem onSelect={() => setDialog("edit")}>Editar orden</DropdownMenuItem>}
            {showReclassify && <DropdownMenuItem onSelect={() => setDialog("reclassify")}>Corregir tipo de acción</DropdownMenuItem>}
            {editExecution && <DropdownMenuItem onSelect={() => setDialog("estimate")}>Cambiar entrega estimada</DropdownMenuItem>}
            {showCorrectEntry && <DropdownMenuItem onSelect={() => setDialog("entry")}>Corregir ingreso</DropdownMenuItem>}
            {moreRecordOptions.map((option) => (
              <DropdownMenuItem key={option.kind} onSelect={() => setRecordKind(option.kind)}>Registrar otra {KIND_TEXT[option.kind].toLowerCase()}</DropdownMenuItem>
            ))}
            {props.partsRequestHref && (
              <DropdownMenuItem asChild>
                <Link href={props.partsRequestHref} className="flex items-center gap-2">
                  <Package className="h-4 w-4 shrink-0" aria-hidden /> Solicitar compra
                </Link>
              </DropdownMenuItem>
            )}
            {allowed.has("void") && (
              <>
                {hasRoutineItems && <DropdownMenuSeparator />}
                <DropdownMenuItem className="text-[var(--color-danger-ink)]" onSelect={() => { voidOp.setMessage(""); setDialog("void") }}>
                  Anular
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {unassignOp.message && <p role="alert" className="basis-full text-sm text-[var(--color-danger-ink)]">{unassignOp.message}</p>}

      {dialog === "edit" && props.canEditRequest && (
        <EditOtSheet
          open
          onOpenChange={(open) => { if (!open) setDialog(null) }}
          workOrderId={props.workOrderId}
          folio={props.folio}
          version={props.version}
          request={props.request}
          executionWorksites={props.executionWorksites ?? []}
          actionTypeRequired={props.actionTypeRequired}
        />
      )}
      {dialog === "reclassify" && !props.canEditRequest && props.canReclassify && (
        <ReclassifyDialog
          {...dialogProps}
          classification={{
            actionType: props.request.actionType,
            specialties: props.request.specialties,
            executionWorksiteId: props.request.executionWorksiteId,
            laborHours: props.request.laborHours,
            hasExit: props.request.hasExit,
          }}
          executionWorksites={(props.executionWorksites ?? []).filter((worksite) => worksite.id !== props.request.worksiteId)}
          actionTypeRequired={props.actionTypeRequired}
        />
      )}
      {dialog === "assign" && props.mechanics && (
        <AssignDialog {...dialogProps} mechanics={props.mechanics} currentUserId={props.assignedToUserId} />
      )}
      {dialog === "entry" && props.entryCatalogs && (
        <EntryDialog {...dialogProps} unit={props.unit} entry={props.entry} catalogs={props.entryCatalogs} correcting={!!props.entry} readings={props.entryReadings ?? null} />
      )}
      {dialog === "estimate" && <EstimateDialog {...dialogProps} current={props.estimatedDeliveryDate} />}
      {dialog === "items" && <ItemsDialog {...dialogProps} items={props.items} />}
      {dialog === "finish" && <FinishDialog {...dialogProps} entryAt={props.entry?.entryAt ?? null} savedWorkPerformed={props.request.workPerformed} savedLaborHours={props.request.laborHours} />}
      {dialog === "receive" && <ReceiptDialog {...dialogProps} mode="receive" defaultName={props.actorName} />}
      {dialog === "conform" && <ReceiptDialog {...dialogProps} mode="conform" defaultName={props.actorName} reservedUnused={props.reservedUnused ?? null} />}
      {dialog === "reject" && <ReasonDialog {...dialogProps} mode="reject" />}
      {dialog === "reopen" && <ReasonDialog {...dialogProps} mode="reopen" />}
      {recordKind && recordForm && (
        <OtRecordSheet
          kind={recordKind}
          workOrderId={props.workOrderId}
          folio={props.folio}
          userId={props.actorUserId}
          userName={props.actorName}
          form={recordForm}
          availableParts={props.availableParts}
          onClose={() => setRecordKind(null)}
        />
      )}

      <ConfirmDialog
        open={dialog === "void"}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        title={`Anular ${props.folio}`}
        description={`Queda visible como anulada, con su motivo. Si el equipo estaba en taller, vuelve a su estado anterior. No se puede deshacer.${props.reservedUnused ? ` ${reservedUnusedText(props.reservedUnused)}` : ""}`}
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
