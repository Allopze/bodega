import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
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

  return (
    <ConstanciasWorkbench
      worksites={worksites}
      view={view}
      initialWorksiteId={one(query.faena) ?? "all"}
      canExecute={can(session, "prevention:pdtp:execute") || can(session, "prevention:constancias:execute")}
    />
  )
}
