import type { Metadata } from "next"
import Link from "next/link"
import { redirect, notFound } from "next/navigation"
import { eq } from "drizzle-orm"
import { ClipboardText } from "@phosphor-icons/react/dist/ssr"
import { requireAuth, can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { db } from "@/db"
import { pdtpActivities, pdtpExecutions } from "@/db/schema"
import {
  getPdtpProgram,
  listActionPlanItems,
  listFollowups,
} from "@/lib/services/prevention-pdtp"
import { findInspectionTemplateForPdtpActivity } from "@/lib/services/pdtp-adapters/inspection-templates-2026"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ExecutionActionPlanPanel } from "./execution-action-plan-panel"

export const metadata: Metadata = { title: "Verificación de ejecución PDTP" }

type Props = { params: Promise<{ programId: string; executionId: string }> }

export default async function PdtpExecutionDetailPage({ params }: Props) {
  let session
  try { session = await requireAuth() }
  catch { redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/ejecucion")}`) }
  if (!can(session, "prevention:pdtp:view")) redirect(`/forbidden?desde=${encodeURIComponent("/prevencion/pdtp/[programId]/ejecucion")}`)

  const { programId, executionId } = await params
  const program = await getPdtpProgram(programId)
  if (!program) notFound()

  const [execution] = await db.select().from(pdtpExecutions).where(eq(pdtpExecutions.id, executionId)).limit(1)
  if (!execution) notFound()
  if (!canAccessWorksite(session, execution.worksiteId)) notFound()

  const [activity] = await db.select().from(pdtpActivities).where(eq(pdtpActivities.id, execution.activityId)).limit(1)
  if (!activity || activity.programId !== programId) notFound()

  // D10 (diseño 2026-08-12): las actividades de inspección se ejecutan en el
  // módulo Inspecciones, que acredita el PDTP solo al completar el run.
  const inspectionTemplate = await findInspectionTemplateForPdtpActivity(activity.n)

  const actionItems = await listActionPlanItems(executionId)
  const followupLists = await Promise.all(actionItems.map((item) => listFollowups(item.id)))
  const followupsByItem = Object.fromEntries(actionItems.map((item, i) => [item.id, followupLists[i]!]))

  const canManageActions = can(session, "prevention:pdtp:action:manage")
  const canVerifyActions = can(session, "prevention:pdtp:action:verify")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Verificación N°${activity.n}: ${activity.activity}`}
        description={`Período ${execution.month}/${execution.year} · Semana ${execution.week} · Cantidad ejecutada: ${execution.executedQuantity}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Inicio", href: "/dashboard" },
            { label: "Programa de trabajo", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Verificación" },
          ]} />
        }
      />

      <div className="space-y-8">
        {inspectionTemplate ? (
          <EmptyState
            icon={<ClipboardText size={20} />}
            title="Esta actividad se ejecuta en Inspecciones"
            description={`Usa la plantilla «${inspectionTemplate.name}». Al completar la inspección, esta actividad del programa queda acreditada sola, con sus hallazgos y su plan de acción.`}
            action={
              <Button asChild size="sm">
                <Link href="/prevencion/inspecciones">Ir a Inspecciones</Link>
              </Button>
            }
          />
        ) : (
          /* El motor de checklist propio del PDTP se retiró: los instrumentos
           * viven en Inspecciones. Una actividad sin plantilla ahí se verifica
           * por la evidencia de su ejecución, y lo que aparezca se levanta como
           * acción en el plan de abajo. Se dice en voz alta en vez de dejar el
           * hueco: la página se titula «Verificación» y un espacio en blanco se
           * lee como una falla. */
          <EmptyState
            icon={<ClipboardText size={20} />}
            title="Esta actividad no se verifica con un formulario"
            description="Su cumplimiento se respalda con la evidencia adjunta a la ejecución. Si la verificación levantó algo que corregir, regístralo como acción en el plan de acción."
          />
        )}

        <ExecutionActionPlanPanel
          executionId={executionId}
          worksiteId={execution.worksiteId}
          items={actionItems}
          followupsByItem={followupsByItem}
          canManage={canManageActions}
          canVerify={canVerifyActions}
        />
      </div>
    </PageContainer>
  )
}
