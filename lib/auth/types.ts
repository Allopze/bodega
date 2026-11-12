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
      isGlobal?:         boolean  // Derived from roles.is_global at login; optional for backward compat
      /** Instante (ms) en que empezó esta sesión (AUTH-003). Lo usa la emisión de credenciales de la app del mecánico. */
      sessionIssuedAt?:  number
    }
  }
}

export type { Permission } from "@/modules/permissions"

/** All role slugs */
export type RoleSlug =
  | "administrador"
  | "jefa_chome"
  | "secretaria"
  | "prevencionista"
  | "solicitante_faena"
  | "prevencionista_faena"
  | "jefe_mantencion"
  | "conductor_lider"
  | "admin_contrato"
  | "jefe_terreno"
  | "cphs"
  | "mecanico"
  | "supervisor_mantencion"
