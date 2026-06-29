import type { ModuleManifest } from "@/modules/manifest-types"

export const repuestosModule = {
  id: "repuestos",
  permissions: [
    "repuestos:create",
    "repuestos:view_own",
    "repuestos:view_all",
    "repuestos:submit",
    "repuestos:approve",
  ] as const,

  permissionMeta: {
    "repuestos:create":    { id: "p-rep-create",  description: "Crear solicitudes de repuestos" },
    "repuestos:view_own":  { id: "p-rep-own",     description: "Ver solicitudes de repuestos propias" },
    "repuestos:view_all":  { id: "p-rep-all",     description: "Ver todas las solicitudes de repuestos" },
    "repuestos:submit":    { id: "p-rep-submit",  description: "Enviar solicitudes de repuestos a aprobación" },
    "repuestos:approve":   { id: "p-rep-approve", description: "Aprobar cotizaciones de repuestos" },
  },
  nav: [
    {
      areaId: "adquisiciones",
      items: [
        {
          label:       "Repuestos",
          href:        "/repuestos",
          iconName:    "Wrench",
          permissions: ["repuestos:view_own", "repuestos:view_all"],
        },
      ],
    },
  ],
  defaultGrants: [
    // Administrador: acceso total
    { roleSlug: "administrador", permission: "repuestos:create" },
    { roleSlug: "administrador", permission: "repuestos:view_own" },
    { roleSlug: "administrador", permission: "repuestos:view_all" },
    { roleSlug: "administrador", permission: "repuestos:submit" },
    { roleSlug: "administrador", permission: "repuestos:approve" },
    // Jefatura: aprueba cotizaciones + ve todo
    { roleSlug: "jefa_chome", permission: "repuestos:view_all" },
    { roleSlug: "jefa_chome", permission: "repuestos:approve" },
    // Secretaría: crea, envía y ve todo (genera OC via compras existente)
    { roleSlug: "secretaria", permission: "repuestos:create" },
    { roleSlug: "secretaria", permission: "repuestos:view_own" },
    { roleSlug: "secretaria", permission: "repuestos:view_all" },
    { roleSlug: "secretaria", permission: "repuestos:submit" },
    // Jefa Dpto. Prevención de riesgos: crea y envía para sus faenas
    { roleSlug: "prevencionista", permission: "repuestos:create" },
    { roleSlug: "prevencionista", permission: "repuestos:view_own" },
    { roleSlug: "prevencionista", permission: "repuestos:view_all" },
    { roleSlug: "prevencionista", permission: "repuestos:submit" },
    // Faena: crea y ve sus propias solicitudes
    { roleSlug: "solicitante_faena", permission: "repuestos:create" },
    { roleSlug: "solicitante_faena", permission: "repuestos:view_own" },
    { roleSlug: "solicitante_faena", permission: "repuestos:submit" },
    // Prevencionista faena: crea y ve sus propias solicitudes
    { roleSlug: "prevencionista_faena", permission: "repuestos:create" },
    { roleSlug: "prevencionista_faena", permission: "repuestos:view_own" },
    { roleSlug: "prevencionista_faena", permission: "repuestos:submit" },
  ],
} as const satisfies ModuleManifest
