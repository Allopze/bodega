import type { Metadata } from "next"
import Link from "next/link"
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
import { listLicenses, getLicensesAssignments } from "@/lib/services/ti/licenses"
import { licenseRenewal } from "@/lib/services/ti/license-renewal"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { listAssetOptions } from "@/lib/services/ti/assets"
import { LicenseList } from "./license-list"
import { LicenseCta, LicenseSheet } from "./license-sheet"

export const metadata: Metadata = { title: "Licencias" }

export default async function LicenciasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("ti:view") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  // `?renovacion=proxima` es contrato con el resumen de TI: licencias que
  // renuevan en 14 días o menos, y las que ya pasaron su fecha.
  const onlyRenewing = sp.renovacion === "proxima"
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

  const renewingCount = licenses.filter((license) => licenseRenewal(license.renewalDate, license.isActive).urgent).length
  const shown = onlyRenewing
    ? licenses.filter((license) => licenseRenewal(license.renewalDate, license.isActive).urgent)
    : licenses
  // Una sola consulta para todas las licencias a la vista (antes, una por licencia).
  const assignmentsByLicense = await getLicensesAssignments(shown.map((license) => license.id), worksiteIds)
  const licensesWithAssignments = shown.map((license) => ({
    ...license,
    assignments: assignmentsByLicense.get(license.id) ?? [],
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Licencias"
        description="Licencias y suscripciones de software y servicios: compradas, asignadas y disponibles."
        breadcrumb={<Breadcrumbs items={[{ label: "TI", href: "/ti" }, { label: "Licencias" }]} />}
        actions={canManage ? (
          <LicenseCta suppliers={suppliersList} users={usersList} />
        ) : undefined}
      />

      {(renewingCount > 0 || onlyRenewing) && (
        <SegmentedControl
          className="mb-4"
          ariaLabel="Filtrar licencias por renovación"
          variant="segmented"
          items={[
            { key: "todas", label: `Todas (${licenses.length})`, active: !onlyRenewing, href: "/ti/licencias" },
            { key: "proxima", label: `Por renovar (${renewingCount})`, active: onlyRenewing, href: "/ti/licencias?renovacion=proxima" },
          ]}
        />
      )}

      {licensesWithAssignments.length > 0 && (
        <LicenseList
          licenses={licensesWithAssignments}
          canManage={canManage}
          workers={workersList}
          worksites={worksitesList}
          assets={assetOptions}
          suppliers={suppliersList}
          users={usersList}
        />
      )}
      {licenses.length > 0 && licensesWithAssignments.length === 0 && (
        <EmptyState
          compact
          title="Ninguna licencia por renovar"
          description="Ninguna licencia vence ni renueva en los próximos 14 días."
          action={<Button asChild variant="secondary" size="sm"><Link href="/ti/licencias">Ver todas las licencias</Link></Button>}
        />
      )}

      {licenses.length === 0 && (
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
