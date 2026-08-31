"use client"

import { Info } from "@phosphor-icons/react/dist/ssr"
import { Tooltip } from "@/components/ui/tooltip"

/**
 * Botón de glosario de un KPI. Separado del `KpiCard` principal porque Radix
 * `Tooltip` monta estado (open/close) y, cuando se renderiza desde un Server
 * Component, dispara un `Hydration failed because the server rendered HTML
 * didn't match the client`: el span con `onPointerMove` y `onPointerLeave`
 * sólo existe en el árbol del cliente, y React 19 lo compara byte a byte con
 * lo que produjo el server.
 *
 *   - Server output: `<span class="cursor-help">…</span>`
 *   - Client output: `<span … onPointerMove={…} onPointerLeave={…} …>`
 *
 * Al aislar el Tooltip en un Client Component, el límite cliente/servidor cae
 * justo en este span. El server emite el placeholder con `suppressHydrationWarning`
 * (los handlers los añade React al hidratar) y el cliente los monta después.
 */
export function KpiCardGlossary({ content }: { content: string }) {
  return (
    <Tooltip content={content} side="top">
      <span
        className="inline-flex cursor-help items-center text-[var(--color-text-subtle)] hover:text-[var(--color-text)]"
        suppressHydrationWarning
      >
        <Info size={14} />
      </span>
    </Tooltip>
  )
}
