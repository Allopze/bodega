import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { requireAuth, can } from "@/lib/auth/can"
import { listReports } from "@/lib/services/feedback"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { Button } from "@/components/ui/button"
import { ReportList } from "./report-list"

export const metadata: Metadata = { title: "Soporte" }

export default async function SoportePage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "feedback:view_own") && !can(session, "feedback:view_all") && !can(session, "feedback:manage")) {
    redirect("/forbidden")
  }

  const canViewAll = can(session, "feedback:view_all")
  const canCreate  = can(session, "feedback:create")

  const reports = await listReports(
    { mode: canViewAll ? "all" : "own", userId: session.user.id },
    50,
    0,
  )

  return (
    <PageContainer>
      <PageHeader
        title="Soporte"
        description="Reporta bugs, consultas o sugerencias para mejorar la plataforma."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Soporte" },
          ]} />
        }
        headerActions={
          canCreate ? (
            <Button asChild>
              <Link href="/soporte/nuevo">Nuevo reporte</Link>
            </Button>
          ) : undefined
        }
      />
      <ReportList reports={reports} canCreate={canCreate} canViewAll={canViewAll} />
    </PageContainer>
  )
}
