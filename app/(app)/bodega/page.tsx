import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { can, canAccessWorksite } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonPage } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Package, Warehouse, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { ReturnPanel } from "./return-panel"
import { StockTable } from "./stock-table"
import { KardexTable } from "./kardex-table"
import type { ReturnPanelStockOption } from "./return-panel"
import type { WorksiteStockWithProduct, InventoryMovementWithRelations } from "./types"

export const metadata: Metadata = { title: "Bodega" }

interface WorksiteOption {
  id: string
  name: string
}

export default async function BodegaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("warehouse:view_stock") }
  catch { redirect("/dashboard") }
  const sp = await searchParams
  const requestedWorksiteId = typeof sp.faena === "string" ? sp.faena : ""

  const canRegisterMovements = can(session, "warehouse:register_movement")
  const canViewReceiving = can(session, "receiving:view")

  const [allWorksites, stockRows, recentMovements] = await Promise.all([
    db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    db.query.worksiteStock.findMany({
      with: { product: true, worksite: true },
      orderBy: (s, { asc }) => [asc(s.worksiteId)],
    }),
    db.query.inventoryMovements.findMany({
      with: { product: true, worksite: true },
      orderBy: (m, { desc }) => [desc(m.performedAt)],
      limit: 50,
    }),
  ])

  if (allWorksites.length === 0) {
    return (
      <PageContainer>
        <PageHeader title="Bodega" description="Control de stock e inventario."
          breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
        />
        <EmptyState icon={<Warehouse size={24} />} title="Sin faenas configuradas"
          description="Configura las faenas en el módulo de administración para ver el stock aquí."
        />
      </PageContainer>
    )
  }

  const worksiteOptions: WorksiteOption[] = allWorksites
    .filter((w) => canAccessWorksite(session, w.id))
    .map((w) => ({ id: w.id, name: w.name }))
  const visibleStockRows = stockRows.filter((s) => canAccessWorksite(session, s.worksiteId))
  const visibleMovements = recentMovements.filter((m) => canAccessWorksite(session, m.worksiteId))
  const stockWithQuantity = visibleStockRows.filter((item) => item.quantity > 0)
  const worksitesWithStock = new Set(stockWithQuantity.map((item) => item.worksiteId))
  const productsWithStock = new Set(stockWithQuantity.map((item) => item.productId))
  const lowStockRows = visibleStockRows.filter((item) => item.minStock > 0 && item.quantity <= item.minStock)

  const returnProducts: ReturnPanelStockOption[] = visibleStockRows
    .map((s) => ({
      worksiteId: s.worksiteId,
      worksiteName: s.worksite?.name ?? s.worksiteId,
      productId: s.productId,
      productName: s.product?.name ?? s.productId,
      productSku: s.product?.sku ?? null,
      unitOfMeasure: s.product?.unitOfMeasure ?? "unidad",
    }))

  const firstStockWorksiteId = visibleStockRows.find((item) => item.quantity > 0)?.worksiteId
  const initialWorksiteId = (requestedWorksiteId && worksiteOptions.some((w) => w.id === requestedWorksiteId) ? requestedWorksiteId : undefined)
    ?? firstStockWorksiteId
    ?? worksiteOptions[0]?.id
  const showReturnPanel = canRegisterMovements && returnProducts.length > 0 && worksiteOptions.length > 0

  const stockByWorksite: Record<string, WorksiteStockWithProduct[]> = {}
  for (const s of visibleStockRows) {
    if (!stockByWorksite[s.worksiteId]) stockByWorksite[s.worksiteId] = []
    stockByWorksite[s.worksiteId].push(s)
  }

  return (
    <PageContainer>
      <PageHeader title="Bodega" description="Stock por producto y kardex de movimientos."
        breadcrumb={<Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Bodega" }]} />}
      />
      <div className={showReturnPanel ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start" : "flex flex-col gap-6"}>
        <div className="min-w-0 space-y-6">
          <WarehouseSummary
            worksiteCount={worksiteOptions.length}
            worksitesWithStock={worksitesWithStock.size}
            productsWithStock={productsWithStock.size}
            lowStockCount={lowStockRows.length}
            movementCount={visibleMovements.length}
          />

          <Suspense fallback={<SkeletonPage rows={6} />}>
            <StockSection
              worksites={worksiteOptions}
              stockByWorksite={stockByWorksite}
              initialWorksiteId={initialWorksiteId}
              receivingHref={canViewReceiving ? "/recepcion" : undefined}
            />
          </Suspense>

          <Suspense fallback={<SkeletonPage rows={6} />}>
            <KardexSection movements={visibleMovements as InventoryMovementWithRelations[]} />
          </Suspense>
        </div>

        {showReturnPanel && (
          <aside className="xl:sticky xl:top-6">
            <ReturnPanel products={returnProducts} worksites={worksiteOptions} />
          </aside>
        )}
      </div>
    </PageContainer>
  )
}

function WarehouseSummary({
  worksiteCount,
  worksitesWithStock,
  productsWithStock,
  lowStockCount,
  movementCount,
}: {
  worksiteCount: number
  worksitesWithStock: number
  productsWithStock: number
  lowStockCount: number
  movementCount: number
}) {
  const stats: Array<{ label: string; value: string; tone?: "signal" }> = [
    { label: "Faenas con stock", value: `${worksitesWithStock}/${worksiteCount}` },
    { label: "Productos activos", value: productsWithStock.toLocaleString("es-CL") },
    { label: "Bajo mínimo", value: lowStockCount.toLocaleString("es-CL"), tone: lowStockCount > 0 ? "signal" : undefined },
    { label: "Movimientos recientes", value: movementCount.toLocaleString("es-CL") },
  ]

  return (
    <section className="flex flex-col gap-3 px-1 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 className="text-h2 text-[var(--color-text)]">Inventario por faena</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Stock disponible, mínimos configurados y últimos movimientos de bodega.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[34rem]">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[11px] font-medium text-[var(--color-text-subtle)]">{stat.label}</p>
            <p className="mt-0.5 font-mono text-lg font-semibold leading-none text-[var(--color-text)]">
              {stat.value}
            </p>
            {stat.tone === "signal" && (
              <Badge variant="signal" size="sm" className="mt-1.5">
                Revisar
              </Badge>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function StockSection({ worksites, stockByWorksite, initialWorksiteId, receivingHref }: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  initialWorksiteId?: string
  receivingHref?: string
}) {
  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })
  const worksitesWithStock = sortedWorksites
    .map((ws) => ({
      ...ws,
      items: (stockByWorksite[ws.id] ?? []).filter((item) => item.quantity > 0),
    }))
    .filter((ws) => ws.items.length > 0)
  const worksitesWithoutStock = sortedWorksites.filter((ws) => !worksitesWithStock.some((stocked) => stocked.id === ws.id))

  if (worksites.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <EmptyState
          icon={<Warehouse size={24} />}
          title="Sin faenas asignadas"
          description="Tu cuenta no tiene faenas habilitadas para consultar stock."
        />
      </section>
    )
  }

  if (worksitesWithStock.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <EmptyState
          icon={<Package size={24} />}
          title="Sin stock registrado"
          description="Los ingresos de recepción aparecerán aquí cuando una orden de compra llegue a faena."
          action={receivingHref ? (
            <Link
              href={receivingHref}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-full)] bg-[var(--color-primary)] px-4 text-[13px] font-semibold text-white transition-[background-color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-primary-strong)] active:scale-[0.97]"
            >
              Ver recepciones
              <ArrowRight size={14} aria-hidden />
            </Link>
          ) : undefined}
        />
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {worksitesWithStock.map((ws) => (
        <StockTable key={ws.id} worksiteName={ws.name}
          items={ws.items} />
      ))}

      {worksitesWithoutStock.length > 0 && (
        <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-card)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-subtle)]">
                <WarningCircle size={18} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Faenas sin stock</h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  Estas faenas no tienen productos disponibles en este momento.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 md:justify-end">
              {worksitesWithoutStock.map((ws) => (
                <Badge key={ws.id} variant="outline" size="lg">
                  {ws.name}
                </Badge>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function KardexSection({ movements }: { movements: InventoryMovementWithRelations[] }) {
  return <KardexTable movements={movements} />
}
