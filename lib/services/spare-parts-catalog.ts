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

import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm"
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
import { escapeLikePattern } from "@/lib/utils"

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export const SPARE_PARTS_CATEGORY_SLUG = "repuestos"
export const SPARE_PART_SKU_PREFIX = "RPT"

/** Por qué un repuesto sube en el buscador cuando se eligió un vehículo. */
export type SparePartVehicleMatch = "vehicle" | "model" | null

export interface ListSparePartsOptions {
  query?: string
  vehicleId?: string
  includeInactive?: boolean
  /** Sólo estos repuestos (p. ej. los que una solicitud ya referencia). */
  ids?: readonly string[]
  /** Sólo los comprados para `vehicleId` o para otro de su marca y modelo. */
  onlyVehicleMatches?: boolean
  /** Tope de filas; sin él, todas. */
  limit?: number
}

export interface SparePartSearchResult {
  parts: SparePartListItem[]
  /** Cuántos coincidían antes del tope. */
  total: number
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

export interface NormalizedSparePartInput {
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

async function findPartNumberOwner(
  client: typeof db | Tx,
  partNumber: string,
  partBrand: string | null,
  exceptId?: string,
): Promise<string | null> {
  const [existing] = await client
    .select({ sku: products.sku })
    .from(products)
    .where(and(samePartNumberAndBrand(partNumber, partBrand), exceptId ? ne(products.id, exceptId) : undefined))
    .limit(1)
  return existing?.sku ?? null
}

function duplicatePartNumberMessage(sku: string | null): string {
  return sku ? `Ya existe el repuesto ${sku} con ese N° de parte` : "Ya existe un repuesto con ese N° de parte"
}

async function assertPartNumberAvailable(
  client: typeof db | Tx,
  partNumber: string | null,
  partBrand: string | null,
  exceptId?: string,
) {
  if (!partNumber) return
  const sku = await findPartNumberOwner(client, partNumber, partBrand, exceptId)
  if (sku) throw new Error(duplicatePartNumberMessage(sku))
}

/**
 * Corre una escritura de repuesto en un savepoint y, si el índice único del N°
 * de parte la rechaza (otra alta del mismo número ganó la carrera entre la
 * revisión previa y la escritura), dice cuál es el repuesto que ya lo tiene,
 * con el mismo mensaje que la revisión previa. El savepoint deja la transacción
 * usable para esa lectura: sin él, Postgres la da por abortada.
 */
async function withPartNumberGuard(
  tx: Tx,
  data: { partNumber: string | null; partBrand: string | null },
  write: (sp: Tx) => Promise<unknown>,
  exceptId?: string,
): Promise<void> {
  try {
    await tx.transaction(async (sp) => { await write(sp as unknown as Tx) })
  } catch (error) {
    if (isUniqueViolation(error) && data.partNumber) {
      const sku = await findPartNumberOwner(tx, data.partNumber, data.partBrand, exceptId)
      throw new Error(duplicatePartNumberMessage(sku))
    }
    throw error
  }
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
 *
 * `productIds`: sólo esos repuestos (lo que devolvió la búsqueda). `null` = todo
 * el catálogo, para la lista completa de la pantalla de gestión.
 */
async function loadVehicleLinks(productIds: readonly string[] | null): Promise<VehicleLinkRow[]> {
  if (productIds !== null && productIds.length === 0) return []
  const allSpareParts = db.select({ id: products.id }).from(products).where(eq(products.isSparePart, true))

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
      productIds !== null
        ? or(inArray(purchaseRequestItems.productId, [...productIds]), inArray(purchaseOrderItems.productId, [...productIds]))
        : or(inArray(purchaseRequestItems.productId, allSpareParts), inArray(purchaseOrderItems.productId, allSpareParts)),
    ))

  // Una línea entra si CUALQUIERA de sus dos lados es uno de los buscados, así
  // que el otro lado puede ser un producto común: se descarta acá.
  const spare = productIds !== null
    ? new Set(productIds)
    : new Set((await db.select({ id: products.id }).from(products).where(eq(products.isSparePart, true))).map((row) => row.id))

  const links: VehicleLinkRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const candidates = [row.requestProductId, row.orderId ? row.orderProductId : null]
    for (const candidate of candidates) {
      if (candidate === null || !spare.has(candidate)) continue
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
  return links
}

/* ── Búsqueda en SQL ─────────────────────────────────────────────────────── */

/*
 * La base no tiene la extensión `unaccent` (ver migración 0177), así que el
 * pliegue de tildes es un `translate` con las vocales acentuadas del español.
 * Va antes de `lower`: con collation C, `lower` no baja «Á».
 */
const FOLD_FROM = "ÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇáéíóúüñàèìòùâêîôûäëïöç"
const FOLD_TO   = "AEIOUUNAEIOUAEIOUAEIOCaeiouunaeiouaeiouaeioc"

function foldSql(value: SQL | AnyColumn): SQL {
  return sql`lower(translate(coalesce(${value}, ''), ${FOLD_FROM}, ${FOLD_TO}))`
}

/** Mismo pliegue que `foldSql`, del lado del texto escrito. */
export function foldSparePartSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()
}

/** «1R-0750», «1r 0750» y «1r0750» son el mismo N° de parte para la búsqueda. */
function compactSearch(value: string): string {
  return foldSparePartSearch(value).replace(/[^a-z0-9]/g, "")
}

/**
 * El repuesto se compró para un vehículo que cumple `vehicleCondition`: una
 * línea de solicitud viva lo apunta, o la línea de OC (no anulada ni eliminada)
 * que compra esa línea. Misma regla que `loadVehicleLinks`, en SQL, para ordenar
 * y filtrar sin traer el historial completo.
 */
function purchasedForVehicleSql(vehicleCondition: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${purchaseRequestItems}
    INNER JOIN ${purchaseRequests} ON ${purchaseRequests.id} = ${purchaseRequestItems.requestId}
    INNER JOIN ${fuelVehicles} ON ${fuelVehicles.id} = ${purchaseRequestItems.vehicleId}
    WHERE ${purchaseRequests.status} NOT IN ('cancelled', 'rejected')
      AND ${purchaseRequestItems.status} NOT IN ('cancelled', 'rejected')
      AND (
        ${purchaseRequestItems.productId} = ${products.id}
        OR EXISTS (
          SELECT 1 FROM ${purchaseOrderItems}
          INNER JOIN ${purchaseOrders} ON ${purchaseOrders.id} = ${purchaseOrderItems.purchaseOrderId}
          WHERE ${purchaseOrderItems.requestItemId} = ${purchaseRequestItems.id}
            AND ${purchaseOrderItems.productId} = ${products.id}
            AND ${purchaseOrders.deletedAt} IS NULL
            AND ${purchaseOrders.status} <> 'cancelled'
        )
      )
      AND ${vehicleCondition}
  )`
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

/** Cuántos repuestos devuelve por defecto una búsqueda con tope. */
export const SPARE_PART_SEARCH_LIMIT = 30

/**
 * Busca en el catálogo con el filtro, el orden por vehículo y el tope en SQL,
 * y sólo después carga precios, última compra y vehículos de las filas que
 * devuelve. Con miles de repuestos, el buscador no paga el catálogo entero.
 *
 * - `query`: nombre, SKU, N° de parte (también sin guiones) y marca, sin
 *   distinguir mayúsculas ni tildes.
 * - `vehicleId`: primero lo comprado para ese vehículo, luego para otro de la
 *   misma marca y modelo, luego el resto; dentro de cada grupo, alfabético.
 * - `onlyVehicleMatches`: sólo esos dos primeros grupos (la lista inicial del
 *   buscador, antes de escribir). Sin `vehicleId` no devuelve nada.
 * - `ids`: sólo esos repuestos (los que una solicitud ya referencia).
 * - `limit`: tope de filas; `total` dice cuántas coincidían.
 */
export async function searchSpareParts(opts: ListSparePartsOptions = {}): Promise<SparePartSearchResult> {
  if (opts.ids && opts.ids.length === 0) return { parts: [], total: 0 }

  let target: { id: string; brandKey: string | null; modelKey: string | null } | null = null
  if (opts.vehicleId) {
    const [vehicle] = await db
      .select({ brand: fuelVehicles.brand, model: fuelVehicles.model })
      .from(fuelVehicles)
      .where(eq(fuelVehicles.id, opts.vehicleId))
      .limit(1)
    const brandKey = vehicle?.brand ? foldSparePartSearch(vehicle.brand) : ""
    const modelKey = vehicle?.model ? foldSparePartSearch(vehicle.model) : ""
    target = { id: opts.vehicleId, brandKey: brandKey || null, modelKey: modelKey || null }
  }
  if (opts.onlyVehicleMatches && !target) return { parts: [], total: 0 }

  const forVehicle = target ? purchasedForVehicleSql(sql`${fuelVehicles.id} = ${target.id}`) : null
  // Sin marca o sin modelo no hay «mismo modelo»: dos equipos sin dato no son iguales.
  const forModel = target?.brandKey && target.modelKey
    ? purchasedForVehicleSql(sql`${foldSql(sql`btrim(${fuelVehicles.brand})`)} = ${target.brandKey} AND ${foldSql(sql`btrim(${fuelVehicles.model})`)} = ${target.modelKey}`)
    : null
  const tier = forVehicle
    ? sql<number>`CASE WHEN ${forVehicle} THEN 0 ${forModel ? sql`WHEN ${forModel} THEN 1 ` : sql``}ELSE 2 END`
    : sql<number>`2`

  const query = foldSparePartSearch(opts.query ?? "")
  const compactQuery = compactSearch(opts.query ?? "")
  const pattern = `%${escapeLikePattern(query)}%`
  const textMatch = query
    ? or(
        sql`${foldSql(products.name)} LIKE ${pattern}`,
        sql`${foldSql(products.sku)} LIKE ${pattern}`,
        sql`${foldSql(products.partNumber)} LIKE ${pattern}`,
        sql`${foldSql(products.partBrand)} LIKE ${pattern}`,
        compactQuery
          ? sql`regexp_replace(${foldSql(products.partNumber)}, '[^a-z0-9]', '', 'g') LIKE ${`%${compactQuery}%`}`
          : undefined,
      )
    : undefined

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

  const base = db
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
      tier:                  sql<number>`${tier}`.mapWith(Number),
      total:                 sql<number>`count(*) OVER ()`.mapWith(Number),
    })
    .from(products)
    .leftJoin(preferred, eq(preferred.productId, products.id))
    .where(and(
      eq(products.isSparePart, true),
      opts.includeInactive ? undefined : eq(products.isActive, true),
      opts.ids ? inArray(products.id, [...opts.ids]) : undefined,
      textMatch,
      opts.onlyVehicleMatches ? or(forVehicle ?? undefined, forModel ?? undefined) : undefined,
    ))
    // Sin vehículo no hay grupos (y un `ORDER BY 2` literal ordenaría por la 2.ª columna).
    .orderBy(...(forVehicle ? [tier] : []), foldSql(products.name), asc(products.sku))
    .$dynamic()
  const parts = await (opts.limit !== undefined ? base.limit(opts.limit) : base)
  if (parts.length === 0) return { parts: [], total: 0 }

  const ids = parts.map((part) => part.id)

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

  // Con tope, sólo los vínculos de las filas devueltas; sin tope ni filtro, el
  // catálogo entero en una sola lectura (no una lista de miles de ids).
  const wholeCatalog = opts.limit === undefined && !opts.ids && !query && !opts.onlyVehicleMatches
  const links = await loadVehicleLinks(wholeCatalog ? null : ids)
  const vehiclesByPart = new Map<string, Set<string>>()
  for (const link of links) {
    const vehicles = vehiclesByPart.get(link.productId) ?? new Set<string>()
    vehicles.add(link.vehicleId)
    vehiclesByPart.set(link.productId, vehicles)
  }

  const matchByTier: Record<number, SparePartVehicleMatch> = { 0: "vehicle", 1: "model" }
  return {
    total: parts[0]!.total,
    parts: parts.map((part) => {
      const vehicles = vehiclesByPart.get(part.id) ?? new Set<string>()
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
        purchasedForVehicleIds: [...vehicles].sort(),
        vehicleMatch: target ? (matchByTier[part.tier] ?? null) : null,
      }
    }),
  }
}

/** La búsqueda sin el total: la lista de gestión y la exportación. */
export async function listSpareParts(opts: ListSparePartsOptions = {}): Promise<SparePartListItem[]> {
  return (await searchSpareParts(opts)).parts
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
    .where(and(
      eq(productSupplierPriceHistory.productId, id),
      // Una OC o factura que repite el precio vigente deja una fila de
      // confirmación (mismo precio antes y después): no es un cambio de precio.
      sql`${productSupplierPriceHistory.previousPrice} IS DISTINCT FROM ${productSupplierPriceHistory.newPrice}`,
    ))
    .orderBy(desc(productSupplierPriceHistory.effectiveDate), desc(productSupplierPriceHistory.createdAt))

  const links = await loadVehicleLinks([id])
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
 * El INSERT del alta, sin la revisión previa del N° de parte: si otra alta del
 * mismo número llegó primero, el índice único decide y el error dice cuál es.
 * Exportado sólo para probar esa carrera; las altas pasan por `createSparePartTx`.
 */
export async function insertSparePartRowTx(
  tx: Tx,
  { id, sku, categoryId, data }: { id: string; sku: string; categoryId: string; data: NormalizedSparePartInput },
): Promise<void> {
  await withPartNumberGuard(tx, data, (sp) => sp.insert(products).values({
    id,
    sku,
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
  }))
}

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

  await insertSparePartRowTx(tx, { id, sku: sku!, categoryId, data })

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

    await withPartNumberGuard(tx as unknown as Tx, data, (sp) => sp.update(products).set({
      name: data.name,
      partNumber: data.partNumber,
      partBrand: data.partBrand,
      unitOfMeasure: data.unitOfMeasure,
      notes: data.notes,
      referencePrice: data.referencePrice,
      updatedAt: new Date().toISOString(),
    }).where(eq(products.id, id)), id)

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
