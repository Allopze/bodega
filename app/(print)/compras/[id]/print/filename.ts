/**
 * Suggested download filename for an orden de compra PDF.
 * Format: "OC {número}" where {número} is the order code without its "OC-"
 * prefix (e.g. "OC-2026-0001" → "OC 2026-0001.pdf").
 */
export function ocPdfFilename(code: string): string {
  return `OC ${code.replace(/^OC-/, "")}.pdf`
}
