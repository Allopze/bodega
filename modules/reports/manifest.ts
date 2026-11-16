import type { ModuleManifest } from "@/modules/manifest-types"

export const reportsModule = {
  id: "reports",
  permissions: [
    "reports:view",
    "reports:export",
  ] as const,

  permissionMeta: {
    "reports:view": { id: "p-rep-view", description: "Ver reportes y matriz de trazabilidad" },
    // Decisión 2026-11-16: el Excel de «Ver datos» de /reportes es opt-in y no se copia de `reports:view`.
    "reports:export": { id: "p-rep-export", description: "Exportar a Excel los datos de los gráficos de Reportes" },
  },
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
    { roleSlug: "administrador",  permission: "reports:export" },
    { roleSlug: "jefa_chome",     permission: "reports:export" },
  ],
} as const satisfies ModuleManifest
