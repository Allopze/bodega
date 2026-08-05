import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { count, eq } from "drizzle-orm"
import { db } from "@/db"
import { fuelEquipmentTypes, fuelVehicles } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { PageContainer } from "@/components/ui/page-container"
import { PageHeader } from "@/components/ui/page-header"
import { EquipmentTypeCatalog } from "./equipment-type-catalog"

export const metadata: Metadata = { title: "Tipos de equipo" }

export default async function EquipmentTypesPage() {
  try { await requirePermission("admin:fleet_catalog") }
  catch { redirect("/forbidden") }

  const rows = await db.select({
    id: fuelEquipmentTypes.id,
    slug: fuelEquipmentTypes.slug,
    name: fuelEquipmentTypes.name,
    category: fuelEquipmentTypes.category,
    defaultMeterType: fuelEquipmentTypes.defaultMeterType,
    defaultPerformanceUnit: fuelEquipmentTypes.defaultPerformanceUnit,
    description: fuelEquipmentTypes.description,
    sortOrder: fuelEquipmentTypes.sortOrder,
    isActive: fuelEquipmentTypes.isActive,
    vehicleCount: count(fuelVehicles.id),
  }).from(fuelEquipmentTypes)
    .leftJoin(fuelVehicles, eq(fuelVehicles.equipmentTypeId, fuelEquipmentTypes.id))
    .groupBy(fuelEquipmentTypes.id)
    .orderBy(fuelEquipmentTypes.sortOrder, fuelEquipmentTypes.name)

  return <PageContainer>
    <PageHeader title="Tipos de equipo" description="Taxonomía configurable para vehículos, maquinaria, unidades de medición y grupos analíticos." breadcrumb={[{ label: "Inicio", href: "/dashboard" }, { label: "Administración", href: "/admin" }, { label: "Catálogos de flota", href: "/admin/flota-catalogos" }, { label: "Tipos de equipo" }]} />
    <EquipmentTypeCatalog rows={rows.map((row) => ({ ...row, vehicleCount: Number(row.vehicleCount) }))} />
  </PageContainer>
}
