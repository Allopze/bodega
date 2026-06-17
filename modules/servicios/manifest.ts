import type { ModuleManifest } from "@/modules/manifest-types"

export const serviciosModule = {
  id: "servicios",
  permissions: [
    "servicios:create",
    "servicios:view_own",
    "servicios:view_all",
    "servicios:submit",
    "servicios:approve",
  ] as const,
  nav: [],
  defaultGrants: [
    // Administrador: acceso total
    { roleSlug: "administrador", permission: "servicios:create" },
    { roleSlug: "administrador", permission: "servicios:view_own" },
    { roleSlug: "administrador", permission: "servicios:view_all" },
    { roleSlug: "administrador", permission: "servicios:submit" },
    { roleSlug: "administrador", permission: "servicios:approve" },
    // Jefatura: aprueba cotizaciones + ve todo
    { roleSlug: "jefa_chome", permission: "servicios:view_all" },
    { roleSlug: "jefa_chome", permission: "servicios:approve" },
    // Secretaría: crea, envía y ve todo (genera OC via compras existente)
    { roleSlug: "secretaria", permission: "servicios:create" },
    { roleSlug: "secretaria", permission: "servicios:view_own" },
    { roleSlug: "secretaria", permission: "servicios:view_all" },
    { roleSlug: "secretaria", permission: "servicios:submit" },
    { roleSlug: "secretaria", permission: "servicios:approve" },
    // Prevencionista oficina: crea y envía para sus faenas
    { roleSlug: "prevencionista", permission: "servicios:create" },
    { roleSlug: "prevencionista", permission: "servicios:view_own" },
    { roleSlug: "prevencionista", permission: "servicios:view_all" },
    { roleSlug: "prevencionista", permission: "servicios:submit" },
    // Faena: crea y ve sus propias solicitudes
    { roleSlug: "solicitante_faena", permission: "servicios:create" },
    { roleSlug: "solicitante_faena", permission: "servicios:view_own" },
    { roleSlug: "solicitante_faena", permission: "servicios:submit" },
  ],
} as const satisfies ModuleManifest
