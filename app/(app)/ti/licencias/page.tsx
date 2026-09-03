import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { db } from "@/db"
import { suppliers, workers, worksites } from "@/db/schema"
import { eq, asc } from "drizzle-orm"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
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

  const [licenses, suppliersList, workersList, worksitesList, assetOptions] = await Promise.all([
    listLicenses(),
    db.select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name)),
    db.select({ id: workers.id, name: workers.firstName, lastName: workers.lastName })
      .from(workers).where(eq(workers.isActive, true)).orderBy(asc(workers.firstName), asc(workers.lastName)),
    db.select({ id: worksites.id, name: worksites.name })
      .from(worksites).where(eq(worksites.isActive, true)).orderBy(asc(worksites.name)),
    listAssetOptions(),
  ])

  const licensesWithAssignments = await Promise.all(
    licenses.map(async (license) => ({
      ...license,
      assignments: await getLicenseAssignments(license.id),
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
            workers={workersList}
            worksites={worksitesList}
            assets={assetOptions}
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
          />
        ))}
      </div>

      {licensesWithAssignments.length === 0 && (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          Sin licencias registradas.{" "}
          {canManage && <span className="font-semibold text-[var(--color-primary)]">Crea la primera con «Nueva licencia».</span>}
        </p>
      )}
    </PageContainer>
  )
}
