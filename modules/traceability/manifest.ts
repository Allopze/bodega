import type { ModuleManifest } from "@/core/module-kit"

export const traceabilityModule = {
  id: "traceability",
  // La trazabilidad es una vista de solo lectura sobre datos de otros módulos.
  // El acceso se controla desde el módulo que origina los datos.
  permissions: [] as const,
  nav: [
    {
      section: "Operaciones",
      items: [
        {
          label:       "Trazabilidad",
          href:        "/trazabilidad",
          iconName:    "Path",
          permissions: ["requests:view_all"],
        },
      ],
    },
  ],
  defaultGrants: [],
} as const satisfies ModuleManifest
