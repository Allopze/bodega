import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles, users, workers, worksites, worksiteUsers } from "@/db/schema"
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { visibleUserIdsForAdminScope } from "@/lib/auth/admin-user-scope"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { getInvitationStatus, parseInvitationJson } from "@/lib/auth/invitations"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { UserList } from "./user-list"
import { UserActions } from "./user-actions"


export const metadata: Metadata = { title: "Usuarios" }

export default async function UsuariosPage() {
  let session
  try { session = await requirePermission("admin:users") }
  catch { redirect("/forbidden") }

  const visibleUserIds = await visibleUserIdsForAdminScope(db, session)
  const userScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(users.id, visibleUserIds)
      : sql`false`
  const userRolesScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(userRoles.userId, visibleUserIds)
      : sql`false`
  const userPermissionsScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(userPermissions.userId, visibleUserIds)
      : sql`false`
  const worksiteUsersScope = visibleUserIds === undefined
    ? worksiteScopeSql(session, worksiteUsers.worksiteId)
    : visibleUserIds.length > 0
      ? and(inArray(worksiteUsers.userId, visibleUserIds), worksiteScopeSql(session, worksiteUsers.worksiteId))
      : sql`false`
  const canManageAdmins = can(session, "admin:manage_admins")

  // Todas estas lecturas dependen solo del alcance ya calculado; ejecutarlas
  // juntas evita sumar su latencia en cascada.
  const [allUsers, allUserRoleRows, allUserPermissionRows, allRolePermissionRows, allWsUsers, allRolesData, allPermissionsData, allWorksitesData, allWorkersData, invitationRowsRaw] = await Promise.all([
    db.query.users.findMany({ where: userScope, orderBy: (u, { asc }) => [asc(u.name)] }),
    db.select({ userId: userRoles.userId, roleId: userRoles.roleId, roleName: roles.name, roleLabel: roles.label }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(userRolesScope),
    db.select({ userId: userPermissions.userId, permissionId: userPermissions.permissionId, permissionModule: permissions.module }).from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id)).where(userPermissionsScope),
    db.select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId }).from(rolePermissions),
    db.query.worksiteUsers.findMany({ where: worksiteUsersScope }),
    db.query.roles.findMany({ orderBy: (r, { asc }) => [asc(r.label)] }),
    db.query.permissions.findMany({ orderBy: (p, { asc }) => [asc(p.module), asc(p.name)] }),
    db.query.worksites.findMany({ where: and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)), orderBy: (w, { asc }) => [asc(w.name)] }),
    db.select({ id: workers.id, firstName: workers.firstName, lastName: workers.lastName, rut: workers.rut, worksiteId: workers.worksiteId, worksiteName: worksites.name, linkedUserId: users.id })
      .from(workers)
      .innerJoin(worksites, eq(workers.worksiteId, worksites.id))
      .leftJoin(users, eq(users.workerId, workers.id))
      .where(and(or(eq(workers.isActive, true), isNotNull(users.id)), worksiteScopeSql(session, workers.worksiteId)))
      .orderBy(workers.firstName, workers.lastName),
    db.query.userInvitations.findMany({ orderBy: (i, { desc }) => [desc(i.createdAt)], limit: 500 }),
  ])

  const roleLabelById = new Map(allRolesData.map((role) => [role.id, role.label]))
  const worksiteById = new Map(allWorksitesData.map((worksite) => [worksite.id, worksite]))
  const visibleUserEmails = new Set(allUsers.map((user) => user.email.toLowerCase()))
  const invitationEmails = [...new Set(invitationRowsRaw.map((invitation) => invitation.email.toLowerCase()))]
  const inviterIds = [...new Set(invitationRowsRaw.map((invitation) => invitation.invitedByUserId).filter(Boolean) as string[])]
  const [usersForInvitationEmails, inviterRows] = await Promise.all([
    invitationEmails.length ? db.select({ email: users.email }).from(users).where(inArray(users.email, invitationEmails)) : Promise.resolve([]),
    inviterIds.length ? db.query.users.findMany({ where: inArray(users.id, inviterIds) }) : Promise.resolve([]),
  ])
  const existingUserEmailsForInvitations = new Set(usersForInvitationEmails.map((user) => user.email.toLowerCase()))
  const inviterNameById = new Map(inviterRows.map((user) => [user.id, user.name]))

  const roleIdsByPermission = new Map<string, string[]>()
  for (const assignment of allRolePermissionRows) {
    const roleIds = roleIdsByPermission.get(assignment.permissionId) ?? []
    roleIds.push(assignment.roleId)
    roleIdsByPermission.set(assignment.permissionId, roleIds)
  }
  const availableRoles = allRolesData.flatMap((role) => canManageAdmins || role.name !== "administrador" ? [{ id: role.id, name: role.name, label: role.label }] : [])
  const availablePermissions = allPermissionsData.flatMap((permission) => canManageAdmins || permission.module !== "admin" ? [{
    id: permission.id,
    name: permission.name,
    module: permission.module,
    description: permission.description,
    roleIds: roleIdsByPermission.get(permission.id) ?? [],
  }] : [])
  const availableWorksites = allWorksitesData.map((worksite) => ({ id: worksite.id, name: worksite.name, code: worksite.code }))
  const availableWorkers = allWorkersData.map((worker) => ({ id: worker.id, name: `${worker.firstName} ${worker.lastName}`, rut: worker.rut, worksiteId: worker.worksiteId, worksiteName: worker.worksiteName, linkedUserId: worker.linkedUserId }))

  const invitationRows = invitationRowsRaw.flatMap((invitation) => {
    const invitationEmail = invitation.email.toLowerCase()
    if (existingUserEmailsForInvitations.has(invitationEmail) && !visibleUserEmails.has(invitationEmail)) return []

    const roleIds = parseInvitationJson<string[]>(invitation.roleIdsJson, [])
    if (!canManageAdmins && roleIds.some((roleId) => allRolesData.find((role) => role.id === roleId)?.name === "administrador")) return []

    const worksiteAssignments = parseInvitationJson<{ worksiteId: string; isPrimary: boolean }[]>(invitation.worksiteAssignmentsJson, [])
    const visibleAssignments = worksiteAssignments.filter((assignment) => worksiteById.has(assignment.worksiteId))
    if (worksiteAssignments.length > 0 && visibleAssignments.length === 0) return []

    return [{
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      status: getInvitationStatus(invitation),
      roleLabels: roleIds.map((roleId) => roleLabelById.get(roleId)).filter(Boolean) as string[],
      worksiteCount: visibleAssignments.length,
      invitedByName: invitation.invitedByUserId ? inviterNameById.get(invitation.invitedByUserId) ?? null : null,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      acceptedAt: invitation.acceptedAt,
      cancelledAt: invitation.cancelledAt,
      cancelReason: invitation.cancelReason,
      lastSentAt: invitation.lastSentAt,
      sendCount: invitation.sendCount,
    }]
  }).slice(0, 100)

  // Assemble user rows
  const userRows = allUsers.flatMap((u) => {
    const uRoles = allUserRoleRows.filter((r) => r.userId === u.id)
    const uPermissions = allUserPermissionRows.filter((p) => p.userId === u.id)
    if (!canManageAdmins && uRoles.some((role) => role.roleName === "administrador")) return []
    if (!canManageAdmins && uPermissions.some((permission) => permission.permissionModule === "admin")) return []
    const uWs    = allWsUsers.filter((w) => w.userId === u.id)
    return [{
      id:          u.id,
      name:        u.name,
      email:       u.email,
      isActive:    u.isActive,
      emailNotifications: u.emailNotifications,
      passwordSetupPending: isPasswordSetupPending(u.hashedPassword),
      createdAt:   u.createdAt,
      avatarColor: u.avatarColor,
      roleIds:     uRoles.map((r) => r.roleId),
      roleLabels:  uRoles.map((r) => r.roleLabel),
      permissionIds: uPermissions.map((p) => p.permissionId),
      workerId: u.workerId,
      worksiteAssignments: uWs.map((w) => ({ worksiteId: w.worksiteId, isPrimary: w.isPrimary })),
      worksiteCount: uWs.length,
    }]
  })

  return (
    <PageContainer>
      <PageHeader
        title="Usuarios"
        description="Gestión de usuarios del sistema, roles y acceso a faenas."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración", href: "/admin" },
            { label: "Usuarios" },
          ]} />
        }
        actions={
          <UserActions
            allRoles={availableRoles}
            allPermissions={availablePermissions}
            allWorksites={availableWorksites}
            allWorkers={availableWorkers}
          />
        }
      />
      <UserList
        users={userRows}
        invitations={invitationRows}
        allRoles={availableRoles}
        allPermissions={availablePermissions}
        allWorksites={availableWorksites}
        allWorkers={availableWorkers}
      />
    </PageContainer>
  )
}
