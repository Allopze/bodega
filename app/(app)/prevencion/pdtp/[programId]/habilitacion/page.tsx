import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPdtpCoverageReport, getPdtpProgram } from "@/lib/services/prevention-pdtp"
import type { PdtpCoverageInstrument, PdtpFulfillmentCoverageIssue } from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import {
  applicabilityLink,
  instrumentLink,
  programEditorLink,
  rolesLink,
} from "@/lib/prevention/pdtp-readiness-links"
import { pdtpPermissionLabel } from "../pdtp-destination-labels"
import { ActivityReadinessWorkbench, type ReadinessRow } from "./activity-readiness-workbench"
import type { ReadinessResolution } from "./resolve-action"
import {
  affectedWorksiteNames,
  instrumentCode,
  instrumentKindLabel,
  instrumentStateLabel,
  readinessRowReason,
} from "./readiness-copy"

export const metadata: Metadata = { title: "Habilitar actividades" }

type Session = Awaited<ReturnType<typeof requireAuth>>

/**
 * Quién puede firmar cada instrumento, y quién lo escribió.
 *
 * Tener el permiso de aprobar no basta: los tres módulos exigen que el
 * aprobador sea distinto del autor, con una sola excepción
 * (`prevention:sign_own_work`, concedida sólo a `prevencionista`). Mandar al
 * autor a un botón que su propio servicio le va a rechazar es exactamente el
 * fallo que este rediseño corrige, así que la comparación se hace acá, donde
 * está `session.user.id`, y no en el cliente.
 */
function resolveInstrumentAction(
  instrument: PdtpCoverageInstrument,
  session: Session,
): ReadinessResolution {
  const link = instrumentLink(instrument)
  const signOwnWork = can(session, "prevention:sign_own_work")
  const userId = session.user.id

  if (instrument.kind === "inspection_template") {
    const canApprove = can(session, "prevention:inspections:approve")
    const isAuthor = instrument.authorUserId === userId
    if (canApprove && !(isAuthor && !signOwnWork)) return { kind: "open", ...link }
    if (can(session, "prevention:inspections:manage")) {
      return {
        kind: "request",
        target: { kind: "template", templateId: instrument.id },
        label: isAuthor ? "Pedir que otro la apruebe" : "Solicitar aprobación",
        hint: isAuthor ? "Quien escribe una versión no la aprueba." : undefined,
      }
    }
    return { kind: "blocked", askRoles: ["Jefatura de Prevención"], permissionLabel: pdtpPermissionLabel("prevention:inspections:execute") }
  }

  if (instrument.kind === "training_course") {
    const version = instrument.latestVersion
    const canApprove = can(session, "prevention:training:approve")
    const isAuthor = version?.authorUserId === userId
    if (canApprove && version && !(isAuthor && !signOwnWork)) return { kind: "open", ...link }
    if (can(session, "prevention:training:manage")) {
      // Sin ninguna versión no hay nada que pedirle a nadie: hay que crearla, y
      // eso lo puede hacer quien tiene `manage`.
      if (!version) return { kind: "open", ...link, label: "Crear la versión" }
      return {
        kind: "request",
        target: { kind: "course", versionId: version.id },
        label: isAuthor ? "Pedir que otro la publique" : "Solicitar publicación",
      }
    }
    return { kind: "blocked", askRoles: ["Jefatura de Prevención"], permissionLabel: "publicar versiones de curso" }
  }

  // Plan de emergencia. Nunca se ofrece "Aprobar": `approveEmergencyPlan` falla
  // si el plan no está completo, y el detalle ya muestra qué le falta antes de
  // habilitar su propio botón.
  const first = instrument.worksites[0]
  if (can(session, "prevention:emergency:approve") || can(session, "prevention:emergency:manage")) {
    if (first?.planId && first.createdByUserId === session.user.id && !can(session, "prevention:emergency:approve")) {
      return { kind: "request", target: { kind: "plan", planId: first.planId }, label: "Pedir que otro lo apruebe" }
    }
    return { kind: "open", ...link }
  }
  return { kind: "blocked", askRoles: ["Jefatura de Prevención"], permissionLabel: pdtpPermissionLabel("prevention:emergency:approve") }
}

function resolveAction(
  issue: PdtpFulfillmentCoverageIssue,
  session: Session,
  context: { programId: string; canManageProgram: boolean; programStatus: string },
): ReadinessResolution {
  // Una disyunción: basta con resolver uno. Se ofrece el primero y, cuando se
  // resuelve, la fila desaparece con todos los demás.
  const instrument = issue.instruments?.[0]
  if (instrument) return resolveInstrumentAction(instrument, session)

  if (issue.status === "executor_permission_gap") {
    if (can(session, "admin:roles")) return { kind: "roles", href: rolesLink().href }
    return {
      kind: "blocked",
      askRoles: issue.executorRoleLabels ?? [],
      permissionLabel: pdtpPermissionLabel(issue.requiredPermission),
    }
  }

  if (issue.status === "decision_required") {
    if (context.canManageProgram) return { kind: "open", ...applicabilityLink() }
    return { kind: "blocked", askRoles: ["quien administra el programa"], permissionLabel: "declarar el padrón por faena" }
  }

  if (issue.status === "segregated_valid") return { kind: "none" }

  // El resto se arregla en el editor del programa, y sólo sobre un borrador:
  // cambiar el catálogo de una versión firmada invalidaría su huella.
  if (context.canManageProgram && context.programStatus === "draft") {
    return { kind: "open", ...programEditorLink(context.programId, issue.n) }
  }
  return {
    kind: "blocked",
    askRoles: ["quien administra el programa"],
    permissionLabel: "editar el catálogo de actividades",
  }
}

export default async function PdtpReadinessPage({ params }: { params: Promise<{ programId: string }> }) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp")}`)

  const { programId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" = scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []
  const report = await getPdtpCoverageReport(programId, worksiteIds === "all" ? undefined : { worksiteIds })

  const canManageProgram = can(session, "prevention:pdtp:program:manage")
  const context = { programId, canManageProgram, programStatus: program.status }

  const rows: ReadinessRow[] = report.groups.flatMap((group) =>
    group.issues.map((issue) => {
      const instrument = issue.instruments?.[0]
      return {
        activityId: issue.activityId,
        n: issue.n,
        activity: issue.activity,
        status: issue.status,
        blocks: group.blocks,
        reason: readinessRowReason(issue),
        instrumentKind: instrument ? instrumentKindLabel(instrument) : null,
        instrumentCode: instrument ? instrumentCode(instrument) : null,
        instrumentState: instrument ? instrumentStateLabel(instrument) : null,
        worksiteNames: affectedWorksiteNames(issue),
        resolution: resolveAction(issue, session, context),
      }
    }),
  )

  const breadcrumb = (
    <Breadcrumbs items={[
      { label: "Inicio", href: "/dashboard" },
      { label: "Prevención", href: "/prevencion" },
      { label: "Programa de trabajo", href: "/prevencion/pdtp" },
      { label: program.title, href: `/prevencion/pdtp/${programId}` },
      { label: "Habilitar actividades" },
    ]} />
  )

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Habilitar actividades"
        description="Qué le falta a cada actividad para poder ejecutarse y acreditar cumplimiento."
        breadcrumb={breadcrumb}
      />
      {report.total === 0 ? (
        <EmptyState
          title="Este programa todavía no tiene actividades activas"
          description="Carga el catálogo en el editor del programa para poder revisar su cobertura."
        />
      ) : (
        <ActivityReadinessWorkbench rows={rows} total={report.total} ready={report.ready} />
      )}
    </PageContainer>
  )
}
