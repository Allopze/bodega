/**
 * admin-nav.ts — Árbol de navegación de Administración, para el sidebar
 * contextual que reemplaza el árbol de negocio mientras `pathname` está bajo
 * `/admin`. A diferencia de `nav-items.ts`, esto NO pasa por el registry de
 * módulos: `modules/admin/manifest.ts` declara `nav: []` a propósito, y esta
 * lista hand-authored es la fuente de verdad paralela para ese caso.
 */

import type { Session } from "next-auth"
import { canSeeNav, type AreaNode, type NavItem } from "./nav-items"

/** Árbol completo (sin filtrar por permiso). Un `AreaNode` por categoría. */
export const ADMIN_AREAS: AreaNode[] = [
  {
    id:       "catalogos",
    label:    "Catálogos",
    iconName: "Stack",
    order:    10,
    items: [
      { label: "Cargos y capacidades",  href: "/admin/cargos",              iconName: "Briefcase",         permissions: ["admin:worker_positions"] },
      { label: "Productos",             href: "/admin/productos",           iconName: "Cube",              permissions: ["admin:products"] },
      { label: "Catálogo de EPP",       href: "/admin/epps",                iconName: "ShieldCheck",       permissions: ["admin:products"] },
      { label: "Catálogos de productos", href: "/admin/catalogos-productos", iconName: "Cube",             permissions: ["admin:product_catalogs"] },
      { label: "Desviaciones",          href: "/admin/desviaciones",        iconName: "WarningCircle",     permissions: ["admin:deviation_catalog"] },
      { label: "Catálogos PDTP",        href: "/admin/pdtp-catalogos",      iconName: "FileText",          permissions: ["admin:pdtp_catalog"] },
      {
        label: "Catálogos de flota", href: "/admin/flota-catalogos", iconName: "GearSix", permissions: ["admin:fleet_catalog"],
        children: [
          { label: "Estanques de combustible",   href: "/admin/flota-catalogos/estanques-combustible",   permissions: ["admin:fleet_catalog"] },
          { label: "Productos de combustible",   href: "/admin/flota-catalogos/productos-combustible",   permissions: ["admin:fleet_catalog"] },
          { label: "Tipos de equipo",             href: "/admin/flota-catalogos/tipos-equipo",            permissions: ["admin:fleet_catalog"] },
          { label: "Vehículos",                   href: "/admin/flota-catalogos/vehiculos",               permissions: ["admin:fleet_vehicles"] },
          { label: "Proveedores de combustible",  href: "/admin/flota-catalogos/proveedores-combustible", permissions: ["combustibles:manage_suppliers"] },
        ],
      },
      { label: "Tipos de activo TI",    href: "/admin/tipos-activo",        iconName: "Laptop",            permissions: ["admin:it_asset_types"] },
      { label: "Tipos de documento SST", href: "/admin/taxonomia-sst",      iconName: "FileText",          permissions: ["admin:document_taxonomy"] },
      { label: "Escenarios de emergencia", href: "/admin/escenarios-emergencia", iconName: "WarningCircle", permissions: ["admin:emergency_scenario_catalog"] },
    ],
  },
  {
    id:       "plataforma",
    label:    "Configuración de plataforma",
    iconName: "GearSix",
    order:    20,
    items: [
      { label: "Configuración",              href: "/admin/configuracion",           iconName: "GearSix",     permissions: ["admin:config"] },
      { label: "Parámetros operativos",      href: "/admin/parametros-operativos",   iconName: "GearSix",     permissions: ["admin:ops_settings"] },
      { label: "Módulos del sistema",        href: "/admin/modulos",                 iconName: "ToggleLeft",  permissions: ["admin:module_management"] },
      { label: "Respaldos",                  href: "/admin/backups",                 iconName: "HardDrives",  permissions: ["admin:backups"] },
      { label: "Almacenamiento de documentos", href: "/admin/almacenamiento",        iconName: "HardDrives",  permissions: ["admin:storage"] },
    ],
  },
  {
    id:       "personas",
    label:    "Personas y acceso",
    iconName: "Users",
    order:    30,
    items: [
      { label: "Usuarios",     href: "/admin/usuarios",     iconName: "Users",       permissions: ["admin:users"] },
      { label: "Faenas",       href: "/admin/faenas",       iconName: "MapPin",      permissions: ["admin:worksites"] },
      { label: "Trabajadores", href: "/admin/trabajadores", iconName: "UserCircle",  permissions: ["admin:workers"] },
      { label: "Roles",        href: "/admin/roles",        iconName: "ShieldCheck", permissions: ["admin:roles"] },
    ],
  },
  {
    id:       "comunicaciones",
    label:    "Comunicaciones e integraciones",
    iconName: "ChatCircleText",
    order:    40,
    items: [
      { label: "Notificaciones",       href: "/admin/notificaciones", iconName: "EnvelopeSimple", permissions: ["admin:notifications"] },
      { label: "Sincronización DTE",   href: "/admin/dte",            iconName: "Receipt",        permissions: ["admin:dte_sync"] },
      { label: "Correo SMTP",          href: "/admin/correo-smtp",    iconName: "EnvelopeSimple", permissions: ["admin:smtp"] },
      { label: "Plantillas de correo", href: "/admin/plantillas",     iconName: "FileText",       permissions: ["admin:email_templates"] },
    ],
  },
  {
    id:       "activos",
    label:    "Activos operativos",
    iconName: "Package",
    order:    50,
    items: [
      { label: "Inventario de faena", href: "/admin/inventario-faena", iconName: "Package",           permissions: ["admin:worksite_inventory"] },
      { label: "Contenedores",        href: "/admin/contenedores",     iconName: "ShippingContainer", permissions: ["admin:containers"] },
      { label: "Equipos de servicio", href: "/admin/equipos",          iconName: "Cube",              permissions: ["admin:service_equipment"] },
    ],
  },
  {
    id:       "seguridad",
    label:    "Seguridad y trazabilidad",
    iconName: "ShieldCheck",
    order:    60,
    items: [
      { label: "Folios",                href: "/admin/folios",    iconName: "FileText",    permissions: ["admin:folios"] },
      { label: "Seguridad y bloqueos",  href: "/admin/seguridad", iconName: "ShieldCheck", permissions: ["admin:security"] },
      { label: "Log de Auditoría",      href: "/admin/auditoria", iconName: "ShieldCheck", permissions: ["admin:audit_log"] },
    ],
  },
  {
    id:       "abastecimiento",
    label:    "Productos y abastecimiento",
    iconName: "Buildings",
    order:    70,
    items: [
      { label: "Proveedores",     href: "/admin/proveedores",   iconName: "Buildings", permissions: ["admin:suppliers"] },
      { label: "Centros de costo", href: "/admin/centros-costo", iconName: "Buildings", permissions: ["admin:cost_centers"] },
    ],
  },
]

/**
 * Áreas de admin visibles para la sesión, con ítems (y children) filtrados
 * por permiso. Un ítem se conserva si el propio permiso lo permite O si al
 * menos un hijo es visible — el permiso del padre y el de sus hijos no
 * siempre coinciden (p.ej. "Catálogos de flota" pide `admin:fleet_catalog`,
 * pero "Proveedores de combustible" pide `combustibles:manage_suppliers`), y
 * filtrar solo por el permiso del padre escondería hijos a los que la sesión
 * sí tiene acceso.
 */
export function getAdminAreas(session: Session): AreaNode[] {
  const areas: AreaNode[] = []
  for (const area of ADMIN_AREAS) {
    const items: NavItem[] = []
    for (const item of area.items) {
      const children = item.children?.filter((child) => canSeeNav(child, session))
      const selfVisible = canSeeNav(item, session)
      if (!selfVisible && !children?.length) continue
      // El padre se conserva por sus hijos, pero su `href` no: el árbol se
      // pinta con el padre como enlace (`nav-rows.tsx`), así que dejarlo
      // apuntando a su propia pantalla mandaba a /forbidden a quien sólo tiene
      // permiso sobre un hijo — el caso real de "Catálogos de flota", que pide
      // `admin:fleet_catalog`, frente a una sesión que sólo trae
      // `combustibles:manage_suppliers`. Se apunta al primer hijo visible, que
      // es adonde esa sesión quería llegar de todos modos.
      const href = selfVisible ? item.href : (children?.[0]?.href ?? item.href)
      items.push({ ...item, href, children })
    }
    if (items.length === 0) continue
    areas.push({ ...area, items })
  }
  return areas
}
