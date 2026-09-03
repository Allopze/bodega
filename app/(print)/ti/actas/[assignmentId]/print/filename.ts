/** Nombre del PDF descargable del acta de entrega/devolución. */
export function actaPdfFilename(code: string): string {
  return `acta-${code.toLowerCase()}.pdf`
}
