import type { RiskClassification } from "@/lib/prevention/miper/methodology"

/**
 * Las cuatro bandas del RE-04 (Tolerable → Intolerable) como las dibujan los
 * gráficos de riesgo: verde, ámbar, naranja y rojo, la lectura canónica de un
 * mapa de riesgos. Son estados, así que van con los semánticos
 * (`success`, `warning`, `signal`, `danger`) y no con la serie categórica
 * (`--color-chart-N`), tal como pide DESIGN.md § Gráficos.
 *
 * Sólo los mapas de calor y las barras apiladas usan esta paleta de cuatro
 * tonos. El `RiskClassificationBadge` de las filas conserva la suya (el
 * Importante en rojo suave, el Intolerable en rojo sólido): allí el estado va
 * en un rótulo, y el contraste entre dos vecinos no se juega.
 *
 * El color NUNCA es la única señal: cada consumidor imprime además el rótulo y
 * la cifra.
 */

/** Relleno sólido de la banda (tramos de barra, marcas de leyenda). Es superficie, no texto: para texto, `-ink`. */
export const RISK_BAND_FILL: Record<RiskClassification, string> = {
  tolerable: "var(--color-success)",
  moderate: "var(--color-warning)",
  // Naranjo cargado al rojo: `signal` puro quedaba a un paso del ocre de `moderate`,
  // y ésa es justo la frontera que exige seguimiento (recorrido del 2026-11-03).
  important: "color-mix(in oklab, var(--color-signal) 55%, var(--color-danger))",
  intolerable: "var(--color-danger)",
}

/**
 * Celda del mapa de calor. `zone`: la celda sin riesgos, que sólo marca la zona
 * (tinte tenue, texto atenuado). `filled`: la celda con riesgos, un escalón más
 * intenso (`-line` con texto `-ink`; el Intolerable, rojo sólido con texto
 * blanco). Dos intensidades discretas y ninguna interpolación: la escala 1-2-4
 * no es lineal.
 */
export const RISK_BAND_CELL: Record<RiskClassification, { zone: string; filled: string }> = {
  tolerable: {
    zone: "bg-[var(--color-success-tint)] text-[var(--color-text-muted)]",
    filled: "bg-[var(--color-success-line)] text-[var(--color-success-ink)]",
  },
  moderate: {
    zone: "bg-[var(--color-warning-tint)] text-[var(--color-text-muted)]",
    filled: "bg-[var(--color-warning-line)] text-[var(--color-warning-ink)]",
  },
  important: {
    zone: "bg-[var(--color-signal-tint)] text-[var(--color-text-muted)]",
    filled: "bg-[var(--color-signal-line)] text-[var(--color-signal-ink)]",
  },
  intolerable: {
    zone: "bg-[var(--color-danger-tint)] text-[var(--color-text-muted)]",
    filled: "bg-[var(--color-danger)] text-white",
  },
}
