import type { ModuleManifest } from "@/modules/manifest-types"

export const requestsModule = {
  id: "requests",
  permissions: [
    "requests:create",
    "requests:view_own",
    "requests:view_all",
    "requests:submit",
    "requests:delete",
  ] as const,
  nav: [
    {
      areaId: "operaciones",
      items: [
        {
          label:       "Solicitudes",
          href:        "/solicitudes",
          iconName:    "ClipboardText",
          permissions: ["requests:view_own", "requests:view_all"],
          badge:       "count" as const,
        },
      ],
    },
  ],
  defaultGrants: [
    // Todas las roles salvo faena pueden ver todas las solicitudes
    { roleSlug: "administrador",   permission: "requests:create" },
    { roleSlug: "administrador",   permission: "requests:view_own" },
    { roleSlug: "administrador",   permission: "requests:view_all" },
    { roleSlug: "administrador",   permission: "requests:submit" },
    { roleSlug: "administrador",   permission: "requests:delete" },
    { roleSlug: "jefa_chome",      permission: "requests:view_all" },
    { roleSlug: "jefa_chome",      permission: "requests:delete" },
    { roleSlug: "secretaria",      permission: "requests:create" },
    { roleSlug: "secretaria",      permission: "requests:view_own" },
    { roleSlug: "secretaria",      permission: "requests:view_all" },
    { roleSlug: "secretaria",      permission: "requests:submit" },
    { roleSlug: "secretaria",      permission: "requests:delete" },
    { roleSlug: "prevencionista",  permission: "requests:create" },
    { roleSlug: "prevencionista",  permission: "requests:view_own" },
    { roleSlug: "prevencionista",  permission: "requests:view_all" },
    { roleSlug: "prevencionista",  permission: "requests:submit" },
    // Faena: solo crea y ve las propias
    { roleSlug: "solicitante_faena", permission: "requests:create" },
    { roleSlug: "solicitante_faena", permission: "requests:view_own" },
    { roleSlug: "solicitante_faena", permission: "requests:submit" },
    // Prevencionista faena: crea y ve las propias
    { roleSlug: "prevencionista_faena", permission: "requests:create" },
    { roleSlug: "prevencionista_faena", permission: "requests:view_own" },
    { roleSlug: "prevencionista_faena", permission: "requests:submit" },
    // Jefe de mantención: crea, ve propias y envía (sin view_all)
    { roleSlug: "jefe_mantencion", permission: "requests:create" },
    { roleSlug: "jefe_mantencion", permission: "requests:view_own" },
    { roleSlug: "jefe_mantencion", permission: "requests:submit" },
  ],
} as const satisfies ModuleManifest
