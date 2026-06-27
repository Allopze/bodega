import type { ModuleManifest } from "@/modules/manifest-types"

export const flotaModule = {
  id: "flota",
  permissions: [
    "flota:view",
  ] as const,

  permissionMeta: {
    "flota:view": { id: "p-flot-view", description: "Ver flota de vehículos" },
  },

  nav: [
    {
      areaId: "vehiculos",
      items: [
        {
          label:    "Flota",
          href:     "/flota",
          iconName: "Truck",
          permissions: ["flota:view"],
        },
      ],
    },
  ],

  defaultGrants: [
    { roleSlug: "administrador", permission: "flota:view" },
    { roleSlug: "jefe_mantencion", permission: "flota:view" },
    { roleSlug: "jefa_chome", permission: "flota:view" },
  ],
} as const satisfies ModuleManifest
