/**
 * Work queue — task construction and progress tracking.
 *
 * @module work-queue
 */
export type {
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

export {
  buildWorkTasks,
  buildRequestProgress,
} from "./work-queue-builders"

export {
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
  DELIVERY_ITEM_STATUSES,
  OFFICE_RECEIVABLE_STATUSES,
  FAENA_RECEIVABLE_STATUSES,
  DIRECT_FAENA_RECEIVABLE_STATUSES,
} from "./work-queue-labels"
