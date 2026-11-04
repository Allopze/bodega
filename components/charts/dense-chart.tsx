"use client"

import type { ReactNode } from "react"
import { useMediaQuery } from "@/lib/hooks/use-media-query"

/**
 * Bajo 360 px de ancho de pantalla (un teléfono chico en vertical: 320–359 px) un
 * gráfico denso deja de leerse: el diagrama de dispersión son puntos de 3 px, los
 * paneles de una serie pequeña caben de a uno y un ranking de veinte barras queda
 * con las etiquetas cortadas. 359,98 y no 359: con escalado de pantalla el ancho
 * puede ser fraccionario y la consulta no debe dejar un hueco antes de 360.
 *
 * Es una consulta de **pantalla**, no de contenedor: el gráfico está siempre dentro
 * de una tarjeta con relleno, así que un contenedor mide ~290 px incluso en un
 * teléfono de 375 px y la regla reemplazaría gráficos en casi todos los móviles.
 */
export const NARROW_CHART_PX = 360
export const NARROW_CHART_QUERY = "(max-width: 359.98px)"

/** ¿La pantalla es más angosta que 360 px? (`false` en el servidor.) */
export function useNarrowViewport(): boolean {
  return useMediaQuery(NARROW_CHART_QUERY)
}

/**
 * Reemplaza un gráfico denso por su equivalente textual bajo 360 px.
 *
 * Es **el** mecanismo de la regla «Responsive» de `DESIGN.md § Gráficos`: cada
 * pantalla lo usa en vez de decidir por su cuenta. `fallback` es lo que se muestra
 * en lugar del dibujo: un `RankedList` cuando hay una medida que ordenar (litros por
 * faena) o una tabla cuando son pares de valores (dos ejes). Nunca un gráfico más
 * chico: lo que no cabe, no se dibuja.
 *
 * - `when` deja el gráfico aunque la pantalla sea angosta. Para la densidad que
 *   depende de los datos: una barra apilada con 4 segmentos cabe, con más de 6 no.
 * - Con la pantalla ancha monta sólo el gráfico y con la angosta sólo el reemplazo:
 *   no se renderizan los dos y se esconde uno con CSS, porque un `ResponsiveContainer`
 *   dentro de un `display:none` mide 0 y recharts avisa por consola.
 * - Es un componente de cliente que parte en «ancho» (también en el servidor y en la
 *   hidratación): en una pantalla angosta el cambio llega al montar.
 */
export function DenseChart({
  fallback,
  when = true,
  children,
}: {
  fallback: ReactNode
  when?: boolean
  children: ReactNode
}) {
  const narrow = useNarrowViewport()
  if (!narrow || !when) return <>{children}</>
  return (
    <div data-dense-fallback="" className="min-w-0">
      <p className="mb-2 text-xs text-[var(--color-text-muted)]">Por el ancho de la pantalla, este gráfico se muestra como lista.</p>
      {fallback}
    </div>
  )
}
