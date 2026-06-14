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

export type { Permission } from "@/modules/permissions"

/** All role slugs */
export type RoleSlug =
  | "administrador"
  | "jefa_chome"
  | "secretaria"
  | "prevencionista"
  | "solicitante_faena"
