import type { ModuleManifest } from "@/modules/manifest-types"

export const deliveriesModule = {
  id: "deliveries",
  // Las entregas dependen de warehouse:register_movement — no hay permiso propio adicional
  permissions: [] as const,
  nav: [
    {
      areaId: "bodega",
      items: [
        {
          label:       "Entregas",
          href:        "/entregas",
          iconName:    "HardHat",
          permissions: ["warehouse:register_movement"],
        },
      ],
    },
  ],
  defaultGrants: [],
} as const satisfies ModuleManifest
