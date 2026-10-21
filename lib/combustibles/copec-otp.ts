import { ImapFlow, type MessageStructureObject } from "imapflow"

/**
 * Código de verificación del login Copec, leído desde la casilla de la cuenta
 * de plataforma.
 *
 * Desde 2026-10 el portal TCT/TAE pide, después de usuario y clave, un código
 * de 6 dígitos que envía por correo (`info@copec.cl`, "COPEC TCT: Código de
 * verificación"; vence en minutos y es de un solo uso). La cuenta y su casilla
 * existen sólo para esta integración, así que la sincronización lee la casilla
 * por IMAP, toma el código y lo marca leído para que nunca se reutilice.
 *
 * El código no se registra en ningún log ni mensaje de error.
 */

export const COPEC_OTP_SENDER = "info@copec.cl"

export interface CopecOtpConfig {
  host: string
  port: number
  user: string
  password: string
}

/** `null` si falta alguna variable: el llamador lo reporta como falla de configuración. */
export function readCopecOtpConfig(env: Record<string, string | undefined> = process.env): CopecOtpConfig | null {
  const host = env.COPEC_OTP_IMAP_HOST?.trim()
  const user = env.COPEC_OTP_IMAP_USER?.trim()
  const password = env.COPEC_OTP_IMAP_PASSWORD?.trim()
  const port = Number(env.COPEC_OTP_IMAP_PORT?.trim() || 993)
  if (!host || !user || !password || !Number.isInteger(port) || port <= 0) return null
  return { host, port, user, password }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&oacute;/gi, "ó")
    .replace(/&nbsp;/gi, " ")
}

/**
 * Extrae el código del cuerpo del correo (HTML o texto). Se ancla a la frase
 * "código de verificación ... es:" y toma los 6 dígitos que siguen: el HTML
 * trae otros números de 6 cifras (estilos, pie), así que un `\d{6}` suelto
 * podía devolver uno equivocado.
 */
export function extractCopecOtp(body: string): string | null {
  const text = decodeEntities(body.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ")
  return text.match(/c[oó]digo de verificaci[oó]n[^0-9]{0,80}?\bes:?\s*(\d{6})\b/i)?.[1] ?? null
}

/** Un correo candidato, ya decodificado. */
export interface CopecOtpMessage {
  id: number
  receivedAt: Date
  body: string
}

/** La casilla, reducida a lo que necesita la espera del código. */
export interface CopecOtpMailbox {
  /** Correos de Copec no leídos recibidos desde `since`. */
  unreadSince(since: Date): Promise<CopecOtpMessage[]>
  /** Marca el correo como leído: un código consumido no vuelve a tomarse. */
  markUsed(id: number): Promise<void>
  close(): Promise<void>
}

export class CopecOtpTimeoutError extends Error {
  constructor() {
    super("El código de verificación de Copec no llegó al correo de la plataforma a tiempo.")
    this.name = "CopecOtpTimeoutError"
  }
}

/**
 * Margen hacia atrás sobre el instante del clic en "Ingresar". La fecha de
 * recepción la pone el servidor de correo, cuyo reloj puede ir algo adelante o
 * atrás del nuestro; sin margen, un código legítimo quedaba fuera del filtro.
 */
const CLOCK_SKEW_MS = 60_000

/**
 * Espera el código pedido por el login que empezó en `requestedAt`. Toma el
 * correo MÁS NUEVO: si quedó un código sin usar de un intento anterior dentro
 * del margen de reloj, el que vale es el último que envió Copec.
 */
export async function waitForCopecOtp(
  mailbox: CopecOtpMailbox,
  requestedAt: Date,
  options: { timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<string> {
  const { timeoutMs = 90_000, pollMs = 3_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = options
  const since = new Date(requestedAt.getTime() - CLOCK_SKEW_MS)
  const deadline = now() + timeoutMs
  for (;;) {
    const messages = (await mailbox.unreadSince(since))
      .filter((message) => message.receivedAt >= since)
      .sort((left, right) => right.receivedAt.getTime() - left.receivedAt.getTime())
    for (const message of messages) {
      const code = extractCopecOtp(message.body)
      if (!code) continue
      await mailbox.markUsed(message.id)
      return code
    }
    if (now() >= deadline) throw new CopecOtpTimeoutError()
    await sleep(pollMs)
  }
}

function findTextPart(node: MessageStructureObject | undefined): { part: string; type: string } | null {
  if (!node) return null
  if (node.childNodes?.length) {
    const parts = node.childNodes.map(findTextPart).filter((part): part is { part: string; type: string } => part !== null)
    return parts.find((part) => part.type === "text/html") ?? parts[0] ?? null
  }
  if (node.type === "text/html" || node.type === "text/plain") return { part: node.part ?? "1", type: node.type }
  return null
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

/** Casilla IMAP real. Mantiene una conexión abierta mientras dura la espera. */
export async function openCopecOtpMailbox(config: CopecOtpConfig): Promise<CopecOtpMailbox> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.port === 993,
    auth: { user: config.user, pass: config.password },
    logger: false,
  })
  await client.connect()
  return {
    async unreadSince(since) {
      const lock = await client.getMailboxLock("INBOX")
      try {
        // SINCE de IMAP compara sólo la fecha, sin hora: se pide desde el día
        // anterior y la hora exacta la filtra `waitForCopecOtp`.
        const uids = await client.search({ from: COPEC_OTP_SENDER, seen: false, since: new Date(since.getTime() - 86_400_000) }, { uid: true })
        if (!uids || uids.length === 0) return []
        const candidates: Array<{ uid: number; receivedAt: Date; part: string }> = []
        for await (const message of client.fetch(uids, { internalDate: true, bodyStructure: true }, { uid: true })) {
          const receivedAt = message.internalDate instanceof Date ? message.internalDate : new Date(message.internalDate ?? 0)
          const part = findTextPart(message.bodyStructure)
          if (part && receivedAt >= since) candidates.push({ uid: message.uid, receivedAt, part: part.part })
        }
        const messages: CopecOtpMessage[] = []
        for (const candidate of candidates) {
          const download = await client.download(String(candidate.uid), candidate.part, { uid: true })
          messages.push({ id: candidate.uid, receivedAt: candidate.receivedAt, body: await streamToString(download.content) })
        }
        return messages
      } finally {
        lock.release()
      }
    },
    async markUsed(id) {
      const lock = await client.getMailboxLock("INBOX")
      try {
        await client.messageFlagsAdd(String(id), ["\\Seen"], { uid: true })
      } finally {
        lock.release()
      }
    },
    async close() {
      await client.logout().catch(() => {})
    },
  }
}
