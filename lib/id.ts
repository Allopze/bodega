/** Simple nano-ID generator (no external dep needed for this) */
export function nanoid(size = 21): string {
  const chars = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"
  let id = ""
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  for (let i = 0; i < size; i++) {
    id += chars[bytes[i]! & 63]
  }
  return id
}

/**
 * Prefijos con una sola serie continua (sin año en el folio) y el ancho de su
 * secuencia. `lib/code-sequences.ts` los mapea al año 0 para que la SEQUENCE
 * nativa sea única en vez de una por año.
 */
const CONTINUOUS_CODE_PREFIXES: Record<string, number> = {
  SOL: 4,
  GDI: 6,   // Guía de Despacho Interna: "GDI-000001", correlativo único de por vida.
}

/** True si el prefijo usa una serie continua sin año (ver `CONTINUOUS_CODE_PREFIXES`). */
export function isContinuousCodePrefix(prefix: string): boolean {
  return prefix in CONTINUOUS_CODE_PREFIXES
}

/** Generate a human-readable code like "SOL-0042", "GDI-000001" or "OC-2026-0042". */
export function generateCode(prefix: string, seq: number, year?: number): string {
  const continuousPad = CONTINUOUS_CODE_PREFIXES[prefix]
  if (continuousPad) {
    return `${prefix}-${String(seq).padStart(continuousPad, "0")}`
  }
  const y = year ?? new Date().getFullYear()
  return `${prefix}-${y}-${String(seq).padStart(4, "0")}`
}
