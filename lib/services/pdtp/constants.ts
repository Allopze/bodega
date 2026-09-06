// Utilidades genéricas del dominio PDTP. El vocabulario fijo de la
// plantilla 2026 (hojas, nombres de exportación, abreviaturas de rol) vive
// en lib/services/pdtp-adapters/sheet-meta-2026.ts, no aquí.

// Las etiquetas de mes tienen una sola fuente en `lib/utils.ts` (contrato de
// fechas/numbers de la plataforma); `MONTH_LABELS` vivía duplicado en ~13
// archivos y se consolidó ahí. Este re-export conserva la ruta de importación
// histórica del dominio PDTP.
export { MONTH_LABELS } from "@/lib/utils"
