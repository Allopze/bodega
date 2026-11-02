"use server"

import type { ActionState } from "@/lib/validation/masters"

/**
 * Fase 0: firmas fijas de las acciones sobre una OT existente. Implementa L1
 * (guardAnyPermission → Zod con `lib/mantencion/work-order-schemas.ts` →
 * servicio → revalidatePath); las usa la jefatura (L3) con `useOperation`.
 *
 * Todas reciben el objeto ya armado (no FormData) con `workOrderId` y
 * `expectedVersion`, y devuelven `ActionState` con `data.version` nueva.
 */

type WorkOrderActionState = ActionState & { data?: { version: number; status: string } }

const notImplemented = async (): Promise<WorkOrderActionState> => ({ ok: false, message: "No implementado (fase 0)" })

export async function editWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function assignWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function unassignWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
/** Registrar ingreso a taller (asignada → en_ejecucion) o corregir el ingreso ya registrado. */
export async function startWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function updateWorkOrderEntryAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function changeWorkOrderEstimateAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function markWorkOrderItemsAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
/** Salida de taller (en_ejecucion → trabajo_terminado). */
export async function finishWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function receiveWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
/** Rechazo en la recepción (desde trabajo_terminado) o en la conformidad (desde recepcionada): el servicio decide por el estado. */
export async function rejectWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
/** Recepción en faena = conformidad; cierra la OT. */
export async function conformWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function voidWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
export async function reopenWorkOrderAction(_input: unknown): Promise<WorkOrderActionState> { return notImplemented() }
