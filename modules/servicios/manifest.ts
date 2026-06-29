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

  permissionMeta: {
    "servicios:create":    { id: "p-srv-create",  description: "Crear solicitudes de servicios" },
    "servicios:view_own":  { id: "p-srv-own",     description: "Ver solicitudes de servicios propias" },
    "servicios:view_all":  { id: "p-srv-all",     description: "Ver todas las solicitudes de servicios" },
    "servicios:submit":    { id: "p-srv-submit",  description: "Enviar solicitudes de servicios a aprobación" },
    "servicios:approve":   { id: "p-srv-approve", description: "Aprobar cotizaciones de servicios" },
  },
  // Servicios no longer has its own page; it is created and managed inside the
  // unified Solicitudes flow (/solicitudes). No standalone nav entry.
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
    // Jefa Dpto. Prevención de riesgos: crea y envía para sus faenas
    { roleSlug: "prevencionista", permission: "servicios:create" },
    { roleSlug: "prevencionista", permission: "servicios:view_own" },
    { roleSlug: "prevencionista", permission: "servicios:view_all" },
    { roleSlug: "prevencionista", permission: "servicios:submit" },
    // Faena: crea y ve sus propias solicitudes
    { roleSlug: "solicitante_faena", permission: "servicios:create" },
    { roleSlug: "solicitante_faena", permission: "servicios:view_own" },
    { roleSlug: "solicitante_faena", permission: "servicios:submit" },
    // Prevencionista faena: crea y ve sus propias solicitudes
    { roleSlug: "prevencionista_faena", permission: "servicios:create" },
    { roleSlug: "prevencionista_faena", permission: "servicios:view_own" },
    { roleSlug: "prevencionista_faena", permission: "servicios:submit" },
  ],
} as const satisfies ModuleManifest
