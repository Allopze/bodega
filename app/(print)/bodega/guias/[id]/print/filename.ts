/**
 * Nombre sugerido del PDF de una Guía de Despacho Interna.
 * "GDI-000012" → "Guia despacho interna GDI-000012.pdf".
 */
export function guidePdfFilename(code: string): string {
  return `Guia despacho interna ${code}.pdf`
}
