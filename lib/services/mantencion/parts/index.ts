/**
 * Repuestos con stock y reservas por OT (ADR mantención 0001). Punto de entrada
 * único: las líneas de trabajo importan desde aquí.
 */
export * from "./types"
export { lockForStockTx, allocationRemainingTx, freeStockTx, addToAllocationTx, shrinkAllocationsForSourceTx, type StockLocks } from "./allocations"
export { releaseWorkOrderAllocationsTx, releaseAllocationTx } from "./release"
export { consumePartTx, reverseRecordPartsTx } from "./consumption"
export { listAvailableForWorkOrders, stockReservationSummary } from "./reads"
