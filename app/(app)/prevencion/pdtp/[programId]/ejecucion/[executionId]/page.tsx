import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { requireAuth, can } from "@/lib/auth/can"
import { canAccessWorksite } from "@/lib/auth/scope"
import { db } from "@/db"
import { fuelVehicles, pdtpActivities, pdtpExecutions, workers } from "@/db/schema"
import {
  getPdtpProgram,
  listExecutionChecklists,
  getChecklistResponses,
  listActionPlanItems,
  listFollowups,
} from "@/lib/services/prevention-pdtp"
import { PageContainer } from "@/components/ui/page-container"
import { Breadcrumbs, PageHeader } from "@/components/ui/page-header"
import { ExecutionChecklistPanel } from "./execution-checklist-panel"
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

  const [instances, actionItems] = await Promise.all([
    listExecutionChecklists(executionId),
    listActionPlanItems(executionId),
  ])
  const responseLists = await Promise.all(instances.map((inst) => getChecklistResponses(inst.id)))
  const responsesByInstance = Object.fromEntries(instances.map((inst, i) => [inst.id, responseLists[i] ?? []]))
  const followupLists = await Promise.all(actionItems.map((item) => listFollowups(item.id)))
  const followupsByItem = Object.fromEntries(actionItems.map((item, i) => [item.id, followupLists[i]!]))

  // Sujetos disponibles para el selector "Agregar sujeto": vehículos y
  // trabajadores activos de la faena de la ejecución (PLAN_INTEGRACION §7).
  const [vehicles, worksiteWorkers] = await Promise.all([
    db.select({
      id: fuelVehicles.id,
      plate: fuelVehicles.plate,
      code: fuelVehicles.code,
      brand: fuelVehicles.brand,
      model: fuelVehicles.model,
    }).from(fuelVehicles)
      .where(and(eq(fuelVehicles.worksiteId, execution.worksiteId), eq(fuelVehicles.isActive, true)))
      .orderBy(fuelVehicles.plate),
    db.select({
      id: workers.id,
      firstName: workers.firstName,
      lastName: workers.lastName,
      position: workers.position,
      rut: workers.rut,
    }).from(workers)
      .where(and(eq(workers.worksiteId, execution.worksiteId), eq(workers.isActive, true)))
      .orderBy(workers.lastName, workers.firstName),
  ])

  const canFill = can(session, "prevention:pdtp:checklist:fill")
  const canManageActions = can(session, "prevention:pdtp:action:manage")
  const canVerifyActions = can(session, "prevention:pdtp:action:verify")

  return (
    <PageContainer width="workbench">
      <PageHeader
        title={`Verificación — N°${activity.n} ${activity.activity}`}
        description={`Período ${execution.month}/${execution.year} · Semana ${execution.week} · Cantidad ejecutada: ${execution.executedQuantity}`}
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Programas PDTP", href: "/prevencion/pdtp" },
            { label: program.title, href: `/prevencion/pdtp/${programId}` },
            { label: "Verificación" },
          ]} />
        }
      />

      <div className="space-y-8">
        <ExecutionChecklistPanel
          executionId={executionId}
          programId={programId}
          instances={instances}
          responsesByInstance={responsesByInstance}
          canFill={canFill}
          vehicles={vehicles}
          worksiteWorkers={worksiteWorkers}
        />

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
