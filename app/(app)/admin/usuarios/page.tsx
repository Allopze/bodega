import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { roles, userRoles, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { isPasswordSetupPending } from "@/lib/auth/password-setup"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { UserList } from "./user-list"

export const metadata: Metadata = { title: "Usuarios" }

export default async function UsuariosPage() {
  let session
  try { session = await requirePermission("admin:users") }
  catch { redirect("/dashboard") }

  // Load all users
  const allUsers = await db.query.users.findMany({
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

  // Load worksite assignments
  const allWsUsers = await db.query.worksiteUsers.findMany()

  // Assemble user rows
  const canManageAdmins = session.user.roles.includes("administrador")
  const userRows = allUsers.flatMap((u) => {
    const uRoles = allUserRoleRows.filter((r) => r.userId === u.id)
    if (!canManageAdmins && uRoles.some((role) => role.roleName === "administrador")) return []
    const uWs    = allWsUsers.filter((w) => w.userId === u.id)
    return [{
      id:          u.id,
      name:        u.name,
      email:       u.email,
      isActive:    u.isActive,
      passwordSetupPending: isPasswordSetupPending(u.hashedPassword),
      createdAt:   u.createdAt,
      avatarColor: u.avatarColor,
      roleIds:     uRoles.map((r) => r.roleId),
      roleLabels:  uRoles.map((r) => r.roleLabel),
      worksiteAssignments: uWs.map((w) => ({ worksiteId: w.worksiteId, isPrimary: w.isPrimary })),
      worksiteCount: uWs.length,
    }]
  })

  // Load available roles + active worksites for the form selects
  const allRolesData     = await db.query.roles.findMany({ orderBy: (r, { asc }) => [asc(r.label)] })
  const allWorksitesData = await db.query.worksites.findMany({
    where: eq(worksites.isActive, true),
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
      <UserList
        users={userRows}
        allRoles={allRolesData
          .filter((r) => canManageAdmins || r.name !== "administrador")
          .map((r) => ({ id: r.id, name: r.name, label: r.label }))}
        allWorksites={allWorksitesData.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
      />
    </PageContainer>
  )
}
