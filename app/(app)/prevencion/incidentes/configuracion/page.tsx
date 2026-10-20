import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requirePermission } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { getPreventionIncidentRe20Configuration } from "@/lib/services/prevention-incident-re20-config"
import { ConfigWorkbench } from "./config-workbench"

export const metadata: Metadata = { title: "Configuración RE-20" }
export const dynamic = "force-dynamic"

export default async function Re20ConfigurationPage() {
  let session
  try { session = await requirePermission("prevention:incidents:configure_re20") }
  catch { redirect("/forbidden") }
  const access = { ctx: { userId: session.user.id }, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  const { policy, options } = await getPreventionIncidentRe20Configuration(access)
  const { version, ...values } = policy
  return <ConfigWorkbench options={options} policy={values} policyVersion={version} />
}
