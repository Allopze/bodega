import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { and, asc, count, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { itAssetTypes, itAssets } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { AssetTypeActions } from "./asset-type-actions"
import { AssetTypeList } from "./asset-type-list"

export const metadata: Metadata = { title: "Tipos de activo TI" }

export default async function AssetTypesPage() {
  let session
  try {
    session = await requirePermission("admin:it_asset_types")
  } catch {
    redirect("/forbidden")
  }

  const rows = await db.select({
    id:         itAssetTypes.id,
    name:       itAssetTypes.name,
    category:   itAssetTypes.category,
    hasSpecs:   itAssetTypes.hasSpecs,
    isActive:   itAssetTypes.isActive,
    assetCount: count(itAssets.id),
  }).from(itAssetTypes)
    .leftJoin(itAssets, and(eq(itAssets.assetTypeId, itAssetTypes.id), isNull(itAssets.deletedAt)))
    .groupBy(itAssetTypes.id)
    .orderBy(asc(itAssetTypes.name))

  const canCreate = (session.user.permissions ?? []).includes("admin:it_asset_types")

  return (
    <PageContainer>
      <PageHeader
        title="Tipos de activo TI"
        description="Categorías de activos tecnológicos (notebooks, periféricos, red, etc.) disponibles al registrar un activo en el inventario de TI."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Tipos de activo TI" },
        ]}
        actions={<AssetTypeActions canCreate={canCreate} />}
      />
      <AssetTypeList
        rows={rows.map((r) => ({ ...r, assetCount: Number(r.assetCount) }))}
        canCreate={canCreate}
      />
    </PageContainer>
  )
}
