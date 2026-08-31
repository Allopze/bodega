"use server"

import { safeActionMessage } from "@/lib/action-error"

import { revalidatePath } from "next/cache"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { users, userInvitations } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { generateInvitationToken, hashInvitationToken } from "@/lib/auth/bootstrap"
import { getAppBaseUrl, sendInvitationEmail } from "@/lib/email/smtp"
import { userInvitationSchema, type ActionState } from "@/lib/validation/masters"
import {
  buildWorksiteAssignments,
  validateWorksiteAssignmentScope,
  validateRoleWorksiteRules,
  canManageAdministratorRole,
} from "../actions.helpers"
import { requireAdminPermission } from "./helpers"
import { REVALIDATE } from "./revalidate"
import { validateWorkerAssociation } from "./worker-association"

export async function inviteUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminPermission()
  if (!session) return { ok: false, message: "Sin permisos para invitar usuarios" }

  const raw = {
    name: formData.get("name") || "",
    email: formData.get("email"),
    roleIds: formData.getAll("roleIds"),
    workerId: formData.get("workerId") || "",
    expiresInDays: formData.get("expiresInDays") || 7,
    worksiteAssignments: buildWorksiteAssignments(formData),
  }

  const parsed = userInvitationSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  const d = parsed.data
  const worksiteScopeError = validateWorksiteAssignmentScope(session, d.worksiteAssignments)
  if (worksiteScopeError) return worksiteScopeError
  const roleError = await validateRoleWorksiteRules(
    d.roleIds,
    d.worksiteAssignments,
    canManageAdministratorRole(session),
  )
  if (roleError) return roleError
  const workerAssociation = await validateWorkerAssociation(session, d.workerId || undefined, d.worksiteAssignments)
  if (workerAssociation.error) return workerAssociation.error
  if (d.workerId) {
    const pendingWorkerInvitation = await db.query.userInvitations.findFirst({
      where: and(
        eq(userInvitations.workerId, d.workerId),
        isNull(userInvitations.acceptedAt),
        isNull(userInvitations.cancelledAt),
        isNull(userInvitations.replacedAt),
      ),
    })
    if (pendingWorkerInvitation) {
      return { ok: false, fieldErrors: { workerId: ["Este trabajador ya tiene una invitación pendiente"] } }
    }
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, d.email) })
  if (existing) {
    return { ok: false, fieldErrors: { email: ["Este correo ya tiene una cuenta"] } }
  }

  const token = generateInvitationToken()
  const inviteUrl = `${getAppBaseUrl()}/registro?token=${encodeURIComponent(token)}`
  const expiresAt = new Date(Date.now() + d.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const invitationId = nanoid()
  const now = new Date().toISOString()

  await db.transaction(async (tx) => {
    await tx.update(userInvitations)
      .set({ replacedAt: now, replacedByInvitationId: invitationId })
      .where(and(
        eq(userInvitations.email, d.email),
        isNull(userInvitations.acceptedAt),
        isNull(userInvitations.cancelledAt),
        isNull(userInvitations.replacedAt),
      ))

    await tx.insert(userInvitations).values({
      id: invitationId,
      email: d.email,
      name: workerAssociation.worker ? `${workerAssociation.worker.firstName} ${workerAssociation.worker.lastName}` : d.name || null,
      workerId: d.workerId || null,
      tokenHash: hashInvitationToken(token),
      roleIdsJson: JSON.stringify(d.roleIds),
      worksiteAssignmentsJson: JSON.stringify(d.worksiteAssignments),
      invitedByUserId: session.user.id,
      expiresAt,
      lastSentAt: now,
      sendCount: 1,
    })
  })

  let deliveryMessage = "Invitación creada"
  let pendingInviteUrl: string | undefined
  try {
    const delivery = await sendInvitationEmail({
      to: d.email,
      inviteUrl,
      invitedByName: session.user.name,
    })
    if (delivery.sent) {
      deliveryMessage = `Invitación enviada a ${d.email}`
    } else {
      deliveryMessage = `Invitación creada. SMTP no está configurado; revisa la invitación pendiente.`
      pendingInviteUrl = inviteUrl
    }
  } catch (error) {
    const reason = safeActionMessage(error, "error desconocido")
    deliveryMessage = `Invitación creada, pero no se pudo enviar el correo (${reason}).`
    pendingInviteUrl = inviteUrl
  }

  await recordAudit({
    userId: session.user.id, userEmail: session.user.email ?? undefined,
    action: "create", entityType: "user_invitation", entityId: invitationId,
    newState: { email: d.email, workerId: d.workerId || null, roles: d.roleIds, expiresAt, smtpSent: !pendingInviteUrl },
  })

  revalidatePath(REVALIDATE)
  return {
    ok: true,
    message: deliveryMessage,
    data: pendingInviteUrl ? { email: d.email, inviteUrl: pendingInviteUrl } : undefined,
  }
}
