import type { DB } from "@/db"

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
  nav?: NavSection[]
  seed?: (db: DB) => Promise<void>
  defaultGrants?: RolePermissionGrant[]
}
