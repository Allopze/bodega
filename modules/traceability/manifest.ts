import type { ModuleManifest } from "@/modules/manifest-types"

export const traceabilityModule = {
  id: "traceability",
  permissions: [
    "traceability:view",
  ] as const,
  nav: [
    {
      areaId: "reportes",
      items: [
        {
          label:       "Trazabilidad",
          href:        "/trazabilidad",
          iconName:    "Path",
          permissions: ["traceability:view"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",   permission: "traceability:view" },
    { roleSlug: "jefa_chome",      permission: "traceability:view" },
    { roleSlug: "secretaria",      permission: "traceability:view" },
    { roleSlug: "prevencionista",  permission: "traceability:view" },
    { roleSlug: "jefe_mantencion", permission: "traceability:view" },
  ],
} as const satisfies ModuleManifest
