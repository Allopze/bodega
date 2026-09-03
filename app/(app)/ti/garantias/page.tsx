import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, suppliers } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { listAssetsByWarranty, listSupplierLinks, type WarrantyWindow } from "@/lib/services/ti/supplier-links"
import { WarrantyTable } from "./warranty-table"
import { SupplierLinksPanel } from "./supplier-links-panel"

export const metadata: Metadata = { title: "Garantías y proveedores TI" }

export default async function GarantiasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_assets")
  const sp = await searchParams
  const window = typeof sp.ventana === "string" ? (sp.ventana as WarrantyWindow) : undefined
  const scope = worksiteScopeSql(session, itAssets.worksiteId)

  const [warrantyRows, supplierLinks, suppliersList] = await Promise.all([
    listAssetsByWarranty({ window, scope }),
    listSupplierLinks(),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
  ])

  const windows: { value: WarrantyWindow | ""; label: string }[] = [
    { value: "", label: "Todas con garantía" },
    { value: "active", label: "Vigentes" },
    { value: "expiring_30", label: "Vencen en 30 días" },
    { value: "expiring_60", label: "Vencen en 60 días" },
    { value: "expiring_90", label: "Vencen en 90 días" },
    { value: "expired", label: "Vencidas" },
  ]

  return (
    <PageContainer>
      <PageHeader
        title="Garantías y proveedores TI"
        description="Vigencia de garantías por activo y proveedores identificados para TI."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Garantías y proveedores" }]} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {windows.map((w) => (
          <a
            key={w.value}
            href={w.value ? `/ti/garantias?ventana=${w.value}` : "/ti/garantias"}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              (window ?? "") === w.value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {w.label}
          </a>
        ))}
      </div>

      <WarrantyTable rows={warrantyRows} />

      <div className="mt-6">
        <SupplierLinksPanel links={supplierLinks} canManage={canManage} suppliers={suppliersList} />
      </div>
    </PageContainer>
  )
}
