"use server"

import { can, requireAuth } from "@/lib/auth/can"
import { resolveWorksiteScope } from "@/lib/auth/scope"
import { db } from "@/db"
import { users, worksites } from "@/db/schema"
import { inArray } from "drizzle-orm"
import {
  getDocumentBundle,
  listDocumentRecipientOptions,
} from "@/lib/services/prevention-documents-library"

export async function getDocumentDetailAction(documentId: string) {
  let session
  try { session = await requireAuth() }
  catch { return { error: "No autenticado" } }
  if (!can(session, "prevention:docs:view")) return { error: "Sin permisos" }

  const scope = resolveWorksiteScope(session)
  const bundle = await getDocumentBundle(documentId, scope, session.user.permissions)
  if (!bundle) return { error: "Documento no encontrado" }

  const userIds = Array.from(new Set([
    bundle.doc.uploadedBy,
    session.user.id,
    ...bundle.versions.map((v) => v.uploadedBy),
    ...bundle.versions.flatMap((v) => [v.reviewedBy, v.approvedBy]),
    ...bundle.distribution.flatMap((target) => [target.userId, target.assignedByUserId, target.exemptedByUserId]),
  ].filter(Boolean) as string[]))

  const worksiteIds = Array.from(new Set([
    bundle.doc.worksiteId ?? "",
  ].filter(Boolean) as string[]))

  const canDistribute = can(session, "prevention:docs:distribute")
  const [userRows, worksiteRows, recipientOptions] = await Promise.all([
    userIds.length
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    worksiteIds.length
      ? db.select({ id: worksites.id, name: worksites.name }).from(worksites).where(inArray(worksites.id, worksiteIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    canDistribute ? listDocumentRecipientOptions(scope) : Promise.resolve([]),
  ])

  const userMap = Object.fromEntries(userRows.map((u) => [u.id, u]))
  const worksiteMap = Object.fromEntries(worksiteRows.map((w) => [w.id, w]))

  return {
    bundle,
    userMap,
    worksiteMap,
    canManage: can(session, "prevention:docs:manage"),
    canArchive: can(session, "prevention:docs:archive"),
    canSubmitReview: can(session, "prevention:docs:submit_review"),
    canReview: can(session, "prevention:docs:review"),
    canApprove: can(session, "prevention:docs:approve"),
    canPublish: can(session, "prevention:docs:publish"),
    canDistribute,
    canAck: can(session, "prevention:docs:ack"),
    canLink: can(session, "prevention:docs:link"),
    recipientOptions,
    currentUserId: session.user.id,
    currentUserName: userMap[session.user.id]?.name ?? session.user.email ?? "Yo",
    error: undefined as string | undefined,
  }
}
