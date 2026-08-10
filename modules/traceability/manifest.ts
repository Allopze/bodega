import type { ModuleManifest } from "@/modules/manifest-types"

export const traceabilityModule = {
  id: "traceability",
  permissions: [
    "traceability:view",
    "traceability:reconcile_integrity",
  ] as const,

  permissionMeta: {
    "traceability:view": { id: "p-trace-view", description: "Ver trazabilidad de ítems" },
    "traceability:reconcile_integrity": { id: "p-trace-reconcile-integrity", description: "Detectar y regularizar excepciones históricas de trazabilidad" },
  },
  nav: [
    {
      areaId: "reportes",
      items: [
        {
          label:       "Trazabilidad",
          href:        "/trazabilidad",
          iconName:    "Path",
          permissions: ["traceability:view"],
          children: [
            {
              label:       "Buscar por código",
              href:        "/trazabilidad/documento",
              permissions: ["traceability:view"],
            },
          ],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",   permission: "traceability:view" },
    { roleSlug: "administrador",   permission: "traceability:reconcile_integrity" },
    { roleSlug: "jefa_chome",      permission: "traceability:view" },
    { roleSlug: "secretaria",      permission: "traceability:view" },
    { roleSlug: "prevencionista",  permission: "traceability:view" },
    { roleSlug: "jefe_mantencion", permission: "traceability:view" },
  ],
} as const satisfies ModuleManifest
