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
        label:       "Órdenes de compra",
        href:        "/compras",
        iconName:    "ShoppingCart",
        permissions: ["purchasing:view"],
        badge:       "count",
      },
      {
        label:       "Recepción",
        href:        "/recepcion",
        iconName:    "Truck",
        permissions: ["receiving:view"],
        badge:       "count",
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
        iconName:    "Truck",
        permissions: ["warehouse:register_movement"],
      },
    ],
  },
  {
    section: "Reportes",
    items: [
      {
        label:       "Trazabilidad",
        href:        "/trazabilidad",
        iconName:    "ChartLineUp",
        permissions: ["reports:view"],
      },
      {
        label:       "Reportes",
        href:        "/reportes",
        iconName:    "ChartBar",
        permissions: ["reports:view"],
      },
    ],
  },
]
