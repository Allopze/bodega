import type { Session } from "next-auth"
import { and, count, desc, eq, inArray, sql } from "drizzle-orm"
import { db } from "@/db"
import { fuelLoads, fuelProducts, fuelSuppliers, fuelVehicles, worksites } from "@/db/schema"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { accountableFuelLoadsWhere } from "@/lib/combustibles/load-status"
import { buildFuelVehiclesWhere } from "@/lib/combustibles/queries"
import { resolvePagination, type PaginationState } from "@/lib/pagination"
import type { InvoiceChartData } from "./invoice-charts"
import { INVOICE_PAGE_SIZE } from "./invoice-params"
import { buildInvoiceWhere, type InvoiceFilters } from "./invoice-query"
import type { InvoiceRow } from "./invoices-table"
import { createSettleTracker } from "./settle-tracker"

type NameOption = { id: string; name: string }
type ChartRow = { group: string | null; totalLiters: number; totalAmount: number }

/**
 * Postgres entrega `SUM(numeric)` como texto («279900.00») aunque el `select` lo
 * tipee `sql<number>`: se convierte aquí para que los gráficos reciban números.
 */
function toChartPoints<T extends ChartRow & { count?: number }>(rows: T[]): Array<ChartRow & { count?: number }> {
  return rows.map((row) => ({
    group: row.group,
    totalLiters: Number(row.totalLiters),
    totalAmount: Number(row.totalAmount),
    ...(row.count === undefined ? {} : { count: Number(row.count) }),
  }))
}

export interface InvoiceData {
  rows: InvoiceRow[]
  pagination: PaginationState
  /** Cifras del período: cuentan consumo real (registrado o conciliado), salvo que se filtre por un estado. */
  summary: { loads: number; liters: number; base: number; iec: number; iva: number; total: number }
  charts: InvoiceChartData
  options: {
    vehicles: Array<{ id: string; plate: string; code: string | null }>
    suppliers: NameOption[]
    worksites: NameOption[]
    products: NameOption[]
  }
  /** Consultas que cayeron a su respaldo (`settle`): la pantalla lo dice en vez de mostrar un cero falso. */
  degraded: string[]
  trackedTotal: number
}

/**
 * Todo lo que lee «Pagos › Facturas»: la lista paginada, las cifras del período,
 * los cuatro gráficos y las opciones de los filtros. Con el alcance por faena de
 * la sesión (`buildFuelLoadsWhere` y el de equipos y faenas), así que quien llama
 * no tiene cómo olvidarlo.
 *
 * Las cifras y los gráficos cuentan consumo real: un borrador o una carga anulada
 * se ve en la lista pero no suma (`accountableFuelLoadsWhere`). Si la persona
 * filtra por un estado, el filtro manda y las cifras acompañan a lo que ve.
 */
export async function loadInvoicesData(session: Session, filters: InvoiceFilters, page: number): Promise<InvoiceData> {
  const where = buildInvoiceWhere(session, filters)
  const counted = filters.status ? where : and(where, accountableFuelLoadsWhere())
  const worksiteScope = resolveWorksiteScope(session)
  const { track, degraded, total: trackedTotal } = createSettleTracker()

  const [totalRows, summaryRows, vehicles, suppliers, worksiteList, products, byMonth, byProduct, byWorksite, byEquipment] = await Promise.all([
    track(db.select({ total: count() }).from(fuelLoads).where(where), [{ total: 0 }], "facturas-conteo"),
    track(
      db.select({
        loads: count(),
        liters: sql<string>`coalesce(sum(${fuelLoads.liters}), 0)`,
        base: sql<string>`coalesce(sum(${fuelLoads.baseAmount}), 0)`,
        iec: sql<string>`coalesce(sum(${fuelLoads.iecTotal}), 0)`,
        iva: sql<string>`coalesce(sum(${fuelLoads.ivaAmount}), 0)`,
        total: sql<string>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      }).from(fuelLoads).where(counted),
      [{ loads: 0, liters: "0", base: "0", iec: "0", iva: "0", total: "0" }],
      "facturas-cifras",
    ),
    track(
      db.select({ id: fuelVehicles.id, plate: fuelVehicles.plate, code: fuelVehicles.code })
        .from(fuelVehicles).where(buildFuelVehiclesWhere(session)).orderBy(fuelVehicles.plate),
      [] as Array<{ id: string; plate: string; code: string | null }>,
      "facturas-equipos",
    ),
    track(db.select({ id: fuelSuppliers.id, name: fuelSuppliers.name }).from(fuelSuppliers).orderBy(fuelSuppliers.name), [] as NameOption[], "facturas-proveedores"),
    track<NameOption[]>(
      worksiteScope.mode === "none"
        ? Promise.resolve([])
        : db.select({ id: worksites.id, name: worksites.name }).from(worksites)
            .where(worksiteScope.mode === "some" ? inArray(worksites.id, worksiteScope.ids) : undefined).orderBy(worksites.name),
      [],
      "facturas-faenas",
    ),
    track(db.select({ id: fuelProducts.id, name: fuelProducts.name }).from(fuelProducts).where(eq(fuelProducts.isActive, true)).orderBy(fuelProducts.name), [] as NameOption[], "facturas-productos"),
    track(
      db.select({
        group: fuelLoads.month,
        totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
        totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
        count: sql<number>`count(*)`,
      }).from(fuelLoads).where(counted).groupBy(fuelLoads.month).orderBy(fuelLoads.month),
      [] as Array<ChartRow & { count: number }>,
      "facturas-grafico-mes",
    ),
    track(
      db.select({
        group: fuelLoads.product,
        totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
        totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      }).from(fuelLoads).where(counted).groupBy(fuelLoads.product).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)).limit(8),
      [] as ChartRow[],
      "facturas-grafico-producto",
    ),
    track(
      db.select({
        group: worksites.name,
        totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
        totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      }).from(fuelLoads).leftJoin(worksites, eq(fuelLoads.worksiteId, worksites.id)).where(counted)
        .groupBy(worksites.name).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)).limit(8),
      [] as ChartRow[],
      "facturas-grafico-faena",
    ),
    track(
      db.select({
        group: sql<string | null>`case when ${fuelVehicles.code} is null then ${fuelVehicles.plate} else ${fuelVehicles.code} || ' · ' || ${fuelVehicles.plate} end`,
        totalLiters: sql<number>`coalesce(sum(${fuelLoads.liters}), 0)`,
        totalAmount: sql<number>`coalesce(sum(${fuelLoads.totalAmount}), 0)`,
      }).from(fuelLoads).leftJoin(fuelVehicles, eq(fuelLoads.vehicleId, fuelVehicles.id)).where(counted)
        .groupBy(fuelVehicles.id, fuelVehicles.code, fuelVehicles.plate).orderBy(desc(sql`sum(${fuelLoads.totalAmount})`)).limit(8),
      [] as ChartRow[],
      "facturas-grafico-equipo",
    ),
  ])

  // La lista va después del conteo: la página pedida se acota al total real.
  const pagination = resolvePagination({ pageParam: String(page), totalItems: Number(totalRows[0]?.total ?? 0), pageSize: INVOICE_PAGE_SIZE })
  const listRows = await track(
    db.select({
      id: fuelLoads.id,
      loadDate: fuelLoads.loadDate,
      serviceType: fuelLoads.serviceType,
      product: fuelLoads.product,
      receiptNumber: fuelLoads.receiptNumber,
      odometerReading: fuelLoads.odometerReading,
      hourMeterReading: fuelLoads.hourMeterReading,
      liters: fuelLoads.liters,
      baseAmount: fuelLoads.baseAmount,
      iecTotal: fuelLoads.iecTotal,
      ivaAmount: fuelLoads.ivaAmount,
      totalAmount: fuelLoads.totalAmount,
      status: fuelLoads.status,
      vehicleCode: fuelVehicles.code,
      vehiclePlate: fuelVehicles.plate,
      supplierName: fuelSuppliers.name,
      worksiteName: worksites.name,
    })
      .from(fuelLoads)
      .leftJoin(fuelVehicles, eq(fuelVehicles.id, fuelLoads.vehicleId))
      .leftJoin(fuelSuppliers, eq(fuelSuppliers.id, fuelLoads.fuelSupplierId))
      .leftJoin(worksites, eq(worksites.id, fuelLoads.worksiteId))
      .where(where)
      .orderBy(desc(fuelLoads.loadDate), desc(fuelLoads.createdAt), desc(fuelLoads.id))
      .limit(INVOICE_PAGE_SIZE)
      .offset(pagination.offset),
    [],
    "facturas-lista",
  )
  const rows: InvoiceRow[] = listRows.map(({ vehicleCode, vehiclePlate, ...row }) => ({
    ...row,
    vehicle: vehiclePlate ? { code: vehicleCode, plate: vehiclePlate } : null,
  }))

  const summary = summaryRows[0]
  return {
    rows,
    // Si el conteo cayó, la primera página se muestra con lo que llegó en vez de decir «0 cargas».
    pagination: degraded.includes("facturas-conteo")
      ? resolvePagination({ pageParam: "1", totalItems: rows.length, pageSize: INVOICE_PAGE_SIZE })
      : pagination,
    summary: {
      loads: Number(summary?.loads ?? 0),
      liters: Number(summary?.liters ?? 0),
      base: Number(summary?.base ?? 0),
      iec: Number(summary?.iec ?? 0),
      iva: Number(summary?.iva ?? 0),
      total: Number(summary?.total ?? 0),
    },
    charts: {
      byMonth: toChartPoints(byMonth),
      byProduct: toChartPoints(byProduct),
      byWorksite: toChartPoints(byWorksite),
      byEquipment: toChartPoints(byEquipment),
    },
    options: { vehicles, suppliers, worksites: worksiteList, products },
    degraded,
    trackedTotal: trackedTotal(),
  }
}
