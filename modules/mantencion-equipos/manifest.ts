import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Mantención de equipos (preventiva y correctiva), 2026-10-28.
 *
 * El mecánico registra desde la PWA `/m/mantencion`, distribuida por QR desde
 * Equipos y «App del mecánico»; jefatura y supervisión revisan en `/mantencion/*`.
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
    // Notas de pedido de repuestos (2026-11-26, ADR mantención 0001).
    "mant:np:create",
    "mant:np:view_worksite",
    "mant:np:manage",
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
    "mant:np:create":             { id: "p-mant-np-create", description: "Pedir repuestos para una orden de trabajo asignada (nota de pedido) desde la app o el PC" },
    "mant:np:view_worksite":      { id: "p-mant-np-view-worksite", description: "Ver las notas de pedido de repuestos de sus faenas asignadas" },
    "mant:np:manage":             { id: "p-mant-np-manage", description: "Resolver notas de pedido (sacar de bodega, comprar o rechazar), liberar reservas y conciliar repuestos de sus faenas" },
  },

  nav: [
    {
      areaId: "control-operacional",
      // Orden por la tarea de quien mantiene (reorganización 2026-11-13): primero lo
      // que se mira cada día (Panel, OT, Registros, Historial, Equipos) y al final la
      // «Configuración», que se toca poco y agrupa sus tres pantallas bajo un solo padre.
      items: [
        {
          label: "Panel de mantención",
          href: "/mantencion/panel",
          iconName: "Gauge",
          permissions: ["mant:records:view_worksite", "mant:records:view_all"],
          group: "Mantención",
        },
        {
          // Las OT las ve también la administración de contrato, que no tiene los
          // permisos de registros: por eso el ítem lleva sus propios permisos. El
          // mecánico (`execute`) las trabaja también desde el PC.
          label: "Órdenes de trabajo",
          href: "/mantencion/ot",
          iconName: "Wrench",
          permissions: ["mant:ot:view_worksite", "mant:ot:view_all", "mant:ot:execute"],
          group: "Mantención",
          // Lo que a esta persona le toca hacer con las OT (`getOperationalWorkCounts`): el mismo cálculo de «Mis pendientes».
          badge: "count" as const,
        },
        {
          // Bandeja de las notas de pedido del mecánico (2026-11-26). Quien las
          // resuelve también las ve.
          label: "Notas de pedido",
          href: "/mantencion/notas-pedido",
          iconName: "Tray",
          permissions: ["mant:np:view_worksite", "mant:np:manage"],
          group: "Mantención",
          // Notas por resolver que son de esta persona (`getOperationalWorkCounts`).
          badge: "count" as const,
        },
        {
          label: "Registros firmados",
          href: "/mantencion/registros",
          iconName: "ClipboardText",
          permissions: ["mant:records:view_own", "mant:records:view_worksite", "mant:records:view_all"],
          group: "Mantención",
          // REGISTROS por revisar de las faenas de esta persona (no filas de la cola): `getOperationalWorkCounts`.
          badge: "count" as const,
        },
        {
          // El Historial de mantenciones (también su importación y cada trabajo) vive bajo
          // `/mantencion/registros/historicos`: con este ítem propio la regla del `href` más
          // específico lo marca a él y no a «Registros firmados». Mismos permisos que su página.
          label: "Historial de mantenciones",
          href: "/mantencion/registros/historicos",
          iconName: "Archive",
          permissions: ["mant:records:view_worksite", "mant:records:view_all"],
          group: "Mantención",
        },
        {
          label: "Equipos",
          href: "/mantencion/equipos",
          // Distinto del camión de «Vehículos» (Flota): dos filas con el mismo ícono se leían como la misma pantalla.
          iconName: "Toolbox",
          permissions: ["mant:records:view_worksite", "mant:records:view_all", "mant:equipment:manage"],
          group: "Mantención",
          // La ficha de un equipo se abre en `/flota/[id]/mantencion` y su miga dice «Mantención › Equipos»:
          // el menú tiene que marcar «Equipos» y no «Vehículos». Para quien no ve «Equipos», `isHrefActive`
          // ignora el comodín y «Vehículos» sigue marcado. El interruptor de submódulo no lo entiende (prefijos
          // literales): esa ruta sigue gobernada por Flota.
          aliases: ["/flota/*/mantencion"],
        },
        {
          // Padre sin permisos propios: es sólo un contenedor y se ve cuando la
          // persona ve al menos un hijo (`getVisibleAreas`), llevándola al primero
          // que puede abrir. Cada hijo conserva exactamente el permiso de su
          // página y de sus acciones: el menú sólo los refleja. El `href` es una
          // entrada sin pantalla propia (redirige al primer hijo permitido), como
          // «Ajustes» en Combustible.
          label: "Configuración",
          href: "/mantencion/configuracion",
          iconName: "GearSix",
          permissions: [],
          group: "Mantención",
          // Sus tres destinos se ven sin abrir el padre (auditoría de encontrabilidad 2026-11-26): plegados
          // no se sabía que Pautas, los catálogos y la app del mecánico estaban ahí.
          defaultOpen: true,
          children: [
            { label: "Pautas", href: "/mantencion/pautas", permissions: ["mant:schedules:manage"] },
            // Marcas, talleres, conductores, tipos de trabajo y aceites. Mismo permiso
            // que exige la página y sus acciones (`mant:equipment:manage`).
            { label: "Marcas y talleres", href: "/mantencion/catalogos", permissions: ["mant:equipment:manage"] },
            // Los teléfonos con la app del mecánico conectada, el botón para desconectarlos y el de
            // instalar la app. Mismo permiso que exige la página y su acción (`mant:devices:manage`).
            { label: "App del mecánico", href: "/mantencion/dispositivos", permissions: ["mant:devices:manage"] },
          ],
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
    // Decisión del 2026-11-26 («Mis pendientes»): observar saca un registro de «pendiente» pero cerrarlo como
    // «revisado» era sólo de la jefatura, y la cola de la supervisión no habría llegado nunca a cero. La regla
    // «no revisas lo que firmaste o ejecutaste» (`markRecordReviewed`) vale para todos. En producción lo aplica
    // `GRANT_ADDITIONS`.
    { roleSlug: "supervisor_mantencion", permission: "mant:records:review" },
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
    // Además ve el Panel, los registros, el historial y los equipos de sus faenas,
    // y los exporta (Excel y el informe PDF del Panel). Decisión del usuario del
    // 2026-11-21 (Trinorma): el administrador de contrato muestra el tablero de su
    // faena en la auditoría. En producción lo aplica `GRANT_ADDITIONS`.
    { roleSlug: "admin_contrato", permission: "mant:records:view_worksite" },
    { roleSlug: "admin_contrato", permission: "mant:export" },
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
    // ── Notas de pedido de repuestos (2026-11-26) ──
    // Pide quien ejecuta la OT. Revisan y resuelven los mismos que crean
    // solicitudes de repuestos (decisión D3), en sus faenas. Permisos nuevos:
    // `ensureSystemRbac` aplica estos defaults solo, sin `GRANT_ADDITIONS`.
    { roleSlug: "mecanico", permission: "mant:np:create" },
    { roleSlug: "supervisor_mantencion", permission: "mant:np:create" },
    { roleSlug: "jefe_mantencion", permission: "mant:np:create" },
    { roleSlug: "supervisor_mantencion", permission: "mant:np:view_worksite" },
    { roleSlug: "jefe_mantencion", permission: "mant:np:view_worksite" },
    { roleSlug: "admin_contrato", permission: "mant:np:view_worksite" },
    { roleSlug: "jefa_chome", permission: "mant:np:view_worksite" },
    { roleSlug: "supervisor_mantencion", permission: "mant:np:manage" },
    { roleSlug: "jefe_mantencion", permission: "mant:np:manage" },
    { roleSlug: "admin_contrato", permission: "mant:np:manage" },
  ],
} as const satisfies ModuleManifest
