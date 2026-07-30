/**
 * Work queue — task construction and progress tracking.
 *
 * @module work-queue
 */
export type {
  OperationalModule,
  WorkTaskType,
  WorkPriority,
  WorkTask,
  WorkActor,
  WorkRequestRow,
  WorkItemRow,
  WorkOrderRow,
  WorkQueueSnapshot,
  RequestProgressItem,
  RequestProgress,
} from "./work-queue.types"

export type { OcProgressItem } from "./work-queue-builders"

export {
  buildWorkTasks,
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
} from "./work-queue-labels"
