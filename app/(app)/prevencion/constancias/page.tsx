import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { pdtpRegistrationActorFromSession } from "@/lib/auth/pdtp-registration"
import { listPdtpRegistrableActivityIds } from "@/lib/services/pdtp/registration-authority"
import { listScopedWorksites } from "@/lib/services/ppa"
import { listPdtpConstanciaActivities } from "@/lib/services/prevention-pdtp"
import { ConstanciasWorkbench } from "./constancias-workbench"

export const metadata: Metadata = { title: "Constancias" }

const one = (value?: string | string[]) => Array.isArray(value) ? value[0] : value

export default async function ConstanciasPage({
  searchParams,
}: {
  searchParams: Promise<{ faena?: string | string[] }>
}) {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:constancias:view")) redirect("/forbidden")

  const query = await searchParams
  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const [worksites, view] = await Promise.all([
    listScopedWorksites(scope),
    listPdtpConstanciaActivities(scope),
  ])

  // PREV-I03: "Registrar" sólo en las constancias que el servidor aceptaría de
  // esta persona (su cargo, su asignación, o todas si es Prevención).
  const canExecute = can(session, "prevention:pdtp:execute") || can(session, "prevention:constancias:execute")
  const actor = pdtpRegistrationActorFromSession(session)
  let registrableKeys: string[] | undefined
  if (canExecute && view && !actor.canRegisterAnyActivity) {
    const byWorksite = new Map<string, Set<string>>()
    for (const debt of view.debts) {
      byWorksite.set(debt.worksiteId, (byWorksite.get(debt.worksiteId) ?? new Set()).add(debt.activityId))
    }
    const keys: string[] = []
    await Promise.all([...byWorksite].map(async ([worksiteId, activityIds]) => {
      for (const activityId of await listPdtpRegistrableActivityIds({ activityIds: [...activityIds], worksiteId, actor })) {
        keys.push(`${worksiteId}|${activityId}`)
      }
    }))
    registrableKeys = keys
  }

  return (
    <ConstanciasWorkbench
      worksites={worksites}
      view={view}
      initialWorksiteId={one(query.faena) ?? "all"}
      canExecute={canExecute}
      registrableKeys={registrableKeys}
    />
  )
}
