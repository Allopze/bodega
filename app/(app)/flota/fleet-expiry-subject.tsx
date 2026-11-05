import type { ReactNode } from "react"

/**
 * Rótulo corto del documento que vence, para la columna «Próximo vencimiento»
 * («Rev. técnica · vence en 9 días»). Una abreviatura lleva su nombre completo
 * en `title` (regla A6): «Permiso circ.» solo, sin él, no se entiende.
 *
 * Un tipo sin abreviatura (Padrón, Certificado de emisiones…) se escribe tal cual.
 */
const SUBJECT: Record<string, { short: string; full: string }> = {
  "SOAP": { short: "SOAP", full: "Seguro obligatorio de accidentes personales (SOAP)" },
  "Revisión técnica": { short: "Rev. técnica", full: "Revisión técnica" },
  "Permiso de circulación": { short: "Permiso circ.", full: "Permiso de circulación" },
  "Seguro": { short: "Seguro", full: "Seguro" },
}

export function fleetExpirySubject(documentType: string | null | undefined): ReactNode {
  if (!documentType) return undefined
  const subject = SUBJECT[documentType]
  if (!subject) return documentType
  return subject.short === subject.full ? subject.short : <abbr title={subject.full}>{subject.short}</abbr>
}
