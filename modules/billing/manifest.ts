import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Módulo Facturación y Cobranza.
 *
 * Cuentas por cobrar: qué se debe facturar, qué se facturó, qué se cobró y qué
 * sigue pendiente. **No** emite documentos tributarios ni reemplaza la
 * contabilidad; las facturas de proveedor siguen viviendo en Compras.
 *
 * Perfiles de permisos:
 * - `billing:view` — ver el módulo (acotado por faena para roles no globales).
 * - `billing:view_sensitive` — ver datos financieros sensibles: movimientos
 *   bancarios, contrapartes y detalle de pagos.
 * - `billing:manage_clients` — administrar clientes, contactos y contratos.
 * - `billing:create_proposal` / `review_proposal` / `approve_proposal` — el
 *   flujo de preparación interna. Están separados a propósito: quien prepara no
 *   debería aprobar su propio cobro.
 * - `billing:manage_invoices` — editar los datos INTERNOS de una factura
 *   (vínculos, vencimiento, responsable). Nunca los datos tributarios externos.
 * - `billing:manage_collections` — registrar gestiones y compromisos de pago.
 * - `billing:confirm_payments` — convertir una sugerencia de pago en un cobro
 *   confirmado. Es el permiso más sensible del módulo.
 * - `billing:manage_sync` — disparar sincronizaciones y ver el diagnóstico.
 * - `billing:export` — exportar (queda auditado).
 * - `billing:view_audit` — ver el historial completo de cambios.
 */
export const billingModule = {
  id: "billing",
  permissions: [
    "billing:view",
    "billing:view_sensitive",
    "billing:manage_clients",
    "billing:create_proposal",
    "billing:review_proposal",
    "billing:approve_proposal",
    "billing:manage_invoices",
    "billing:manage_collections",
    "billing:confirm_payments",
    "billing:manage_sync",
    "billing:export",
    "billing:view_audit",
  ] as const,

  permissionMeta: {
    "billing:view":               { id: "p-bil-view",      description: "Ver el módulo de Facturación y Cobranza" },
    "billing:view_sensitive":     { id: "p-bil-sens",      description: "Ver datos financieros sensibles (movimientos bancarios, pagos)" },
    "billing:manage_clients":     { id: "p-bil-clients",   description: "Administrar clientes, contactos y contratos" },
    "billing:create_proposal":    { id: "p-bil-prop-new",  description: "Crear propuestas de facturación" },
    "billing:review_proposal":    { id: "p-bil-prop-rev",  description: "Revisar y observar propuestas de facturación" },
    "billing:approve_proposal":   { id: "p-bil-prop-apr",  description: "Aprobar propuestas de facturación" },
    "billing:manage_invoices":    { id: "p-bil-inv",       description: "Editar datos internos y vínculos de facturas" },
    "billing:manage_collections": { id: "p-bil-cob",       description: "Registrar gestiones y compromisos de cobranza" },
    "billing:confirm_payments":   { id: "p-bil-pay",       description: "Confirmar o rechazar pagos y conciliaciones" },
    "billing:manage_sync":        { id: "p-bil-sync",      description: "Administrar la sincronización con proveedores de facturación" },
    "billing:export":             { id: "p-bil-export",    description: "Exportar información de facturación y cobranza" },
    "billing:view_audit":         { id: "p-bil-audit",     description: "Ver el historial de auditoría de facturación" },
  },

  nav: [
    {
      areaId: "facturacion",
      items: [
        {
          label:       "Resumen",
          href:        "/facturacion",
          iconName:    "ChartLineUp",
          permissions: ["billing:view"],
        },
        {
          label:       "Pendientes de facturar",
          href:        "/facturacion/pendientes",
          iconName:    "ClipboardText",
          permissions: ["billing:view"],
        },
        {
          label:       "Propuestas",
          href:        "/facturacion/propuestas",
          iconName:    "FolderOpen",
          permissions: ["billing:view"],
        },
        {
          label:       "Facturas emitidas",
          href:        "/facturacion/facturas",
          iconName:    "Receipt",
          permissions: ["billing:view"],
        },
        {
          label:       "Cobranza",
          href:        "/facturacion/cobranza",
          iconName:    "CurrencyDollar",
          permissions: ["billing:view"],
        },
        {
          label:       "Posibles duplicados",
          href:        "/facturacion/duplicados",
          iconName:    "MagnifyingGlass",
          permissions: ["billing:manage_invoices"],
        },
        {
          label:       "Clientes y contratos",
          href:        "/facturacion/clientes",
          iconName:    "Buildings",
          permissions: ["billing:manage_clients"],
        },
        {
          label:       "Sincronización",
          href:        "/facturacion/sincronizacion",
          iconName:    "ArrowsClockwise",
          permissions: ["billing:manage_sync"],
        },
      ],
    },
  ],

  defaultGrants: [
    // Administrador técnico: configura integraciones y ve el módulo, pero el
    // detalle financiero sensible y la confirmación de pagos son de Finanzas.
    { roleSlug: "administrador", permission: "billing:view" },
    { roleSlug: "administrador", permission: "billing:manage_clients" },
    { roleSlug: "administrador", permission: "billing:manage_sync" },
    { roleSlug: "administrador", permission: "billing:view_audit" },

    // Jefatura: visión global, aprobación y confirmación de cobros.
    { roleSlug: "jefa_chome", permission: "billing:view" },
    { roleSlug: "jefa_chome", permission: "billing:view_sensitive" },
    { roleSlug: "jefa_chome", permission: "billing:manage_clients" },
    { roleSlug: "jefa_chome", permission: "billing:review_proposal" },
    { roleSlug: "jefa_chome", permission: "billing:approve_proposal" },
    { roleSlug: "jefa_chome", permission: "billing:manage_invoices" },
    { roleSlug: "jefa_chome", permission: "billing:manage_collections" },
    { roleSlug: "jefa_chome", permission: "billing:confirm_payments" },
    { roleSlug: "jefa_chome", permission: "billing:manage_sync" },
    { roleSlug: "jefa_chome", permission: "billing:export" },
    { roleSlug: "jefa_chome", permission: "billing:view_audit" },

    // Administración/Secretaría: prepara, mantiene maestros y gestiona cobranza.
    // NO aprueba propuestas ni confirma pagos.
    { roleSlug: "secretaria", permission: "billing:view" },
    { roleSlug: "secretaria", permission: "billing:manage_clients" },
    { roleSlug: "secretaria", permission: "billing:create_proposal" },
    { roleSlug: "secretaria", permission: "billing:review_proposal" },
    { roleSlug: "secretaria", permission: "billing:manage_invoices" },
    { roleSlug: "secretaria", permission: "billing:manage_collections" },
    { roleSlug: "secretaria", permission: "billing:export" },

    // Administrador de contrato / supervisor de faena: ve lo pendiente de su
    // faena y arma la propuesta con los antecedentes del terreno.
    { roleSlug: "admin_contrato", permission: "billing:view" },
    { roleSlug: "admin_contrato", permission: "billing:create_proposal" },
  ],
} as const satisfies ModuleManifest
