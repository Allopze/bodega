import type { ModuleManifest } from "@/modules/manifest-types"

export const mantencionesModule = {
  id: "mantenciones",
  permissions: [
    "mantenciones:view",
    "mantenciones:create",
  ] as const,

  permissionMeta: {
    "mantenciones:view": { id: "p-mant-view", description: "Ver mantenciones de vehículos" },
    "mantenciones:create": { id: "p-mant-create", description: "Registrar mantenciones de vehículos" },
  },

  nav: [
    {
      areaId: "vehiculos",
      items: [
        {
          label:    "Mantenciones",
          href:     "/mantenciones",
          iconName: "Wrench",
          permissions: ["mantenciones:view"],
        },
      ],
    },
  ],

  defaultGrants: [
    { roleSlug: "administrador", permission: "mantenciones:view" },
    { roleSlug: "administrador", permission: "mantenciones:create" },
    { roleSlug: "jefa_chome", permission: "mantenciones:view" },
    { roleSlug: "jefa_chome", permission: "mantenciones:create" },
  ],
} as const satisfies ModuleManifest
