import type { ModuleManifest } from "@/modules/manifest-types"

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
    { roleSlug: "prevencionista_faena", permission: "reports:view" },
    { roleSlug: "jefe_mantencion", permission: "reports:view" },
  ],
} as const satisfies ModuleManifest
