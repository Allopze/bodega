import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { worksites } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { FaenasList } from "./faenas-list"

export const metadata: Metadata = { title: "Faenas" }

export default async function FaenasPage() {
  let session
  try { session = await requirePermission("admin:worksites") }
  catch { redirect("/dashboard") }

  const allWorksites = await db.query.worksites.findMany({
    where: worksiteScopeSql(session, worksites.id),
    orderBy: (w, { asc }) => [asc(w.name)],
  })
  const canCreateWorksites = resolveWorksiteScope(session).mode === "all"

  return (
    <PageContainer>
      <PageHeader
        title="Faenas"
        description="Configura las faenas activas de la organización."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Faenas" },
          ]} />
        }
      />
      <FaenasList
        worksites={allWorksites.map((w) => ({
          id: w.id, name: w.name, code: w.code,
          address: w.address, region: w.region,
          isActive: w.isActive, createdAt: w.createdAt, updatedAt: w.updatedAt,
        }))}
        canCreateWorksites={canCreateWorksites}
      />
    </PageContainer>
  )
}
