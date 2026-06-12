"use server"

/**
 * modules/warehouse/actions/bodega.ts
 *
 * Forward shim → app/(app)/bodega/actions.ts
 */

export {
  dispatchAction,
  setMinStockAction,
  returnStockAction,
} from "@/app/(app)/bodega/actions"
