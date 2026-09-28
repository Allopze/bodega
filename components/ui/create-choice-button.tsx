"use client"

import * as React from "react"
import { CaretRight, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export interface CreateChoice {
  key: string
  /** Rótulo dentro del selector ("Comité paritario"). */
  label: string
  description: string
  icon?: React.ReactNode
  /** Texto del botón cuando es la única opción disponible ("Nuevo comité"). */
  soloLabel: string
  /** Pinta el diálogo de alta, abierto por este componente. */
  render: (state: { open: boolean; onOpenChange: (open: boolean) => void }) => React.ReactNode
}

/**
 * Un solo "Nuevo" de página que pregunta *qué* crear (AGENTS.md, layout 5 y
 * densidad A3). Es el patrón de `admin/pdtp-catalogos/pdtp-actions.tsx` y
 * `admin/productos/product-actions.tsx`, extraído porque lo necesitan varias
 * pantallas de Prevención con dos o tres altas que antes vivían como botones
 * sueltos en la barra de filtros.
 *
 * Las opciones llegan ya filtradas por permiso: con una sola, el botón abre
 * directamente su diálogo (preguntar "¿qué quieres crear?" con una única
 * respuesta sería un clic de más); sin ninguna, no se pinta nada.
 */
export function CreateChoiceButton({
  choices,
  label = "Nuevo",
  title = "¿Qué quieres crear?",
  description,
}: {
  choices: CreateChoice[]
  label?: string
  title?: string
  description: string
}) {
  const [chooserOpen, setChooserOpen] = React.useState(false)
  const [active, setActive] = React.useState<string | null>(null)

  if (choices.length === 0) return null
  const solo = choices.length === 1 ? choices[0] : null

  return (
    <>
      <Button
        size="sm"
        variant="primary"
        aria-haspopup="dialog"
        onClick={() => (solo ? setActive(solo.key) : setChooserOpen(true))}
      >
        <Plus size={14} aria-hidden />{solo ? solo.soloLabel : label}
      </Button>

      {!solo && (
        <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {choices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  data-choice={choice.key}
                  onClick={() => { setChooserOpen(false); setActive(choice.key) }}
                  className="group flex items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"
                >
                  {choice.icon && (
                    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
                      {choice.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-(--color-text)">{choice.label}</span>
                    <span className="block text-xs text-(--color-text-muted)">{choice.description}</span>
                  </span>
                  <CaretRight aria-hidden size={16} className="shrink-0 text-(--color-text-faint)" />
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {choices.map((choice) => (
        <React.Fragment key={choice.key}>
          {choice.render({
            open: active === choice.key,
            onOpenChange: (open) => setActive(open ? choice.key : null),
          })}
        </React.Fragment>
      ))}
    </>
  )
}
