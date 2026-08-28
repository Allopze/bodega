import type { ModuleManifest } from "@/modules/manifest-types"

export const flotaModule = {
  id: "flota",
  permissions: [
    "flota:view",
    "flota:manage_documents",
    "flota:manage_gps",
    "flota:view_gps_history",
    "flota:view_gps_driver",
  ] as const,

  permissionMeta: {
    "flota:view": { id: "p-flot-view", description: "Ver flota de vehículos" },
    "flota:manage_documents": { id: "p-flot-manage-documents", description: "Subir y eliminar documentos de flota" },
    "flota:manage_gps": { id: "p-flot-manage-gps", description: "Configurar y sincronizar monitoreo GPS" },
    "flota:view_gps_history": { id: "p-flot-view-gps-history", description: "Ver recorridos y viajes GPS" },
    "flota:view_gps_driver": { id: "p-flot-view-gps-driver", description: "Ver identidad vinculada del conductor GPS" },
  },

  nav: [
    {
      areaId: "control-operacional",
      items: [
        {
          label:    "Control operacional",
          href:     "/control-operacional",
          iconName: "ChartLineUp",
          permissions: ["flota:view"],
        },
        {
          label:    "Flota",
          href:     "/flota",
          iconName: "Truck",
          permissions: ["flota:view"],
        },
        {
          label:    "Monitoreo GPS",
          href:     "/flota/monitoreo",
          iconName: "MapPin",
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
    { roleSlug: "administrador", permission: "flota:manage_gps" },
    { roleSlug: "jefe_mantencion", permission: "flota:manage_gps" },
    { roleSlug: "jefa_chome", permission: "flota:manage_gps" },
    { roleSlug: "administrador", permission: "flota:view_gps_history" },
    { roleSlug: "jefe_mantencion", permission: "flota:view_gps_history" },
    { roleSlug: "jefa_chome", permission: "flota:view_gps_history" },
    { roleSlug: "administrador", permission: "flota:view_gps_driver" },
    { roleSlug: "jefe_mantencion", permission: "flota:view_gps_driver" },
    { roleSlug: "jefa_chome", permission: "flota:view_gps_driver" },
  ],
} as const satisfies ModuleManifest
