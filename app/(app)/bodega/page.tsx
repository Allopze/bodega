import type { Metadata } from "next"
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
import { Warehouse } from "@phosphor-icons/react/dist/ssr"
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
          <Suspense fallback={<SkeletonPage rows={6} />}>
            <StockSection worksites={worksiteOptions} stockByWorksite={stockByWorksite} initialWorksiteId={initialWorksiteId} />
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

function StockSection({ worksites, stockByWorksite, initialWorksiteId }: {
  worksites: WorksiteOption[]
  stockByWorksite: Record<string, WorksiteStockWithProduct[]>
  initialWorksiteId?: string
}) {
  const sortedWorksites = [...worksites].sort((a, b) => {
    const aHasStock = (stockByWorksite[a.id] ?? []).some((item) => item.quantity > 0)
    const bHasStock = (stockByWorksite[b.id] ?? []).some((item) => item.quantity > 0)
    if (a.id === initialWorksiteId) return -1
    if (b.id === initialWorksiteId) return 1
    if (aHasStock !== bHasStock) return aHasStock ? -1 : 1
    return a.name.localeCompare(b.name, "es")
  })

  return (
    <>
      {sortedWorksites.map((ws) => (
        <StockTable key={ws.id} worksiteName={ws.name}
          items={stockByWorksite[ws.id] ?? []} />
      ))}
    </>
  )
}

function KardexSection({ movements }: { movements: InventoryMovementWithRelations[] }) {
  return <KardexTable movements={movements} />
}
