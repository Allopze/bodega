/**
 * core/module-kit — Contratos del sistema modular
 *
 * Un módulo autocontenido exporta un `ModuleManifest` que describe todo lo que
 * el sistema central necesita saber de él: qué permisos introduce, qué entradas
 * de nav expone, cómo hacer seed de sus datos base, y qué roles obtienen qué
 * permisos por defecto.
 *
 * El registry (modules/registry.ts) agrega todos los manifests y de ahí se
 * deriva el type `Permission` sin ediciones centrales.
 *
 * Regla de dependencia:
 *   core → (nada de modules)
 *   modules → core  (solo a través de los barrels públicos de cada módulo)
 *   app    → modules (solo a través de su index.ts)
 */

import type { DB } from "@/db"

// ── Navegación ──────────────────────────────────────────────────────────────

/**
 * Una entrada de navegación que un módulo puede registrar.
 * Structuralmente compatible con el NavItem de components/layout/nav-items.ts;
 * en Phase 3 ese archivo importará desde aquí.
 */
/** Submenú de nivel 2 — se muestra como acordeón dentro del panel del área. */
export interface NavChild {
  label: string
  href: string
  /** ANY de estos permisos concede visibilidad */
  permissions?: string[]
  /** ANY de estos roles concede visibilidad */
  roles?: string[]
}

export interface NavItem {
  label: string
  href: string
  iconName: string
  /** ANY de estos permisos concede visibilidad */
  permissions?: string[]
  /** ANY de estos roles concede visibilidad */
  roles?: string[]
  /** Muestra un contador de pendientes si está definido */
  badge?: "count"
  /** Submenú nivel 2 (acordeón en el panel del área) */
  children?: NavChild[]
}

/**
 * Entrada de nav de un módulo, adscrita a un ÁREA del catálogo central
 * (components/layout/areas.ts). Varios módulos pueden aportar ítems a la misma área.
 */
export interface NavSection {
  /** id del área en el catálogo central (ej: "operaciones", "bodega") */
  areaId: string
  items: NavItem[]
}

// ── RBAC ────────────────────────────────────────────────────────────────────

/**
 * Concede un permiso a un rol por defecto.
 * El seed itera los `defaultGrants` de cada módulo y aplica upserts.
 */
export interface RolePermissionGrant {
  /** Slug del rol según la tabla `roles` */
  roleSlug: string
  /** Clave del permiso (ej: "requests:create") */
  permission: string
}

// ── Manifest ─────────────────────────────────────────────────────────────────

/**
 * Contrato que todo módulo debe exportar.
 *
 * Uso en cada módulo:
 * ```ts
 * export const myModule = {
 *   id: "my-module",
 *   permissions: ["my-module:create", "my-module:view"] as const,
 *   nav: [{ areaId: "...", items: [...] }],
 *   defaultGrants: [{ roleSlug: "administrador", permission: "my-module:create" }],
 * } satisfies ModuleManifest
 * ```
 *
 * `as const` en `permissions` preserva los literal types para que el registry
 * pueda derivar el type `Permission` automáticamente.
 */
export interface ModuleManifest {
  /** Identificador único del módulo (kebab-case) */
  id: string
  /**
   * Permisos que este módulo introduce al sistema.
   * Declara con `as const` para que TypeScript infiera literal types.
   */
  permissions: readonly string[]
  /** Secciones de navegación del módulo */
  nav?: NavSection[]
  /**
   * Función que hace upsert de datos base del módulo en la BD.
   * Llamada por db/seed.ts via registry en orden de registro.
   */
  seed?: (db: DB) => Promise<void>
  /** Asignación por defecto de permisos a roles */
  defaultGrants?: RolePermissionGrant[]
}
