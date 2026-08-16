import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listScopedWorksites } from "@/lib/services/ppa"
import {
  listPdtpDemandActivities,
  listPdtpObligations,
} from "@/lib/services/prevention-pdtp"
import { PdtpObligationsWorkbench } from "./pdtp-obligations-workbench"

export const metadata: Metadata = { title: "Actividades a demanda y por evento" }

export default async function PdtpObligationsPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:pdtp:view")) redirect("/forbidden")

  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  // Esta pantalla es sólo de las actividades no calendarizadas. Las bandejas de
  // trabajo calendarizado (programadas de la semana y ejecuciones por aprobar)
  // se movieron a /prevencion/pdtp/aprobaciones, donde ya vivía la misma cola.
  const [worksites, activities, obligations] = await Promise.all([
    listScopedWorksites(scope),
    listPdtpDemandActivities(),
    listPdtpObligations({ scope, statuses: ["pending", "overdue", "reported"] }),
  ])

  return (
    <PdtpObligationsWorkbench
      worksites={worksites}
      activities={activities}
      initialObligations={obligations}
      canExecute={can(session, "prevention:pdtp:execute")}
      canCancel={can(session, "prevention:pdtp:obligation:cancel")}
    />
  )
}
