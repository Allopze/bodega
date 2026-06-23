import type { ModuleManifest } from "@/modules/manifest-types"

export const purchasingModule = {
  id: "purchasing",
  permissions: [
    "purchasing:view",
    "purchasing:create_order",
    "purchasing:send_order",
    "purchasing:manage_suppliers",
    "purchasing:delete_order",
  ] as const,
  nav: [
    {
      areaId: "operaciones",
      items: [
        {
          label:       "Compras",
          href:        "/compras",
          iconName:    "ShoppingCart",
          permissions: ["purchasing:view", "purchasing:create_order"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "purchasing:view" },
    { roleSlug: "administrador",  permission: "purchasing:create_order" },
    { roleSlug: "administrador",  permission: "purchasing:send_order" },
    { roleSlug: "administrador",  permission: "purchasing:manage_suppliers" },
    { roleSlug: "administrador",  permission: "purchasing:delete_order" },
    { roleSlug: "jefa_chome",     permission: "purchasing:view" },
    { roleSlug: "jefa_chome",     permission: "purchasing:delete_order" },
    { roleSlug: "secretaria",     permission: "purchasing:view" },
    { roleSlug: "secretaria",     permission: "purchasing:create_order" },
    { roleSlug: "secretaria",     permission: "purchasing:send_order" },
    { roleSlug: "secretaria",     permission: "purchasing:manage_suppliers" },
    { roleSlug: "secretaria",     permission: "purchasing:delete_order" },
    { roleSlug: "jefe_mantencion", permission: "purchasing:view" },
  ],
} as const satisfies ModuleManifest
