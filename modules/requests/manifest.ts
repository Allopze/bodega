import type { ModuleManifest } from "@/core/module-kit"

export const requestsModule = {
  id: "requests",
  permissions: [
    "requests:create",
    "requests:view_own",
    "requests:view_all",
    "requests:submit",
  ] as const,
  nav: [
    {
      section: "Operaciones",
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
    { roleSlug: "jefa_chome",      permission: "requests:create" },
    { roleSlug: "jefa_chome",      permission: "requests:view_own" },
    { roleSlug: "jefa_chome",      permission: "requests:view_all" },
    { roleSlug: "jefa_chome",      permission: "requests:submit" },
    { roleSlug: "secretaria",      permission: "requests:create" },
    { roleSlug: "secretaria",      permission: "requests:view_own" },
    { roleSlug: "secretaria",      permission: "requests:view_all" },
    { roleSlug: "secretaria",      permission: "requests:submit" },
    { roleSlug: "prevencionista",  permission: "requests:create" },
    { roleSlug: "prevencionista",  permission: "requests:view_own" },
    { roleSlug: "prevencionista",  permission: "requests:view_all" },
    { roleSlug: "prevencionista",  permission: "requests:submit" },
    // Faena: solo crea y ve las propias
    { roleSlug: "solicitante_faena", permission: "requests:create" },
    { roleSlug: "solicitante_faena", permission: "requests:view_own" },
    { roleSlug: "solicitante_faena", permission: "requests:submit" },
  ],
} as const satisfies ModuleManifest
