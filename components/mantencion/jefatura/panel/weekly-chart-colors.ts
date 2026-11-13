import { CHART_COLORS } from "@/lib/chart-palette"

/**
 * Colores del gráfico semanal: preventiva con el verde de marca y correctiva con
 * el azul de la paleta categórica. Ambos son tokens (`--color-primary`,
 * `--color-chart-2`), con el contraste de gráficos (3:1, WCAG 1.4.11) ya
 * comprobado por `design-tokens-contrast.test.ts`.
 *
 * Antes eran dos hex fijos y la correctiva iba en naranja: ese tono es el
 * semántico de «pendiente» (`--color-signal`), así que un registro correctivo ya
 * firmado se leía como trabajo por hacer (auditoría 2026-11-13, M14).
 */
export const WEEKLY_COLORS = { preventive: CHART_COLORS.brand, corrective: CHART_COLORS.blue } as const
