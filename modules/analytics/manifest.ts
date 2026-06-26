import type { ModuleManifest } from "@/modules/manifest-types"

export const analyticsModule = {
  id: "analytics",
  permissions: [
    "analytics:view",
    "analytics:export",
  ] as const,

  permissionMeta: {
    "analytics:view":   { id: "p-ana-view", description: "Ver analítica transversal" },
    "analytics:export": { id: "p-ana-exp",  description: "Exportar reportes de analítica transversal" },
  },
  nav: [
    {
      areaId: "reportes",
      items: [
        {
          label:       "Analítica",
          href:        "/analitica",
          iconName:    "ChartLineUp",
          permissions: ["analytics:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",   permission: "analytics:view" },
    { roleSlug: "administrador",   permission: "analytics:export" },
    { roleSlug: "jefa_chome",      permission: "analytics:view" },
    { roleSlug: "jefa_chome",      permission: "analytics:export" },
    { roleSlug: "secretaria",      permission: "analytics:view" },
    { roleSlug: "secretaria",      permission: "analytics:export" },
    { roleSlug: "prevencionista",  permission: "analytics:view" },
    { roleSlug: "jefe_mantencion", permission: "analytics:view" },
  ],
} as const satisfies ModuleManifest
