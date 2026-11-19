/**
 * lib/module-labels.ts — Nombre visible de cada módulo del registry.
 *
 * Vivía dentro de `lib/services/module-toggles.ts`; salió aquí para que la
 * vista «Apps» de TI (`lib/apps/catalog.ts`) lo use sin arrastrar la base de
 * datos a un módulo puro.
 *
 * ID de módulo → nombre propio.
 *
 * Antes esto devolvía el nombre del **área** de navegación, de modo que la
 * pantalla de módulos mostraba seis tarjetas llamadas "Adquisiciones", tres
 * "Control operacional", tres "Bodega" y tres "Prevención". Lo único que las
 * distinguía era el identificador técnico en inglés (`purchasing`,
 * `receiving`, `traceability`), justo el tipo de jerga que la auditoría
 * pide retirar del flujo estándar — y quien apagaba un módulo no podía saber
 * cuál estaba apagando. Cada módulo tiene ahora su propio nombre; el área
 * sigue disponible aparte para agrupar.
 */
export const MODULE_LABELS: Record<string, string> = {
  admin:           "Administración",
  requests:        "Solicitudes",
  approvals:       "Aprobaciones",
  purchasing:      "Órdenes de compra",
  receiving:       "Recepción",
  warehouse:       "Bodega",
  deliveries:      "Entregas",
  traceability:    "Trazabilidad",
  reports:         "Reportes",
  analytics:       "Analítica",
  repuestos:       "Repuestos",
  servicios:       "Servicios",
  sst:             "Evaluaciones SST",
  ppa:             "PPA digital",
  feedback:        "Soporte",
  combustibles:    "Combustibles",
  flota:           "Flota",
  mantencion_equipos: "Mantención de equipos",
  prevention:      "Prevención",
  operations:      "Pendientes operacionales",
  billing:         "Facturación y cobranza",
  ti:              "TI",
}

export function getModuleLabel(moduleId: string): string {
  return MODULE_LABELS[moduleId] ?? moduleId.charAt(0).toUpperCase() + moduleId.slice(1)
}
