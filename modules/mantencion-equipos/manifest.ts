import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Mantención de equipos (preventiva y correctiva), 2026-10-28.
 *
 * Independiente del módulo `mantenciones` (órdenes de trabajo con costos): no
 * comparte rutas, tablas ni permisos con él. El mecánico registra desde la app
 * `/m/mantencion` (PWA sin conexión); jefatura y supervisión revisan en
 * `/mantencion/*`. Los permisos se validan siempre en el servidor; la
 * navegación sólo los refleja.
 */
export const mantencionEquiposModule = {
  id: "mantencion_equipos",
  permissions: [
    "mant:app:use",
    "mant:records:view_own",
    "mant:records:view_worksite",
    "mant:records:view_all",
    "mant:records:observe",
    "mant:records:review",
    "mant:records:void",
    "mant:equipment:manage",
    "mant:schedules:manage",
    "mant:devices:manage",
    "mant:export",
  ] as const,

  permissionMeta: {
    "mant:app:use":               { id: "p-mant-app-use", description: "Registrar mantención preventiva y correctiva y actualizar el estado en taller desde la app del mecánico" },
    "mant:records:view_own":      { id: "p-mant-records-own", description: "Ver los registros de mantención propios" },
    "mant:records:view_worksite": { id: "p-mant-records-worksite", description: "Ver los registros de mantención de sus faenas asignadas" },
    "mant:records:view_all":      { id: "p-mant-records-all", description: "Ver los registros de mantención de todas las faenas" },
    "mant:records:observe":       { id: "p-mant-records-observe", description: "Observar registros de mantención dentro de su alcance" },
    "mant:records:review":        { id: "p-mant-records-review", description: "Marcar registros de mantención como revisados" },
    "mant:records:void":          { id: "p-mant-records-void", description: "Anular registros de mantención firmados" },
    "mant:equipment:manage":      { id: "p-mant-equipment-manage", description: "Crear, editar, dar de baja e importar equipos de mantención" },
    "mant:schedules:manage":      { id: "p-mant-schedules-manage", description: "Crear, editar y asignar pautas de mantención" },
    "mant:devices:manage":        { id: "p-mant-devices-manage", description: "Revocar credenciales de dispositivo de la app del mecánico" },
    "mant:export":                { id: "p-mant-export", description: "Exportar registros, equipos y pautas de mantención (Excel y PDF)" },
  },

  nav: [
    {
      areaId: "control-operacional",
      items: [
        {
          label: "Panel",
          href: "/mantencion/panel",
          iconName: "Gauge",
          permissions: ["mant:records:view_worksite", "mant:records:view_all"],
          group: "Mantención",
        },
        {
          label: "Registros",
          href: "/mantencion/registros",
          iconName: "ClipboardText",
          permissions: ["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"],
          group: "Mantención",
        },
        {
          label: "Equipos",
          href: "/mantencion/equipos",
          iconName: "Truck",
          permissions: ["mant:records:view_worksite", "mant:records:view_all", "mant:equipment:manage"],
          group: "Mantención",
        },
        {
          label: "Pautas",
          href: "/mantencion/pautas",
          iconName: "ListChecks",
          permissions: ["mant:schedules:manage"],
          group: "Mantención",
        },
        {
          label: "App del mecánico",
          href: "/m/mantencion",
          iconName: "DeviceMobile",
          permissions: ["mant:app:use"],
          group: "Mantención",
        },
      ],
    },
  ],

  defaultGrants: [
    // Mecánico: registra y ve lo propio.
    { roleSlug: "mecanico", permission: "mant:app:use" },
    { roleSlug: "mecanico", permission: "mant:records:view_own" },
    // Supervisor de faena: además ve, observa y exporta su faena.
    { roleSlug: "supervisor_mantencion", permission: "mant:app:use" },
    { roleSlug: "supervisor_mantencion", permission: "mant:records:view_own" },
    { roleSlug: "supervisor_mantencion", permission: "mant:records:view_worksite" },
    { roleSlug: "supervisor_mantencion", permission: "mant:records:observe" },
    { roleSlug: "supervisor_mantencion", permission: "mant:export" },
    // Jefatura de mantención: todo el módulo.
    { roleSlug: "jefe_mantencion", permission: "mant:app:use" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:view_own" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:view_worksite" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:view_all" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:observe" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:review" },
    { roleSlug: "jefe_mantencion", permission: "mant:records:void" },
    { roleSlug: "jefe_mantencion", permission: "mant:equipment:manage" },
    { roleSlug: "jefe_mantencion", permission: "mant:schedules:manage" },
    { roleSlug: "jefe_mantencion", permission: "mant:devices:manage" },
    { roleSlug: "jefe_mantencion", permission: "mant:export" },
    // Jefatura general: lectura y exportación.
    { roleSlug: "jefa_chome", permission: "mant:records:view_all" },
    { roleSlug: "jefa_chome", permission: "mant:records:view_worksite" },
    { roleSlug: "jefa_chome", permission: "mant:export" },
  ],
} as const satisfies ModuleManifest
