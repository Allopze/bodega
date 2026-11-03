import type { Session } from "next-auth"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries, deliveryItems, fuelEquipmentTypes, fuelMeterReadings, fuelProviderTransactions, fuelSuppliers, fuelVehicles,
  inventoryMovements, products, productCategories,
  purchaseOrderItems, purchaseOrders, purchaseRequestItems, purchaseRequests,
  suppliers, worksites, workers,
} from "@/db/schema"
import type { AnalyticsDashboardData, AnalyticsFilters } from "./types"
import {
  ACTIVE_ORDER_STATUSES, normalizeAnalyticsFilters,
  previousPeriod, dateFilter, worksiteFilter, mergeSpendByMonth,
  mergeWorksiteSpend, variationPct, moduleLabel, getAnalyticsAlertThresholds,
  buildDataGaps, dateOnly, chileDayRange, chileMonthExpr,
  monthlyTrendWindow, buildMonthlyTrend,
} from "./helpers"
import { buildAlerts } from "./alerts"
import { can } from "@/lib/auth/can"
import { issuedOrderPredicate } from "@/lib/services/operational-period-metrics"
import { accountableProviderTransactionsWhere, providerLoadCountSql } from "@/lib/combustibles/load-status"
import { controlFiltersForRange, isoTextPeriodSql } from "@/lib/combustibles/control/queries/field-filters"
import { todayInChile } from "@/lib/utils"

export interface PurchasingFinancialSummary {
  kpis: {
    totalSpend: number
    previousTotalSpend: number
    spendVariationPct: number | null
    purchaseOrderCount: number
    averageOrderAmount: number
  }
  spendByModule: AnalyticsDashboardData["spendByModule"]
  topSuppliers: AnalyticsDashboardData["topSuppliers"]
}

/**
 * Read model mínimo para la sección Finanzas del tablero. Mantenerlo separado
 * evita que un rol de compras consulte stock, EPP, combustible o
 * aprobaciones sólo para dibujar gasto de OC y proveedores.
 */
export async function getPurchasingFinancialSummary(
  session: Session,
  rawFilters: AnalyticsFilters = {},
): Promise<PurchasingFinancialSummary> {
  if (!can(session, "purchasing:view")) throw new Error("No autorizado")

  const filters = normalizeAnalyticsFilters(rawFilters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const orderScope = worksiteFilter(session, purchaseOrders.worksiteId)
  // INI-01 (auditoría 2026-10-05): el gasto del tablero se fecha por emisión y
  // usa la misma definición de "OC emitida" que el resto de las vistas
  // (`issuedOrderPredicate`): fuera de borrador, sin anuladas ni eliminadas.
  // Antes se fechaba por `createdAt` y los gráficos de Finanzas no cuadraban
  // con los tiles. `issuedAt` es texto (día o ISO): se compara como fecha.
  const issuedBetween = (from: string, to: string) => and(
    sql`${purchaseOrders.issuedAt}::date >= ${from}::date`,
    sql`${purchaseOrders.issuedAt}::date <= ${to}::date`,
  )
  const orderWhere = and(
    orderScope,
    issuedOrderPredicate(),
    issuedBetween(filters.fromDate, filters.toDate),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
  )
  const previousOrderWhere = and(
    orderScope,
    issuedOrderPredicate(),
    // ANA-001: el período de comparación usa el mismo día civil que el consultado.
    issuedBetween(previous.fromDate, previous.toDate),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
  )

  const [[summary], [previousSummary], modules, supplierRows] = await Promise.all([
    db.select({
      totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      orderCount: sql<number>`COUNT(*)`,
      averageOrderAmount: sql<number>`COALESCE(AVG(${purchaseOrders.totalAmount}), 0)`,
    }).from(purchaseOrders).where(orderWhere),
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` })
      .from(purchaseOrders).where(previousOrderWhere),
    db.select({
      module: purchaseRequests.requestType,
      totalAmount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`,
    })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .leftJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
      .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(orderWhere, filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined))
      .groupBy(purchaseRequests.requestType)
      .orderBy(desc(sql`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`)),
    db.select({
      id: suppliers.id,
      name: suppliers.name,
      module: sql<string>`'Compras'`,
      totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(orderWhere)
      .groupBy(suppliers.id, suppliers.name)
      .orderBy(desc(sql`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`))
      .limit(10),
  ])

  const totalSpend = Number(summary?.totalAmount ?? 0)
  const previousTotalSpend = Number(previousSummary?.totalAmount ?? 0)
  return {
    kpis: {
      totalSpend,
      previousTotalSpend,
      spendVariationPct: variationPct(totalSpend, previousTotalSpend),
      purchaseOrderCount: Number(summary?.orderCount ?? 0),
      averageOrderAmount: Number(summary?.averageOrderAmount ?? 0),
    },
    spendByModule: modules
      .map((row) => ({ module: moduleLabel(row.module), totalAmount: Number(row.totalAmount ?? 0) }))
      .filter((row) => row.totalAmount > 0)
      .sort((a, b) => b.totalAmount - a.totalAmount),
    topSuppliers: supplierRows.map((row) => ({
      id: row.id,
      name: row.name,
      module: row.module,
      totalAmount: Number(row.totalAmount ?? 0),
      count: Number(row.count ?? 0),
    })),
  }
}

export async function getAnalyticsDashboard(session: Session, rawFilters: AnalyticsFilters = {}): Promise<AnalyticsDashboardData> {
  const canViewFuel = can(session, "combustibles:view")
  const canViewFuelCosts = canViewFuel && can(session, "combustibles:view_costs")
  const filters = normalizeAnalyticsFilters(rawFilters)
  const previous = previousPeriod(filters.fromDate, filters.toDate)
  const detectedAt = dateOnly(new Date())
  const thresholds = await getAnalyticsAlertThresholds()

  const orderScope = worksiteFilter(session, purchaseOrders.worksiteId)
  const requestScope = worksiteFilter(session, purchaseRequests.worksiteId)
  const movementScope = worksiteFilter(session, inventoryMovements.worksiteId)
  const deliveryScope = worksiteFilter(session, deliveries.worksiteId)
  const t = fuelProviderTransactions
  const fuelScope = worksiteFilter(session, t.worksiteId)

  const orderWhere = and(orderScope, inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES), dateFilter(filters, purchaseOrders.createdAt), filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined, filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined)
  const previousOrderWhere = and(orderScope, inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES), chileDayRange(purchaseOrders.createdAt, previous.fromDate, previous.toDate), filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined, filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined)
  // C-9: el gasto en combustible sale del libro del proveedor (Copec), no de
  // `fuel_loads` (0 filas en producción), con la regla canónica que ya usa la
  // conciliación: aceptadas, vigentes y sin doble conteo del agregado mensual TCT
  // (`lib/combustibles/load-status.ts`). `occurred_at` es texto ISO: el día y el
  // mes salen de sus primeros 10 y 7 caracteres, como en el módulo de combustibles.
  const fuelWhereFor = (from: string, to: string) => and(
    accountableProviderTransactionsWhere(),
    fuelScope,
    isoTextPeriodSql(controlFiltersForRange({ from, to }), t.occurredAt),
    filters.worksiteId ? eq(t.worksiteId, filters.worksiteId) : undefined,
    filters.vehicleId ? eq(t.vehicleId, filters.vehicleId) : undefined,
  )
  const fuelWhere = fuelWhereFor(filters.fromDate, filters.toDate)
  const previousFuelWhere = fuelWhereFor(previous.fromDate, previous.toDate)
  // C-10: la tendencia mensual mira 12 meses que terminan en `hasta`, sin importar `desde`.
  const trend = monthlyTrendWindow(filters.toDate)
  const trendOrderWhere = and(orderScope, inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES), chileDayRange(purchaseOrders.createdAt, trend.fromDate, trend.toDate), filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined, filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined)
  const trendFuelWhere = fuelWhereFor(trend.fromDate, trend.toDate)
  // Importes de una fila contable y cuántas cargas representa (un agregado TCT trae su detalle).
  const fuelAmountSql = sql<number>`COALESCE(SUM(${t.amount}), 0)`
  const fuelLitersSql = sql<number>`COALESCE(SUM(${t.quantity}), 0)`
  const fuelMonthSql = sql<string>`left(${t.occurredAt}, 7)`
  const fuelLoadsSql = sql<number>`COALESCE(SUM(${providerLoadCountSql()}), 0)`
  const [[purchaseSummary], [previousPurchaseSummary], [fuelSummary], [previousFuelSummary], [approvalSummary], purchaseMonths, fuelMonths, purchaseModules, fuelModules, purchaseSuppliers, fuelSupplierRows, purchaseWorksites, fuelWorksites, vehicleRows, rotationRows, eppRows, recentOrders, [eppWorkerSummary]] = await Promise.all([
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`, orderCount: sql<number>`COUNT(*)`, averageOrderAmount: sql<number>`COALESCE(AVG(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(orderWhere),
    db.select({ totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(previousOrderWhere),
    canViewFuel
      ? db.select({ totalAmount: canViewFuelCosts ? fuelAmountSql : sql<null>`null`, loadCount: fuelLoadsSql, totalLiters: fuelLitersSql }).from(t).where(fuelWhere)
      : Promise.resolve([]),
    canViewFuelCosts
      ? db.select({ totalAmount: fuelAmountSql }).from(t).where(previousFuelWhere)
      : Promise.resolve([]),
    db.select({ pendingApprovals: sql<number>`COUNT(*) FILTER (WHERE ${purchaseRequestItems.status} = 'requested')` }).from(purchaseRequestItems).innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id)).where(and(requestScope, filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined, dateFilter(filters, purchaseRequests.createdAt))),
    db.select({ month: chileMonthExpr(purchaseOrders.createdAt), module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).where(trendOrderWhere).groupBy(chileMonthExpr(purchaseOrders.createdAt)).orderBy(chileMonthExpr(purchaseOrders.createdAt)),
    canViewFuelCosts
      ? db.select({ month: fuelMonthSql, module: sql<string>`'Combustible'`, totalAmount: fuelAmountSql }).from(t).where(trendFuelWhere).groupBy(fuelMonthSql).orderBy(fuelMonthSql)
      : Promise.resolve([]),
    db.select({ module: purchaseRequests.requestType, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)` }).from(purchaseOrderItems).innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id)).leftJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id)).leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id)).where(and(orderWhere, filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined)).groupBy(purchaseRequests.requestType).orderBy(desc(sql`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`)),
    canViewFuelCosts
      ? db.select({ module: sql<string>`'Combustible'`, totalAmount: fuelAmountSql }).from(t).where(fuelWhere)
      : Promise.resolve([]),
    db.select({ id: suppliers.id, name: suppliers.name, module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`, count: sql<number>`COUNT(*)` }).from(purchaseOrders).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(orderWhere).groupBy(suppliers.id, suppliers.name).orderBy(desc(sql`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`)).limit(10),
    canViewFuelCosts
      ? db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name, module: sql<string>`'Combustible'`, totalAmount: fuelAmountSql, count: fuelLoadsSql }).from(t).innerJoin(fuelSuppliers, eq(t.supplierId, fuelSuppliers.id)).where(fuelWhere).groupBy(fuelSuppliers.id, fuelSuppliers.name).orderBy(desc(fuelAmountSql)).limit(10)
      : Promise.resolve([]),
    db.select({ id: worksites.id, name: worksites.name, module: sql<string>`'Compras'`, totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)` }).from(purchaseOrders).innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id)).where(orderWhere).groupBy(worksites.id, worksites.name),
    canViewFuelCosts
      ? db.select({ id: worksites.id, name: worksites.name, module: sql<string>`'Combustible'`, totalAmount: fuelAmountSql }).from(t).innerJoin(worksites, eq(t.worksiteId, worksites.id)).where(fuelWhere).groupBy(worksites.id, worksites.name)
      : Promise.resolve([]),
    canViewFuelCosts
      ? db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, type: fuelEquipmentTypes.name, totalFuelAmount: fuelAmountSql, totalLiters: fuelLitersSql, loadCount: fuelLoadsSql }).from(t).innerJoin(fuelVehicles, eq(t.vehicleId, fuelVehicles.id)).innerJoin(fuelEquipmentTypes, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id)).where(fuelWhere).groupBy(fuelVehicles.id, fuelVehicles.plate, fuelEquipmentTypes.name).orderBy(desc(fuelAmountSql)).limit(10)
      : Promise.resolve([]),
    db.select({ productId: products.id, productName: products.name, sku: products.sku, totalOut: sql<number>`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`, movementCount: sql<number>`COUNT(*)` }).from(inventoryMovements).innerJoin(products, eq(inventoryMovements.productId, products.id)).where(and(movementScope, filters.worksiteId ? eq(inventoryMovements.worksiteId, filters.worksiteId) : undefined, chileDayRange(inventoryMovements.performedAt, filters.fromDate, filters.toDate), eq(inventoryMovements.type, "egreso_entrega"))).groupBy(products.id, products.name, products.sku).orderBy(desc(sql`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`)).limit(10),
    db.select({ productId: products.id, productName: products.name, workerName: sql<string>`COALESCE(${workers.firstName} || ' ' || ${workers.lastName}, ${deliveries.receiverName}, 'Sin trabajador')`, worksiteName: worksites.name, totalQty: sql<number>`COALESCE(SUM(${deliveryItems.quantity}), 0)`, deliveryCount: sql<number>`COUNT(*)` }).from(deliveryItems).innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id)).leftJoin(workers, eq(deliveries.workerId, workers.id)).leftJoin(worksites, eq(deliveries.worksiteId, worksites.id)).leftJoin(products, eq(deliveryItems.productId, products.id)).leftJoin(productCategories, eq(products.categoryId, productCategories.id)).where(and(deliveryScope, filters.worksiteId ? eq(deliveries.worksiteId, filters.worksiteId) : undefined, chileDayRange(deliveries.deliveredAt, filters.fromDate, filters.toDate), sql`(${products.isEpp} = true OR ${productCategories.isEpp} = true)`)).groupBy(products.id, products.name, workers.firstName, workers.lastName, deliveries.receiverName, worksites.name).orderBy(desc(sql`COALESCE(SUM(${deliveryItems.quantity}), 0)`)).limit(10),
    db.select({ id: purchaseOrders.id, code: purchaseOrders.code, worksiteName: worksites.name, supplierName: suppliers.name, totalAmount: purchaseOrders.totalAmount, createdAt: purchaseOrders.createdAt }).from(purchaseOrders).innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id)).innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id)).where(orderWhere).orderBy(desc(purchaseOrders.createdAt)).limit(8),
    // Trabajadores distintos con entrega de EPP en el período. `eppRows` no sirve
    // para contarlos: agrupa por trabajador × producto y trae sólo los 10 de más
    // cantidad, así que el tile del tablero nunca pasaba de 10.
    db.select({ workers: sql<number>`COUNT(DISTINCT COALESCE(${deliveries.workerId}::text, ${deliveries.receiverName}, 'sin-trabajador'))` }).from(deliveryItems).innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id)).leftJoin(products, eq(deliveryItems.productId, products.id)).leftJoin(productCategories, eq(products.categoryId, productCategories.id)).where(and(deliveryScope, filters.worksiteId ? eq(deliveries.worksiteId, filters.worksiteId) : undefined, chileDayRange(deliveries.deliveredAt, filters.fromDate, filters.toDate), sql`(${products.isEpp} = true OR ${productCategories.isEpp} = true)`)),
  ])

  const purchaseTotal = Number(purchaseSummary?.totalAmount ?? 0)
  const fuelTotal = Number(fuelSummary?.totalAmount ?? 0)
  const previousTotal = Number(previousPurchaseSummary?.totalAmount ?? 0) + Number(previousFuelSummary?.totalAmount ?? 0)
  const totalSpend = purchaseTotal + fuelTotal

  // Serie de 12 meses completa (ceros en los meses sin movimiento) y con el mes parcial marcado.
  const spendByMonth = buildMonthlyTrend(
    mergeSpendByMonth([...purchaseMonths.map((r) => ({ month: r.month, module: r.module, totalAmount: Number(r.totalAmount ?? 0) })), ...fuelMonths.map((r) => ({ month: r.month, module: r.module, totalAmount: Number(r.totalAmount ?? 0) }))]),
    filters.toDate,
    todayInChile(),
  )

  const spendByModule = [...purchaseModules.map((r) => ({ module: moduleLabel(r.module), totalAmount: Number(r.totalAmount ?? 0) })), ...fuelModules.map((r) => ({ module: r.module ?? "Combustible", totalAmount: Number(r.totalAmount ?? 0) }))].filter((r) => r.totalAmount > 0).sort((a, b) => b.totalAmount - a.totalAmount)

  const topSuppliers = [...purchaseSuppliers, ...fuelSupplierRows].map((r) => ({ id: r.id, name: r.name, module: r.module, totalAmount: Number(r.totalAmount ?? 0), count: Number(r.count ?? 0) })).sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 10)

  const topWorksites = mergeWorksiteSpend([...purchaseWorksites, ...fuelWorksites])

  // Última lectura CRONOLÓGICA por vehículo y tipo de medidor, no el máximo
  // histórico: un medidor reemplazado dejaba el máximo antiguo pegado para
  // siempre (CO-023, mismo fix que lib/services/fleet.ts). Salen de
  // `fuel_meter_readings` —el odómetro que trae el informe de detalle de Copec—,
  // no de `fuel_loads`: sin esto, al leer el gasto del proveedor cada vehículo
  // aparecería «sin lecturas» y las brechas de trazabilidad lo declararían falso.
  const vehicleIds = vehicleRows.map((r) => r.id)
  const lastReadingRows = canViewFuelCosts && vehicleIds.length > 0
    ? await db.selectDistinctOn([fuelMeterReadings.vehicleId, fuelMeterReadings.meterType], {
        vehicleId: fuelMeterReadings.vehicleId,
        meterType: fuelMeterReadings.meterType,
        value: fuelMeterReadings.value,
      })
      .from(fuelMeterReadings)
      .where(and(
        inArray(fuelMeterReadings.vehicleId, vehicleIds),
        eq(fuelMeterReadings.source, "copec_tct"),
        isoTextPeriodSql(controlFiltersForRange({ from: filters.fromDate, to: filters.toDate }), fuelMeterReadings.occurredAt),
      ))
      .orderBy(fuelMeterReadings.vehicleId, fuelMeterReadings.meterType, desc(fuelMeterReadings.occurredAt))
    : []
  const lastReadingByVehicle = new Map<string, { odometer: number | null; hourMeter: number | null }>()
  for (const reading of lastReadingRows) {
    if (!reading.vehicleId) continue
    const current = lastReadingByVehicle.get(reading.vehicleId) ?? { odometer: null, hourMeter: null }
    if (reading.meterType === "odometer") current.odometer = Number(reading.value)
    else current.hourMeter = Number(reading.value)
    lastReadingByVehicle.set(reading.vehicleId, current)
  }
  const vehicleCosts = vehicleRows.map((r) => {
    const lastReading = lastReadingByVehicle.get(r.id)
    return {
      id: r.id,
      plate: r.plate,
      type: r.type,
      totalFuelAmount: Number(r.totalFuelAmount ?? 0),
      totalLiters: Number(r.totalLiters ?? 0),
      loadCount: Number(r.loadCount ?? 0),
      lastOdometerReading: lastReading?.odometer ?? null,
      lastHourMeterReading: lastReading?.hourMeter ?? null,
    }
  })

  const productRotation = rotationRows.map((r) => ({ productId: r.productId, productName: r.productName, sku: r.sku, totalOut: Number(r.totalOut ?? 0), movementCount: Number(r.movementCount ?? 0) }))
  const eppDeliveries = eppRows.map((r) => ({ productId: r.productId ?? "sin-producto", productName: r.productName ?? "EPP sin catálogo", workerName: r.workerName, worksiteName: r.worksiteName ?? "Sin faena", totalQty: Number(r.totalQty ?? 0), deliveryCount: Number(r.deliveryCount ?? 0) }))

  const dataGaps = buildDataGaps(vehicleCosts)
  const alerts = buildAlerts({ vehicleCosts, topSuppliers, eppDeliveries, totalSpend, thresholds, detectedAt, noData: totalSpend === 0 && eppDeliveries.length === 0 })

  return {
    filters, kpis: { totalSpend, previousTotalSpend: previousTotal, spendVariationPct: variationPct(totalSpend, previousTotal), purchaseOrderCount: Number(purchaseSummary?.orderCount ?? 0), pendingApprovals: Number(approvalSummary?.pendingApprovals ?? 0), fuelAmount: fuelTotal, fuelLiters: Number(fuelSummary?.totalLiters ?? 0), fuelLoadCount: Number(fuelSummary?.loadCount ?? 0), averageOrderAmount: Number(purchaseSummary?.averageOrderAmount ?? 0) },
    spendByMonth, spendByModule, topSuppliers, topWorksites, vehicleCosts, productRotation, eppDeliveries,
    eppWorkerCount: Number(eppWorkerSummary?.workers ?? 0),
    recentOrders: recentOrders.map((r) => ({ id: r.id, code: r.code, worksiteName: r.worksiteName, supplierName: r.supplierName, totalAmount: Number(r.totalAmount ?? 0), createdAt: r.createdAt })),
    alerts, dataGaps,
  }
}
