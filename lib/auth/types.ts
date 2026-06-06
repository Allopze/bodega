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
  | "approvals:approve_faena"
  | "approvals:approve_prevencion"
  | "approvals:approve_admin"
  // Purchasing
  | "purchasing:view"
  | "purchasing:create_order"
  | "purchasing:send_order"
  | "purchasing:manage_suppliers"
  // Receiving
  | "receiving:register"
  | "receiving:view"
  // Delivery
  | "delivery:register"
  | "delivery:view"
  // Warehouse
  | "warehouse:view_stock"
  | "warehouse:register_movement"
  | "warehouse:adjust_stock"
  // Invoicing
  | "invoicing:register"
  | "invoicing:reconcile"
  | "invoicing:view"
  // Reports
  | "reports:view_operational"
  | "reports:view_management"
  | "reports:export"
  // Admin
  | "admin:users"
  | "admin:worksites"
  | "admin:products"
  | "admin:suppliers"
  | "admin:config"
  | "admin:audit_log"

/** All role slugs */
export type RoleSlug =
  | "administrador"
  | "solicitante"
  | "jefe_faena"
  | "prevencion"
  | "compras"
  | "recepcion"
  | "finanzas"
  | "gerencia"
