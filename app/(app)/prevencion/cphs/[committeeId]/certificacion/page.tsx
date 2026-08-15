import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { getCommitteeStatus } from "@/lib/services/prevention-cphs"
import {
  getCertificationDossier,
  listCertificationDossiers,
} from "@/lib/services/prevention-cphs-certification"
import { CertificationHeaderActions, CertificationPanel } from "./certification-panel"

export const metadata: Metadata = { title: "Certificación CPHS Mutual" }

export default async function CertificacionPage({ params, searchParams }: {
  params: Promise<{ committeeId: string }>
  searchParams: Promise<{ expediente?: string }>
}) {
  const { committeeId } = await params
  const { expediente } = await searchParams

  let session
  try { session = await requirePermission("prevention:cphs:view") }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/cphs")}`) }

  const access = {
    userId: session.user.id,
    scope: resolveWorksiteScope(session),
    permissions: session.user.permissions,
  }

  const status = await getCommitteeStatus(committeeId, access)
  if (!status) notFound()

  const dossiers = await listCertificationDossiers(committeeId, access)
  const selectedId = expediente && dossiers.some((row) => row.id === expediente)
    ? expediente
    : dossiers[dossiers.length - 1]?.id
  const selected = selectedId ? await getCertificationDossier(selectedId, access) : null
  const canCertify = session.user.permissions.includes("prevention:cphs:certify")
  const selectedView = selected && {
    id: selected.dossier.id,
    level: selected.dossier.level,
    periodYear: selected.dossier.periodYear,
    status: selected.dossier.status,
    version: selected.dossier.version,
    adherenceConfirmed: selected.dossier.adherenceConfirmed,
    sagecopRegistered: selected.dossier.sagecopRegistered,
    sagecopReference: selected.dossier.sagecopReference,
    contributionsStatus: selected.dossier.contributionsStatus,
    auditedFrom: selected.dossier.auditedFrom,
    auditedTo: selected.dossier.auditedTo,
    auditedOn: selected.dossier.auditedOn,
    auditResult: selected.dossier.auditResult,
    gapsDeadlineOn: selected.dossier.gapsDeadlineOn,
    validUntilOn: selected.dossier.validUntilOn,
    frozen: selected.frozen,
    requirements: selected.requirements,
    summary: selected.summary,
    gaps: selected.gaps,
  }

  return (
    <PageContainer>
      <PageHeader
        title="Certificación CPHS Mutual"
        description={`${status.committee.name} · ${status.worksiteName}`}
        actions={canCertify ? <CertificationHeaderActions committeeId={committeeId} selected={selectedView} /> : undefined}
        breadcrumb={<Breadcrumbs items={[
          { label: "Inicio", href: "/dashboard" },
          { label: "Prevención" },
          { label: "CPHS", href: "/prevencion/cphs" },
          { label: status.committee.name, href: `/prevencion/cphs/${committeeId}` },
          { label: "Certificación" },
        ]} />}
      />
      <CertificationPanel
        committeeId={committeeId}
        dossiers={dossiers.map((row) => ({ id: row.id, level: row.level, periodYear: row.periodYear, status: row.status }))}
        selected={selectedView}
        canCertify={canCertify}
      />
    </PageContainer>
  )
}
