import type { ModuleManifest } from "@/core/module-kit"

export const deliveriesModule = {
  id: "deliveries",
  // Las entregas dependen de warehouse:register_movement — no hay permiso propio adicional
  permissions: [] as const,
  nav: [
    {
      section: "Bodega",
      items: [
        {
          label:       "Entregas",
          href:        "/entregas",
          iconName:    "User",
          permissions: ["warehouse:register_movement"],
        },
      ],
    },
  ],
  defaultGrants: [],
} as const satisfies ModuleManifest
