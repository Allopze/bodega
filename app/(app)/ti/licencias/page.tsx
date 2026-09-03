import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { serviceWorksiteScope, worksiteScopeSql } from "@/lib/auth/scope"
import { db } from "@/db"
import { itAssets, suppliers, workers, worksites, users } from "@/db/schema"
import { and, eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Plus } from "@phosphor-icons/react/dist/ssr"
import { listLicenses, getLicenseAssignments } from "@/lib/services/ti/licenses"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { LicensePanel } from "./license-panel"
import { LicenseSheet } from "./license-sheet"

export const metadata: Metadata = { title: "Licencias TI" }

export default async function LicenciasPage() {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const canManage = can(session, "ti:manage_licenses")
  const worksiteIds = serviceWorksiteScope(session)
  const workerScope = worksiteScopeSql(session, workers.worksiteId)
  const worksiteScope = worksiteScopeSql(session, worksites.id)
  const assetScope = worksiteScopeSql(session, itAssets.worksiteId)

  const [licenses, suppliersList, workersList, worksitesList, assetOptions, usersList] = await Promise.all([
    listLicenses(undefined, worksiteIds),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(and(eq(workers.isActive, true), workerScope)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(and(eq(worksites.isActive, true), worksiteScope)).orderBy(asc(worksites.name)),
    listAssetOptions(assetScope),
    db.select({ id: users.id, name: users.name })
      .from(users).where(eq(users.isActive, true)).orderBy(asc(users.name)),
  ])

  const licensesWithAssignments = await Promise.all(
    licenses.map(async (license) => ({
      ...license,
      assignments: await getLicenseAssignments(license.id, worksiteIds),
    })),
  )

  return (
    <PageContainer>
      <PageHeader
        title="Licencias y suscripciones"
        description="Software, SaaS y servicios contratados: compradas, asignadas y disponibles."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Licencias" }]} />}
        actions={canManage ? (
          <LicenseSheet
            trigger={<Button><Plus size={14} className="mr-1.5" /> Nueva licencia</Button>}
            suppliers={suppliersList}
            users={usersList}
          />
        ) : undefined}
      />

      <div className="space-y-4">
        {licensesWithAssignments.map((license) => (
          <LicensePanel
            key={license.id}
            license={license}
            canManage={canManage}
            workers={workersList}
            worksites={worksitesList}
            assets={assetOptions}
            suppliers={suppliersList}
            users={usersList}
          />
        ))}
      </div>

      {licensesWithAssignments.length === 0 && (
        <EmptyState
          title="Sin licencias registradas"
          description={canManage ? "Registra la primera suscripción para controlar sus cantidades y renovaciones." : "Las licencias y suscripciones aparecerán aquí cuando se registren."}
          action={canManage ? (
            <LicenseSheet
              trigger={<Button variant="secondary">Registrar la primera licencia</Button>}
              suppliers={suppliersList}
              users={usersList}
            />
          ) : undefined}
        />
      )}
    </PageContainer>
  )
}
