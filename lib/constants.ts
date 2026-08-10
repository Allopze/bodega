/**
 * Application-wide constants.
 *
 * Centralize page sizes, limits, and other magic numbers here
 * instead of scattering them across individual page files.
 */

/** Default number of items per page in list views */
export const DEFAULT_PAGE_SIZE = 25

/** Default IVA (VAT) rate for Chile — can be overridden via env var */
export const TAX_RATE = Number(process.env.TAX_RATE ?? 0.19)

/* ── Per-module page sizes ──────────────────────────────────────────────── */
// Only define overrides here; modules that want DEFAULT_PAGE_SIZE import it directly.

/** Solicitudes list */
export const SOLICITUDES_PAGE_SIZE = 25

/** Purchase orders list */
export const ORDERS_PAGE_SIZE = 25

/** Approval queue */
export const APPROVAL_REQUESTS_PAGE_SIZE = 20

/** Delivery history */
export const HISTORY_PAGE_SIZE = 25

/** Warehouse kardex */
export const KARDEX_PAGE_SIZE = 25

/** Receiving list */
export const RECEPCION_PAGE_SIZE = 25

/**
 * Cola de Compras: solicitudes aprobadas pendientes de OC. Más corta que el
 * resto porque cada fila se despliega con el desglose de sus ítems, y /compras
 * la muestra arriba del registro de OC — con 25 la segunda lista quedaba fuera
 * de la primera pantalla.
 */
export const PENDING_PURCHASE_PAGE_SIZE = 10

/** Traceability matrix — larger page size for data-density */
export const TRACEABILITY_PAGE_SIZE = 50

/** Max rows scanned for the in-memory alert computation in traceability */
export const TRACEABILITY_ALERT_SCAN_LIMIT = 1_000
