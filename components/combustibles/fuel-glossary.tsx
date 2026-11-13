"use client"

import * as React from "react"
import { Question } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { FUEL_GLOSSARY, fuelTermDefinition } from "@/lib/combustibles/glossary"

/**
 * «¿Qué significa?»: las palabras del módulo en simple. Va al final de
 * `PageHeader.actions` en cada pantalla de Combustible.
 */
export function FuelGlossaryButton() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {/* Sólo ícono: el texto competía con la acción primaria en una cabecera que
            ya lleva período, «Agregar datos» y exportación (auditoría 2026-11-13, C12). */}
        <Button type="button" variant="ghost" size="icon" aria-label="¿Qué significa? Glosario de combustible" title="¿Qué significa?">
          <Question aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <div>
            <SheetTitle>¿Qué significa?</SheetTitle>
            <SheetDescription>Las palabras del módulo de combustible, en simple.</SheetDescription>
          </div>
          <SheetCloseButton />
        </SheetHeader>
        <SheetBody>
          <dl className="space-y-4">
            {FUEL_GLOSSARY.map((entry) => (
              <div key={entry.term}>
                <dt className="font-semibold">
                  {entry.term}
                  {entry.formerly ? <span className="ml-1.5 text-sm font-normal text-[var(--color-text-subtle)]">· antes «{entry.formerly}»</span> : null}
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--color-text-muted)]">{entry.definition}</dd>
              </div>
            ))}
          </dl>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

/** Un término del módulo con su definición en un `title` (A6). */
export function FuelTerm({ term, children }: { term: string; children?: React.ReactNode }) {
  const definition = fuelTermDefinition(term)
  if (!definition) return <>{children ?? term}</>
  return (
    <abbr title={definition} className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline">
      {children ?? term}
    </abbr>
  )
}
