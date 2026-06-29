import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import { permissions, rolePermissions, roles, userPermissions, userRoles, users, worksites, worksiteUsers } from "@/db/schema"
import { and, eq, ilike, inArray, or, sql, count } from "drizzle-orm"
import { requirePermission, can } from "@/lib/auth/can"
import { visibleUserIdsForAdminScope } from "@/lib/auth/admin-user-scope"
import { worksiteScopeSql } from "@/lib/auth/scope"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { UserList } from "./user-list"
import { resolvePagination } from "@/lib/pagination"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 25

export const metadata: Metadata = { title: "Usuarios" }

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  let session
  try { session = await requirePermission("admin:users") }
  catch { redirect("/forbidden") }

  const sp = await searchParams
  const q = typeof sp.q === "string" ? sp.q : ""

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

  const searchCondition = q
    ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`))
    : undefined

  // Count total for pagination
  const [totalRow] = await db
    .select({ n: count() })
    .from(users)
    .where(and(userScope, searchCondition))
  const totalItems = totalRow?.n ?? 0
  const pagination = resolvePagination({ pageParam: sp.page, totalItems, pageSize: PAGE_SIZE })

  // Load users with pagination
  const allUsers = await db.query.users.findMany({
    where: and(userScope, searchCondition),
    orderBy: (u, { asc }) => [asc(u.name)],
    limit: pagination.limit,
    offset: pagination.offset,
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
  const canManageAdmins = can(session, "admin:manage_admins")
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
      <form className="mb-4">
        <div className="flex gap-2">
          <Input name="q" placeholder="Buscar por nombre o email..." defaultValue={q} className="max-w-sm h-9" />
          <Button type="submit" variant="secondary" size="sm" className="h-9 px-3">Buscar</Button>

          {q && (
            <Button asChild variant="ghost" size="sm" className="h-9">
              <Link href="/admin/usuarios">Limpiar</Link>
            </Button>
          )}
        </div>
      </form>

      {pagination.totalItems > PAGE_SIZE && (
        <div className="mb-4 flex items-center justify-between text-sm text-[var(--color-text-subtle)]">
          <span>{pagination.totalItems} usuarios</span>
          <div className="flex gap-1">
            {pagination.page > 1 && (
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                <Link href={`/admin/usuarios?page=${pagination.page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Anterior</Link>
              </Button>
            )}
            <span className="flex h-7 items-center px-2">
              Pág. {pagination.page} de {pagination.totalPages}
            </span>
            {pagination.page < pagination.totalPages && (
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                <Link href={`/admin/usuarios?page=${pagination.page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>Siguiente</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <UserList
        users={userRows}
        pagination={{ page: pagination.page, totalPages: pagination.totalPages, totalItems }}
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
      />
    </PageContainer>
  )
}
