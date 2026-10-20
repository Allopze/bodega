"use client"

import * as React from "react"
import type { SectionProgress } from "./run-view-helpers"
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

// 44 px de alto en el teléfono (objetivo táctil); desde `md` vuelve al chip compacto.
const CHIP_CLASS = "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium md:min-h-8"

/**
 * Los chips de sección: un índice sirve a cualquiera que lea el checklist, no
 * sólo a quien ejecuta (I-09). Con más de una sección. `findingsCount`
 * antepone el chip «Hallazgos (n)» cuando la vista adelanta los hallazgos
 * antes de las secciones (revisión); sin él no hay chip. `progress` (captura)
 * agrega a cada chip cuánto lleva la sección, «3/12».
 */
export function SectionNav({ sections, findingsCount, progress }: {
  sections: SectionInfo[]
  findingsCount?: number
  progress?: Record<string, SectionProgress>
}) {
  if (sections.length <= 1) return null
  return (
    <nav aria-label="Secciones de la inspección" className="sticky top-0 z-10 -mx-1 flex gap-2 overflow-x-auto bg-[var(--color-surface)] px-1 py-1.5 md:static md:bg-transparent">
      {findingsCount !== undefined && (
        <a href="#hallazgos" className={CHIP_CLASS}>Hallazgos ({findingsCount})</a>
      )}
      {sections.map((section, index) => {
        const done = progress?.[section.id]
        return (
          <a key={section.id} href={`#section-${section.id}`} className={CHIP_CLASS}>
            {sectionNavLabel(section.title, index)}
            {done && (
              <>
                <span aria-hidden="true" className="tabular-nums text-[var(--color-text-subtle)]">{done.answered}/{done.total}</span>
                <span className="sr-only">{done.answered} de {done.total} respondidos</span>
              </>
            )}
          </a>
        )
      })}
    </nav>
  )
}
