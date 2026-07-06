/**
 * lib/services/requests-draft.ts
 *
 * Diff-based persist logic for purchase requests.
 *
 * Security audit A-01 / A-08: the previous implementation deleted and
 * re-inserted every request item on each save, which:
 *   - wiped `approval_decisions` rows (legal audit trail lost when an
 *     approver had modified the quantity),
 *   - wiped `inventory_movements` references,
 *   - generated expensive cascade deletes on `request_item_attributes`,
 *   - created a window where approvers could see "no items" between the
 *     delete and the re-insert.
 *
 * This service performs a true diff: items with a stable `id` are
 * updated in place (preserving `approval_decisions` and references),
 * items without an `id` are inserted, and items present in the DB but
 * missing from the input are deleted (and only their `approval_decisions`
 * are removed with them).
 */

import { db } from "@/db"
import type { RequestFormData } from "@/lib/validation/operations"
import { createRequestWithDiff } from "./requests-draft-create"
import { updateRequestWithDiff } from "./requests-draft-update"
import type { PersistDraftResult } from "./requests-draft.types"

export type { PersistDraftResult }

/**
 * Persist a request (create or update) using a diff algorithm.
 *
 * Caller must have validated input with `requestSchema` and verified
 * worksite access. This function is wrapped in its own transaction.
 */
export async function persistRequestWithDiff(
  sessionUserId: string,
  sessionUserEmail: string | undefined,
  data: RequestFormData,
  isEdit: boolean,
  actorCanEditAnyRequest: boolean,
): Promise<PersistDraftResult> {
  if (isEdit && !data.id) {
    throw new Error("Internal: isEdit=true but data.id is missing")
  }
  return await db.transaction(async (tx) => {
    if (isEdit) {
      return await updateRequestWithDiff(tx, data, sessionUserId, sessionUserEmail, actorCanEditAnyRequest)
    }
    return await createRequestWithDiff(tx, data, sessionUserId, sessionUserEmail)
  })
}
