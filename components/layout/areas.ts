/**
 * areas.ts — Catálogo central de ÁREAS de navegación
 *
 * Cada área es un icono del rail. Los módulos NO definen áreas: solo declaran a
 * qué `areaId` pertenecen sus ítems (en su manifest). Esto garantiza icono y
 * orden consistentes cuando varios módulos comparten un área (ej: Adquisiciones),
 * y mantiene "agregar un módulo" como una sola línea + su manifest.
 *
 * Para sumar un área nueva: agrega una entrada aquí y apunta el `areaId` del
 * módulo a ese id. El rail/panel/⌘K la toman automáticamente.
 */

export interface AreaDef {
  /** id estable referido por los manifests (kebab/lower) */
  id:       string
  label:    string
  /** Nombre de icono Phosphor (mapeado en components/layout/rail.tsx) */
  iconName: string
  /** Orden en el rail (menor = arriba) */
  order:    number
}

/**
 * Orden canónico de los grupos dentro de un área.
 *
 * Sin esto el orden lo decide la posición del módulo en `modules/registry.ts`,
 * y un área alimentada por varios módulos (Prevención: sst + ppa + prevention)
 * no puede ordenarse: los ítems de sst salen siempre primero. Peor, un mismo
 * grupo puede quedar partido en bloques no contiguos y `nav-rows.tsx` repite su
 * encabezado (pasaba con "Gestión en terreno").
 *
 * Los ítems sin `group` dan índice -1 y quedan antes que cualquier grupo, así
 * las áreas que no usan grupos conservan su orden de declaración.
 */
export const NAV_GROUP_ORDER: string[] = [
  // Prevención — el ciclo del programa: qué se planifica, qué lo cumple,
  // qué ocurre en terreno y con qué se verifica.
  "Programa",
  "Cumplimiento del programa",
  "En terreno",
  "Seguimiento",
]

export const AREAS: AreaDef[] = [
  // "Mis pendientes" colgaba de Adquisiciones, pero su cola agrega PDTP, CAPA,
  // inspecciones, documentación, PPA y SST: es una bandeja transversal, no un
  // submódulo de compras (auditoría UI/UX 2026-07-29, A-26). Va primero porque
  // es el punto de entrada al trabajo del día.
  { id: "pendientes",    label: "Mis pendientes", iconName: "CheckSquare", order: 5 },
  { id: "adquisiciones", label: "Adquisiciones", iconName: "Stack",     order: 10 },
  { id: "control-operacional", label: "Control operacional", iconName: "Car", order: 15 },
  { id: "bodega",      label: "Bodega",      iconName: "Warehouse", order: 20 },
  { id: "facturacion", label: "Facturación", iconName: "Receipt",   order: 25 },
  { id: "reportes",    label: "Reportes",    iconName: "ChartBar",  order: 30 },
  // ── Próximas áreas (descomenta al registrar sus módulos) ──────────────────
  { id: "prevencion", label: "Prevención", iconName: "ShieldCheck", order: 40 },
  { id: "soporte",    label: "Soporte",    iconName: "Lifebuoy",    order: 50 },
  // { id: "admin",      label: "Admin",      iconName: "GearSix",     order: 90 },
]
