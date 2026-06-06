import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { roles, userRoles, worksites } from "@/db/schema"
import { eq } from "drizzle-orm"
import { requirePermission } from "@/lib/auth/can"
import { PageHeader, Breadcrumbs } from "@/components/ui/page-header"
import { UserList } from "./user-list"

export const metadata: Metadata = { title: "Usuarios" }

export default async function UsuariosPage() {
  try { await requirePermission("admin:users") }
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
      roleLabel: roles.label,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))

  // Load worksite assignments
  const allWsUsers = await db.query.worksiteUsers.findMany()

  // Assemble user rows
  const userRows = allUsers.map((u) => {
    const uRoles = allUserRoleRows.filter((r) => r.userId === u.id)
    const uWs    = allWsUsers.filter((w) => w.userId === u.id)
    return {
      id:          u.id,
      name:        u.name,
      email:       u.email,
      isActive:    u.isActive,
      createdAt:   u.createdAt,
      avatarColor: u.avatarColor,
      roleIds:     uRoles.map((r) => r.roleId),
      roleLabels:  uRoles.map((r) => r.roleLabel),
      worksiteAssignments: uWs.map((w) => ({ worksiteId: w.worksiteId, isPrimary: w.isPrimary })),
      worksiteCount: uWs.length,
    }
  })

  // Load available roles + active worksites for the form selects
  const allRolesData     = await db.query.roles.findMany({ orderBy: (r, { asc }) => [asc(r.label)] })
  const allWorksitesData = await db.query.worksites.findMany({
    where: eq(worksites.isActive, true),
    orderBy: (w, { asc }) => [asc(w.name)],
  })

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Gestión de usuarios del sistema, roles y acceso a faenas."
        breadcrumb={
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Administración" },
            { label: "Usuarios" },
          ]} />
        }
      />
      <UserList
        users={userRows}
        allRoles={allRolesData.map((r) => ({ id: r.id, name: r.name, label: r.label }))}
        allWorksites={allWorksitesData.map((w) => ({ id: w.id, name: w.name, code: w.code }))}
      />
    </>
  )
}
