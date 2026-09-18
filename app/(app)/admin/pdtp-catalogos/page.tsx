import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requirePermission } from "@/lib/auth/can"
import { listPdtpAdminCatalogs, listRoleSlugs } from "@/lib/services/pdtp/admin-catalogs"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { PdtpActions } from "./pdtp-actions"
import { CatalogTabs } from "./catalog-tabs"
import type { CatalogActivityRow } from "./activity-form"

export const metadata: Metadata = { title: "Catálogos PDTP" }

export default async function PdtpCatalogsPage() {
  let session
  try {
    session = await requirePermission("admin:pdtp_catalog")
  } catch {
    redirect("/forbidden")
  }

  const [{ responsibles, programs, sheets, activities }, roleOptions] = await Promise.all([
    listPdtpAdminCatalogs(),
    listRoleSlugs(),
  ])

  return (
    <PageContainer>
      <PageHeader
        title="Catálogos PDTP"
        description="Administra actividades preventivas reutilizables, responsables y estructura de los programas anuales."
        breadcrumb={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos PDTP" },
        ]}
        actions={<PdtpActions
          programs={programs.map((p) => ({ id: p.id, year: p.year, version: p.version, status: p.status, title: p.title ?? p.id }))}
          roleOptions={roleOptions}
          canManagePrograms={can(session, "prevention:pdtp:program:manage")}
          responsibleCatalog={responsibles.filter((responsible) => responsible.isActive).map((responsible) => ({ slug: responsible.slug, displayName: responsible.displayName }))}
          catalogActivities={activities.map((activity) => ({
            id: activity.id,
            code: activity.code,
            title: activity.title,
            description: activity.description,
            status: activity.status as "draft" | "active" | "retired",
            currentRevision: activity.currentRevision,
            executionGuidance: activity.executionGuidance,
          }))}
        />}
      />
      <CatalogTabs
        activities={activities.map((activity) => ({
          ...activity,
          status: activity.status as CatalogActivityRow["status"],
          updatedAt: activity.updatedAt,
          revisions: activity.revisions.map((revision) => ({
            revision: revision.revision,
            title: revision.title,
            description: revision.description,
            executionGuidance: revision.executionGuidance,
            changeNote: revision.changeNote ?? "",
            createdAt: revision.createdAt,
          })),
        }))}
        roleOptions={roleOptions}
        responsibles={responsibles.map((r) => ({
          slug: r.slug,
          displayName: r.displayName,
          roleName: r.roleName ?? "",
          kind: r.kind,
          notes: r.notes ?? "",
          isActive: r.isActive,
        }))}
        sheets={sheets.map((s) => ({
          id: s.id,
          code: s.code,
          programId: s.programId ?? "",
          label: s.label,
          area: s.area,
          defaultScopeRoles: Array.isArray(s.defaultScopeRoles) ? s.defaultScopeRoles as string[] : [],
          isActive: s.isActive,
        }))}
        programs={programs.map((p) => ({
          id: p.id,
          year: p.year,
          version: p.version,
          status: p.status,
          title: p.title ?? p.id,
          href: `/prevencion/pdtp/${encodeURIComponent(p.id)}`,
        }))}
        draftPrograms={programs.filter((p) => p.status === "draft").map((p) => ({
          id: p.id,
          year: p.year,
          version: p.version,
          status: p.status,
          title: p.title ?? p.id,
          href: `/prevencion/pdtp/${encodeURIComponent(p.id)}/editar`,
        }))}
        canManagePrograms={can(session, "prevention:pdtp:program:manage")}
      />
    </PageContainer>
  )
}
