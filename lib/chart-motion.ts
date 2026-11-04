/**
 * Tope de la entrada de un gráfico (DESIGN.md § Gráficos › Movimiento).
 *
 * Vive aquí, y no en `components/ui/chart-interactions.tsx`, porque esa pieza es
 * `"use client"` y arrastra recharts: un Server Component (`RankedList`, el
 * medidor radial) que importara el valor desde allí recibiría una referencia de
 * cliente y no el número, y un componente de cliente sin recharts
 * (`DebtAgingChart`) pagaría el chunk de gráficos sólo por una constante.
 * `chart-interactions.tsx` la re-exporta con el mismo nombre; hay un solo número.
 */
export const CHART_ENTRY_MS = 200
