import type { Permission } from "@/lib/auth/types"

export interface NavItem {
  label:       string
  href:        string
  iconName:    string          // Phosphor icon name
  permissions?: Permission[]   // ANY of these grants access; empty = public-within-auth
  roles?:      string[]        // OR check: ANY of these roles
  badge?:      "count"         // shows a pending count if set
}

export interface NavSection {
  section:  string
  items:    NavItem[]
}

/** Full navigation tree — filtered per-user in the sidebar component */
export const NAV_ITEMS: NavSection[] = [
  {
    section: "Principal",
    items: [
      {
        label:    "Dashboard",
        href:     "/dashboard",
        iconName: "SquaresFour",
      },
    ],
  },
  {
    section: "Operaciones",
    items: [
      {
        label:       "Solicitudes",
        href:        "/solicitudes",
        iconName:    "ClipboardText",
        permissions: ["requests:view_own", "requests:view_all"],
        badge:       "count",
      },
      {
        label:       "Aprobaciones",
        href:        "/aprobaciones",
        iconName:    "CheckSquare",
        permissions: ["approvals:approve"],
        badge:       "count",
      },
      {
        label:       "Compras",
        href:        "/compras",
        iconName:    "ShoppingCart",
        permissions: ["purchasing:view"],
        badge:       "count",
      },
      {
        label:       "Recepción/Bodega",
        href:        "/recepcion",
        iconName:    "Truck",
        permissions: ["receiving:view"],
      },
      {
        label:       "Bodega",
        href:        "/bodega",
        iconName:    "Warehouse",
        permissions: ["warehouse:view_stock"],
      },
      {
        label:       "Entregas",
        href:        "/entregas",
        iconName:    "ArrowSquareOut",
        permissions: ["warehouse:view_stock"],
      },
    ],
  },
  {
    section: "Administración",
    items: [
      {
        label:       "Usuarios",
        href:        "/admin/usuarios",
        iconName:    "Users",
        permissions: ["admin:users"],
      },
      {
        label:       "Faenas",
        href:        "/admin/faenas",
        iconName:    "MapPin",
        permissions: ["admin:worksites"],
      },
      {
        label:       "Productos",
        href:        "/admin/productos",
        iconName:    "Cube",
        permissions: ["admin:products"],
      },
      {
        label:       "Proveedores",
        href:        "/admin/proveedores",
        iconName:    "Buildings",
        permissions: ["admin:suppliers"],
      },
      {
        label:       "Bodegas",
        href:        "/admin/bodegas",
        iconName:    "Warehouse",
        permissions: ["admin:config"],
      },
      {
        label:       "Log de Auditoría",
        href:        "/admin/auditoria",
        iconName:    "ShieldCheck",
        permissions: ["admin:audit_log"],
      },
    ],
  },
]
