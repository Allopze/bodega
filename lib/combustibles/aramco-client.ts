/**
 * Cliente del portal Aramco Fleet (Esmax, plataforma ex-Petrobras/Paytech).
 *
 * A diferencia de Copec —que exige Playwright para navegar un portal Telerik y
 * raspar un XLSX— Aramco expone la misma API REST JSON que consume su SPA. Por
 * eso acá no hay navegador: sólo `fetch`.
 *
 * El portal usa un teclado virtual anti-keylogger, pero el teclado LO GENERA EL
 * CLIENTE: se manda la secuencia de índices de botón junto con el layout que se
 * usó, y el servidor resuelve. Cada botón cubre DOS dígitos, así que un
 * observador aprende sólo pares, no la clave. Como nosotros elegimos el layout,
 * autenticarse es cálculo puro y no hace falta hacer clics.
 *
 * Flujo: `users/authenticatecredential` (devuelve las cuentas del RUT) ->
 * `token` con el `systemOperatorId` elegido -> Bearer para todo lo demás.
 */

const API_ROOT = "https://www.portaltarjetas.cl/sigaf/flota2/api/"
const REQUEST_TIMEOUT_MS = 60_000
/** Tope del portal por página; el histórico completo de esta cuenta entra en una. */
const PAGE_SIZE = 500
/** Cota de seguridad: si el portal empieza a paginar sin fin, cortamos. */
const MAX_PAGES = 40

/** Programa de flota. `2` es Fuelmax, que no nos interesa. */
const PROGRAM_TYPE_FLOTA = 1

export interface AramcoSession {
  token: string
  /** Prefijo de recurso ya resuelto, p. ej. `customers/23645/`. */
  baseUrl: string
  systemOperatorId: number
  customerName: string
}

/** Fila de `movements`: una transacción de carga. Campos verificados en vivo. */
export interface AramcoMovement {
  transactionId: number
  transactionDate: string
  vehicleRegistrationPlate: string | null
  cardNumber: string | null
  quantity: number
  /** Precio de lista antes de descuento. */
  originalAmount: number
  totalDiscountAmount: number
  /** Lo que efectivamente se cobra: `originalAmount - totalDiscountAmount`. */
  amountToPay: number
  productName: string | null
  productId: number | null
  /** Llegan como string y a veces nulos. */
  vehicleOdometer: string | null
  vehiclePreviousOdometer: string | null
  serviceStationName: string | null
  customerCostCenterName: string | null
  [key: string]: unknown
}

export interface AramcoVehicle {
  id: number
  registrationPlate: string | null
  typeDescription: string | null
  fuelTypeDescription: string | null
  statusDescription: string | null
  [key: string]: unknown
}

/** Credenciales rechazadas: no se reintenta, el portal bloquea por intentos. */
export class AramcoAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AramcoAuthError"
  }
}

/**
 * Falla del lado del portal, no nuestra.
 *
 * El backend de Aramco filtra excepciones internas con 400 y cuerpo de .NET (se
 * vio en vivo un "A second operation started on this context…", que es un error
 * de concurrencia de su propio DbContext). Volcarlo tal cual en el toast del
 * operador no le dice nada accionable, y no es un problema de credenciales ni de
 * datos: la corrida siguiente lo recupera sola, porque la sincronización no lleva
 * estado y es idempotente.
 */
export class AramcoUpstreamError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Aramco tuvo un error interno (HTTP ${status}). No es un problema de credenciales: reintenta en unos minutos.`)
    this.name = "AramcoUpstreamError"
  }
}

/**
 * El portal pidió segundo factor. Hoy la cuenta tiene
 * `twoFactorAuthentication: null` y no dispara, pero si lo activan el cron no
 * puede continuar solo: se distingue para que la UI pida intervención en vez de
 * mostrar un error genérico.
 */
export class AramcoTwoFactorRequiredError extends Error {
  constructor() {
    super("Aramco pidió autenticación de dos factores: la sincronización automática no puede continuar sin intervención")
    this.name = "AramcoTwoFactorRequiredError"
  }
}

/** Upstream JSON did not match the movement contract. No raw payload is kept in the error. */
export class AramcoPayloadValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Aramco entregó movimientos inválidos (${issues.length})`)
    this.name = "AramcoPayloadValidationError"
  }
}

/** Permutación aleatoria de 0-9, réplica de `generateKeyboard()` del portal. */
export function generateAramcoKeyboard(): number[] {
  const keyboard: number[] = []
  while (keyboard.length < 10) {
    const digit = Math.floor(Math.random() * 10)
    if (!keyboard.includes(digit)) keyboard.push(digit)
  }
  return keyboard
}

/** Etiquetas de los 5 botones: el teclado en pares, como los muestra el portal. */
function keyboardPairs(keyboard: number[]): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < keyboard.length; i += 2) pairs.push([keyboard[i]!, keyboard[i + 1]!])
  return pairs
}

/**
 * Arma el parámetro `login`: base64 de un query string.
 *
 * `password` no lleva la clave sino la secuencia de ÍNDICES de botón pulsados
 * (`setPassword(index)` en el portal), y `passwordType=2` le dice al servidor
 * que venga interpretado así. `passwordKeyboard` lleva el layout para que pueda
 * resolver qué par corresponde a cada pulsación.
 */
export function encodeAramcoLogin(
  documentNumber: string,
  password: string,
  keyboard: number[],
  systemOperatorId?: number,
): string {
  if (!/^\d+$/.test(password)) {
    // Sin esto un carácter no numérico daría índice -1 y el portal recibiría una
    // clave silenciosamente corrupta, gastando un intento de los que bloquean.
    throw new AramcoAuthError("La clave de Aramco debe ser numérica: el portal la captura con teclado de dígitos")
  }
  if (new Set(keyboard).size !== 10 || keyboard.length !== 10) {
    throw new AramcoAuthError("El teclado de Aramco debe ser una permutación de los dígitos 0-9")
  }

  const pairs = keyboardPairs(keyboard)
  const indices = [...password]
    .map((digit) => pairs.findIndex((pair) => pair.includes(Number(digit))))
    .join("")

  let data = `documentNumber=${documentNumber}`
    + `&password=${indices}`
    + `&passwordType=2`
    + `&passwordKeyboard=${pairs.map(([a, b]) => `${a} - ${b}`)}`
  if (systemOperatorId !== undefined) data += `&systemOperatorId=${systemOperatorId}`
  return Buffer.from(data, "utf8").toString("base64")
}

function headers(token?: string): Record<string, string> {
  const base: Record<string, string> = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Origin": "https://www.portaltarjetas.cl",
    "Referer": "https://www.portaltarjetas.cl/sigaf/",
    "Pragma": "no-cache",
  }
  if (token) base["Authorization"] = `Bearer ${token}`
  return base
}

async function request(path: string, init: RequestInit & { token?: string } = {}): Promise<unknown> {
  const { token, ...rest } = init
  const response = await fetch(API_ROOT + path, {
    ...rest,
    headers: { ...headers(token), ...(rest.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const body = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AramcoAuthError(`Aramco rechazó las credenciales (${response.status})`)
    }
    // 412 son validaciones legibles del portal y sí valen tal cual. El resto de
    // los 4xx/5xx con cuerpo de excepción .NET son fallas suyas: se traducen a un
    // mensaje accionable y el detalle queda en el error para el log.
    if (response.status !== 412 && /operation|context|exception|Object reference/i.test(body)) {
      throw new AramcoUpstreamError(response.status, body.slice(0, 300))
    }
    throw new Error(`Aramco respondió ${response.status} en ${path}: ${body.slice(0, 200)}`)
  }
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`Aramco respondió algo que no es JSON en ${path}`)
  }
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }
}

interface CredentialAccount {
  userId: number
  systemOperatorId: number
  systemOperatorName?: string
  programType?: number
  twoFactorAuthentication?: unknown
}

interface TokenResponse {
  access_token?: string
  environment_type?: string
  user_id?: number
}

/** Autentica y deja lista la sesión con el prefijo de recurso ya resuelto. */
export async function authenticateAramco(documentNumber: string, password: string): Promise<AramcoSession> {
  if (!documentNumber || !password) {
    throw new AramcoAuthError("Faltan las credenciales de Aramco: configúralas en Combustibles → Importar")
  }

  const accounts = await request(
    "users/authenticatecredential",
    form({ login: encodeAramcoLogin(documentNumber, password, generateAramcoKeyboard()) }),
  ) as CredentialAccount[] | null

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new AramcoAuthError("Aramco no devolvió ninguna cuenta para este RUT")
  }

  const account = accounts.find((candidate) => candidate.programType === PROGRAM_TYPE_FLOTA) ?? accounts[0]!
  if (account.twoFactorAuthentication) throw new AramcoTwoFactorRequiredError()

  // El teclado se regenera para el segundo POST: el portal entrega uno nuevo en
  // cada pantalla y reutilizar el anterior es justo lo que el esquema evita.
  const token = await request(
    "token",
    form({
      grant_type: "password",
      login: encodeAramcoLogin(documentNumber, password, generateAramcoKeyboard(), account.systemOperatorId),
    }),
  ) as TokenResponse | null

  if (!token?.access_token) throw new AramcoAuthError("Aramco no entregó un token de acceso")

  const baseUrl = token.environment_type === "CustomerCostCenter"
    ? `customers/${token.user_id ?? account.userId}/costcenters/${account.systemOperatorId}/`
    : `customers/${account.systemOperatorId}/`

  return {
    token: token.access_token,
    baseUrl,
    systemOperatorId: account.systemOperatorId,
    customerName: account.systemOperatorName ?? "",
  }
}

interface PagedResponse<T> {
  recordsTotal?: number
  totalPages?: number
  data?: T[]
}

/** Filtro del portal: `?filter=` + base64 del objeto de búsqueda. */
function filterParam(search: unknown): string {
  return "?filter=" + encodeURI(Buffer.from(JSON.stringify(search), "utf8").toString("base64"))
}

/** `DD-MM-YYYY HH:mm:ss`, el formato que espera el portal. */
function portalDate(plainDate: string, endOfDay: boolean): string {
  const [year, month, day] = plainDate.split("-")
  return `${day}-${month}-${year} ${endOfDay ? "23:59:59" : "00:00:00"}`
}

async function fetchAllPages<T>(session: AramcoSession, path: string, search: Record<string, unknown>): Promise<T[]> {
  const collected: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const payload = await request(
      path + filterParam({ ...search, pageNumber: page, pageSize: PAGE_SIZE }),
      { token: session.token },
    ) as PagedResponse<T> | null

    const rows = payload?.data ?? []
    collected.push(...rows)
    const totalPages = payload?.totalPages ?? 1
    if (page >= totalPages || rows.length === 0) return collected
  }
  throw new Error(`Aramco devolvió más de ${MAX_PAGES} páginas en ${path}: se cortó por seguridad`)
}

/**
 * Transacciones en un rango de fechas (`YYYY-MM-DD`, ambos inclusive).
 *
 * El endpoint devuelve 500 si se lo llama sin filtro, así que el rango no es
 * opcional.
 */
export async function fetchAramcoMovements(
  session: AramcoSession,
  from: string,
  to: string,
): Promise<AramcoMovement[]> {
  const rows = await fetchAllPages<AramcoMovement>(session, `${session.baseUrl}movements`, {
    operador: "and",
    orderBy: [{ name: "transactionDate", order: "asc" }],
    filter: [
      { name: "transactionDate", value: portalDate(from, false), condition: "gte" },
      { name: "transactionDate", value: portalDate(to, true), condition: "lte" },
    ],
  })
  const issues: string[] = []
  const ids = new Set<number>()
  const valid = rows.filter((row, index): row is AramcoMovement => {
    const candidate = row as Partial<AramcoMovement> | null
    const transactionId = candidate?.transactionId
    const validId = typeof transactionId === "number"
      && Number.isInteger(transactionId)
      && transactionId > 0
    const validDate = typeof candidate?.transactionDate === "string"
      && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(candidate.transactionDate)
    const numericFields = [candidate?.quantity, candidate?.originalAmount, candidate?.totalDiscountAmount, candidate?.amountToPay]
    const validNumbers = numericFields.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
    const validProduct = candidate?.productName === null || typeof candidate?.productName === "string"
    if (!validId || !validDate || !validNumbers || !validProduct) {
      issues.push(`fila ${index + 1}: contrato de movimiento inválido`)
      return false
    }
    if (ids.has(transactionId as number)) {
      issues.push(`fila ${index + 1}: transactionId duplicado`)
      return false
    }
    ids.add(transactionId as number)
    return true
  })
  if (issues.length > 0) throw new AramcoPayloadValidationError(issues)
  return valid
}

/** Catálogo de vehículos de la cuenta. */
export async function fetchAramcoVehicles(session: AramcoSession): Promise<AramcoVehicle[]> {
  return fetchAllPages<AramcoVehicle>(session, `${session.baseUrl}vehicles`, {
    operador: "and",
    orderBy: [{ name: "registrationPlate", order: "asc" }],
    filter: [],
  })
}
