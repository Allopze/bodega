import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { inventoryMovements, products, users, worksites, worksiteStock } from "@/db/schema"
import { and, eq, asc, desc, sql, count } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { resolvePagination } from "@/lib/pagination"
import Link from "next/link"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
import { parseListParams, textSearchSql, eqFilter, periodSql } from "@/lib/adquisiciones/list-query"
import { WarehouseHeaderMetrics } from "./bodega-header-metrics"
import { StockSection, KardexSection } from "./bodega-sections"
import { BodegaMovementSheet } from "./movement-sheet"
import { BodegaViewTabs, type BodegaView } from "./bodega-view-tabs"
import { BodegaFilters } from "./bodega-filters"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"
import { KARDEX_PAGE_SIZE } from "@/lib/constants"

export const metadata: Metadata = { title: "Bodega" }

/**
 * Techo de filas del stock. No se pagina a propósito: la tabla agrupa por faena
 * y partir los grupos entre páginas rompe el total por producto del encabezado.
 * ponytail: si este límite se toca en producción, el paso siguiente es paginar
 * por faena (una faena entera por página), no por fila.
 */
const STOCK_ROW_LIMIT = 2_000

/** Ventana del KPI de movimientos. Un total histórico sólo crece y no informa. */
const MOVEMENT_WINDOW_DAYS = 30

const VIEWS: BodegaView[] = ["stock", "kardex"]

function firstStr(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function readView(raw: string | string[] | undefined): BodegaView {
  const value = firstStr(raw)
  return (VIEWS as string[]).includes(value) ? (value as BodegaView) : "stock"
}

function readStockState(raw: string | string[] | undefined): "" | "low" | "warn" {
  const value = firstStr(raw)
  return value === "low" || value === "warn" ? value : ""
}

function daysAgoIso(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export default async function BodegaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const view = readView(sp.vista)
  const filters = parseListParams(sp)
  const stockState = readStockState(sp.stock)
  const tipo = firstStr(sp.tipo)
  const producto = firstStr(sp.producto)

  const canRegisterMovements = can(session, "warehouse:register_movement")
  const canAdjustStock       = can(session, "warehouse:adjust_stock")
  const canCreateGuide       = can(session, "warehouse:create_guide")
  const canViewReceiving     = can(session, "receiving:view")
  const canExportStock       = can(session, "warehouse:view_stock")

  const worksiteScope = worksiteScopeSql(session, worksites.id)
  const stockScope    = worksiteScopeSql(session, worksiteStock.worksiteId)
  const movementScope = worksiteScopeSql(session, inventoryMovements.worksiteId)

  // Los filtros de texto y faena se aplican en el servidor: filtrarlos en
  // memoria sólo alcanzaba a la página que el kardex ya había traído, así que
  // una coincidencia en una página vieja no aparecía nunca.
  const stockWhere = and(
    eq(worksites.isActive, true),
    stockScope,
    eqFilter(worksiteStock.worksiteId, filters.faena),
    textSearchSql(filters.q, [products.name, products.sku]),
  )

  const movementWhere = and(
    movementScope,
    eqFilter(inventoryMovements.worksiteId, filters.faena),
    eqFilter(inventoryMovements.type, tipo),
    eqFilter(inventoryMovements.productId, producto),
    periodSql(inventoryMovements.performedAt, filters.desde, filters.hasta),
    textSearchSql(filters.q, [
      products.name,
      worksites.name,
      inventoryMovements.reason,
      inventoryMovements.notes,
    ]),
  )

  const [allWorksites, stockSummaryRows, stockTotalRow, movementTotalRow, recentMovementRow] = await Promise.all([
    db
      .select({ id: worksites.id, name: worksites.name })
      .from(worksites)
      .where(and(eq(worksites.isActive, true), worksiteScope))
      .orderBy(asc(worksites.name)),
    // Una sola pasada para todos los KPI del encabezado: antes salían de traer
    // el stock completo a memoria, lo que obligaba a consultarlo incluso en la
    // vista del kardex.
    db
      .select({
        worksitesWithStock:  sql<number>`count(distinct ${worksiteStock.worksiteId}) filter (where ${worksiteStock.quantity} > 0)`,
        productsWithStock:   sql<number>`count(distinct ${worksiteStock.productId}) filter (where ${worksiteStock.quantity} > 0)`,
        lowStock:            sql<number>`count(*) filter (where ${worksiteStock.minStock} > 0 and ${worksiteStock.quantity} <= ${worksiteStock.minStock})`,
        warnStock:           sql<number>`count(*) filter (where ${worksiteStock.minStock} > 0 and ${worksiteStock.quantity} > ${worksiteStock.minStock} and ${worksiteStock.quantity} < ${worksiteStock.minStock} * 1.5)`,
        minStockDefined:     sql<number>`count(*) filter (where ${worksiteStock.minStock} > 0)`,
      })
      .from(worksiteStock)
      .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
      .where(and(eq(worksites.isActive, true), stockScope)),
    db
      .select({ total: count() })
      .from(worksiteStock)
      .innerJoin(products, eq(worksiteStock.productId, products.id))
      .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
      .where(and(stockWhere, sql`${worksiteStock.quantity} > 0`)),
    db
      .select({ total: count() })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
      .where(movementWhere),
    db
      .select({ total: count() })
      .from(inventoryMovements)
      .where(and(movementScope, sql`${inventoryMovements.performedAt} >= ${daysAgoIso(MOVEMENT_WINDOW_DAYS)}`)),
  ])

  if (allWorksites.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin faenas configuradas"
          description="Configura las faenas en el módulo de administración para ver el stock aquí."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/admin/faenas">Configurar faenas</Link>
            </Button>
          }
        />
      </PageContainer>
    )
  }

  const summary = stockSummaryRows[0]
  const kardexTotal = Number(movementTotalRow[0]?.total ?? 0)
  const stockTotal = Number(stockTotalRow[0]?.total ?? 0)

  const kardexPagination = resolvePagination({
    pageParam: sp.kardex_page,
    totalItems: kardexTotal,
    pageSize: KARDEX_PAGE_SIZE,
  })

  // Sólo las consultas de la vista activa: entrar a Stock ya no trae ni cuenta
  // el kardex, y viceversa.
  const stockRows = view === "stock"
    ? await db
        .select({
          id:             worksiteStock.id,
          worksiteId:     worksiteStock.worksiteId,
          productId:      worksiteStock.productId,
          quantity:       worksiteStock.quantity,
          minStock:       worksiteStock.minStock,
          lastMovementAt: worksiteStock.lastMovementAt,
          updatedAt:      worksiteStock.updatedAt,
          productName:    products.name,
          productSku:     products.sku,
          unitOfMeasure:  products.unitOfMeasure,
          worksiteName:   worksites.name,
        })
        .from(worksiteStock)
        .innerJoin(products, eq(worksiteStock.productId, products.id))
        .innerJoin(worksites, eq(worksiteStock.worksiteId, worksites.id))
        .where(stockWhere)
        .orderBy(asc(worksites.name), asc(products.name))
        .limit(STOCK_ROW_LIMIT)
    : []

  const movements = view === "kardex"
    ? await db
        .select({
          id:             inventoryMovements.id,
          worksiteId:     inventoryMovements.worksiteId,
          productId:      inventoryMovements.productId,
          type:           inventoryMovements.type,
          quantity:       inventoryMovements.quantity,
          stockBefore:    inventoryMovements.stockBefore,
          stockAfter:     inventoryMovements.stockAfter,
          performedAt:    inventoryMovements.performedAt,
          reason:         inventoryMovements.reason,
          notes:          inventoryMovements.notes,
          referenceType:  inventoryMovements.referenceType,
          referenceId:    inventoryMovements.referenceId,
          productName:    products.name,
          worksiteName:   worksites.name,
          performedByName: users.name,
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .innerJoin(worksites, eq(inventoryMovements.worksiteId, worksites.id))
        .leftJoin(users, eq(inventoryMovements.performedBy, users.id))
        .where(movementWhere)
        .orderBy(desc(inventoryMovements.performedAt), desc(inventoryMovements.id))
        .limit(kardexPagination.limit)
        .offset(kardexPagination.offset)
    : []

  // Productos que efectivamente aparecen en el kardex del alcance: alimenta el
  // selector del filtro sin ofrecer todo el catálogo.
  const kardexProducts = view === "kardex"
    ? await db
        .selectDistinct({ id: products.id, name: products.name })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(movementScope)
        .orderBy(asc(products.name))
        .limit(500)
    : []

  const worksiteOptions = allWorksites.map((w) => ({ id: w.id, name: w.name }))

  const stockByWorksite: Record<string, WorksiteStockWithProduct[]> = {}
  for (const row of stockRows) {
    const item: WorksiteStockWithProduct = {
      id: row.id,
      worksiteId: row.worksiteId,
      productId: row.productId,
      quantity: row.quantity,
      minStock: row.minStock,
      lastMovementAt: row.lastMovementAt,
      updatedAt: row.updatedAt,
      product: { name: row.productName, sku: row.productSku, unitOfMeasure: row.unitOfMeasure },
      worksite: { name: row.worksiteName },
    }
    ;(stockByWorksite[row.worksiteId] ??= []).push(item)
  }

  const kardexMovements: InventoryMovementWithRelations[] = movements.map((row) => ({
    id: row.id,
    worksiteId: row.worksiteId,
    productId: row.productId,
    type: row.type,
    quantity: row.quantity,
    stockBefore: row.stockBefore,
    stockAfter: row.stockAfter,
    performedAt: row.performedAt,
    reason: row.reason,
    notes: row.notes,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    performedByName: row.performedByName,
    product: { name: row.productName },
    worksite: { name: row.worksiteName },
  }))

  const hasFilters = Boolean(filters.q || filters.faena || stockState || tipo || producto || filters.desde || filters.hasta)

  return (
    <PageContainer>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Inicio", href: "/dashboard" }, { label: "Bodega" }]} />}
        headerActions={(
          <WarehouseHeaderMetrics
            worksiteCount={worksiteOptions.length}
            worksitesWithStock={Number(summary?.worksitesWithStock ?? 0)}
            productsWithStock={Number(summary?.productsWithStock ?? 0)}
            lowStockCount={Number(summary?.lowStock ?? 0)}
            warnStockCount={Number(summary?.warnStock ?? 0)}
            minStockDefinedCount={Number(summary?.minStockDefined ?? 0)}
            movementCount={Number(recentMovementRow[0]?.total ?? 0)}
            movementWindowDays={MOVEMENT_WINDOW_DAYS}
          />
        )}
        actions={
          <BodegaMovementSheet
            worksites={worksiteOptions}
            canRegister={canRegisterMovements}
            canAdjust={canAdjustStock}
            canCreateGuide={canCreateGuide}
          />
        }
      />

      <BodegaViewTabs
        current={view}
        tabs={[
          { value: "stock", label: "Stock", count: stockTotal },
          { value: "kardex", label: "Kardex", count: kardexTotal },
          { value: "documentos", label: "Documentos", href: "/bodega/documentos" },
        ]}
      />

      <BodegaFilters
        view={view}
        worksites={worksiteOptions}
        products={kardexProducts}
        current={{
          q: filters.q,
          faena: filters.faena,
          stock: stockState,
          tipo,
          producto,
          desde: filters.desde,
          hasta: filters.hasta,
        }}
      />

      {view === "stock" ? (
        <StockSection
          worksites={worksiteOptions}
          stockByWorksite={stockByWorksite}
          receivingHref={canViewReceiving ? "/recepcion" : undefined}
          canExportStock={canExportStock}
          stockState={stockState}
          hasFilters={hasFilters}
          truncated={stockRows.length >= STOCK_ROW_LIMIT}
          canSetMinStock={canRegisterMovements}
        />
      ) : (
        <KardexSection
          movements={kardexMovements}
          worksites={worksiteOptions}
          canExport={canExportStock}
          pagination={kardexPagination}
          searchParams={sp}
        />
      )}
    </PageContainer>
  )
}
