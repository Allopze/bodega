import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { listPdtpAdminCatalogs } from "@/lib/services/pdtp/admin-catalogs"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { CatalogTabs } from "./catalog-tabs"

export const metadata: Metadata = { title: "Catálogos PDTP" }

export default async function PdtpCatalogsPage() {
  try {
    await requirePermission("admin:pdtp_catalog")
  } catch {
    redirect("/forbidden")
  }

  const { responsibles, programs, sheets } = await listPdtpAdminCatalogs()

  return (
    <PageContainer>
      <PageHeader
        title="Catálogos PDTP"
        description="Mantén el catálogo de responsables, las hojas del programa preventivo y revisa los programas activos."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Catálogos PDTP" },
        ]}
      />
      <CatalogTabs
        responsibles={responsibles.map((r) => ({
          slug: r.slug,
          displayName: r.displayName,
          roleName: r.roleName ?? "",
          kind: r.kind,
          notes: r.notes ?? "",
        }))}
        sheets={sheets.map((s) => ({
          id: s.id,
          code: s.code,
          programId: s.programId ?? "",
          label: s.label,
          area: s.area,
          defaultScopeRoles: Array.isArray(s.defaultScopeRoles) ? s.defaultScopeRoles as string[] : [],
        }))}
        programs={programs.map((p) => ({
          id: p.id,
          year: p.year,
          version: p.version,
          status: p.status,
          title: p.title ?? p.id,
          href: `/prevencion/pdtp/${encodeURIComponent(p.id)}`,
        }))}
      />
    </PageContainer>
  )
}
