import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { listExposureGroups, listProgramEnrollments } from "@/lib/services/prevention-hygiene"
import { ProgramDetail } from "./program-detail"

export const metadata: Metadata = { title: "Programa de vigilancia" }

export default async function ProgramaPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params

  let auth
  try { auth = await requirePermission("prevention:hygiene:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/higiene/programas")}`) }

  const access = {
    userId: auth.user.id,
    scope: resolveWorksiteScope(auth),
    permissions: auth.user.permissions,
  }

  const detail = await listProgramEnrollments(programId, access)
  if (!detail) notFound()

  const canManage = auth.user.permissions.includes("prevention:hygiene:manage")
  const allGroups = canManage ? await listExposureGroups(access) : []
  const eligibleGroups = allGroups.filter((row) => row.group.worksiteId === detail.program.worksiteId && row.group.isActive)

  return (
    <PageContainer>
      <PageHeader
        title={detail.program.name}
        description={detail.program.protocol}
        breadcrumb={<Breadcrumbs items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Prevención" },
          { label: "Higiene", href: "/prevencion/higiene" },
          { label: detail.program.name },
        ]} />}
      />
      <ProgramDetail
        program={{
          id: detail.program.id,
          code: detail.program.code,
          name: detail.program.name,
          protocol: detail.program.protocol,
          periodicityMonths: detail.program.periodicityMonths,
          legalBasis: detail.program.legalBasis,
          status: detail.program.status,
        }}
        enrollments={detail.enrollments.map((item) => ({
          id: item.id,
          workerName: item.workerName,
          groupName: item.groupName,
          enrolledOn: item.enrolledOn,
          dueOn: item.dueOn,
          status: item.status,
          attendedOn: item.attendedOn,
          absenceReason: item.absenceReason,
        }))}
        eligibleGroups={eligibleGroups.map((row) => ({ id: row.group.id, name: row.group.name, memberCount: row.memberCount }))}
        canManage={canManage}
      />
    </PageContainer>
  )
}
