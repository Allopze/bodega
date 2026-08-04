import type { ReactNode } from "react"

export interface MobileDocumentSummarySection {
  title: string
  fields: Array<{ label: string; value: ReactNode }>
}

interface MobileDocumentSummaryProps {
  title: string
  code: string
  description: string
  sections: MobileDocumentSummarySection[]
}

/**
 * Lectura HTML para teléfono. La hoja A4 y el PDF continúan siendo el
 * artefacto legal: este resumen evita encogerlos hasta volverlos ilegibles.
 */
export function MobileDocumentSummary({ title, code, description, sections }: MobileDocumentSummaryProps) {
  return (
    <main className="mobile-document-summary" aria-label={`Resumen de ${title}`}>
      <p className="mobile-document-summary-code">{code}</p>
      <h1>{title}</h1>
      <p className="mobile-document-summary-description">{description}</p>
      <p className="mobile-document-summary-notice">Esta es una vista de lectura. Descarga el PDF para conservar el documento A4 completo.</p>
      {sections.map((section) => (
        <section key={section.title} className="mobile-document-summary-section" aria-labelledby={`mobile-document-${section.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
          <h2 id={`mobile-document-${section.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>{section.title}</h2>
          <dl>
            {section.fields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </main>
  )
}
