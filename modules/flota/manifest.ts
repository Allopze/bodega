import type { ModuleManifest } from "@/modules/manifest-types"

export const flotaModule = {
  id: "flota",
  permissions: [
    "flota:view",
    "flota:manage_documents",
    "flota:manage_gps",
    "flota:view_gps_history",
    "flota:view_gps_driver",
    "flota:manage_licenses",
  ] as const,

  permissionMeta: {
    "flota:view": { id: "p-flot-view", description: "Ver flota de vehículos" },
    "flota:manage_documents": { id: "p-flot-manage-documents", description: "Subir y eliminar documentos de flota" },
    "flota:manage_gps": { id: "p-flot-manage-gps", description: "Configurar y sincronizar monitoreo GPS" },
    "flota:view_gps_history": { id: "p-flot-view-gps-history", description: "Ver recorridos y viajes GPS" },
    "flota:view_gps_driver": { id: "p-flot-view-gps-driver", description: "Ver identidad vinculada del conductor GPS" },
    "flota:manage_licenses": { id: "p-flot-manage-licenses", description: "Ver y actualizar licencias de conducir y recibir sus avisos de vencimiento" },
  },

  nav: [
    {
      areaId: "control-operacional",
      items: [
        {
          label:    "Panel operacional",
          href:     "/control-operacional",
          iconName: "ChartLineUp",
          // Paridad con el gate de la página: cualquiera de los tres permisos
          // abre el centro, así que la navegación debe ofrecerlo a los tres.
          permissions: ["flota:view", "prevention:inspections:view", "combustibles:view"],
          // Mismo encabezado que abre TI con su resumen: un área agrupa todos
          // sus ítems o ninguno (navigation.test.ts).
          group:    "Seguimiento",
        },
        {
          label:    "Vehículos",
          href:     "/flota",
          iconName: "Truck",
          permissions: ["flota:view"],
          group:    "Flota",
        },
        {
          // Licencias de conducir: la ven jefatura, admin. de contrato y jefe de
          // terreno, que no tienen `flota:view`. Paridad con el gate de la página.
          label:    "Conductores",
          href:     "/flota/conductores",
          iconName: "IdentificationCard",
          permissions: ["flota:manage_licenses"],
          group:    "Flota",
        },
        {
          label:    "Monitoreo GPS",
          href:     "/flota/monitoreo",
          iconName: "MapPin",
          permissions: ["flota:view"],
          group:    "Flota",
        },
        {
          label:    "Indicadores GPS",
          href:     "/flota/indicadores",
          iconName: "ChartBar",
          permissions: ["flota:view"],
          group:    "Flota",
        },
      ],
    },
  ],

  defaultGrants: [
    { roleSlug: "administrador", permission: "flota:view" },
    { roleSlug: "administrador", permission: "flota:manage_licenses" },
    { roleSlug: "jefa_chome", permission: "flota:manage_licenses" },
    { roleSlug: "admin_contrato", permission: "flota:manage_licenses" },
    { roleSlug: "jefe_terreno", permission: "flota:manage_licenses" },
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
