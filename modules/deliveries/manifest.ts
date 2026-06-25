import type { ModuleManifest } from "@/modules/manifest-types"

export const deliveriesModule = {
  id: "deliveries",
  permissions: [
    "deliveries:view",
    "deliveries:create",
  ] as const,

  permissionMeta: {
    "deliveries:view":   { id: "p-del-view",   description: "Ver historial de entregas" },
    "deliveries:create": { id: "p-del-create", description: "Registrar entregas a trabajadores" },
  },
  nav: [
    {
      areaId: "bodega",
      items: [
        {
          label:       "Entregas",
          href:        "/entregas",
          iconName:    "HardHat",
          permissions: ["deliveries:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",       permission: "deliveries:view" },
    { roleSlug: "administrador",       permission: "deliveries:create" },
    { roleSlug: "jefa_chome",          permission: "deliveries:view" },
    { roleSlug: "secretaria",          permission: "deliveries:view" },
    { roleSlug: "secretaria",          permission: "deliveries:create" },
    { roleSlug: "prevencionista",      permission: "deliveries:view" },
    { roleSlug: "prevencionista",      permission: "deliveries:create" },
    { roleSlug: "solicitante_faena",   permission: "deliveries:view" },
    { roleSlug: "prevencionista_faena", permission: "deliveries:view" },
    { roleSlug: "prevencionista_faena", permission: "deliveries:create" },
  ],
} as const satisfies ModuleManifest
