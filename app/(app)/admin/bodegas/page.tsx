import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { WarehouseList } from "./warehouse-list"

export const metadata: Metadata = { title: "Bodegas" }

export default async function BodegasPage() {
  try { await requirePermission("admin:config") }
  catch { redirect("/dashboard") }

  const allWarehouses = await db.query.warehouses.findMany({ orderBy: (w, { asc }) => [asc(w.name)] })
  const allWorksites  = await db.query.worksites.findMany({
    where: eq(worksites.isActive, true),
    orderBy: (w, { asc }) => [asc(w.name)],
  })

  // Build worksite name map
  const wsMap = Object.fromEntries(allWorksites.map((w) => [w.id, w.name]))

  return (
    <>
      <PageHeader
        title="Bodegas"
        description="Configuración de bodegas centrales y de faena."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Bodegas" },
          ]} />
        }
      />
      <WarehouseList
        warehouses={allWarehouses.map((w) => ({
          id: w.id, name: w.name, code: w.code, type: w.type,
          worksiteId: w.worksiteId, worksiteName: w.worksiteId ? wsMap[w.worksiteId] ?? null : null,
          address: w.address, notes: w.notes, isActive: w.isActive, createdAt: w.createdAt,
        }))}
        worksites={allWorksites.map((w) => ({ id: w.id, name: w.name }))}
      />
    </>
  )
}
