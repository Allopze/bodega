import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles, users, workers, worksites, worksiteUsers } from "@/db/schema"
import { and, eq, inArray, sql } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { visibleUserIdsForAdminScope } from "@/lib/auth/admin-user-scope"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { UserList } from "./user-list"

export const metadata: Metadata = { title: "Usuarios" }

export default async function UsuariosPage() {
  let session
  try { session = await requirePermission("admin:users") }
  catch { redirect("/dashboard") }

  const visibleUserIds = await visibleUserIdsForAdminScope(db, session)
  const userScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(users.id, visibleUserIds)
      : sql`1 = 0`
  const userRolesScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(userRoles.userId, visibleUserIds)
      : sql`1 = 0`
  const userPermissionsScope = visibleUserIds === undefined
    ? undefined
    : visibleUserIds.length > 0
      ? inArray(userPermissions.userId, visibleUserIds)
      : sql`1 = 0`
  const worksiteUsersScope = visibleUserIds === undefined
    ? worksiteScopeSql(session, worksiteUsers.worksiteId)
    : visibleUserIds.length > 0
      ? and(inArray(worksiteUsers.userId, visibleUserIds), worksiteScopeSql(session, worksiteUsers.worksiteId))
      : sql`1 = 0`

  // Load all users
  const allUsers = await db.query.users.findMany({
    where: userScope,
    orderBy: (u, { asc }) => [asc(u.name)],
  })

  // Load role assignments for all users in one query
  const allUserRoleRows = await db
    .select({
      userId:    userRoles.userId,
      roleId:    userRoles.roleId,
      roleName:  roles.name,
      roleLabel: roles.label,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(userRolesScope)

  const allUserPermissionRows = await db
    .select({
      userId: userPermissions.userId,
      permissionId: userPermissions.permissionId,
      permissionModule: permissions.module,
    })
    .from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(userPermissionsScope)

  const allRolePermissionRows = await db
    .select({
      roleId: rolePermissions.roleId,
      permissionId: rolePermissions.permissionId,
    })
    .from(rolePermissions)

  // Load worksite assignments
  const allWsUsers = await db.query.worksiteUsers.findMany({
    where: worksiteUsersScope,
  })

  // Assemble user rows
  const canManageAdmins = session.user.roles.includes("administrador")
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
      workerId:    u.workerId,
      passwordSetupPending: isPasswordSetupPending(u.hashedPassword),
      createdAt:   u.createdAt,
      avatarColor: u.avatarColor,
      roleIds:     uRoles.map((r) => r.roleId),
      roleLabels:  uRoles.map((r) => r.roleLabel),
      permissionIds: uPermissions.map((p) => p.permissionId),
      worksiteAssignments: uWs.map((w) => ({ worksiteId: w.worksiteId, isPrimary: w.isPrimary })),
      worksiteCount: uWs.length,
    }]
  })

  // Load available roles + active worksites for the form selects
  const allRolesData     = await db.query.roles.findMany({ orderBy: (r, { asc }) => [asc(r.label)] })
  const allPermissionsData = await db.query.permissions.findMany({
    orderBy: (p, { asc }) => [asc(p.module), asc(p.name)],
  })
  const allWorksitesData = await db.query.worksites.findMany({
    where: and(eq(worksites.isActive, true), worksiteScopeSql(session, worksites.id)),
    orderBy: (w, { asc }) => [asc(w.name)],
  })
  const allWorkersData = await db.query.workers.findMany({
    where: eq(workers.isActive, true),
    orderBy: (w, { asc }) => [asc(w.firstName), asc(w.lastName)],
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
      />
      <UserList
        users={userRows}
        allRoles={allRolesData
          .filter((r) => canManageAdmins || r.name !== "administrador")
          .map((r) => ({ id: r.id, name: r.name, label: r.label }))}
        allPermissions={allPermissionsData
          .filter((p) => canManageAdmins || p.module !== "admin")
          .map((p) => ({
            id: p.id,
            name: p.name,
            module: p.module,
            description: p.description,
            roleIds: allRolePermissionRows
              .filter((rp) => rp.permissionId === p.id)
              .map((rp) => rp.roleId),
          }))}
        allWorksites={allWorksitesData.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
        allWorkers={allWorkersData.map((w) => ({ id: w.id, firstName: w.firstName, lastName: w.lastName, rut: w.rut, worksiteId: w.worksiteId }))}
      />
    </PageContainer>
  )
}
