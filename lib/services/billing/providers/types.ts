/**
 * lib/services/billing/providers/types.ts
 *
 * Contrato de un proveedor de facturación.
 *
 * La interfaz se define por **capacidades**, no por métodos obligatorios: un
 * proveedor declara qué sabe hacer y el resto del sistema pregunta antes de
 * pedirlo. Así no hay métodos que existen para lanzar "no soportado", y agregar
 * un proveedor no obliga a mentir sobre lo que puede.
 *
 * Nada de este archivo conoce FacturaEnLínea ni Chipax. Los DTO son el modelo
 * normalizado del dominio; cada adaptador traduce hacia acá.
 */

import type { BillingProviderId } from "@/db/schema"

/* ── Capacidades ─────────────────────────────────────────────────────────── */

export interface BillingProviderCapabilities {
  /** Puede listar los documentos que la empresa emitió (ventas). */
  canListIssuedInvoices: boolean
  /** Puede listar los documentos que la empresa recibió (compras). */
  canListReceivedInvoices: boolean
  /** Puede entregar el XML de un documento. */
  canRetrieveXml: boolean
  /** Puede entregar el PDF de un documento. */
  canRetrievePdf: boolean
  /** Puede listar pagos. */
  canListPayments: boolean
  /** Puede listar movimientos bancarios / cartolas. */
  canListBankTransactions: boolean
  /** Puede listar el maestro de clientes. */
  canListClients: boolean
  /** Puede CREAR documentos tributarios. La plataforma nunca lo usa. */
  canCreateInvoices: boolean
  /** Puede CREAR gastos. Requiere autorización explícita para activarse. */
  canCreateExpenses: boolean
}

/** Ningún proveedor puede nada hasta que lo declare. */
export const NO_CAPABILITIES: BillingProviderCapabilities = {
  canListIssuedInvoices: false,
  canListReceivedInvoices: false,
  canRetrieveXml: false,
  canRetrievePdf: false,
  canListPayments: false,
  canListBankTransactions: false,
  canListClients: false,
  canCreateInvoices: false,
  canCreateExpenses: false,
}

/* ── DTO normalizados ────────────────────────────────────────────────────── */

/**
 * Documento tal como lo entrega un proveedor, ya normalizado al vocabulario
 * interno pero antes de tocar la base de datos.
 *
 * `receiverTaxId` es opcional a propósito: hay fuentes (el listado de ventas de
 * FacturaEnLínea) que solo entregan la razón social. La resolución del RUT es
 * responsabilidad del sync, no del adaptador, y queda registrada en la
 * evidencia — nunca se inventa.
 */
export interface ProviderInvoice {
  /** Id del documento en el proveedor. Si el proveedor no tiene uno, el adaptador construye una clave natural estable. */
  externalId:     string
  direction:      "sale" | "purchase"
  docType:        string
  folio:          number
  issuerTaxId:    string | null
  issuerName:     string | null
  receiverTaxId:  string | null
  receiverName:   string | null
  issueDate:      string            // "YYYY-MM-DD"
  dueDate:        string | null
  currency:       string
  netAmount:      number | null
  taxAmount:      number | null
  exemptAmount:   number | null
  totalAmount:    number
  /** Estado documental del proveedor, ya traducido al vocabulario interno. */
  documentStatus: "issued" | "accepted" | "rejected" | "void" | "draft" | "unknown"
  /** Texto de estado del proveedor, para mostrar sin reinterpretar. */
  externalStatus: string | null
  /** URL del documento en el proveedor, si la expone. */
  documentUrl:    string | null
  /** URL del XML, para enriquecer bajo demanda. */
  xmlUrl:         string | null
  /** Cuenta/empresa dentro del proveedor (ej: CodEmp del portal). */
  accountRef:     string | null
  items:          ProviderInvoiceItem[]
}

export interface ProviderInvoiceItem {
  externalItemId: string | null
  description:    string
  quantity:       number | null
  unit:           string | null
  unitPrice:      number | null
  discountAmount: number | null
  netAmount:      number | null
  taxAmount:      number | null
  totalAmount:    number | null
  sortOrder:      number
}

export interface ProviderBankTransaction {
  externalId:        string
  transactionDate:   string          // "YYYY-MM-DD"
  amount:            number
  currency:          string
  description:       string | null
  counterpartyName:  string | null
  counterpartyTaxId: string | null
  /** Cuenta ya enmascarada por el adaptador. El número completo no sale del adaptador. */
  accountRef:        string | null
}

export interface ProviderClient {
  externalId: string
  taxId:      string | null
  name:       string
  email:      string | null
  phone:      string | null
}

/* ── Consulta ────────────────────────────────────────────────────────────── */

export interface ProviderPeriodQuery {
  /** Período a consultar, "YYYY-MM". */
  period: string
  /** Punto de reanudación entregado por una consulta anterior. */
  cursor?: string | null
}

/** Una página de resultados. `nextCursor` null = no hay más. */
export interface ProviderPage<T> {
  items:      T[]
  nextCursor: string | null
  /** Total declarado por el proveedor, si lo informa. Sirve para detectar pérdidas. */
  reportedTotal: number | null
  /** Cursor logical managed by the provider, not normal HTTP pagination. */
  managedCursor?: boolean
  /** Stop this sync after the page; the next cron resumes from nextCursor. */
  deferred?: boolean
  /** A selected XML was not durable/resolved; do not advance its cursor. */
  retryRequired?: boolean
}

export interface ProviderHealth {
  ok: boolean
  /** Mensaje ya redactado: nunca credenciales ni cuerpos completos. */
  detail: string
  checkedAt: string
}

/* ── Errores ─────────────────────────────────────────────────────────────── */

export type BillingProviderErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_SUPPORTED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "PARSE_FAILED"
  | "INVALID_RESPONSE"
  | "CONTRACT_UNKNOWN"
  | "UNKNOWN"

export class BillingProviderError extends Error {
  constructor(
    message: string,
    readonly code: BillingProviderErrorCode,
    readonly provider: BillingProviderId,
  ) {
    super(message)
    this.name = "BillingProviderError"
  }
}

/* ── Interfaz ────────────────────────────────────────────────────────────── */

/**
 * Proveedor de facturación. Todos los métodos de datos son **opcionales**: la
 * presencia del método y la capacidad declarada tienen que coincidir, y eso lo
 * verifica una prueba (`providers.test.ts`).
 */
export interface BillingProvider {
  readonly id: BillingProviderId
  readonly label: string
  readonly capabilities: BillingProviderCapabilities

  /** True si hay credenciales/configuración suficientes para operar. */
  isConfigured(): Promise<boolean>
  /** Diagnóstico sin secretos. Nunca lanza: reporta. */
  healthCheck(): Promise<ProviderHealth>

  listIssuedInvoices?(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderInvoice>>
  listReceivedInvoices?(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderInvoice>>
  /** Enriquecimiento bajo demanda: devuelve los campos que solo están en el XML. */
  getInvoiceXml?(invoice: Pick<ProviderInvoice, "externalId" | "xmlUrl">): Promise<string>
  listBankTransactions?(query: ProviderPeriodQuery): Promise<ProviderPage<ProviderBankTransaction>>
  listClients?(): Promise<ProviderClient[]>
}
