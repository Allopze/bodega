import type { ModuleManifest } from "@/modules/manifest-types"

export const mantencionesModule = {
  id: "mantenciones",
  permissions: [
    "mantenciones:view",
  ] as const,

  permissionMeta: {
    "mantenciones:view": { id: "p-mant-view", description: "Ver mantenciones de vehículos" },
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
  ],
} as const satisfies ModuleManifest
