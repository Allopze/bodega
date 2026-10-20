import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { SYSTEM_ROLES } from "@/lib/auth/system-rbac"
import { getPreventionIncidentDetail, getPreventionIncidentRe20SensitivePayload, getPreventionIncidentRe20Workspace } from "@/lib/services/prevention-incidents"
import { getPreventionIncidentRe20PrintExtras } from "@/lib/services/prevention-incident-re20-print"
import { re20PublicDataSchema } from "@/lib/services/prevention-incident-re20-schema"
import { PrintTrigger } from "../../../../../sst/[id]/print/print-trigger"
import { Re20PrintDocument } from "./document"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Expediente RE-20" }

export default async function Re20PrintPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sensitive?: string; purpose?: string }>
}) {
  let session
  try { session = await requirePermission("prevention:incidents:view") }
  catch { redirect("/login") }
  const { id } = await params
  const query = await searchParams
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions, roles: session.user.roles ?? [] }
  const [bundle, re20] = await Promise.all([
    getPreventionIncidentDetail({ incidentId: id, access, includeSensitive: false }),
    getPreventionIncidentRe20Workspace({ incidentId: id, access }),
  ])
  if (!bundle || !re20) notFound()
  let sensitive: (Record<string, unknown> & { purpose: string }) | null = null
  if (query.sensitive === "1") {
    try {
      sensitive = {
        ...await getPreventionIncidentRe20SensitivePayload({ incidentId: id, purpose: query.purpose ?? "", access }),
        purpose: query.purpose?.trim() ?? "",
      }
    } catch {
      notFound()
    }
  }
  const incident = { ...bundle.incident, worksiteName: bundle.worksiteName }
  // El expediente llega normalizado al esquema vigente; si un registro viejo no parsea se imprime vacío antes que fallar.
  const data = re20.workspace ? (re20PublicDataSchema.safeParse(re20.workspace.data).data ?? re20PublicDataSchema.parse({})) : null
  const extras = await getPreventionIncidentRe20PrintExtras({
    incidentId: id,
    userIds: [
      re20.workspace?.updatedByUserId,
      ...(data?.team.map((member) => member.userId) ?? []),
      ...(data?.measures.flatMap((measure) => [measure.responsibleUserId, measure.verifierUserId]) ?? []),
      ...(data?.definitive.instruments.map((instrument) => instrument.responsibleUserId) ?? []),
      ...(data?.tasks.map((task) => task.responsibleUserId) ?? []),
      ...re20.qualityReviews.map((review) => review.reviewerUserId),
    ],
  })
  const printable = {
    incident: { ...incident, potentialSeverity: bundle.incident.potentialSeverity },
    workspace: re20.workspace && data ? { ...re20.workspace, data } : null,
    qualityReviews: re20.qualityReviews,
    followups: extras.followups,
    diffusions: extras.diffusions,
    people: extras.people,
    roleLabels: Object.fromEntries(SYSTEM_ROLES.map((role) => [role.name, role.label])),
    sensitive,
    legacy: bundle.investigation ? {
      methodology: bundle.investigation.methodology,
      preliminaryReportText: bundle.investigation.preliminaryReportText,
      conclusions: bundle.investigation.conclusions,
      immediateCauses: bundle.investigation.immediateCauses,
      basicCauses: bundle.investigation.basicCauses,
      organizationalCauses: bundle.investigation.organizationalCauses,
    } : null,
  }

  const sensitiveQuery = sensitive ? `?sensitive=1&purpose=${encodeURIComponent(sensitive.purpose)}` : ""
  return <>
    <PrintTrigger backHref={`/prevencion/incidentes/${id}`} backLabel="Volver al incidente" pdfHref={`/prevencion/incidentes/${id}/re20/print/pdf${sensitiveQuery}`} suggestedFilename={`${incident.code}-RE-20${sensitive ? "-reservado" : ""}.pdf`} />
    <Re20PrintDocument data={printable} />
  </>
}
