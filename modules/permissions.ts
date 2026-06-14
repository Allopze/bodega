/**
 * modules/permissions.ts — Tipo Permission derivado del registry
 *
 * En lugar de mantener manualmente un union type de 23+ strings (que habría que
 * actualizar cada vez que se agrega un módulo), este archivo los deriva del registry.
 *
 * Migración:
 *   - Fase 0-1: Permission re-exporta el tipo estático de lib/auth/types para no
 *     romper los ~103 sitios que ya lo importan. El registry todavía está vacío.
 *   - Fase 2+: A medida que los módulos se registran con `as const`, el tipo
 *     derivado `RegistryPermission` va tomando forma.
 *   - Fase 3: Cuando todos los módulos estén registrados, se elimina la
 *     re-exportación legacy y se usa solo `RegistryPermission`.
 *
 * USO:
 *   import type { Permission } from "@/modules/permissions"
 *   — En código nuevo usar esta ruta, no @/lib/auth/types
 */

import type { registry } from "./registry"

// ── Tipo derivado (vacío hasta que los módulos se registren) ──────────────────

/**
 * Unión de todos los permission keys declarados por los módulos registrados.
 * Cuando el registry está vacío = never.
 * Cuando todos los módulos estén registrados = el type completo y correcto.
 */
export type RegistryPermission = typeof registry[number]["permissions"][number]

// ── Tipo legacy (re-exportación de compatibilidad) ────────────────────────────
// Mantiene compatibilidad mientras los módulos se van registrando.
// Eliminar en Fase 3 cuando todos estén en el registry.
export type { Permission } from "@/lib/auth/types"

// ── Constante útil para seed y audit ─────────────────────────────────────────
import { registry as _registry } from "./registry"
import type { ModuleManifest } from "@/modules/manifest-types"

/**
 * Array plano de todos los permisos declarados por los módulos registrados.
 * Cast a ReadonlyArray<ModuleManifest> para que funcione con registry vacío
 * (cuando está vacío TypeScript infiere `never` en el elemento, no ModuleManifest).
 */
export const ALL_MODULE_PERMISSIONS = (
  _registry as ReadonlyArray<ModuleManifest>
).flatMap((m) => m.permissions)

export const ALL_MODULE_DEFAULT_GRANTS = (
  _registry as ReadonlyArray<ModuleManifest>
).flatMap((m) => m.defaultGrants ?? [])
