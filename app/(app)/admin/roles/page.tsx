import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { rolePermissions } from "@/db/schema"
import { requirePermission } from "@/lib/auth/can"
import { listRolesWithPermissions, PROTECTED_ROLE_SLUGS } from "@/lib/services/admin-roles"
import { PageHeader } from "@/components/ui/page-header"
import { PageContainer } from "@/components/ui/page-container"
import { RoleList } from "./role-list"

export const metadata: Metadata = { title: "Roles" }

function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K): Array<{ module: K; permissions: T[] }> {
  return items.reduce<Array<{ module: K; permissions: T[] }>>((groups, item) => {
    const key = keyFn(item)
    const group = groups.find((g) => g.module === key)
    if (group) group.permissions.push(item)
    else groups.push({ module: key, permissions: [item] })
    return groups
  }, [])
}

export default async function RolesPage() {
  try {
    await requirePermission("admin:roles")
  } catch {
    redirect("/forbidden")
  }

  const [rolesData, perms, grants] = await Promise.all([
    listRolesWithPermissions(),
    db.query.permissions.findMany({ orderBy: (p, { asc }) => [asc(p.module), asc(p.name)] }),
    db.select().from(rolePermissions),
  ])

  const grouped = groupBy(perms, (p) => p.module).map((g) => ({
    module: g.module,
    permissions: g.permissions.map((p) => ({
      id: p.id,
      name: p.name,
      module: p.module,
      description: p.description ?? p.name,
    })),
  }))

  const rolesForView = rolesData.map((r) => {
    const count = grants.filter((g) => g.roleId === r.id).length
    return {
      id: r.id,
      name: r.name,
      label: r.label,
      description: r.description ?? "",
      isGlobal: r.isGlobal,
      isProtected: PROTECTED_ROLE_SLUGS.has(r.name),
      permissionCount: count,
      permissionIds: r.permissionIds,
    }
  })

  const permissionsForForm = perms.map((p) => ({
    id: p.id,
    name: p.name,
    module: p.module,
    description: p.description ?? p.name,
  }))

  return (
    <PageContainer>
      <PageHeader
        title="Roles"
        description="Gestiona roles base, su alcance y los permisos incluidos por cada rol."
        breadcrumb={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Administración", href: "/admin" },
          { label: "Roles" },
        ]}
      />
      <RoleList
        roles={rolesForView}
        groupedPermissions={grouped}
        permissions={permissionsForForm}
      />
    </PageContainer>
  )
}
