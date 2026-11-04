import { coverageNoticeText } from "@/lib/combustibles/coverage-notice"

/**
 * Cifras de Flota que suman lo que el proveedor informó: «Costo combustible (12 meses)», litros,
 * cargas y las columnas por equipo. Lo dice el aviso de la pantalla (`CoverageNotice`) y la hoja
 * «Metadatos» de la exportación con **la misma frase**.
 */
export function fleetProviderGapSubject(lookbackMonths: number): string {
  return `los totales de ${lookbackMonths} meses`
}

/**
 * Aviso de que la ventana de cifras de Flota («Costo combustible (12 meses)», litros, cargas y
 * las columnas por equipo) tiene meses en que el proveedor no trajo datos (C-4): esas cifras
 * suman sólo lo que Copec informó, y un mes sin informe no es «no se cargó combustible».
 *
 * Es el texto del aviso compartido de cobertura (`coverageNoticeText`) con las cifras de Flota
 * por sujeto; la pantalla lo dibuja con `CoverageNotice` y la exportación lo lleva en
 * «Metadatos». `null` cuando no falta ningún mes. Los meses vienen de `getFleetProviderGapMonths`.
 */
export function fleetProviderGapNotice(gapMonths: readonly string[], lookbackMonths: number): string | null {
  return coverageNoticeText({ gapMonths, subject: fleetProviderGapSubject(lookbackMonths) })
}
