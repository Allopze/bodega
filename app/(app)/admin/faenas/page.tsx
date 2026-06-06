import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { FaenasList } from "./faenas-list"

export const metadata: Metadata = { title: "Faenas" }

export default async function FaenasPage() {
  try { await requirePermission("admin:worksites") }
  catch { redirect("/dashboard") }

  const worksites   = await db.query.worksites.findMany({ orderBy: (w, { asc }) => [asc(w.name)] })
  const costCenters = await db.query.costCenters.findMany({ orderBy: (c, { asc }) => [asc(c.name)] })

  return (
    <>
      <PageHeader
        title="Faenas y centros de costo"
        description="Configura las faenas activas y sus centros de costo."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Faenas" },
          ]} />
        }
      />
      <FaenasList
        worksites={worksites.map((w) => ({
          id: w.id, name: w.name, code: w.code,
          address: w.address, region: w.region,
          isActive: w.isActive, createdAt: w.createdAt, updatedAt: w.updatedAt,
          costCenters: [],
        }))}
        costCenters={costCenters.map((c) => ({
          id: c.id, name: c.name, code: c.code,
          worksiteId: c.worksiteId, isActive: c.isActive, createdAt: c.createdAt,
        }))}
      />
    </>
  )
}
