/**
 * Catálogo de repuestos (fase 2 de «Repuestos vinculados», 2026-11-09).
 *
 * Un repuesto de catálogo es una fila de `products` con `is_spare_part`, en la
 * categoría sembrada `repuestos` (migración 0385). Reutiliza tal cual
 * `product_suppliers`, `product_supplier_price_history` y la OC. Es de consumo
 * directo: no entra a stock ni kárdex.
 *
 * La compatibilidad con vehículos NO se declara: se deriva del historial. Un
 * repuesto «se compró para» un vehículo cuando una línea de solicitud lo
 * apunta (`purchase_request_items.product_id`, o la línea de OC vinculada a esa
 * solicitud con `purchase_order_items.product_id`) con `vehicle_id` y la
 * solicitud no está anulada ni rechazada.
 *
 * SIN AUTORIZACIÓN: este servicio no revisa permisos. Quien lo llama exige
 * `repuestos:catalog` para escribir, y para leer lo que corresponda a su
 * pantalla (`repuestos:create` / `purchasing:create_order` en el buscador).
 */

import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  fuelVehicles,
  productCategories,
  productSupplierPriceHistory,
  productSuppliers,
  products,
  purchaseOrderItems,
  purchaseOrders,
  purchaseRequestItems,
  purchaseRequests,
  suppliers,
  users,
} from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import { nanoid } from "@/lib/id"
import { generateUniqueSkus } from "@/lib/products/product-skus"
import { resolveActiveUnitCode } from "@/lib/services/product-unit-catalog"
import { matchesQuery } from "@/lib/utils"

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export const SPARE_PARTS_CATEGORY_SLUG = "repuestos"
export const SPARE_PART_SKU_PREFIX = "RPT"

/** Por qué un repuesto sube en el buscador cuando se eligió un vehículo. */
export type SparePartVehicleMatch = "vehicle" | "model" | null

export interface ListSparePartsOptions {
  query?: string
  vehicleId?: string
  includeInactive?: boolean
}

export interface SparePartListItem {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  isActive: boolean
  preferredSupplierId: string | null
  preferredSupplierName: string | null
  /** Precio del proveedor preferido; si no tiene, el último precio conocido de cualquier proveedor. */
  lastPrice: number | null
  /** Fecha (ISO) de la OC emitida más reciente que lo incluye. */
  lastPurchasedAt: string | null
  /** Vehículos distintos para los que se pidió. */
  vehicleCount: number
  purchasedForVehicleIds: string[]
  /**
   * Sólo con `vehicleId`: `"vehicle"` si se compró para ese vehículo,
   * `"model"` si se compró para otro de la misma marca y modelo, `null` si no.
   */
  vehicleMatch: SparePartVehicleMatch
}

export interface SparePartSupplierPrice {
  supplierId: string
  supplierName: string
  unitPrice: number | null
  isPreferred: boolean
  lastUpdated: string
}

export interface SparePartPriceHistoryEntry {
  id: string
  supplierId: string
  supplierName: string
  previousPrice: number | null
  newPrice: number | null
  source: string
  sourceId: string | null
  effectiveDate: string
  createdByName: string | null
}

export interface SparePartVehicleUsage {
  vehicleId: string
  vehicleCode: string | null
  vehiclePlate: string
  vehicleBrand: string | null
  vehicleModel: string | null
  /** Líneas de solicitud distintas que lo pidieron para este vehículo. */
  requestCount: number
  lastRequestedAt: string
}

export interface SparePartPurchaseLine {
  /** Línea de solicitud, si la hay (una OC puede llevar el repuesto sin solicitud). */
  requestItemId: string | null
  requestId: string | null
  requestCode: string | null
  orderId: string | null
  orderCode: string | null
  orderStatus: string | null
  supplierName: string | null
  vehicleId: string | null
  vehicleCode: string | null
  vehiclePlate: string | null
  quantity: number
  unitPrice: number | null
  /** Emisión de la OC; sin OC, la fecha de la línea de solicitud. */
  date: string
}

export interface SparePartRecord {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  notes: string | null
  referencePrice: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface SparePartDetail {
  part: SparePartRecord
  suppliers: SparePartSupplierPrice[]
  /** Más reciente primero. */
  priceHistory: SparePartPriceHistoryEntry[]
  /** «Comprado para», agrupado por vehículo, más reciente primero. */
  purchasedFor: SparePartVehicleUsage[]
  /** Últimas ~20 líneas de solicitud/OC, más reciente primero. */
  recentLines: SparePartPurchaseLine[]
}

export interface SparePartInput {
  name: string
  partNumber?: string | null
  partBrand?: string | null
  unitOfMeasure: string
  notes?: string | null
  referencePrice?: number | null
}

export interface CreateSparePartInput extends SparePartInput {
  createdByUserId: string
}

export interface SparePartSummary {
  id: string
  sku: string
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  isActive: boolean
}

/* ── Constantes internas ─────────────────────────────────────────────────── */

const DEAD_REQUEST_STATUSES = ["cancelled", "rejected"]
/** Una OC en borrador no se emitió; una anulada no se compró. */
const NOT_ISSUED_ORDER_STATUSES = ["draft", "cancelled"]
const RECENT_LINES_LIMIT = 20
const NAME_MAX = 200
const PART_FIELD_MAX = 100
const NOTES_MAX = 2000

/** Fecha de emisión de una OC como ISO UTC estable (los drivers difieren con timestamptz). */
const orderDateIso = sql<string>`to_char(coalesce(${purchaseOrders.issuedAt}::timestamptz, ${purchaseOrders.sentAt}::timestamptz, ${purchaseOrders.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

/* ── Normalización y validación ──────────────────────────────────────────── */

function cleanOptional(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\s+/g, " ")
  return trimmed ? trimmed : null
}

/** «1R-0750» y «1r 0750» son el mismo N° de parte para la búsqueda. */
function compactPartNumber(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toLowerCase()
  const right = (b ?? "").trim().toLowerCase()
  return left !== "" && left === right
}

interface NormalizedSparePartInput {
  name: string
  partNumber: string | null
  partBrand: string | null
  unitOfMeasure: string
  notes: string | null
  referencePrice: number | null
}

async function normalizeInput(client: typeof db | Tx, input: SparePartInput): Promise<NormalizedSparePartInput> {
  const name = cleanOptional(input.name)
  if (!name) throw new Error("El nombre del repuesto es obligatorio")
  if (name.length > NAME_MAX) throw new Error(`El nombre del repuesto no puede superar ${NAME_MAX} caracteres`)

  const partNumber = cleanOptional(input.partNumber)
  const partBrand = cleanOptional(input.partBrand)
  if (partNumber && partNumber.length > PART_FIELD_MAX) throw new Error(`El N° de parte no puede superar ${PART_FIELD_MAX} caracteres`)
  if (partBrand && partBrand.length > PART_FIELD_MAX) throw new Error(`La marca no puede superar ${PART_FIELD_MAX} caracteres`)

  const notes = (input.notes ?? "").trim() || null
  if (notes && notes.length > NOTES_MAX) throw new Error(`Las notas no pueden superar ${NOTES_MAX} caracteres`)

  const referencePrice = input.referencePrice ?? null
  if (referencePrice !== null && (!Number.isFinite(referencePrice) || referencePrice < 0)) {
    throw new Error("El precio de referencia debe ser un número no negativo")
  }

  const unitOfMeasure = await resolveActiveUnitCode(input.unitOfMeasure, client)

  return {
    name,
    partNumber,
    partBrand,
    unitOfMeasure,
    notes,
    referencePrice: referencePrice === null ? null : Math.round((referencePrice + Number.EPSILON) * 100) / 100,
  }
}

/** Mismo criterio que el índice único `products_spare_part_number_brand_unique`. */
function samePartNumberAndBrand(partNumber: string, partBrand: string | null) {
  return and(
    eq(products.isSparePart, true),
    sql`lower(${products.partNumber}) = lower(${partNumber})`,
    sql`lower(coalesce(${products.partBrand}, '')) = lower(${partBrand ?? ""})`,
  )
}

async function assertPartNumberAvailable(
  client: typeof db | Tx,
  partNumber: string | null,
  partBrand: string | null,
  exceptId?: string,
) {
  if (!partNumber) return
  const [existing] = await client
    .select({ sku: products.sku })
    .from(products)
    .where(and(samePartNumberAndBrand(partNumber, partBrand), exceptId ? ne(products.id, exceptId) : undefined))
    .limit(1)
  if (existing) throw new Error(`Ya existe el repuesto ${existing.sku} con ese N° de parte`)
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

async function sparePartsCategoryId(client: typeof db | Tx): Promise<string> {
  const [category] = await client
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(eq(productCategories.slug, SPARE_PARTS_CATEGORY_SLUG))
    .limit(1)
  if (!category) throw new Error("Falta la categoría «Repuestos» del catálogo; aplica las migraciones pendientes")
  return category.id
}

/* ── Vínculos con vehículos ──────────────────────────────────────────────── */

interface VehicleLinkRow {
  productId: string
  requestItemId: string
  vehicleId: string
  vehicleCode: string | null
  vehiclePlate: string
  vehicleBrand: string | null
  vehicleModel: string | null
  requestedAt: string
}

/**
 * Pares (repuesto, vehículo) del historial. El repuesto puede venir de la línea
 * de solicitud o de la línea de OC que la compra (Compras cataloga al armar la
 * OC). Las solicitudes anuladas o rechazadas no cuentan; la OC anulada o
 * eliminada tampoco aporta su vínculo.
 */
async function loadVehicleLinks(productId?: string): Promise<VehicleLinkRow[]> {
  const sparePartIds = db.select({ id: products.id }).from(products).where(
    productId ? and(eq(products.isSparePart, true), eq(products.id, productId)) : eq(products.isSparePart, true),
  )

  const rows = await db
    .select({
      requestProductId: purchaseRequestItems.productId,
      orderProductId:   purchaseOrderItems.productId,
      orderId:          purchaseOrders.id,
      requestItemId:    purchaseRequestItems.id,
      vehicleId:        fuelVehicles.id,
      vehicleCode:      fuelVehicles.code,
      vehiclePlate:     fuelVehicles.plate,
      vehicleBrand:     fuelVehicles.brand,
      vehicleModel:     fuelVehicles.model,
      requestedAt:      purchaseRequestItems.createdAt,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .innerJoin(fuelVehicles, eq(purchaseRequestItems.vehicleId, fuelVehicles.id))
    .leftJoin(purchaseOrderItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
    .leftJoin(purchaseOrders, and(
      eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id),
      isNull(purchaseOrders.deletedAt),
      ne(purchaseOrders.status, "cancelled"),
    ))
    .where(and(
      notInArray(purchaseRequests.status, DEAD_REQUEST_STATUSES),
      notInArray(purchaseRequestItems.status, DEAD_REQUEST_STATUSES),
      or(
        inArray(purchaseRequestItems.productId, sparePartIds),
        inArray(purchaseOrderItems.productId, sparePartIds),
      ),
    ))

  const links: VehicleLinkRow[] = []
  const seen = new Set<string>()
  const wanted = (id: string | null): id is string => id !== null && (!productId || id === productId)
  for (const row of rows) {
    const candidates = [row.requestProductId, row.orderId ? row.orderProductId : null]
    for (const candidate of candidates) {
      if (!wanted(candidate)) continue
      const key = `${candidate}|${row.requestItemId}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({
        productId: candidate,
        requestItemId: row.requestItemId,
        vehicleId: row.vehicleId,
        vehicleCode: row.vehicleCode,
        vehiclePlate: row.vehiclePlate,
        vehicleBrand: row.vehicleBrand,
        vehicleModel: row.vehicleModel,
        requestedAt: row.requestedAt,
      })
    }
  }
  // Una línea entra si CUALQUIERA de sus dos lados es repuesto, así que el
  // otro lado puede ser un producto común: se descarta acá.
  if (productId) return links
  const spare = new Set(
    (await db.select({ id: products.id }).from(products).where(eq(products.isSparePart, true))).map((row) => row.id),
  )
  return links.filter((link) => spare.has(link.productId))
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

export async function listSpareParts(opts: ListSparePartsOptions = {}): Promise<SparePartListItem[]> {
  const preferred = db
    .select({
      productId:    productSuppliers.productId,
      supplierId:   productSuppliers.supplierId,
      supplierName: suppliers.name,
      unitPrice:    productSuppliers.unitPrice,
    })
    .from(productSuppliers)
    .innerJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(eq(productSuppliers.isPreferred, true))
    .as("preferred")

  const parts = await db
    .select({
      id:                    products.id,
      sku:                   products.sku,
      name:                  products.name,
      partNumber:            products.partNumber,
      partBrand:             products.partBrand,
      unitOfMeasure:         products.unitOfMeasure,
      isActive:              products.isActive,
      preferredSupplierId:   preferred.supplierId,
      preferredSupplierName: preferred.supplierName,
      preferredPrice:        preferred.unitPrice,
    })
    .from(products)
    .leftJoin(preferred, eq(preferred.productId, products.id))
    .where(and(
      eq(products.isSparePart, true),
      opts.includeInactive ? undefined : eq(products.isActive, true),
    ))

  const query = (opts.query ?? "").trim()
  const compactQuery = compactPartNumber(query)
  const matching = query
    ? parts.filter((part) =>
        matchesQuery(query, [part.name, part.sku, part.partNumber])
        || (compactQuery.length > 0 && part.partNumber !== null && compactPartNumber(part.partNumber).includes(compactQuery)))
    : parts
  if (matching.length === 0) return []

  const ids = matching.map((part) => part.id)

  const latestPrices = await db
    .selectDistinctOn([productSuppliers.productId], {
      productId: productSuppliers.productId,
      unitPrice: productSuppliers.unitPrice,
    })
    .from(productSuppliers)
    .where(and(inArray(productSuppliers.productId, ids), sql`${productSuppliers.unitPrice} IS NOT NULL`))
    .orderBy(productSuppliers.productId, desc(productSuppliers.lastUpdated))
  const latestPriceById = new Map(latestPrices.map((row) => [row.productId, row.unitPrice]))

  const lastPurchases = await db
    .select({
      productId: purchaseOrderItems.productId,
      lastAt:    sql<string>`max(${orderDateIso})`,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .where(and(
      inArray(purchaseOrderItems.productId, ids),
      isNull(purchaseOrders.deletedAt),
      notInArray(purchaseOrders.status, NOT_ISSUED_ORDER_STATUSES),
    ))
    .groupBy(purchaseOrderItems.productId)
  const lastPurchaseById = new Map(lastPurchases.map((row) => [row.productId, row.lastAt]))

  const links = await loadVehicleLinks()
  const vehiclesByPart = new Map<string, Map<string, { brand: string | null; model: string | null }>>()
  for (const link of links) {
    const vehicles = vehiclesByPart.get(link.productId) ?? new Map()
    vehicles.set(link.vehicleId, { brand: link.vehicleBrand, model: link.vehicleModel })
    vehiclesByPart.set(link.productId, vehicles)
  }

  let target: { id: string; brand: string | null; model: string | null } | null = null
  if (opts.vehicleId) {
    const [vehicle] = await db
      .select({ id: fuelVehicles.id, brand: fuelVehicles.brand, model: fuelVehicles.model })
      .from(fuelVehicles)
      .where(eq(fuelVehicles.id, opts.vehicleId))
      .limit(1)
    target = vehicle ?? { id: opts.vehicleId, brand: null, model: null }
  }

  const items: SparePartListItem[] = matching.map((part) => {
    const vehicles = vehiclesByPart.get(part.id) ?? new Map<string, { brand: string | null; model: string | null }>()
    let vehicleMatch: SparePartVehicleMatch = null
    if (target) {
      if (vehicles.has(target.id)) vehicleMatch = "vehicle"
      else if ([...vehicles.values()].some((v) => sameText(v.brand, target.brand) && sameText(v.model, target.model))) {
        vehicleMatch = "model"
      }
    }
    return {
      id: part.id,
      sku: part.sku,
      name: part.name,
      partNumber: part.partNumber,
      partBrand: part.partBrand,
      unitOfMeasure: part.unitOfMeasure,
      isActive: part.isActive,
      preferredSupplierId: part.preferredSupplierId,
      preferredSupplierName: part.preferredSupplierName,
      lastPrice: part.preferredPrice ?? latestPriceById.get(part.id) ?? null,
      lastPurchasedAt: lastPurchaseById.get(part.id) ?? null,
      vehicleCount: vehicles.size,
      purchasedForVehicleIds: [...vehicles.keys()].sort(),
      vehicleMatch,
    }
  })

  const tier = (match: SparePartVehicleMatch) => (match === "vehicle" ? 0 : match === "model" ? 1 : 2)
  return items.sort((a, b) =>
    tier(a.vehicleMatch) - tier(b.vehicleMatch)
    || a.name.localeCompare(b.name, "es-CL", { sensitivity: "base" })
    || a.sku.localeCompare(b.sku))
}

export async function getSparePartDetail(id: string): Promise<SparePartDetail | null> {
  if (!id) return null
  const [part] = await db
    .select({
      id:             products.id,
      sku:            products.sku,
      name:           products.name,
      partNumber:     products.partNumber,
      partBrand:      products.partBrand,
      unitOfMeasure:  products.unitOfMeasure,
      notes:          products.notes,
      referencePrice: products.referencePrice,
      isActive:       products.isActive,
      createdAt:      products.createdAt,
      updatedAt:      products.updatedAt,
    })
    .from(products)
    .where(and(eq(products.id, id), eq(products.isSparePart, true)))
    .limit(1)
  if (!part) return null

  const supplierRows = await db
    .select({
      supplierId:   productSuppliers.supplierId,
      supplierName: suppliers.name,
      unitPrice:    productSuppliers.unitPrice,
      isPreferred:  productSuppliers.isPreferred,
      lastUpdated:  productSuppliers.lastUpdated,
    })
    .from(productSuppliers)
    .innerJoin(suppliers, eq(productSuppliers.supplierId, suppliers.id))
    .where(eq(productSuppliers.productId, id))
    .orderBy(desc(productSuppliers.isPreferred), desc(productSuppliers.lastUpdated), asc(suppliers.name))

  const priceHistory = await db
    .select({
      id:            productSupplierPriceHistory.id,
      supplierId:    productSupplierPriceHistory.supplierId,
      supplierName:  suppliers.name,
      previousPrice: productSupplierPriceHistory.previousPrice,
      newPrice:      productSupplierPriceHistory.newPrice,
      source:        productSupplierPriceHistory.source,
      sourceId:      productSupplierPriceHistory.sourceId,
      effectiveDate: productSupplierPriceHistory.effectiveDate,
      createdByName: users.name,
    })
    .from(productSupplierPriceHistory)
    .innerJoin(suppliers, eq(productSupplierPriceHistory.supplierId, suppliers.id))
    .leftJoin(users, eq(productSupplierPriceHistory.createdByUserId, users.id))
    .where(eq(productSupplierPriceHistory.productId, id))
    .orderBy(desc(productSupplierPriceHistory.effectiveDate), desc(productSupplierPriceHistory.createdAt))

  const links = await loadVehicleLinks(id)
  const usageByVehicle = new Map<string, SparePartVehicleUsage & { items: Set<string> }>()
  for (const link of links) {
    const usage = usageByVehicle.get(link.vehicleId) ?? {
      vehicleId: link.vehicleId,
      vehicleCode: link.vehicleCode,
      vehiclePlate: link.vehiclePlate,
      vehicleBrand: link.vehicleBrand,
      vehicleModel: link.vehicleModel,
      requestCount: 0,
      lastRequestedAt: link.requestedAt,
      items: new Set<string>(),
    }
    usage.items.add(link.requestItemId)
    usage.requestCount = usage.items.size
    if (link.requestedAt > usage.lastRequestedAt) usage.lastRequestedAt = link.requestedAt
    usageByVehicle.set(link.vehicleId, usage)
  }
  const purchasedFor = [...usageByVehicle.values()]
    .map(({ items: _items, ...usage }) => usage)
    .sort((a, b) => b.lastRequestedAt.localeCompare(a.lastRequestedAt))

  return {
    part,
    suppliers: supplierRows,
    priceHistory,
    purchasedFor,
    recentLines: await loadRecentLines(id),
  }
}

/**
 * Últimas líneas donde aparece el repuesto: líneas de OC (vinculadas por la OC
 * o por su solicitud) y líneas de solicitud que aún no tienen OC.
 */
async function loadRecentLines(id: string): Promise<SparePartPurchaseLine[]> {
  const orderLines = await db
    .select({
      requestItemId: purchaseRequestItems.id,
      requestId:     purchaseRequests.id,
      requestCode:   purchaseRequests.code,
      orderId:       purchaseOrders.id,
      orderCode:     purchaseOrders.code,
      orderStatus:   purchaseOrders.status,
      supplierName:  suppliers.name,
      vehicleId:     fuelVehicles.id,
      vehicleCode:   fuelVehicles.code,
      vehiclePlate:  fuelVehicles.plate,
      quantity:      purchaseOrderItems.quantity,
      unitPrice:     purchaseOrderItems.unitPrice,
      date:          orderDateIso,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .innerJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
    .leftJoin(purchaseRequestItems, eq(purchaseOrderItems.requestItemId, purchaseRequestItems.id))
    .leftJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(fuelVehicles, eq(purchaseRequestItems.vehicleId, fuelVehicles.id))
    .where(and(
      isNull(purchaseOrders.deletedAt),
      or(eq(purchaseOrderItems.productId, id), eq(purchaseRequestItems.productId, id)),
    ))
    .orderBy(desc(orderDateIso))
    .limit(RECENT_LINES_LIMIT)

  const withOrder = new Set(orderLines.map((line) => line.requestItemId).filter((value): value is string => value !== null))

  const requestLines = await db
    .select({
      requestItemId: purchaseRequestItems.id,
      requestId:     purchaseRequests.id,
      requestCode:   purchaseRequests.code,
      vehicleId:     fuelVehicles.id,
      vehicleCode:   fuelVehicles.code,
      vehiclePlate:  fuelVehicles.plate,
      quantity:      purchaseRequestItems.quantity,
      unitPrice:     purchaseRequestItems.estimatedUnitPrice,
      date:          purchaseRequestItems.createdAt,
    })
    .from(purchaseRequestItems)
    .innerJoin(purchaseRequests, eq(purchaseRequestItems.requestId, purchaseRequests.id))
    .leftJoin(fuelVehicles, eq(purchaseRequestItems.vehicleId, fuelVehicles.id))
    .where(and(
      eq(purchaseRequestItems.productId, id),
      notInArray(purchaseRequests.status, DEAD_REQUEST_STATUSES),
      notInArray(purchaseRequestItems.status, DEAD_REQUEST_STATUSES),
    ))
    .orderBy(desc(purchaseRequestItems.createdAt))
    .limit(RECENT_LINES_LIMIT * 2)

  const lines: SparePartPurchaseLine[] = [
    ...orderLines,
    ...requestLines
      .filter((line) => !withOrder.has(line.requestItemId))
      .map((line) => ({ ...line, orderId: null, orderCode: null, orderStatus: null, supplierName: null })),
  ]
  return lines
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, RECENT_LINES_LIMIT)
}

export async function findSparePartByPartNumber(
  partNumber: string,
  brand?: string | null,
): Promise<SparePartSummary | null> {
  const cleanNumber = cleanOptional(partNumber)
  if (!cleanNumber) return null
  const cleanBrand = cleanOptional(brand)

  const rows = await db
    .select({
      id:            products.id,
      sku:           products.sku,
      name:          products.name,
      partNumber:    products.partNumber,
      partBrand:     products.partBrand,
      unitOfMeasure: products.unitOfMeasure,
      isActive:      products.isActive,
    })
    .from(products)
    .where(and(
      cleanBrand
        ? samePartNumberAndBrand(cleanNumber, cleanBrand)
        : and(eq(products.isSparePart, true), sql`lower(${products.partNumber}) = lower(${cleanNumber})`),
      eq(products.isActive, true),
    ))
    // Sin marca: el repuesto sin marca primero, luego por SKU (determinista).
    .orderBy(sql`${products.partBrand} IS NULL DESC`, asc(products.sku))
    .limit(1)
  return rows[0] ?? null
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

/**
 * Da de alta un repuesto de catálogo dentro de la transacción del llamador
 * (la pantalla del catálogo o «crear desde la OC»).
 */
export async function createSparePartTx(
  tx: Tx,
  input: CreateSparePartInput,
): Promise<{ id: string; sku: string }> {
  const data = await normalizeInput(tx, input)
  await assertPartNumberAvailable(tx, data.partNumber, data.partBrand)
  const categoryId = await sparePartsCategoryId(tx)

  // Dos altas simultáneas leerían el mismo máximo RPT-NNN: el lock de
  // transacción las pone en fila hasta el COMMIT de la primera.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('products-sku-RPT'))`)
  const [sku] = await generateUniqueSkus(tx, 1, SPARE_PART_SKU_PREFIX)
  const id = nanoid()

  try {
    await tx.insert(products).values({
      id,
      sku: sku!,
      name: data.name,
      categoryId,
      unitOfMeasure: data.unitOfMeasure,
      isEpp: false,
      isService: false,
      isSparePart: true,
      partNumber: data.partNumber,
      partBrand: data.partBrand,
      referencePrice: data.referencePrice,
      notes: data.notes,
      isActive: true,
    })
  } catch (error) {
    // Carrera con otra alta del mismo N° de parte: el índice único decide.
    if (isUniqueViolation(error) && data.partNumber) {
      throw new Error("Ya existe un repuesto con ese N° de parte")
    }
    throw error
  }

  await recordAudit({
    userId: input.createdByUserId,
    action: "create",
    entityType: "product",
    entityId: id,
    entityCode: sku!,
    newState: { sku, name: data.name, partNumber: data.partNumber, partBrand: data.partBrand, isSparePart: true },
  }, tx)

  return { id, sku: sku! }
}

export async function updateSparePart(
  id: string,
  input: SparePartInput,
  actorUserId: string,
): Promise<{ id: string; sku: string }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: products.id, sku: products.sku, name: products.name, partNumber: products.partNumber, partBrand: products.partBrand })
      .from(products)
      .where(and(eq(products.id, id), eq(products.isSparePart, true)))
      .for("update")
    if (!current) throw new Error("El repuesto no existe")

    const data = await normalizeInput(tx, input)
    await assertPartNumberAvailable(tx, data.partNumber, data.partBrand, id)

    try {
      await tx.update(products).set({
        name: data.name,
        partNumber: data.partNumber,
        partBrand: data.partBrand,
        unitOfMeasure: data.unitOfMeasure,
        notes: data.notes,
        referencePrice: data.referencePrice,
        updatedAt: new Date().toISOString(),
      }).where(eq(products.id, id))
    } catch (error) {
      if (isUniqueViolation(error) && data.partNumber) {
        throw new Error("Ya existe un repuesto con ese N° de parte")
      }
      throw error
    }

    await recordAudit({
      userId: actorUserId,
      action: "update",
      entityType: "product",
      entityId: id,
      entityCode: current.sku,
      oldState: { name: current.name, partNumber: current.partNumber, partBrand: current.partBrand },
      newState: { name: data.name, partNumber: data.partNumber, partBrand: data.partBrand },
    }, tx)

    return { id, sku: current.sku }
  })
}

export async function setSparePartActive(id: string, active: boolean, actorUserId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(products)
      .set({ isActive: active, updatedAt: new Date().toISOString() })
      .where(and(eq(products.id, id), eq(products.isSparePart, true)))
      .returning({ sku: products.sku })
    if (!updated) throw new Error("El repuesto no existe")
    if (actorUserId) {
      await recordAudit({
        userId: actorUserId,
        action: "update",
        entityType: "product",
        entityId: id,
        entityCode: updated.sku,
        newState: { isActive: active },
      }, tx)
    }
  })
}
