"use client"

import * as React from "react"
import { CaretDown, Info, X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

export interface OnboardingHintProps {
  storageKey: string
  title: string
  body: string
  className?: string
}

const OnboardingHintInner = React.memo(function OnboardingHintInner({
  storageKey,
  title,
  body,
  className,
}: OnboardingHintProps) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    try {
      setVisible(!localStorage.getItem(storageKey))
    } catch {
      setVisible(false)
    }
  }, [storageKey])

  function dismiss() {
    try {
      localStorage.setItem(storageKey, "1")
    } catch {
      /* ignore */
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    /* A-19: antes mostraba título + párrafo siempre, y sumado al resto de la
       ayuda de cabecera empujaba los datos fuera de la primera pantalla (en
       /recepcion, ~115px de ayuda sobre 2 filas de tabla). Ahora nace colapsado
       en una línea y se expande a voluntad. `<details>` nativo: sin estado de
       cliente, y es el mismo patrón que ya usa `StateLegend`. */
    /* El botón de descartar es hermano del <details>, no hijo del <summary>:
       un control interactivo dentro de otro dispara `nested-interactive` de axe
       (serio) y rompe el foco con lectores de pantalla. Lo detectó la suite e2e
       de accesibilidad en cuatro rutas. Se posiciona sobre la esquina para que
       siga leyéndose como parte de la tarjeta. */
    <div className={cn("relative", className)}>
      <details className="group rounded-[var(--radius)] border border-[var(--color-info-line)] bg-[var(--color-info-tint)]">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-2 pl-4 pr-14 select-none">
          <Info size={15} weight="fill" className="shrink-0 text-[var(--color-info-ink)]" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--color-info-ink)]">{title}</span>
          <CaretDown
            size={13}
            aria-hidden
            className="shrink-0 text-[var(--color-info-ink)] opacity-60 transition-transform group-open:rotate-180"
          />
        </summary>
        <p className="border-t border-[var(--color-info-line)] px-4 py-2.5 pl-11 text-xs text-[var(--color-info-ink)] opacity-80">
          {body}
        </p>
      </details>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar ayuda"
        /* Altura acotada a la del `summary`: con `min-h-11` el botón se metía
           dentro del cuerpo al expandirse. Ancho 44px para el objetivo táctil. */
        className="absolute right-1 top-0 flex h-9 w-11 items-center justify-center rounded text-[var(--color-info-ink)] opacity-50 transition-opacity hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  )
})

export const OnboardingHint = OnboardingHintInner
