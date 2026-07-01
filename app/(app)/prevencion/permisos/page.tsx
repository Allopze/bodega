import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireAuth, can } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import {
  listPermitTemplates,
  listPermitRequests,
  listSignoffsForPermits,
} from "@/lib/services/prevention-permits"
import { listScopedWorksites } from "@/lib/services/ppa"
import { PageContainer } from "@/components/ui/page-container"
import { PermisosPanel } from "./permisos-panel"

export const metadata: Metadata = { title: "Permisos de trabajo" }

function scopeToIds(scope: ReturnType<typeof resolveWorksiteScope>): string[] | "all" {
  if (scope.mode === "all") return "all"
  if (scope.mode === "none") return []
  return scope.ids
}

export default async function PermisosPage() {
  let session
  try { session = await requireAuth() }
  catch { redirect("/forbidden") }
  if (!can(session, "prevention:permits:view")) redirect("/forbidden")

  const scope = scopeToIds(resolveWorksiteScope(session))
  const [templates, permits, worksites] = await Promise.all([
    listPermitTemplates(),
    listPermitRequests(scope),
    listScopedWorksites(scope),
  ])
  const signoffs = await listSignoffsForPermits(permits.map((p) => p.id))

  return (
    <PageContainer>
      <PermisosPanel
        permits={permits}
        templates={templates}
        worksites={worksites}
        signoffs={signoffs}
        canManage={can(session, "prevention:permits:manage")}
      />
    </PageContainer>
  )
}
