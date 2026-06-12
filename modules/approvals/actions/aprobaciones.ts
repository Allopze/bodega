"use server"

/**
 * modules/approvals/actions/aprobaciones.ts
 *
 * Forward shim → app/(app)/aprobaciones/actions.ts
 */

export {
  approveItemAction,
  rejectItemAction,
  returnItemAction,
  bulkApproveRequestAction,
} from "@/app/(app)/aprobaciones/actions"
