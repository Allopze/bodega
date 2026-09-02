import type { ModuleManifest } from "@/modules/manifest-types"

export const operationsModule = {
  id: "operations",
  permissions: [
    "operations:view_work",
  ] as const,
  permissionMeta: {
    "operations:view_work": { id: "p-ops-view-work", description: "Ver la cola operacional priorizada dentro de sus permisos y faenas" },
  },
  nav: [
    {
      // A-26: área propia; la cola agrega módulos de todo el sistema.
      areaId: "pendientes",
      items: [{
        label: "Mis pendientes",
        href: "/pendientes",
        iconName: "CheckSquare",
        permissions: ["operations:view_work"],
        badge: "count" as const,
      }],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador", permission: "operations:view_work" },
    { roleSlug: "jefa_chome", permission: "operations:view_work" },
    { roleSlug: "secretaria", permission: "operations:view_work" },
    { roleSlug: "prevencionista", permission: "operations:view_work" },
    { roleSlug: "solicitante_faena", permission: "operations:view_work" },
    { roleSlug: "prevencionista_faena", permission: "operations:view_work" },
    { roleSlug: "jefe_mantencion", permission: "operations:view_work" },
  ],
} as const satisfies ModuleManifest
