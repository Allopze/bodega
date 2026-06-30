import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { listIperMatrices } from "@/lib/services/prevention-iper"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { IperPanel } from "./iper-panel"

export const metadata: Metadata = { title: "Matriz de riesgos" }

export default async function IperPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:iper:view")) redirect("/forbidden")

  const scope = resolveWorksiteScope(session)
  const worksiteIds: string[] | "all" =
    scope.mode === "all" ? "all" : scope.mode === "some" ? scope.ids : []

  const [matrices, worksites] = await Promise.all([
    listIperMatrices(worksiteIds),
    listScopedWorksites(worksiteIds),
  ])

  const canManage = can(session, "prevention:iper:manage")

  return (
    <PageContainer>
      <IperPanel matrices={matrices} worksites={worksites} canManage={canManage} />
    </PageContainer>
  )
}
