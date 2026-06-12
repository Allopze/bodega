import type { ModuleManifest } from "@/core/module-kit"

export const purchasingModule = {
  id: "purchasing",
  permissions: [
    "purchasing:view",
    "purchasing:create_order",
    "purchasing:send_order",
    "purchasing:manage_suppliers",
  ] as const,
  nav: [
    {
      section: "Operaciones",
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
    { roleSlug: "jefa_chome",     permission: "purchasing:view" },
    { roleSlug: "jefa_chome",     permission: "purchasing:create_order" },
    { roleSlug: "jefa_chome",     permission: "purchasing:send_order" },
    { roleSlug: "jefa_chome",     permission: "purchasing:manage_suppliers" },
    { roleSlug: "secretaria",     permission: "purchasing:view" },
    { roleSlug: "secretaria",     permission: "purchasing:create_order" },
    { roleSlug: "secretaria",     permission: "purchasing:send_order" },
  ],
} as const satisfies ModuleManifest
