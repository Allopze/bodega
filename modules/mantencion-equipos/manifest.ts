import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Mantención de equipos (preventiva y correctiva), 2026-10-28.
 *
 * El mecánico registra desde la PWA `/m/mantencion`, distribuida por QR desde
 * Equipos y Dispositivos; jefatura y supervisión revisan en `/mantencion/*`.
 * Desde 2026-11 incluye las órdenes de trabajo (`/mantencion/ot`), que
 * reemplazan al módulo antiguo `mantenciones`.
 * Los permisos se validan siempre en el servidor; la navegación sólo los refleja.
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
    // Órdenes de trabajo (2026-11-02), calcadas del talonario en papel.
    "mant:ot:view_worksite",
    "mant:ot:view_all",
    "mant:ot:create",
    "mant:ot:manage",
    "mant:ot:execute",
    "mant:ot:receive",
    "mant:ot:conform",
  ] as const,

  permissionMeta: {
    "mant:app:use":               { id: "p-mant-app-use", description: "Registrar mantención preventiva y correctiva y actualizar el estado en taller desde la app del mecánico" },
    "mant:records:view_own":      { id: "p-mant-records-own", description: "Ver los registros de mantención propios" },
    "mant:records:view_worksite": { id: "p-mant-records-worksite", description: "Ver los registros de mantención de sus faenas asignadas" },
    "mant:records:view_all":      { id: "p-mant-records-all", description: "Ver los registros de mantención de todas las faenas" },
    "mant:records:observe":       { id: "p-mant-records-observe", description: "Observar registros de mantención dentro de su alcance" },
    "mant:records:review":        { id: "p-mant-records-review", description: "Marcar registros de mantención como revisados" },
    "mant:records:void":          { id: "p-mant-records-void", description: "Anular registros de mantención firmados" },
    "mant:equipment:manage":      { id: "p-mant-equipment-manage", description: "Crear, editar, dar de baja e importar equipos de mantención y administrar sus catálogos (marcas, talleres, conductores, tipos de trabajo y aceites)" },
    "mant:schedules:manage":      { id: "p-mant-schedules-manage", description: "Crear, editar y asignar pautas de mantención" },
    "mant:devices:manage":        { id: "p-mant-devices-manage", description: "Revocar credenciales de dispositivo de la app del mecánico" },
    "mant:export":                { id: "p-mant-export", description: "Exportar registros, equipos y pautas de mantención (Excel y PDF)" },
    "mant:ot:view_worksite":      { id: "p-mant-ot-view-worksite", description: "Ver las órdenes de trabajo de sus faenas asignadas" },
    "mant:ot:view_all":           { id: "p-mant-ot-view-all", description: "Ver las órdenes de trabajo de todas las faenas" },
    "mant:ot:create":             { id: "p-mant-ot-create", description: "Crear órdenes de trabajo para equipos de sus faenas" },
    "mant:ot:manage":             { id: "p-mant-ot-manage", description: "Asignar, reasignar, anular y reabrir órdenes de trabajo" },
    "mant:ot:execute":            { id: "p-mant-ot-execute", description: "Ejecutar las órdenes de trabajo asignadas (ingreso y salida de taller) desde la app o el PC" },
    "mant:ot:receive":            { id: "p-mant-ot-receive", description: "Registrar la recepción del equipo al salir del taller" },
    "mant:ot:conform":            { id: "p-mant-ot-conform", description: "Registrar la recepción en faena (conformidad) y cerrar la orden de trabajo" },
  },

  nav: [
    {
      areaId: "control-operacional",
      items: [
        {
          // Las OT las ve también la administración de contrato, que no tiene los
          // permisos de registros: por eso el ítem lleva sus propios permisos. El
          // mecánico (`execute`) las trabaja también desde el PC.
          label: "Órdenes de trabajo",
          href: "/mantencion/ot",
          iconName: "Wrench",
          permissions: ["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"],
          group: "Mantención",
        },
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
          // Marcas, talleres, conductores, tipos de trabajo y aceites. Mismo permiso que exige la
          // página y sus acciones (`mant:equipment:manage`): el menú sólo lo refleja.
          label: "Catálogos",
          href: "/mantencion/catalogos",
          iconName: "Books",
          permissions: ["mant:equipment:manage"],
          group: "Mantención",
        },
        {
          // Quién tiene la app conectada y el botón para desconectarla. Mismo permiso que exige la
          // página y su acción (`mant:devices:manage`): el menú sólo lo refleja.
          label: "Dispositivos",
          href: "/mantencion/dispositivos",
          iconName: "DeviceMobile",
          permissions: ["mant:devices:manage"],
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
    // ── Órdenes de trabajo ──
    // Administración de contrato: crea la OT, recibe el equipo y da la
    // conformidad (recepción en faena) en sus faenas.
    { roleSlug: "admin_contrato", permission: "mant:ot:view_worksite" },
    { roleSlug: "admin_contrato", permission: "mant:ot:create" },
    { roleSlug: "admin_contrato", permission: "mant:ot:receive" },
    { roleSlug: "admin_contrato", permission: "mant:ot:conform" },
    // Jefatura de mantención: recibe el aviso, asigna y gestiona. No da la
    // conformidad: sería aprobar su propio trabajo.
    { roleSlug: "jefe_mantencion", permission: "mant:ot:view_worksite" },
    { roleSlug: "jefe_mantencion", permission: "mant:ot:view_all" },
    { roleSlug: "jefe_mantencion", permission: "mant:ot:create" },
    { roleSlug: "jefe_mantencion", permission: "mant:ot:manage" },
    { roleSlug: "jefe_mantencion", permission: "mant:ot:execute" },
    { roleSlug: "jefe_mantencion", permission: "mant:ot:receive" },
    // Mecánicos y supervisión: ejecutan desde la app o el PC, en cualquier faena.
    { roleSlug: "mecanico", permission: "mant:ot:execute" },
    { roleSlug: "supervisor_mantencion", permission: "mant:ot:execute" },
    { roleSlug: "supervisor_mantencion", permission: "mant:ot:view_worksite" },
    // Jefatura general: lectura.
    { roleSlug: "jefa_chome", permission: "mant:ot:view_worksite" },
    { roleSlug: "jefa_chome", permission: "mant:ot:view_all" },
  ],
} as const satisfies ModuleManifest
