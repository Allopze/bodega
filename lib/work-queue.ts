/**
 * Work queue — task construction and progress tracking.
 *
 * @module work-queue
 */
export type {
  OperationalModule,
  OperationalSort,
  WorkTaskType,
  WorkPriority,
  WorkTask,
  RequestProgressAttribute,
  RequestProgressItem,
  RequestProgress,
} from "./work-queue.types"

import type { OperationalSort } from "./work-queue.types"

/**
 * El orden por defecto de la cola operacional es por vencimiento, no por
 * prioridad.
 *
 * Ordenando por prioridad, una tarea "Normal" con 37 días de atraso quedaba
 * debajo de una "Alta" que vencía en 13: la lista se leía como incoherente
 * porque el criterio que decidía el orden no era el que el usuario veía gritar
 * en la columna de vencimiento. `due_sort` es
 * `COALESCE(source_due_at, '9999-12-31')`, así que lo más atrasado sube y lo
 * que no tiene fecha se va al final; la prioridad sigue disponible en el
 * selector de orden y como columna.
 *
 * Un único origen para el valor: el cursor de paginación codifica el orden con
 * el que se armó la página, y dos defaults desincronizados harían que
 * "Siguiente página" descartara el cursor en silencio. Vive en este módulo —y
 * no en el servicio— porque el workbench es cliente y no puede importar un
 * valor desde un módulo que abre la conexión a la base.
 */
export const DEFAULT_QUEUE_SORT: OperationalSort = "due"

export type { OcProgressItem, OcProgressOptions } from "./work-queue-builders"

export {
  buildRequestProgress,
  buildOcProgress,
} from "./work-queue-builders"

export {
  OPERATIONAL_MODULE_LABELS,
  requestStatusLabel,
  itemStatusLabel,
  itemStageLabel,
  requestNextAction,
  requestCurrentStage,
  // Also export constants for consumers that need them
  STAGES,
  CLOSED_REQUEST_STATUSES,
  ACTIVE_REQUEST_STATUSES,
  APPROVAL_ITEM_STATUSES,
  PURCHASE_ITEM_STATUSES,
  RECEIVE_ITEM_STATUSES,
  DELIVERY_ITEM_STATUSES,
  OFFICE_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES,
  DIRECT_FAENA_RECEIVABLE_STATUSES,
  RECEIVABLE_ORDER_STATUSES,
  COMPLETED_RECEIPT_ORDER_STATUSES,
  INVOICE_DUE_ORDER_STATUSES,
} from "./work-queue-labels"
