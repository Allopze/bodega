import type { ModuleManifest } from "@/modules/manifest-types"

export const purchasingModule = {
  id: "purchasing",
  permissions: [
    "purchasing:view",
    "purchasing:create_order",
    "purchasing:send_order",
    /*
     * FAC-004 (auditoría 2026-09-14), patrón P9. `purchasing:send_order`
     * habilitaba adjuntar la factura, desvincularla, borrarla **y aceptar su
     * diferencia de monto**: quien reconoce la obligación de pago era quien
     * aprobaba su descuadre. Aceptar la excepción se separa; adjuntar y
     * desvincular siguen donde estaban, que es trabajo de la misma persona.
     */
    "purchasing:accept_invoice_exception",
    "purchasing:manage_suppliers",
    "purchasing:delete_order",
  ] as const,

  permissionMeta: {
    "purchasing:view":            { id: "p-pur-view",  description: "Ver módulo de órdenes de compra" },
    "purchasing:create_order":    { id: "p-pur-create", description: "Crear órdenes de compra" },
    "purchasing:send_order":      { id: "p-pur-send",  description: "Enviar OC a proveedor" },
    "purchasing:accept_invoice_exception": { id: "p-pur-acc-exc", description: "Aceptar una diferencia de conciliación de factura de compra" },
    "purchasing:manage_suppliers": { id: "p-pur-sup",  description: "Administrar proveedores" },
    "purchasing:delete_order":    { id: "p-pur-delete", description: "Eliminar órdenes de compra no recibidas" },
  },
  nav: [
    {
      areaId: "adquisiciones",
      items: [
        {
          label:       "Compras",
          href:        "/compras",
          iconName:    "ShoppingCart",
          permissions: ["purchasing:view", "purchasing:create_order"],
        },
      ],
    },
  ],
  defaultGrants: [
    { roleSlug: "administrador",  permission: "purchasing:view" },
    { roleSlug: "administrador",  permission: "purchasing:create_order" },
    { roleSlug: "administrador",  permission: "purchasing:send_order" },
    { roleSlug: "administrador",  permission: "purchasing:manage_suppliers" },
    { roleSlug: "administrador",  permission: "purchasing:delete_order" },
    { roleSlug: "jefa_chome",     permission: "purchasing:view" },
    { roleSlug: "jefa_chome",     permission: "purchasing:delete_order" },
    // Jefatura acepta la excepción; Administración/Secretaría, que es quien
    // adjunta la factura, deliberadamente no la tiene.
    { roleSlug: "jefa_chome",     permission: "purchasing:accept_invoice_exception" },
    { roleSlug: "secretaria",     permission: "purchasing:view" },
    { roleSlug: "secretaria",     permission: "purchasing:create_order" },
    { roleSlug: "secretaria",     permission: "purchasing:send_order" },
    { roleSlug: "secretaria",     permission: "purchasing:manage_suppliers" },
    { roleSlug: "secretaria",     permission: "purchasing:delete_order" },
    { roleSlug: "jefe_mantencion", permission: "purchasing:view" },
  ],
} as const satisfies ModuleManifest
