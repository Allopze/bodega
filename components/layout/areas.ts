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

export const AREAS: AreaDef[] = [
  { id: "adquisiciones", label: "Adquisiciones", iconName: "Stack",     order: 10 },
  { id: "control-operacional", label: "Control operacional", iconName: "Car", order: 15 },
  { id: "bodega",      label: "Bodega",      iconName: "Warehouse", order: 20 },
  { id: "reportes",    label: "Reportes",    iconName: "ChartBar",  order: 30 },
  // ── Próximas áreas (descomenta al registrar sus módulos) ──────────────────
  { id: "prevencion", label: "Prevención", iconName: "ShieldCheck", order: 40 },
  { id: "soporte",    label: "Soporte",    iconName: "Lifebuoy",    order: 50 },
  // { id: "admin",      label: "Admin",      iconName: "GearSix",     order: 90 },
]
