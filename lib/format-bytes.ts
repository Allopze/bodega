/**
 * Format byte sizes into human-readable strings.
 * Used across admin pages and reports.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes === 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
