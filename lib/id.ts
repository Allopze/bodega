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

/** Generate a human-readable code like "SOL-2026-0042" */
export function generateCode(prefix: string, seq: number, year?: number): string {
  const y = year ?? new Date().getFullYear()
  return `${prefix}-${y}-${String(seq).padStart(4, "0")}`
}
