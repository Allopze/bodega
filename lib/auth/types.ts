import type { DefaultSession } from "next-auth"

// Augment next-auth session types with our custom RBAC fields
declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id:                string
      roles:             string[]
      permissions:       string[]
      worksiteIds:       string[]
      primaryWorksiteId: string | null
      avatarColor:       string | null
      isActive:          boolean
    }
  }
}

/** All permission keys in the system */
export type Permission =
  // Requests
  | "requests:create"
  | "requests:view_own"
  | "requests:view_all"
  | "requests:submit"
  // Approvals
  | "approvals:approve"
  // Purchasing
  | "purchasing:view"
  | "purchasing:create_order"
  | "purchasing:send_order"
  | "purchasing:manage_suppliers"
  // Receiving
  | "receiving:register_office"
  | "receiving:register_faena"
  | "receiving:view"
  // Warehouse
  | "warehouse:view_stock"
  | "warehouse:register_movement"
  | "warehouse:adjust_stock"
  // Reports
  | "reports:view"
  // Admin
  | "admin:users"
  | "admin:worksites"
  | "admin:workers"
  | "admin:products"
  | "admin:suppliers"
  | "admin:config"
  | "admin:audit_log"

/** All role slugs */
export type RoleSlug =
  | "administrador"
  | "jefa_chome"
  | "secretaria"
  | "prevencionista"
  | "solicitante_faena"
