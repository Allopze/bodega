"use client"

import * as React from "react"
import type { SectionInfo } from "./types"

/**
 * I-19: el chip de navegación anteponía "{index+1}. " sobre `section.title`,
 * y una parte del catálogo SST ya numera sus secciones en el propio título
 * ("1. Documentos") mientras otra parte no ("Observaciones generales") — no
 * es consistente, así que no basta con quitar el prefijo siempre: sólo se
 * omite cuando el título ya empieza con un número.
 */
const SECTION_TITLE_ALREADY_NUMBERED = /^\d+\.\s/
export function sectionNavLabel(title: string, index: number) {
  return SECTION_TITLE_ALREADY_NUMBERED.test(title) ? title : `${index + 1}. ${title}`
}

const CHIP_CLASS = "shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium"

/**
 * Los chips de sección: un índice sirve a cualquiera que lea el checklist, no
 * sólo a quien ejecuta (I-09). Con más de una sección. `findingsCount`
 * antepone el chip «Hallazgos (n)» cuando la vista adelanta los hallazgos
 * antes de las secciones (revisión); sin él no hay chip.
 */
export function SectionNav({ sections, findingsCount }: { sections: SectionInfo[]; findingsCount?: number }) {
  if (sections.length <= 1) return null
  return (
    <nav aria-label="Secciones de la inspección" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-[var(--color-bg)] px-1 py-2 md:static md:bg-transparent">
      {findingsCount !== undefined && (
        <a href="#hallazgos" className={CHIP_CLASS}>Hallazgos ({findingsCount})</a>
      )}
      {sections.map((section, index) => <a key={section.id} href={`#section-${section.id}`} className={CHIP_CLASS}>{sectionNavLabel(section.title, index)}</a>)}
    </nav>
  )
}
