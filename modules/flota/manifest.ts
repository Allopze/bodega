import type { ModuleManifest } from "@/modules/manifest-types"

export const flotaModule = {
  id: "flota",
  permissions: [
    "flota:view",
    "flota:manage_documents",
  ] as const,

  permissionMeta: {
    "flota:view": { id: "p-flot-view", description: "Ver flota de vehículos" },
    "flota:manage_documents": { id: "p-flot-manage-documents", description: "Subir y eliminar documentos de flota" },
  },

  nav: [
    {
      areaId: "control-operacional",
      items: [
        {
          label:    "Flota",
          href:     "/flota",
          iconName: "Truck",
          permissions: ["flota:view"],
        },
      ],
    },
  ],

  defaultGrants: [
    { roleSlug: "administrador", permission: "flota:view" },
    { roleSlug: "jefe_mantencion", permission: "flota:view" },
    { roleSlug: "jefa_chome", permission: "flota:view" },
    { roleSlug: "administrador", permission: "flota:manage_documents" },
    { roleSlug: "jefe_mantencion", permission: "flota:manage_documents" },
    { roleSlug: "jefa_chome", permission: "flota:manage_documents" },
  ],
} as const satisfies ModuleManifest
