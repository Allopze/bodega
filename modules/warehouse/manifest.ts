import type { ModuleManifest } from "@/core/module-kit"

export const warehouseModule = {
  id: "warehouse",
  permissions: [
    "warehouse:view_stock",
    "warehouse:register_movement",
    "warehouse:adjust_stock",
  ] as const,
  nav: [
    {
      section: "Bodega",
      items: [
        {
          label:       "Bodega",
          href:        "/bodega",
          iconName:    "Warehouse",
          permissions: ["warehouse:view_stock"],
          badge:       "count" as const,
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "warehouse:view_stock" },
    { roleSlug: "administrador",  permission: "warehouse:register_movement" },
    { roleSlug: "administrador",  permission: "warehouse:adjust_stock" },
    { roleSlug: "jefa_chome",     permission: "warehouse:view_stock" },
    { roleSlug: "jefa_chome",     permission: "warehouse:register_movement" },
    { roleSlug: "jefa_chome",     permission: "warehouse:adjust_stock" },
    { roleSlug: "secretaria",     permission: "warehouse:view_stock" },
    { roleSlug: "secretaria",     permission: "warehouse:register_movement" },
    { roleSlug: "prevencionista", permission: "warehouse:view_stock" },
  ],
} as const satisfies ModuleManifest
