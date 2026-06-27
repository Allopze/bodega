import type { Session } from "next-auth"
import { and, desc, eq, gte, inArray, lte, sql, type SQLWrapper } from "drizzle-orm"
import { db } from "@/db"
import {
  deliveries,
  deliveryItems,
  fuelLoads,
  fuelSuppliers,
  fuelVehicles,
  inventoryMovements,
  maintenanceRecords,
  products,
  productCategories,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  systemSettings,
  worksiteStock,
  worksites,
  workers,
} from "@/db/schema"
import { isGlobalRole, visibleWorksiteIds } from "@/lib/auth/scope"

export interface AnalyticsFilters {
  fromDate?: string
  toDate?: string
  worksiteId?: string
  supplierId?: string
  vehicleId?: string
  requestType?: string
}

export interface AnalyticsKpis {
  totalSpend: number
  previousTotalSpend: number
  spendVariationPct: number | null
  purchaseOrderCount: number
  pendingApprovals: number
  criticalStockCount: number
  fuelLiters: number
  fuelLoadCount: number
  averageOrderAmount: number
}

export interface SpendByMonthRow {
  month: string
  purchasingAmount: number
  fuelAmount: number
  totalAmount: number
}

export interface SpendByModuleRow {
  module: string
  totalAmount: number
}

export interface RankingRow {
  id: string
  name: string
  module?: string
  totalAmount: number
  count: number
}

export interface WorksiteSpendRow {
  id: string
  name: string
  totalAmount: number
}

export interface VehicleCostRow {
  id: string
  plate: string
  type: string
  totalFuelAmount: number
  totalServiceAmount: number
  totalOperationalCost: number
  totalLiters: number
  loadCount: number
  maintenanceCount: number
  lastOdometerReading: number | null
  lastHourMeterReading: number | null
}

export interface StockRiskRow {
  productId: string
  productName: string
  sku: string
  worksiteName: string
  currentQty: number
  minStock: number
}

export interface RotationRow {
  productId: string
  productName: string
  sku: string
  totalOut: number
  movementCount: number
}

export interface EppDeliveryRow {
  productId: string
  productName: string
  workerName: string
  worksiteName: string
  totalQty: number
  deliveryCount: number
}

export type AnalyticsAlertSeverity = "low" | "medium" | "high" | "critical"

export interface AnalyticsAlert {
  type: string
  severity: AnalyticsAlertSeverity
  module: string
  entityLabel: string
  reason: string
  action: string
  detectedAt: string
}

export interface AnalyticsDashboardData {
  filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">> & Omit<AnalyticsFilters, "fromDate" | "toDate">
  kpis: AnalyticsKpis
  spendByMonth: SpendByMonthRow[]
  spendByModule: SpendByModuleRow[]
  topSuppliers: RankingRow[]
  topWorksites: WorksiteSpendRow[]
  vehicleCosts: VehicleCostRow[]
  stockRisks: StockRiskRow[]
  productRotation: RotationRow[]
  eppDeliveries: EppDeliveryRow[]
  recentOrders: Array<{
    id: string
    code: string
    worksiteName: string
    supplierName: string
    totalAmount: number
    createdAt: string
  }>
  alerts: AnalyticsAlert[]
  dataGaps: string[]
}

const ACTIVE_ORDER_STATUSES = [
  "issued",
  "sent",
  "supplier_confirmed",
  "partially_office_received",
  "office_received",
  "partially_received",
  "received",
  "closed",
]

const REQUEST_TYPE_LABELS: Record<string, string> = {
  epp: "EPP",
  stock: "Stock",
  mantencion: "Mantención",
  otro: "Otros",
  repuestos: "Repuestos",
  servicios: "Servicios",
}

interface AnalyticsAlertThresholds {
  vehicleMonthlyAnomalyAmount: number
  supplierConcentrationPct: number
  eppRecurringDeliveryCount: number
}

const DEFAULT_ALERT_THRESHOLDS: AnalyticsAlertThresholds = {
  vehicleMonthlyAnomalyAmount: 5_000_000,
  supplierConcentrationPct: 60,
  eppRecurringDeliveryCount: 3,
}

export function normalizeAnalyticsFilters(
  input: AnalyticsFilters,
  now: Date = new Date(),
): Required<Pick<AnalyticsFilters, "fromDate" | "toDate">> & Omit<AnalyticsFilters, "fromDate" | "toDate"> {
  const fromDate = input.fromDate ?? monthStart(now)
  const toDate = input.toDate ?? dateOnly(now)
  return {
    fromDate,
    toDate,
    ...(input.worksiteId ? { worksiteId: input.worksiteId } : {}),
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(input.requestType ? { requestType: input.requestType } : {}),
  }
}

export async function getAnalyticsDashboard(
  session: Session,
  rawFilters: AnalyticsFilters = {},
): Promise<AnalyticsDashboardData> {
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

  const orderWhere = and(
    orderScope,
    inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES),
    dateFilter(filters, purchaseOrders.createdAt),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
  )
  const previousOrderWhere = and(
    orderScope,
    inArray(purchaseOrders.status, ACTIVE_ORDER_STATUSES),
    gte(purchaseOrders.createdAt, previous.fromDate),
    lte(purchaseOrders.createdAt, `${previous.toDate}T23:59:59`),
    filters.worksiteId ? eq(purchaseOrders.worksiteId, filters.worksiteId) : undefined,
    filters.supplierId ? eq(purchaseOrders.supplierId, filters.supplierId) : undefined,
  )
  const fuelWhere = and(
    fuelScope,
    gte(fuelLoads.loadDate, filters.fromDate),
    lte(fuelLoads.loadDate, filters.toDate),
    filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
    filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined,
  )
  const previousFuelWhere = and(
    fuelScope,
    gte(fuelLoads.loadDate, previous.fromDate),
    lte(fuelLoads.loadDate, previous.toDate),
    filters.worksiteId ? eq(fuelLoads.worksiteId, filters.worksiteId) : undefined,
    filters.vehicleId ? eq(fuelLoads.vehicleId, filters.vehicleId) : undefined,
  )
  const maintenanceWhere = and(
    maintenanceScope,
    gte(maintenanceRecords.maintenanceDate, filters.fromDate),
    lte(maintenanceRecords.maintenanceDate, filters.toDate),
    filters.worksiteId ? eq(maintenanceRecords.worksiteId, filters.worksiteId) : undefined,
    filters.vehicleId ? eq(maintenanceRecords.vehicleId, filters.vehicleId) : undefined,
    sql`${maintenanceRecords.status} <> 'cancelled'`,
  )

  const [
    [purchaseSummary],
    [previousPurchaseSummary],
    [fuelSummary],
    [previousFuelSummary],
    [approvalSummary],
    [stockSummary],
    purchaseMonths,
    fuelMonths,
    purchaseModules,
    fuelModules,
    purchaseSuppliers,
    fuelSupplierRows,
    purchaseWorksites,
    fuelWorksites,
    vehicleRows,
    stockRows,
    rotationRows,
    eppRows,
    recentOrders,
    maintenanceRows,
  ] = await Promise.all([
    db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
        averageOrderAmount: sql<number>`COALESCE(AVG(${purchaseOrders.totalAmount}), 0)`,
      })
      .from(purchaseOrders)
      .where(orderWhere),

    db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      })
      .from(purchaseOrders)
      .where(previousOrderWhere),

    db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
      })
      .from(fuelLoads)
      .where(fuelWhere),

    db
      .select({
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
      })
      .from(fuelLoads)
      .where(previousFuelWhere),

    db
      .select({
        pendingApprovals: sql<number>`COUNT(*) FILTER (WHERE ${purchaseRequestItems.status} = 'requested')`,
      })
      .from(purchaseRequestItems)
      .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        requestScope,
        filters.worksiteId ? eq(purchaseRequests.worksiteId, filters.worksiteId) : undefined,
        dateFilter(filters, purchaseRequests.createdAt),
      )),

    db
      .select({
        criticalStockCount: sql<number>`COUNT(*) FILTER (WHERE ${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock})`,
      })
      .from(worksiteStock)
      .where(and(
        stockScope,
        filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined,
      )),

    db
      .select({
        month: sql<string>`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`,
        module: sql<string>`'Compras'`,
        totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      })
      .from(purchaseOrders)
      .where(orderWhere)
      .groupBy(sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`)
      .orderBy(sql`to_char(${purchaseOrders.createdAt}, 'YYYY-MM')`),

    db
      .select({
        month: fuelLoads.month,
        module: sql<string>`'Combustible'`,
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
      })
      .from(fuelLoads)
      .where(fuelWhere)
      .groupBy(fuelLoads.month)
      .orderBy(fuelLoads.month),

    db
      .select({
        module: purchaseRequests.requestType,
        totalAmount: sql<number>`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .leftJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
      .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
      .where(and(
        orderWhere,
        filters.requestType ? eq(purchaseRequests.requestType, filters.requestType) : undefined,
      ))
      .groupBy(purchaseRequests.requestType)
      .orderBy(desc(sql`COALESCE(SUM(${purchaseOrderItems.subtotal}), 0)`)),

    db
      .select({
        module: sql<string>`'Combustible'`,
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
      })
      .from(fuelLoads)
      .where(fuelWhere),

    db
      .select({
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

    db
      .select({
        id: fuelSuppliers.id,
        name: fuelSuppliers.name,
        module: sql<string>`'Combustible'`,
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(fuelLoads)
      .innerJoin(fuelSuppliers, eq(fuelLoads.fuelSupplierId, fuelSuppliers.id))
      .where(fuelWhere)
      .groupBy(fuelSuppliers.id, fuelSuppliers.name)
      .orderBy(desc(sql`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`))
      .limit(10),

    db
      .select({
        id: worksites.id,
        name: worksites.name,
        module: sql<string>`'Compras'`,
        totalAmount: sql<number>`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .where(orderWhere)
      .groupBy(worksites.id, worksites.name),

    db
      .select({
        id: worksites.id,
        name: worksites.name,
        module: sql<string>`'Combustible'`,
        totalAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
      })
      .from(fuelLoads)
      .innerJoin(worksites, eq(fuelLoads.worksiteId, worksites.id))
      .where(fuelWhere)
      .groupBy(worksites.id, worksites.name),

    db
      .select({
        id: fuelVehicles.id,
        plate: fuelVehicles.plate,
        type: fuelVehicles.type,
        totalFuelAmount: sql<number>`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`,
        totalLiters: sql<number>`COALESCE(SUM(${fuelLoads.liters}), 0)`,
        loadCount: sql<number>`COUNT(*)`,
        lastOdometerReading: sql<number>`MAX(${fuelLoads.odometerReading}) FILTER (WHERE ${fuelLoads.odometerReading} IS NOT NULL)`,
        lastHourMeterReading: sql<number>`MAX(${fuelLoads.hourMeterReading}) FILTER (WHERE ${fuelLoads.hourMeterReading} IS NOT NULL)`,
      })
      .from(fuelLoads)
      .innerJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id))
      .where(fuelWhere)
      .groupBy(fuelVehicles.id, fuelVehicles.plate, fuelVehicles.type)
      .orderBy(desc(sql`COALESCE(SUM(${fuelLoads.totalAmount}), 0)`))
      .limit(10),

    db
      .select({
        productId: products.id,
        productName: products.name,
        sku: products.sku,
        worksiteName: worksites.name,
        currentQty: worksiteStock.quantity,
        minStock: worksiteStock.minStock,
      })
      .from(worksiteStock)
      .innerJoin(products, eq(worksiteStock.productId, products.id))
      .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
      .where(and(
        stockScope,
        filters.worksiteId ? eq(worksiteStock.worksiteId, filters.worksiteId) : undefined,
        sql`${worksiteStock.minStock} > 0 AND ${worksiteStock.quantity} < ${worksiteStock.minStock}`,
      ))
      .orderBy(sql`${worksiteStock.quantity} - ${worksiteStock.minStock}`)
      .limit(10),

    db
      .select({
        productId: products.id,
        productName: products.name,
        sku: products.sku,
        totalOut: sql<number>`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`,
        movementCount: sql<number>`COUNT(*)`,
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(
        movementScope,
        filters.worksiteId ? eq(inventoryMovements.worksiteId, filters.worksiteId) : undefined,
        gte(inventoryMovements.performedAt, filters.fromDate),
        lte(inventoryMovements.performedAt, `${filters.toDate}T23:59:59`),
        eq(inventoryMovements.type, "egreso_entrega"),
      ))
      .groupBy(products.id, products.name, products.sku)
      .orderBy(desc(sql`COALESCE(SUM(ABS(${inventoryMovements.quantity})), 0)`))
      .limit(10),

    db
      .select({
        productId: products.id,
        productName: products.name,
        workerName: sql<string>`COALESCE(${workers.firstName} || ' ' || ${workers.lastName}, ${deliveries.receiverName}, 'Sin trabajador')`,
        worksiteName: worksites.name,
        totalQty: sql<number>`COALESCE(SUM(${deliveryItems.quantity}), 0)`,
        deliveryCount: sql<number>`COUNT(*)`,
      })
      .from(deliveryItems)
      .innerJoin(deliveries, eq(deliveryItems.deliveryId, deliveries.id))
      .leftJoin(workers, eq(deliveries.workerId, workers.id))
      .leftJoin(worksites, eq(deliveries.worksiteId, worksites.id))
      .leftJoin(products, eq(deliveryItems.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(
        deliveryScope,
        filters.worksiteId ? eq(deliveries.worksiteId, filters.worksiteId) : undefined,
        gte(deliveries.deliveredAt, filters.fromDate),
        lte(deliveries.deliveredAt, `${filters.toDate}T23:59:59`),
        sql`(${products.isEpp} = true OR ${productCategories.isEpp} = true)`,
      ))
      .groupBy(products.id, products.name, workers.firstName, workers.lastName, deliveries.receiverName, worksites.name)
      .orderBy(desc(sql`COALESCE(SUM(${deliveryItems.quantity}), 0)`))
      .limit(10),

    db
      .select({
        id: purchaseOrders.id,
        code: purchaseOrders.code,
        worksiteName: worksites.name,
        supplierName: suppliers.name,
        totalAmount: purchaseOrders.totalAmount,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .innerJoin(worksites, eq(purchaseOrders.worksiteId, worksites.id))
      .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(orderWhere)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(8),

    db
      .select({
        vehicleId: maintenanceRecords.vehicleId,
        totalMaintenanceAmount: sql<number>`COALESCE(SUM(${maintenanceRecords.totalAmount}), 0)`,
        maintenanceCount: sql<number>`COUNT(*)`,
      })
      .from(maintenanceRecords)
      .where(maintenanceWhere)
      .groupBy(maintenanceRecords.vehicleId),
  ])

  const purchaseTotal = Number(purchaseSummary?.totalAmount ?? 0)
  const fuelTotal = Number(fuelSummary?.totalAmount ?? 0)
  const previousTotal = Number(previousPurchaseSummary?.totalAmount ?? 0) + Number(previousFuelSummary?.totalAmount ?? 0)
  const totalSpend = purchaseTotal + fuelTotal

  const spendByMonth = mergeSpendByMonth([
    ...purchaseMonths.map((row) => ({
      month: row.month,
      module: row.module,
      totalAmount: Number(row.totalAmount ?? 0),
    })),
    ...fuelMonths.map((row) => ({
      month: row.month,
      module: row.module,
      totalAmount: Number(row.totalAmount ?? 0),
    })),
  ])

  const spendByModule = [
    ...purchaseModules.map((row) => ({
      module: moduleLabel(row.module),
      totalAmount: Number(row.totalAmount ?? 0),
    })),
    ...fuelModules.map((row) => ({
      module: row.module ?? "Combustible",
      totalAmount: Number(row.totalAmount ?? 0),
    })),
  ]
    .filter((row) => row.totalAmount > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount)

  const topSuppliers = [...purchaseSuppliers, ...fuelSupplierRows]
    .map((row) => ({
      id: row.id,
      name: row.name,
      module: row.module,
      totalAmount: Number(row.totalAmount ?? 0),
      count: Number(row.count ?? 0),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10)

  const topWorksites = mergeWorksiteSpend([...purchaseWorksites, ...fuelWorksites])

  const maintenanceByVehicle = new Map(maintenanceRows.map((row) => [
    row.vehicleId,
    {
      totalServiceAmount: Number(row.totalMaintenanceAmount ?? 0),
      maintenanceCount: Number(row.maintenanceCount ?? 0),
    },
  ]))
  const vehicleCosts = vehicleRows.map((row) => {
    const totalFuelAmount = Number(row.totalFuelAmount ?? 0)
    const maintenance = maintenanceByVehicle.get(row.id)
    const totalServiceAmount = maintenance?.totalServiceAmount ?? 0
    return {
      id: row.id,
      plate: row.plate,
      type: row.type,
      totalFuelAmount,
      totalServiceAmount,
      totalOperationalCost: totalFuelAmount + totalServiceAmount,
      totalLiters: Number(row.totalLiters ?? 0),
      loadCount: Number(row.loadCount ?? 0),
      maintenanceCount: maintenance?.maintenanceCount ?? 0,
      lastOdometerReading: row.lastOdometerReading == null ? null : Number(row.lastOdometerReading),
      lastHourMeterReading: row.lastHourMeterReading == null ? null : Number(row.lastHourMeterReading),
    }
  })

  const stockRisks = stockRows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    worksiteName: row.worksiteName,
    currentQty: Number(row.currentQty ?? 0),
    minStock: Number(row.minStock ?? 0),
  }))

  const productRotation = rotationRows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    totalOut: Number(row.totalOut ?? 0),
    movementCount: Number(row.movementCount ?? 0),
  }))

  const eppDeliveries = eppRows.map((row) => ({
    productId: row.productId ?? "sin-producto",
    productName: row.productName ?? "EPP sin catálogo",
    workerName: row.workerName,
    worksiteName: row.worksiteName ?? "Sin faena",
    totalQty: Number(row.totalQty ?? 0),
    deliveryCount: Number(row.deliveryCount ?? 0),
  }))

  const dataGaps = buildDataGaps(vehicleCosts)

  const alerts = buildAlerts({
    stockRisks,
    vehicleCosts,
    topSuppliers,
    eppDeliveries,
    totalSpend,
    thresholds,
    detectedAt,
    noData: totalSpend === 0 && stockRisks.length === 0 && eppDeliveries.length === 0,
  })

  return {
    filters,
    kpis: {
      totalSpend,
      previousTotalSpend: previousTotal,
      spendVariationPct: variationPct(totalSpend, previousTotal),
      purchaseOrderCount: Number(purchaseSummary?.orderCount ?? 0),
      pendingApprovals: Number(approvalSummary?.pendingApprovals ?? 0),
      criticalStockCount: Number(stockSummary?.criticalStockCount ?? 0),
      fuelLiters: Number(fuelSummary?.totalLiters ?? 0),
      fuelLoadCount: Number(fuelSummary?.loadCount ?? 0),
      averageOrderAmount: Number(purchaseSummary?.averageOrderAmount ?? 0),
    },
    spendByMonth,
    spendByModule,
    topSuppliers,
    topWorksites,
    vehicleCosts,
    stockRisks,
    productRotation,
    eppDeliveries,
    recentOrders: recentOrders.map((row) => ({
      id: row.id,
      code: row.code,
      worksiteName: row.worksiteName,
      supplierName: row.supplierName,
      totalAmount: Number(row.totalAmount ?? 0),
      createdAt: row.createdAt,
    })),
    alerts,
    dataGaps,
  }
}

function buildAlerts(input: {
  stockRisks: StockRiskRow[]
  vehicleCosts: VehicleCostRow[]
  topSuppliers: RankingRow[]
  eppDeliveries: EppDeliveryRow[]
  totalSpend: number
  thresholds: AnalyticsAlertThresholds
  detectedAt: string
  noData: boolean
}): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = []

  for (const row of input.stockRisks.slice(0, 5)) {
    alerts.push({
      type: "stock_bajo",
      severity: "critical",
      module: "Bodega",
      entityLabel: row.productName,
      reason: `${row.worksiteName}: stock ${row.currentQty} bajo mínimo ${row.minStock}.`,
      action: "Revisar reposición o traslado antes de aprobar nuevas salidas.",
      detectedAt: input.detectedAt,
    })
  }

  for (const row of input.vehicleCosts.filter((v) => v.totalOperationalCost >= input.thresholds.vehicleMonthlyAnomalyAmount).slice(0, 3)) {
    alerts.push({
      type: "gasto_vehiculo_anomalo",
      severity: "high",
      module: "Vehículos",
      entityLabel: row.plate,
      reason: `Costo operacional ${row.totalOperationalCost} supera el umbral configurado ${input.thresholds.vehicleMonthlyAnomalyAmount}.`,
      action: "Revisar combustible, mantenciones e imputaciones asociadas al vehículo.",
      detectedAt: input.detectedAt,
    })
  }

  for (const row of input.topSuppliers.filter((s) => input.totalSpend > 0 && (s.totalAmount / input.totalSpend) * 100 >= input.thresholds.supplierConcentrationPct).slice(0, 3)) {
    alerts.push({
      type: "proveedor_concentrado",
      severity: "medium",
      module: "Proveedores",
      entityLabel: row.name,
      reason: `Concentra ${Math.round((row.totalAmount / input.totalSpend) * 100)}% del gasto del período.`,
      action: "Validar dependencia operativa, alternativas y condiciones comerciales.",
      detectedAt: input.detectedAt,
    })
  }

  for (const row of input.eppDeliveries.filter((d) => d.deliveryCount >= input.thresholds.eppRecurringDeliveryCount).slice(0, 3)) {
    alerts.push({
      type: "epp_recurrente",
      severity: "medium",
      module: "EPP",
      entityLabel: row.workerName,
      reason: `${row.deliveryCount} entregas de ${row.productName} en el período.`,
      action: "Revisar desgaste, cargo o necesidad de stock permanente por faena.",
      detectedAt: input.detectedAt,
    })
  }

  if (input.noData) {
    alerts.push({
      type: "sin_datos",
      severity: "low",
      module: "Analítica",
      entityLabel: "Período filtrado",
      reason: "No hay registros suficientes para calcular indicadores transversales con los filtros actuales.",
      action: "Ampliar el rango de fechas o revisar registros de compras, combustible, stock y entregas.",
      detectedAt: input.detectedAt,
    })
  }

  return alerts
}

function buildDataGaps(vehicleCosts: VehicleCostRow[]) {
  const gaps: string[] = []
  if (vehicleCosts.length > 0 && vehicleCosts.every((row) => row.totalServiceAmount === 0)) {
    gaps.push("No hay imputaciones de repuestos, servicios o mantenciones para los vehículos del período.")
  }
  if (vehicleCosts.length > 0 && vehicleCosts.every((row) => row.lastOdometerReading == null && row.lastHourMeterReading == null)) {
    gaps.push("No hay lecturas de kilometraje u horómetro en las cargas de combustible del período.")
  }
  return gaps
}

async function getAnalyticsAlertThresholds(): Promise<AnalyticsAlertThresholds> {
  try {
    const rows = await Promise.all([
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:vehicle_monthly_anomaly_amount") }),
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:supplier_concentration_pct") }),
      db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "analytics:epp_recurring_delivery_count") }),
    ])
    return {
      vehicleMonthlyAnomalyAmount: positiveNumber(rows[0]?.value, DEFAULT_ALERT_THRESHOLDS.vehicleMonthlyAnomalyAmount),
      supplierConcentrationPct: positiveNumber(rows[1]?.value, DEFAULT_ALERT_THRESHOLDS.supplierConcentrationPct),
      eppRecurringDeliveryCount: positiveNumber(rows[2]?.value, DEFAULT_ALERT_THRESHOLDS.eppRecurringDeliveryCount),
    }
  } catch {
    return DEFAULT_ALERT_THRESHOLDS
  }
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function mergeSpendByMonth(rows: Array<{ month: string; module: string; totalAmount: number }>): SpendByMonthRow[] {
  const byMonth = new Map<string, SpendByMonthRow>()
  for (const row of rows) {
    const current = byMonth.get(row.month) ?? {
      month: row.month,
      purchasingAmount: 0,
      fuelAmount: 0,
      totalAmount: 0,
    }
    if (row.module === "Combustible") current.fuelAmount += row.totalAmount
    else current.purchasingAmount += row.totalAmount
    current.totalAmount += row.totalAmount
    byMonth.set(row.month, current)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

function mergeWorksiteSpend(rows: Array<{ id: string; name: string; totalAmount: number }>): WorksiteSpendRow[] {
  const byWorksite = new Map<string, WorksiteSpendRow>()
  for (const row of rows) {
    const current = byWorksite.get(row.id) ?? { id: row.id, name: row.name, totalAmount: 0 }
    current.totalAmount += Number(row.totalAmount ?? 0)
    byWorksite.set(row.id, current)
  }
  return [...byWorksite.values()]
    .filter((row) => row.totalAmount > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10)
}

function variationPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

function moduleLabel(value: unknown) {
  const key = String(value ?? "otro")
  return REQUEST_TYPE_LABELS[key] ?? key
}

function previousPeriod(fromDate: string, toDate: string) {
  const from = parsePlainDate(fromDate)
  const to = parsePlainDate(toDate)
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1)
  const previousTo = new Date(from)
  previousTo.setDate(previousTo.getDate() - 1)
  const previousFrom = new Date(previousTo)
  previousFrom.setDate(previousFrom.getDate() - days + 1)
  return {
    fromDate: dateOnly(previousFrom),
    toDate: dateOnly(previousTo),
  }
}

function dateFilter(filters: Required<Pick<AnalyticsFilters, "fromDate" | "toDate">>, column: SQLWrapper) {
  return and(
    gte(column, filters.fromDate),
    lte(column, `${filters.toDate}T23:59:59`),
  )
}

function worksiteFilter(session: Session | null, column: SQLWrapper) {
  if (isGlobalRole(session)) return undefined
  const ids = visibleWorksiteIds(session)
  if (ids.length === 0) return sql`false`
  return inArray(column, ids as never[])
}

function monthStart(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-01`
}

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parsePlainDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}
