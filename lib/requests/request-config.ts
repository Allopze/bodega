/**
 * Request Module Config — parametriza la diferencia entre repuestos y servicios.
 *
 * Cada módulo (repuestos, servicios) provee una config de este tipo.
 * El factory en request-service.ts la usa para generar las funciones compartidas.
 *
 * Nota: los tipos de tabla Drizzle son demasiado complejos para tiparlos aquí.
 *       La seguridad de tipos se mantiene en los wrappers delgados (lib/services/*.ts).
 */

// ── Attribute names map: field → display label ────────────────────────────────

export type AttributeNamesMap = Record<string, string>

// ── Storage helpers config ────────────────────────────────────────────────────

export interface StorageConfig {
  /** Directory where files are stored (e.g. resolveRepuestosDir()) */
  dir: () => string
  /** Create a relative storage path from a safe file name */
  createPath: (storageName: string) => string
  /** Resolve a relative path to an absolute filesystem path (null = invalid) */
  resolveFile: (filePath: string) => string | null
}

// ── Complete module config ────────────────────────────────────────────────────

export interface RequestModuleConfig {
  /** The request_type discriminator column value */
  requestType: "repuestos" | "servicios"
  /** Prefix for auto-generated codes (e.g. "REP", "SER") */
  codePrefix: string
  /** Drizzle table reference for the quotations table */
  quotationsTable: any
  /** Key used in db.query[name] for the quotations table */
  quotationsQueryName: string
  /** Entity type value for audit logging */
  quotationEntityType: string
  /** Attribute names map: fieldName → displayLabel */
  attributeNames: AttributeNamesMap
  /** Storage paths */
  storage: StorageConfig
}
