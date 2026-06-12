"use server"

/**
 * modules/purchasing/actions/compras.ts
 *
 * Forward shim → app/(app)/compras/actions.ts
 */

export {
  createOrderAction,
  issueOrderAction,
  sendOrderAction,
  postponeItemAction,
  cancelOrderAction,
} from "@/app/(app)/compras/actions"
