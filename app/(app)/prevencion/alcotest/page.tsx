import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listScopedWorksites } from "@/lib/services/ppa"
import {
  listAlcoholTestDispatches,
  listAlcoholTests,
  listAlcotestEquipment,
  listAlcotestWorkers,
} from "@/lib/services/prevention-alcotest"
import { AlcotestWorkbench } from "./alcotest-workbench"

export const metadata: Metadata = { title: "Alcotest" }

export default async function AlcotestPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:alcotest:view")) redirect("/forbidden")

  const resolved = resolveWorksiteScope(session)
  const scope: string[] | "all" = resolved.mode === "all" ? "all" : resolved.mode === "some" ? resolved.ids : []
  const [worksites, tests, dispatches, workers, equipment] = await Promise.all([
    listScopedWorksites(scope),
    listAlcoholTests(scope),
    listAlcoholTestDispatches(scope),
    listAlcotestWorkers(scope),
    listAlcotestEquipment(scope),
  ])

  return (
    <AlcotestWorkbench
      worksites={worksites}
      initialTests={tests}
      initialDispatches={dispatches}
      workers={workers}
      equipment={equipment}
      canRegister={can(session, "prevention:alcotest:register")}
      canDispatch={can(session, "prevention:alcotest:dispatch")}
    />
  )
}
