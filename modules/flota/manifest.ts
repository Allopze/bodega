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
    "flota:export",
    "flota:transfer",
  ] as const,

  permissionMeta: {
    "flota:view": { id: "p-flot-view", description: "Ver flota de vehículos" },
    "flota:manage_documents": { id: "p-flot-manage-documents", description: "Subir y eliminar documentos de flota" },
    "flota:manage_gps": { id: "p-flot-manage-gps", description: "Configurar y sincronizar monitoreo GPS" },
    "flota:view_gps_history": { id: "p-flot-view-gps-history", description: "Ver recorridos y viajes GPS" },
    "flota:view_gps_driver": { id: "p-flot-view-gps-driver", description: "Ver identidad vinculada del conductor GPS" },
    "flota:manage_licenses": { id: "p-flot-manage-licenses", description: "Ver y actualizar licencias de conducir y recibir sus avisos de vencimiento" },
    // Decisión 2026-11-15: el Excel de Vehículos y de los Indicadores GPS es opt-in, como en el resto de
    // la plataforma. Al estrenarse se copia de `flota:view` (`PERMISSION_MIRRORS` en lib/auth/bootstrap.ts).
    "flota:export": { id: "p-flot-export", description: "Exportar a Excel los vehículos y los indicadores GPS" },
    "flota:transfer": { id: "p-flot-transfer", description: "Trasladar equipos entre faenas y anular traslados" },
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
          // El permiso para registrar un traslado es `flota:transfer`; ver la lista basta para abrir la
          // pantalla (historial y Excel). Hasta que un administrador lo habilite, el interruptor del
          // submódulo lo oculta del menú.
          label:    "Traslados",
          href:     "/flota/traslados",
          iconName: "ArrowsLeftRight",
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
    // Los mismos roles que ven la flota: con el permiso nuevo nadie gana ni pierde una descarga.
    { roleSlug: "administrador", permission: "flota:export" },
    { roleSlug: "jefe_mantencion", permission: "flota:export" },
    { roleSlug: "jefa_chome", permission: "flota:export" },
    { roleSlug: "administrador", permission: "flota:transfer" },
    { roleSlug: "jefe_mantencion", permission: "flota:transfer" },
    { roleSlug: "jefa_chome", permission: "flota:transfer" },
  ],
} as const satisfies ModuleManifest
