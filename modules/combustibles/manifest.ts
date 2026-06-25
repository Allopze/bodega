import type { ModuleManifest } from "@/modules/manifest-types"

export const combustiblesModule = {
  id: "combustibles",
  permissions: [
    "combustibles:view",
    "combustibles:create",
    "combustibles:delete",
    "combustibles:import",
    "combustibles:export",
    "combustibles:manage_vehicles",
    "combustibles:manage_suppliers",
  ] as const,
  nav: [
    {
      areaId: "operaciones",
      items: [
        {
          label: "Combustibles",
          href: "/combustibles",
          iconName: "GasPump",
          permissions: ["combustibles:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "combustibles:view" },
    { roleSlug: "administrador",  permission: "combustibles:create" },
    { roleSlug: "administrador",  permission: "combustibles:delete" },
    { roleSlug: "administrador",  permission: "combustibles:import" },
    { roleSlug: "administrador",  permission: "combustibles:export" },
    { roleSlug: "administrador",  permission: "combustibles:manage_vehicles" },
    { roleSlug: "administrador",  permission: "combustibles:manage_suppliers" },
    { roleSlug: "jefa_chome",     permission: "combustibles:view" },
    { roleSlug: "jefa_chome",     permission: "combustibles:create" },
    { roleSlug: "jefa_chome",     permission: "combustibles:import" },
    { roleSlug: "jefa_chome",     permission: "combustibles:export" },
  ],
} as const satisfies ModuleManifest
