import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listScopedWorksites } from "@/lib/services/ppa"
import {
  findPdtpWeeklyPending,
  listPdtpDemandActivities,
  listPdtpObligations,
  listPendingPdtpExecutions,
} from "@/lib/services/prevention-pdtp"
import { PdtpObligationsWorkbench } from "./pdtp-obligations-workbench"

export const metadata: Metadata = { title: "Trabajo por necesidad y eventos" }

export default async function PdtpObligationsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const [worksites, activities, obligations, weeklyPendingAll, submittedExecutions] = await Promise.all([
    listScopedWorksites(scope),
    listPdtpDemandActivities(),
    listPdtpObligations({ scope, statuses: ["pending", "overdue", "reported"] }),
    // findPdtpWeeklyPending() recorre TODAS las faenas activas (lo necesita
    // el cron); acá se filtra al alcance real del usuario antes de mostrarlo.
    findPdtpWeeklyPending(),
    listPendingPdtpExecutions(scope),
  ])
  const weeklyPending = scope === "all" ? weeklyPendingAll : weeklyPendingAll.filter((target) => scope.includes(target.worksiteId))

  return (
    <PdtpObligationsWorkbench
      worksites={worksites}
      activities={activities}
      initialObligations={obligations}
      weeklyPending={weeklyPending}
      pendingApproval={submittedExecutions}
      canExecute={can(session, "prevention:pdtp:execute")}
    />
  )
}
