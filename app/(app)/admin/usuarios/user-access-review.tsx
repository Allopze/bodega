"use client"

import type { Permission, Role, Worksite } from "./user-form.helpers"

interface UserAccessReviewProps {
  roles: Role[]
  worksites: Worksite[]
  permissions: Permission[]
  selectedRoleIds: string[]
  selectedWorksiteIds: string[]
  primaryWorksiteId: string
  selectedPermissionIds: string[]
  issue?: string
}

function selectedLabels<T extends { id: string; label?: string; name: string }>(items: T[], ids: string[]) {
  return items.filter((item) => ids.includes(item.id)).map((item) => item.label ?? item.name)
}

export function UserAccessReview({
  roles,
  worksites,
  permissions,
  selectedRoleIds,
  selectedWorksiteIds,
  primaryWorksiteId,
  selectedPermissionIds,
  issue,
}: UserAccessReviewProps) {
  const roleLabels = selectedLabels(roles, selectedRoleIds)
  const worksiteLabels = selectedLabels(worksites, selectedWorksiteIds)
  const primaryWorksite = worksites.find((worksite) => worksite.id === primaryWorksiteId)
  const inheritedPermissions = permissions.filter((permission) => permission.roleIds.some((roleId) => selectedRoleIds.includes(roleId)))
  const directPermissionLabels = permissions
    .filter((permission) => selectedPermissionIds.includes(permission.id))
    .map((permission) => permission.description ?? "Permiso adicional")

  return (
    <section className="mt-5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4" aria-labelledby="user-access-review-title">
      <h3 id="user-access-review-title" className="text-eyebrow mb-3">3. Revisión del acceso</h3>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Roles</dt>
          <dd className="mt-0.5 font-medium text-[var(--color-text)]">{roleLabels.join(", ") || "Aún no seleccionas un rol."}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Alcance por faena</dt>
          <dd className="mt-0.5 text-[var(--color-text)]">
            {worksiteLabels.length > 0
              ? `${worksiteLabels.join(", ")}${primaryWorksite ? `. Principal: ${primaryWorksite.name}.` : ""}`
              : "Sin faena asignada."}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-subtle)]">Permisos</dt>
          <dd className="mt-0.5 text-[var(--color-text)]">
            {`${inheritedPermissions.length} ${inheritedPermissions.length === 1 ? "permiso por rol" : "permisos por rol"}.`}
            {directPermissionLabels.length > 0
              ? ` Excepciones: ${directPermissionLabels.join(", ")}.`
              : " Sin excepciones directas."}
          </dd>
        </div>
      </dl>
      {issue && <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-danger)]">{issue}</p>}
    </section>
  )
}
