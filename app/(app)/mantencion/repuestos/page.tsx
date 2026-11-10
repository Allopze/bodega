import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { SparePartsCatalogView, type SparePartRow } from "@/components/mantencion/repuestos/spare-parts-catalog-view"
import { PageContainer } from "@/components/ui/page-container"
import { requirePermission } from "@/lib/auth/can"
import { listSpareParts } from "@/lib/services/spare-parts-catalog"
import { loadSparePartUnits } from "./unit-options"

export const metadata: Metadata = { title: "Catálogo de repuestos" }
export const dynamic = "force-dynamic"

export default async function SparePartsCatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try {
    await requirePermission("repuestos:catalog", "/mantencion/repuestos")
  } catch {
    redirect("/forbidden")
  }

  const query = await searchParams
  const estado = Array.isArray(query.estado) ? query.estado[0] : query.estado
  const tab = estado === "inactivos" ? "inactivos" : "activos"

  // El catálogo es de cientos de filas: se trae completo y las pestañas y la búsqueda de la barra superior
  // filtran sin ir al servidor. Los conteos de las dos pestañas salen de la misma lectura.
  const [all, units] = await Promise.all([listSpareParts({ includeInactive: true }), loadSparePartUnits()])
  const active = all.filter((part) => part.isActive)
  const inactive = all.filter((part) => !part.isActive)
  const rows: SparePartRow[] = (tab === "inactivos" ? inactive : active).map((part) => ({
    id: part.id,
    sku: part.sku,
    name: part.name,
    partNumber: part.partNumber,
    partBrand: part.partBrand,
    unitOfMeasure: part.unitOfMeasure,
    preferredSupplierName: part.preferredSupplierName,
    lastSupplierName: part.lastSupplierName,
    lastPrice: part.lastPrice,
    referencePrice: part.referencePrice,
    lastPurchasedAt: part.lastPurchasedAt,
    vehicleCount: part.vehicleCount,
  }))

  return (
    <PageContainer>
      <SparePartsCatalogView
        rows={rows}
        counts={{ active: active.length, inactive: inactive.length }}
        tab={tab}
        units={units.filter((unit) => unit.isActive).map((unit) => ({ code: unit.code, label: unit.label }))}
      />
    </PageContainer>
  )
}
