import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { resolveWorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import { getMiperHistory, getMiperWorkspace } from "@/lib/services/miper/queries"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { scopeAllows } from "@/lib/services/miper/shared"
import { MiperWorkspaceView } from "./miper-workspace"

export const metadata: Metadata = { title: "MIPER" }

export default async function MiperWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  let session
  try { session = await requireAuth() } catch { redirect("/forbidden") }
  if (!can(session, "prevention:risk:view")) redirect("/forbidden")
  const { id } = await params
  const access = { userId: session.user.id, scope: resolveWorksiteScope(session), permissions: session.user.permissions }
  let workspace: Awaited<ReturnType<typeof getMiperWorkspace>>
  let history: Awaited<ReturnType<typeof getMiperHistory>>
  try {
    ;[workspace, history] = await Promise.all([getMiperWorkspace(id, access), getMiperHistory(id, access)])
  } catch (error) {
    if (error instanceof RiskLegalDomainError) notFound()
    throw error
  }
  const mode = resolveWorkspaceMode({
    status: workspace.matrix.status, reviewState: workspace.matrix.reviewState, isLegacy: workspace.matrix.isLegacy,
    openRoundStage: workspace.openRound?.stage ?? null, submittedByUserId: workspace.openRound?.submittedByUserId ?? null,
    userId: session.user.id, permissions: session.user.permissions, inScope: scopeAllows(access.scope, workspace.matrix.worksiteId),
  })
  return <MiperWorkspaceView workspace={workspace} history={history} mode={mode} userId={session.user.id} />
}
