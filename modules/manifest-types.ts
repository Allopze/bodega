import type { DB } from "@/db"

/** Metadata for a single permission — id is the short DB key, description is human-readable. */
export interface PermissionMeta {
  id:          string
  description: string
}

export interface NavChild {
  label: string
  href: string
  permissions?: string[]
  roles?: string[]
}

export interface NavItem {
  label: string
  href: string
  iconName: string
  permissions?: string[]
  roles?: string[]
  badge?: "count"
  children?: NavChild[]
}

export interface NavSection {
  areaId: string
  items: NavItem[]
}

export interface RolePermissionGrant {
  roleSlug: string
  permission: string
}

export interface ModuleManifest {
  id: string
  permissions: readonly string[]
  /** Maps each permission name (e.g. "combustibles:view") to its DB id and description. */
  permissionMeta?: Record<string, PermissionMeta>
  nav?: NavSection[]
  seed?: (db: DB) => Promise<void>
  defaultGrants?: RolePermissionGrant[]
}
