import type { ModuleManifest } from "@/core/module-kit"

export const reportsModule = {
  id: "reports",
  permissions: [
    "reports:view",
  ] as const,
  nav: [
    {
      areaId: "reportes",
      items: [
        {
          label:       "Reportes",
          href:        "/reportes",
          iconName:    "ChartBar",
          permissions: ["reports:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "reports:view" },
    { roleSlug: "jefa_chome",     permission: "reports:view" },
    { roleSlug: "secretaria",     permission: "reports:view" },
    { roleSlug: "prevencionista", permission: "reports:view" },
  ],
} as const satisfies ModuleManifest
