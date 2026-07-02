import type { Session } from "next-auth"
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems, fuelLoads, fuelSuppliers, fuelVehicles,
  inventoryMovements, maintenanceRecords, products, productCategories,
  purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests,
  suppliers, worksiteStock, worksites, workers,
} from "@/db/schema"
import type { AnalyticsDashboardData, AnalyticsFilters } from "./types"
import {
  ACTIVE_ORDER_STATUSES, normalizeAnalyticsFilters,
  previousPeriod, dateFilter, worksiteFilter, mergeSpendByMonth,
  mergeWorksiteSpend, variationPct, moduleLabel, getAnalyticsAlertThresholds,
  buildDataGaps, dateOnly,
} from "./helpers"
import { buildAlerts } from "./alerts"

export async function getAnalyticsDashboard(session: Session, rawFilters: AnalyticsFilters = {}): Promise<AnalyticsDashboardData> {
  const filters = normalizeAnalyticsFilters(rawFilters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const detectedAt = dateOnly(new Date())
  const thresholds = await getAnalyticsAlertThresholds()

  const orderScope = worksiteFilter(session, purchaseOrders.worksiteId)
  const requestScope = worksiteFilter(session, purchaseRequests.worksiteId)
  const stockScope = worksiteFilter(session, worksiteStock.worksiteId)
  const movementScope = worksiteFilter(session, inventoryMovements.worksiteId)
  const deliveryScope = worksiteFilter(session, deliveries.worksiteId)
  const fuelScope = worksiteFilter(session, fuelLoads.worksiteId)
  const maintenanceScope = worksiteFilter(session, maintenanceRecords.worksiteId)

  const orderWhere = and(orderScope, inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES), dateFilter(filters, purchaseOrders.createdAt), filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined, filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined)
  const previousOrderWhere = and(orderScope, inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES), gte(purchaseOrders.createdAt, previous.fromDate), lte(purchaseOrders.createdAt, `${previous.toDate}T23:59:59`), filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined, filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined)
  const fuelWhere = and(fuelScope, gte(fuelLoads.loadDate, filters.fromDate), lte(fuelLoads.loadDate, filters.toDate), filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined, filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined)
  const previousFuelWhere = and(fuelScope, gte(fuelLoads.loadDate, previous.fromDate), lte(fuelLoads.loadDate, previous.toDate), filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined, filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined)
  const maintenanceWhere = and(maintenanceScope, gte(maintenanceRecords.maintenanceDate, filters.fromDate), lte(maintenanceRecords.maintenanceDate, filters.toDate), filters.worksiteId ? eq(maintenanceRecords.worksiteId, filters.worksiteId) : undefined, filters.vehicleId ? eq(maintenanceRecords.vehicleId, filters.vehicleId) : undefined, sql`${maintenanceRecords.status} <> 'cancelled'`)

  const [[purchaseSummary], [previousPurchaseSummary], [fuelSummary], [previousFuelSummary], [approvalSummary], [stockSummary], purchaseMonths, fuelMonths, purchaseModules, fuelModules, purchaseSuppliers, fuelSupplierRows, purchaseWorksites, fuelWorksites, vehicleRows, stockRows, rotationRows, eppRows, recentOrders, maintenanceRows] = await Promise.all([
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`, orderCount: sql<number>`COUNT(*)`, averageOrderAmount: sql<number>`COALESCE(AVG(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(orderWhere),
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(previousOrderWhere),
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`, loadCount: sql<number>`COUNT(*)`, totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)` }).from(fuelLoads).where(fuelWhere),
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` }).from(fuelLoads).where(previousFuelWhere),
    db.select({ pendingApprovals: sql<number>`COUNT(*) FILTER (WHERE ${purchaseRequestItems.status} = 'requested')` }).from(purchaseRequestItems).innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id)).where(and(requestScope, filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined, dateFilter(filters, purchaseRequests.createdAt))),
    db.select({ criticalStockCount: sql<number>`COUNT(*) FILTER (WHERE ${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock})` }).from(worksiteStock).where(and(stockScope, filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined)),
    db.select({ month: sql<string>`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`, module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(orderWhere).groupBy(sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`).orderBy(sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`),
    db.select({ month: fuelLoads.month, module: sql<string>`'Combustible'`, totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` }).from(fuelLoads).where(fuelWhere).groupBy(fuelLoads.month).orderBy(fuelLoads.month),
    db.select({ module: purchaseRequests.requestType, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)` }).from(purchaseOrderItems).innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)).leftJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id)).leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id)).where(and(orderWhere, filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined)).groupBy(purchaseRequests.requestType).orderBy(desc(sql`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`)),
    db.select({ module: sql<string>`'Combustible'`, totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` }).from(fuelLoads).where(fuelWhere),
    db.select({ id: suppliers.id, name: suppliers.name, module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`, count: sql<number>`COUNT(*)` }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(orderWhere).groupBy(suppliers.id, suppliers.name).orderBy(desc(sql`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`)).limit(10),
    db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name, module: sql<string>`'Combustible'`, totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`, count: sql<number>`COUNT(*)` }).from(fuelLoads).innerJoin(fuelSuppliers, eq(fuelLoads.fuelSupplierId, fuelSuppliers.id)).where(fuelWhere).groupBy(fuelSuppliers.id, fuelSuppliers.name).orderBy(desc(sql`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`)).limit(10),
    db.select({ id: worksites.id, name: worksites.name, module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id)).where(orderWhere).groupBy(worksites.id, worksites.name),
    db.select({ id: worksites.id, name: worksites.name, module: sql<string>`'Combustible'`, totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)` }).from(fuelLoads).innerJoin(worksites, eq(fuelLoads.worksiteId, worksites.id)).where(fuelWhere).groupBy(worksites.id, worksites.name),
    db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, type: fuelVehicles.type, totalFuelAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`, totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`, loadCount: sql<number>`COUNT(*)`, lastOdometerReading: sql<number>`MAX(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`, lastHourMeterReading: sql<number>`MAX(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)` }).from(fuelLoads).innerJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id)).where(fuelWhere).groupBy(fuelVehicles.id, fuelVehicles.plate, fuelVehicles.type).orderBy(desc(sql`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`)).limit(10),
    db.select({ productId: products.id, productName: products.name, sku: products.sku, worksiteName: worksites.name, currentQty: worksiteStock.quantity, minStock: worksiteStock.minStock }).from(worksiteStock).innerJoin(products, eq(worksiteStock.productId, products.id)).innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id)).where(and(stockScope, filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined, sql`${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`)).orderBy(sql`${worksiteStock.quantity} - ${worksiteStock.minStock}`).limit(10),
    db.select({ productId: products.id, productName: products.name, sku: products.sku, totalOut: sql<number>`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`, movementCount: sql<number>`COUNT(*)` }).from(inventoryMovements).innerJoin(products, eq(inventoryMovements.productId, products.id)).where(and(movementScope, filters.worksiteId ? eq(inventoryMovements.worksiteId, filters.worksiteId) : undefined, gte(inventoryMovements.performedAt, filters.fromDate), lte(inventoryMovements.performedAt, `${filters.toDate}T23:59:59`), eq(inventoryMovements.type, "egreso_entrega"))).groupBy(products.id, products.name, products.sku).orderBy(desc(sql`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`)).limit(10),
    db.select({ productId: products.id, productName: products.name, workerName: sql<string>`COALESCE(${workers.firstName} || ' ' || ${workers.lastName}, ${deliveries.receiverName}, 'Sin trabajador')`, worksiteName: worksites.name, totalQty: sql<number>`COALESCE(SUM(${deliveryItems.quantity}), 0)`, deliveryCount: sql<number>`COUNT(*)` }).from(deliveryItems).innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id)).leftJoin(workers, eq(deliveries.workerId, workers.id)).leftJoin(worksites, eq(deliveries.worksiteId, worksites.id)).leftJoin(products, eq(deliveryItems.productId, products.id)).leftJoin(productCategories, eq(products.categoryId, productCategories.id)).where(and(deliveryScope, filters.worksiteId ? eq(deliveries.worksiteId, filters.worksiteId) : undefined, gte(deliveries.deliveredAt, filters.fromDate), lte(deliveries.deliveredAt, `${filters.toDate}T23:59:59`), sql`(${products.isEpp} = true OR ${productCategories.isEpp} = true)`)).groupBy(products.id, products.name, workers.firstName, workers.lastName, deliveries.receiverName, worksites.name).orderBy(desc(sql`COALESCE(SUM(${deliveryItems.quantity}), 0)`)).limit(10),
    db.select({ id: purchaseOrders.id, code: purchaseOrders.code, worksiteName: worksites.name, supplierName: suppliers.name, totalAmount: purchaseOrders.totalAmount, createdAt: purchaseOrders.createdAt }).from(purchaseOrders).innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id)).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(orderWhere).orderBy(desc(purchaseOrders.createdAt)).limit(8),
    db.select({ vehicleId: maintenanceRecords.vehicleId, totalMaintenanceAmount: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)`, maintenanceCount: sql<number>`COUNT(*)` }).from(maintenanceRecords).where(maintenanceWhere).groupBy(maintenanceRecords.vehicleId),
  ])

  const purchaseTotal = Number(purchaseSummary?.totalAmount ?? 0)
  const fuelTotal = Number(fuelSummary?.totalAmount ?? 0)
  const previousTotal = Number(previousPurchaseSummary?.totalAmount ?? 0) + Number(previousFuelSummary?.totalAmount ?? 0)
  const totalSpend = purchaseTotal + fuelTotal

  const spendByMonth = mergeSpendByMonth([...purchaseMonths.map((r) => ({ month: r.month, module: r.module, totalAmount: Number(r.totalAmount ?? 0) })), ...fuelMonths.map((r) => ({ month: r.month, module: r.module, totalAmount: Number(r.totalAmount ?? 0) }))])

  const spendByModule = [...purchaseModules.map((r) => ({ module: moduleLabel(r.module), totalAmount: Number(r.totalAmount ?? 0) })), ...fuelModules.map((r) => ({ module: r.module ?? "Combustible", totalAmount: Number(r.totalAmount ?? 0) }))].filter((r) => r.totalAmount > 0).sort((a, b) => b.totalAmount - a.totalAmount)

  const topSuppliers = [...purchaseSuppliers, ...fuelSupplierRows].map((r) => ({ id: r.id, name: r.name, module: r.module, totalAmount: Number(r.totalAmount ?? 0), count: Number(r.count ?? 0) })).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10)

  const topWorksites = mergeWorksiteSpend([...purchaseWorksites, ...fuelWorksites])

  const maintenanceByVehicle = new Map(maintenanceRows.map((r) => [r.vehicleId, { totalServiceAmount: Number(r.totalMaintenanceAmount ?? 0), maintenanceCount: Number(r.maintenanceCount ?? 0) }]))
  const vehicleCosts = vehicleRows.map((r) => { const fuelAmount = Number(r.totalFuelAmount ?? 0); const m = maintenanceByVehicle.get(r.id); return { id: r.id, plate: r.plate, type: r.type, totalFuelAmount: fuelAmount, totalServiceAmount: m?.totalServiceAmount ?? 0, totalOperationalCost: fuelAmount + (m?.totalServiceAmount ?? 0), totalLiters: Number(r.totalLiters ?? 0), loadCount: Number(r.loadCount ?? 0), maintenanceCount: m?.maintenanceCount ?? 0, lastOdometerReading: r.lastOdometerReading == null ? null : Number(r.lastOdometerReading), lastHourMeterReading: r.lastHourMeterReading == null ? null : Number(r.lastHourMeterReading) } })

  const stockRisks = stockRows.map((r) => ({ productId: r.productId, productName: r.productName, sku: r.sku, worksiteName: r.worksiteName, currentQty: Number(r.currentQty ?? 0), minStock: Number(r.minStock ?? 0) }))
  const productRotation = rotationRows.map((r) => ({ productId: r.productId, productName: r.productName, sku: r.sku, totalOut: Number(r.totalOut ?? 0), movementCount: Number(r.movementCount ?? 0) }))
  const eppDeliveries = eppRows.map((r) => ({ productId: r.productId ?? "sin-producto", productName: r.productName ?? "EPP sin catálogo", workerName: r.workerName, worksiteName: r.worksiteName ?? "Sin faena", totalQty: Number(r.totalQty ?? 0), deliveryCount: Number(r.deliveryCount ?? 0) }))

  const dataGaps = buildDataGaps(vehicleCosts)
  const alerts = buildAlerts({ stockRisks, vehicleCosts, topSuppliers, eppDeliveries, totalSpend, thresholds, detectedAt, noData: totalSpend === 0 && stockRisks.length === 0 && eppDeliveries.length === 0 })

  return {
    filters, kpis: { totalSpend, previousTotalSpend: previousTotal, spendVariationPct: variationPct(totalSpend, previousTotal), purchaseOrderCount: Number(purchaseSummary?.orderCount ?? 0), pendingApprovals: Number(approvalSummary?.pendingApprovals ?? 0), criticalStockCount: Number(stockSummary?.criticalStockCount ?? 0), fuelLiters: Number(fuelSummary?.totalLiters ?? 0), fuelLoadCount: Number(fuelSummary?.loadCount ?? 0), averageOrderAmount: Number(purchaseSummary?.averageOrderAmount ?? 0) },
    spendByMonth, spendByModule, topSuppliers, topWorksites, vehicleCosts, stockRisks, productRotation, eppDeliveries,
    recentOrders: recentOrders.map((r) => ({ id: r.id, code: r.code, worksiteName: r.worksiteName, supplierName: r.supplierName, totalAmount: Number(r.totalAmount ?? 0), createdAt: r.createdAt })),
    alerts, dataGaps,
  }
}
