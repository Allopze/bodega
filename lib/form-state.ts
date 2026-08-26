/**
 * Shared helpers for Server Action form state.
 * ActionState is the return type for every admin Server Action.
 */
export type { ActionState } from "@/lib/validation/masters"

/** Initial (idle) state to pass to useActionState. */
export const INITIAL_STATE = { ok: false } as const
