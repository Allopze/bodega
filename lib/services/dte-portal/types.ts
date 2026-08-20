/**
 * lib/services/dte-portal/types.ts
 *
 * Tipos compartidos del portal DTE FacturaEnLinea.
 *
 * El portal es PHP legacy (paneldte.php): las credenciales viajan como
 * parámetros GET en cada request (RUT + clave), no hay API REST ni tokens.
 * Los datos se devuelven como HTML quebradizo que hay que parsear.
 *
 * @see explicacion_integral_dte_facturaenlinea.md § 2–19
 */

// ── Credenciales y configuración ─────────────────────────────────────────────

export interface DtePortalCredentials {
  /** RUT del usuario individual habilitado (ej: "6466452-2") */
  rutUsr: string
  /** RUT de la empresa contribuyente titular (ej: "78023530-6") */
  rutEmp: string
  /** Contraseña textual del usuario en la plataforma */
  clave: string
  /** Código interno de empresa asignado por el portal (ej: "433") */
  codEmp: string
}

export type DtePortalCredentialsSource =
  | { kind: "env" }
  | { kind: "system_settings"; keyId: string }

export interface DtePortalClientConfig {
  /** URL base del portal, ej: "https://clientes.dtefacturaenlinea.cl/facturaenlinea" */
  baseUrl: string
  credentials: DtePortalCredentials
  /** Milisegundos entre requests para respetar rate limiting informal. Default 500. */
  delayMs?: number
  /** Timeout por request HTTP. Default 30_000 ms. */
  requestTimeoutMs?: number
}

// ── Filtros de consulta ──────────────────────────────────────────────────────

/**
 * Valor del radio button `rlib`: define el libro/contexto documental.
 * @see § 3
 */
export type DteLibro = "ven" | "com" | "guia" | "bol" | "otro"

/**
 * Tipos de documento tributario chileno.
 * @see § 4
 */
export type DteTipo =
  | "00"  // Todos
  | "33"  // Factura Electrónica
  | "34"  // Factura Exenta Electrónica
  | "61"  // Nota de Crédito Electrónica
  | "56"  // Nota de Débito Electrónica
  | "43"  // Liquidación Factura Electrónica
  | "52"  // Guía de Despacho Electrónica
  | "39"  // Boleta Afecta Electrónica
  | "41"  // Boleta Exenta Electrónica
  | "30"  // Factura Afecta (manual)
  | "32"  // Factura Exenta (manual)
  | "60"  // Nota de Crédito (manual)
  | "55"  // Nota de Débito (manual)
  | "92"  // Factura de Compra
  | "87"  // Factura de Compra Electrónica
  | "40"  // Liquidación Factura (manual)
  | "103" // Liquidación
  | "102" // Fac. Venta Exenta a Z.Franca
  | "110" // Factura Exportación Electrónica
  | "111" // Nota Débito Exportación Electrónica
  | "112" // Nota Crédito Exportación Electrónica
  | "88"  // Factura Exportación
  | "104" // Nota de Débito Exportación
  | "106" // Nota de Crédito Exportación
  | (string & {})

/**
 * @see § 19 — Estados de documentos en el portal
 */
export type DteEstadoSii =
  | "pendiente_envio"   // SiiPen.png
  | "enviado"           // SiiEnv.png
  | "aceptado"          // SiiEnvRec.png
  | "manual"            // SiiMan.png
  | "anulado"           // SiiAnu.png
  | "rechazado"         // SiiEnvPen.png

export type DteEstadoIntercambio =
  | "pendiente"     // flag_blue.png
  | "aceptado"      // flag_green.png
  | "rechazado"     // flag_red.png

/**
 * @see § 6.2 — Búsqueda por folio (fil=3)
 */
export interface DteFolioQuery {
  tipo: "folio"
  rlib: DteLibro
  tipoDoc: DteTipo
  folioDesde: number
  folioHasta: number
}

/**
 * @see § 6.1 — Filtro principal por período (fil=1)
 */
export interface DtePeriodoQuery {
  tipo: "periodo"
  rlib: DteLibro
  /** "YYYY-MM" */
  periodo: `${number}-${string}`
  /** Día del mes (01-31) o "00" = todos */
  dia: string
  /** Si true, buscar por fecha contable en vez de emisión */
  fechaContable?: boolean
}

/**
 * @see § 6.4 — Búsqueda por rango de fechas (fil=2)
 */
export interface DteRangoQuery {
  tipo: "rango"
  rlib: DteLibro
  desde: string  // yyyy-MM-dd
  hasta: string  // yyyy-MM-dd
}

/**
 * @see § 6.3 — Búsqueda por RUT cliente (fil=4)
 */
export interface DteRutQuery {
  tipo: "rut"
  rlib: DteLibro
  rutCliente: string
}

export type DteQuery = DteFolioQuery | DtePeriodoQuery | DteRangoQuery | DteRutQuery

// ── Bandeja de Entrada (Panel Correo) ────────────────────────────────────────
//
// Fuente real de las compras: a diferencia de paneldte.php?rlib=com (vacío,
// nunca se procesan los documentos hacia el libro), PNC_PanelCorreo.php trae
// los DTE que los proveedores envían a Chome, con RUT emisor incluido.
// Verificado contra el portal real (2026-08-04): 681 documentos en 2026-06,
// sin paginación (una sola respuesta trae todo el período).
// @see EXPLORACION_PORTAL_DTE_FACTURAENLINEA_2026-08-04.md § 7

export interface DteBandejaFilter {
  mes: string   // "01".."12"
  anio: string  // "2026"
  codEmp: string
  estadoPlataforma?: "" | "ENV" | "PEN" | "BLO"
  rutProveedor?: string
}

export interface DteBandejaRow {
  /** Fecha/hora de recepción del correo, tal como llega ("YYYY-MM-DD HH:mm") */
  fechaRecepcion: string
  /**
   * Misma fecha de recepción ya parseada a "YYYY-MM-DD" (null si el portal
   * mandó algo que no es fecha). La consulta filtra por fecha del DOCUMENTO,
   * así que este es el único dato que permite medir con cuánto atraso el
   * proveedor sube el DTE y decidir un re-barrido de períodos viejos.
   * Opcional sólo porque hay fixtures que construyen filas a mano;
   * `parseBandejaRow` siempre la puebla.
   */
  fechaRecepcionDate?: string | null
  /**
   * Texto libre derivado del ícono `penplata.gif` (su `title`) cuando está
   * presente; `null` si no. La celda de texto correspondiente es en realidad
   * un comentario HTML nunca renderizado — no se debe leer como texto plano.
   */
  estadoPlataforma: string | null
  /** Fecha del documento "YYYY-MM-DD" */
  fecha: string
  /** Código de tipo de documento (33, 34, 52, 61, etc.) */
  tipoDoc: string
  folio: number
  rutEmisor: string
  razonSocial: string
  montoTotal: number
  tipoRef: string | null
  folioRef: string | null
  fechaRef: string | null
  /** Id interno del portal (Nreguist), extraído del post= de dtepdfX.php */
  nreguist: string | null
  pdfUrl: string | null
  /** Enlace directo al XML del proveedor, sin salto intermedio (ver § 7.3) */
  xmlUrl: string | null
}

export interface DteBandejaResult {
  rows: DteBandejaRow[]
  /**
   * Total declarado por el portal, o el conteo de filas cuando no lo declara.
   * Para verificar completitud NO sirve por sí solo: usar `declaredTotal`.
   */
  totalRegistros: number
  /**
   * Total tal como lo declaró el portal (`tbxTotalRegistros`), o null si el
   * marcador no estaba. En null la completitud no se puede verificar —
   * comparar `totalRegistros` contra las filas sería compararlas consigo
   * mismas— y la corrida debe reportarse `partial`, no `success`.
   */
  declaredTotal: number | null
}

// ── Documento extraído del HTML ──────────────────────────────────────────────

/**
 * Fila de la tabla de resultados de paneldte.php.
 * @see § 8 — Columnas de la tabla
 */
export interface DteDocumentRow {
  /** Identificador interno del portal (parámetro `nreg` o índice de fila) */
  rowId: string | null
  /** Estado SII desde columna "Aceptación SII" */
  estadoSii: DteEstadoSii | null
  /** Estado de intercambio electrónico (flag_*.png), si la columna lo expone */
  estadoIntercambio: DteEstadoIntercambio | null
  /** Fecha del documento "YYYY-MM-DD" */
  fecha: string
  /** Tipo de documento (33, 34, 61, 56, 52, etc.) */
  tipoDoc: string
  /** Número de folio */
  folio: number
  /** Razón social del emisor (libro compras) o receptor (libro ventas) */
  razonSocial: string
  /** Estado actual en la plataforma */
  estado: string
  /** Monto neto ($ CLP) */
  montoNeto: number | null
  /** Monto total ($ CLP) */
  montoTotal: number
  /** Enlace para descargar el PDF (pdf_dte.php?post=...) */
  pdfUrl: string | null
  /** Enlace para ver/descargar el XML */
  xmlUrl: string | null
  /** RUT del emisor (si se pudo determinar desde el contexto) */
  rutEmisor: string | null
  /** Código de empresa (CodEmp) desde el que se consultó */
  codEmp: string
}

// ── Resultados del parser ────────────────────────────────────────────────────

export interface DtePageResult {
  /** Documentos de la página actual */
  docs: DteDocumentRow[]
  /** Página actual (1-based) */
  currentPage: number
  /** Total de páginas, null si no se pudo determinar */
  totalPages: number | null
  /** Total de documentos encontrados, null si no se pudo determinar */
  totalDocs: number | null
  /** Fecha del período consultado, si aplica */
  periodo: string | null
}

// ── Errores ──────────────────────────────────────────────────────────────────

export class DtePortalError extends Error {
  constructor(
    message: string,
    public readonly code: DteErrorCode,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = "DtePortalError"
  }
}

export type DteErrorCode =
  | "AUTH_FAILED"         // 403 del portal, o credenciales inválidas
  | "NOT_FOUND"           // No se encontraron documentos
  | "PARSE_FAILED"        // El HTML cambió y no se pudo parsear
  | "RATE_LIMITED"        // El portal respondió con throttle
  | "TIMEOUT"             // Request timeout
  | "NETWORK_ERROR"       // Error de conexión
  | "INVALID_RESPONSE"    // Respuesta inesperada (no HTML, no XML)
  | "UNKNOWN"             // Error no clasificado
