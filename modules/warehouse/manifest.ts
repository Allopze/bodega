import type { ModuleManifest } from "@/modules/manifest-types"

export const warehouseModule = {
  id: "warehouse",
  permissions: [
    "warehouse:view_stock",
    "warehouse:register_movement",
    "warehouse:adjust_stock",
    // Guías de Despacho Interna (GDI): documento de traslado Oficina → Faena.
    // Editar un borrador queda cubierto por `create_guide`: es el mismo actor
    // preparando el mismo documento, y despachar/anular sí son permisos aparte
    // porque mueven stock.
    "warehouse:view_guides",
    "warehouse:create_guide",
    "warehouse:dispatch_guide",
    "warehouse:receive_guide",
    "warehouse:cancel_guide",
    "warehouse:view_traceability",
    "warehouse:reconcile_integrity",
  ] as const,

  permissionMeta: {
    "warehouse:view_stock":         { id: "p-wh-stock", description: "Ver stock" },
    "warehouse:register_movement":  { id: "p-wh-mov",   description: "Registrar movimientos" },
    "warehouse:adjust_stock":       { id: "p-wh-adj",   description: "Ajustar stock" },
    "warehouse:view_guides":        { id: "p-wh-gdi-view",     description: "Ver guías de despacho internas" },
    "warehouse:create_guide":       { id: "p-wh-gdi-create",   description: "Crear y editar borradores de guías de despacho" },
    "warehouse:dispatch_guide":     { id: "p-wh-gdi-dispatch", description: "Despachar guías (mueve stock de oficina a faena)" },
    "warehouse:receive_guide":      { id: "p-wh-gdi-receive",  description: "Confirmar recepción de guías en faena" },
    "warehouse:cancel_guide":       { id: "p-wh-gdi-cancel",   description: "Anular guías de despacho" },
    "warehouse:view_traceability":  { id: "p-wh-trace-view",   description: "Ver trazabilidad y seguimiento de solicitudes por faena" },
    "warehouse:reconcile_integrity": { id: "p-wh-trace-reconcile-integrity", description: "Detectar y regularizar excepciones históricas de trazabilidad" },
  },
  nav: [
    {
      // Seguimiento de solicitudes (antes "Trazabilidad", bajo Bodega): es el
      // hilo solicitud → OC → recepción → entrega, o sea Adquisiciones. Sigue
      // gobernado por `warehouse:view_traceability`; el permiso y el módulo no
      // cambian, sólo dónde se muestra y su URL (`/seguimiento`).
      areaId: "adquisiciones",
      items: [
        {
          label:       "Seguimiento de solicitudes",
          href:        "/seguimiento",
          iconName:    "Path",
          permissions: ["warehouse:view_traceability"],
        },
      ],
    },
    {
      areaId: "bodega",
      items: [
        {
          label:       "Bodega",
          href:        "/bodega",
          iconName:    "Warehouse",
          permissions: ["warehouse:view_stock"],
        },
        {
          // Las guías de despacho internas eran un módulo completo (lista,
          // detalle, despacho, PDF) sin puerta de entrada propia: sólo se
          // llegaba desde Recepción o desde una OC.
          label:       "Guías de despacho",
          href:        "/bodega/guias",
          iconName:    "Truck",
          permissions: ["warehouse:view_guides"],
          // TRV-01 (auditoría 2026-10-05): guías despachadas pendientes de
          // confirmar en faena (ver `badgeCountsLoader` en app/(app)/layout.tsx).
          badge:       "count" as const,
        },
      ],
    },
  ],
  defaultGrants: [
    // ── Guías de despacho internas ────────────────────────────────────────
    // Emitir/despachar/anular es trabajo de la oficina central (roles
    // globales). Los roles de faena sólo ven sus guías y confirman la
    // recepción: son el destino del traslado, no su origen.
    { roleSlug: "administrador",        permission: "warehouse:view_guides" },
    { roleSlug: "administrador",        permission: "warehouse:create_guide" },
    { roleSlug: "administrador",        permission: "warehouse:dispatch_guide" },
    { roleSlug: "administrador",        permission: "warehouse:receive_guide" },
    { roleSlug: "administrador",        permission: "warehouse:cancel_guide" },
    { roleSlug: "jefa_chome",           permission: "warehouse:view_guides" },
    { roleSlug: "jefa_chome",           permission: "warehouse:create_guide" },
    { roleSlug: "jefa_chome",           permission: "warehouse:dispatch_guide" },
    { roleSlug: "jefa_chome",           permission: "warehouse:cancel_guide" },
    { roleSlug: "secretaria",           permission: "warehouse:view_guides" },
    { roleSlug: "secretaria",           permission: "warehouse:create_guide" },
    { roleSlug: "secretaria",           permission: "warehouse:dispatch_guide" },
    { roleSlug: "prevencionista",       permission: "warehouse:view_guides" },
    { roleSlug: "prevencionista",       permission: "warehouse:create_guide" },
    { roleSlug: "prevencionista",       permission: "warehouse:dispatch_guide" },
    { roleSlug: "solicitante_faena",    permission: "warehouse:view_guides" },
    { roleSlug: "solicitante_faena",    permission: "warehouse:receive_guide" },
    { roleSlug: "prevencionista_faena", permission: "warehouse:view_guides" },
    { roleSlug: "prevencionista_faena", permission: "warehouse:receive_guide" },
    { roleSlug: "admin_contrato",       permission: "warehouse:view_guides" },
    { roleSlug: "admin_contrato",       permission: "warehouse:receive_guide" },
    { roleSlug: "jefe_terreno",         permission: "warehouse:view_guides" },
    { roleSlug: "jefe_terreno",         permission: "warehouse:receive_guide" },
    { roleSlug: "jefe_mantencion",      permission: "warehouse:view_guides" },

    { roleSlug: "administrador",  permission: "warehouse:view_stock" },
    { roleSlug: "administrador",  permission: "warehouse:register_movement" },
    { roleSlug: "administrador",  permission: "warehouse:adjust_stock" },
    { roleSlug: "administrador",  permission: "warehouse:view_traceability" },
    { roleSlug: "administrador",  permission: "warehouse:reconcile_integrity" },
    { roleSlug: "jefa_chome",     permission: "warehouse:view_stock" },
    { roleSlug: "jefa_chome",     permission: "warehouse:view_traceability" },
    { roleSlug: "secretaria",     permission: "warehouse:view_stock" },
    { roleSlug: "secretaria",     permission: "warehouse:register_movement" },
    { roleSlug: "secretaria",     permission: "warehouse:view_traceability" },
    { roleSlug: "prevencionista", permission: "warehouse:view_stock" },
    { roleSlug: "prevencionista", permission: "warehouse:register_movement" },
    { roleSlug: "prevencionista", permission: "warehouse:view_traceability" },
    { roleSlug: "solicitante_faena", permission: "warehouse:view_stock" },
    { roleSlug: "solicitante_faena", permission: "warehouse:register_movement" },
    { roleSlug: "prevencionista_faena", permission: "warehouse:view_stock" },
    { roleSlug: "prevencionista_faena", permission: "warehouse:register_movement" },
    { roleSlug: "jefe_mantencion", permission: "warehouse:view_stock" },
    { roleSlug: "jefe_mantencion", permission: "warehouse:view_traceability" },
  ],
} as const satisfies ModuleManifest
