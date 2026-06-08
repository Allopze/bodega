import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import net from "node:net"
import tls from "node:tls"

type InvitationEmailInput = {
  to: string
  inviteUrl: string
  invitedByName?: string | null
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  from: string
}

type SmtpResponse = {
  code: number
  lines: string[]
  text: string
}

export function getAppBaseUrl() {
  return (
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "")
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user

  if (!host || !user || !pass || !from) return null
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("SMTP_PORT inválido")
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    from,
  }
}

export async function sendInvitationEmail({ to, inviteUrl, invitedByName }: InvitationEmailInput) {
  const config = getSmtpConfig()
  if (!config) return { sent: false as const, reason: "SMTP no configurado" }

  const senderName = invitedByName ?? "Un administrador"
  const text = [
    `${senderName} te invitó a Chome Solicitudes y Bodega.`,
    "",
    "Completa tu registro usando este enlace:",
    inviteUrl,
    "",
    "Si no esperabas esta invitación, puedes ignorar este correo.",
  ].join("\n")
  const html = [
    `<p>${escapeHtml(senderName)} te invitó a <strong>Chome Solicitudes y Bodega</strong>.</p>`,
    `<p><a href="${escapeHtml(inviteUrl)}">Completar registro</a></p>`,
    `<p>Si no esperabas esta invitación, puedes ignorar este correo.</p>`,
  ].join("")

  const client = await SmtpClient.connect(config)
  try {
    await client.sendMail({
      fromHeader: config.from,
      fromAddress: extractEmailAddress(config.from),
      toAddress: extractEmailAddress(to),
      subject: "Invitación a Chome Solicitudes y Bodega",
      text,
      html,
    })
  } finally {
    await client.close()
  }

  return { sent: true as const }
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to:      string
  subject: string
  text:    string
  html:    string
}) {
  const config = getSmtpConfig()
  if (!config) return { sent: false as const, reason: "SMTP no configurado" }

  const client = await SmtpClient.connect(config)
  try {
    await client.sendMail({
      fromHeader:  config.from,
      fromAddress: extractEmailAddress(config.from),
      toAddress:   extractEmailAddress(to),
      subject,
      text,
      html,
    })
  } finally {
    await client.close()
  }

  return { sent: true as const }
}

class SmtpClient {
  private socket: net.Socket | tls.TLSSocket
  private buffer = ""
  private lines: string[] = []
  private waiters: {
    resolve: (line: string) => void
    reject: (error: Error) => void
  }[] = []
  private closedError: Error | null = null

  private constructor(
    private readonly config: SmtpConfig,
    socket: net.Socket | tls.TLSSocket,
  ) {
    this.socket = socket
    this.attachSocket(socket)
  }

  static async connect(config: SmtpConfig) {
    const socket = await createSocket(config)
    const client = new SmtpClient(config, socket)

    await client.expect([220])
    const hello = await client.ehlo()

    if (!config.secure) {
      if (!hasCapability(hello, "STARTTLS")) {
        throw new Error("El servidor SMTP no ofrece STARTTLS")
      }
      await client.command("STARTTLS", [220])
      await client.upgradeToTls()
      await client.ehlo()
    }

    await client.authenticate()
    return client
  }

  async sendMail({
    fromHeader,
    fromAddress,
    toAddress,
    subject,
    text,
    html,
  }: {
    fromHeader: string
    fromAddress: string
    toAddress: string
    subject: string
    text: string
    html: string
  }) {
    await this.command(`MAIL FROM:<${fromAddress}>`, [250])
    await this.command(`RCPT TO:<${toAddress}>`, [250, 251])
    await this.command("DATA", [354])
    await this.writeData(buildMimeMessage({
      from: fromHeader,
      to: toAddress,
      subject,
      text,
      html,
    }))
    await this.expect([250])
  }

  async close() {
    if (this.socket.destroyed) return
    try {
      await this.command("QUIT", [221])
    } catch {
      this.socket.destroy()
    }
  }

  private attachSocket(socket: net.Socket | tls.TLSSocket) {
    socket.setEncoding("utf8")
    socket.setTimeout(20_000)
    socket.on("data", (chunk) => this.pushChunk(chunk))
    socket.on("error", (error) => this.fail(error))
    socket.on("timeout", () => {
      this.fail(new Error("Timeout esperando respuesta SMTP"))
      socket.destroy()
    })
    socket.on("close", () => {
      this.fail(new Error("Conexión SMTP cerrada"))
    })
  }

  private async ehlo() {
    return this.command(`EHLO ${getEhloName()}`, [250])
  }

  private async authenticate() {
    const token = Buffer
      .from(`\u0000${this.config.auth.user}\u0000${this.config.auth.pass}`, "utf8")
      .toString("base64")
    await this.command(`AUTH PLAIN ${token}`, [235])
  }

  private async upgradeToTls() {
    this.socket.removeAllListeners()
    const secureSocket = tls.connect({
      socket: this.socket,
      servername: this.config.host,
    })
    await once(secureSocket, "secureConnect")
    this.socket = secureSocket
    this.attachSocket(secureSocket)
  }

  private async command(command: string, expected: number[]) {
    await this.write(`${command}\r\n`)
    return this.expect(expected)
  }

  private async writeData(message: string) {
    const body = dotStuff(message)
    await this.write(`${body}\r\n.\r\n`)
  }

  private async write(value: string) {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(value, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private async expect(expected: number[]) {
    const response = await this.readResponse()
    if (!expected.includes(response.code)) {
      throw new Error(`Respuesta SMTP inesperada ${response.code}: ${response.text}`)
    }
    return response
  }

  private async readResponse(): Promise<SmtpResponse> {
    const firstLine = await this.readLine()
    const code = Number(firstLine.slice(0, 3))
    if (!Number.isInteger(code)) {
      throw new Error(`Respuesta SMTP inválida: ${firstLine}`)
    }

    const lines = [firstLine]
    while (lines[lines.length - 1]?.startsWith(`${code}-`)) {
      lines.push(await this.readLine())
    }

    return {
      code,
      lines,
      text: lines.map((line) => line.slice(4)).join("\n"),
    }
  }

  private readLine() {
    if (this.lines.length > 0) {
      return Promise.resolve(this.lines.shift() as string)
    }
    if (this.closedError) return Promise.reject(this.closedError)
    return new Promise<string>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  private pushChunk(chunk: string | Buffer) {
    this.buffer += chunk.toString()
    let newlineIndex = this.buffer.indexOf("\n")
    while (newlineIndex !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      this.pushLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine)
      newlineIndex = this.buffer.indexOf("\n")
    }
  }

  private pushLine(line: string) {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(line)
    else this.lines.push(line)
  }

  private fail(error: Error) {
    if (this.socket.destroyed && this.waiters.length === 0) return
    this.closedError = error
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter?.reject(error)
    }
  }
}

async function createSocket(config: SmtpConfig) {
  const socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.createConnection({ host: config.host, port: config.port })

  await once(socket, config.secure ? "secureConnect" : "connect")
  return socket
}

function hasCapability(response: SmtpResponse, capability: string) {
  return response.lines.some((line) =>
    line.slice(4).toUpperCase().startsWith(capability.toUpperCase())
  )
}

function buildMimeMessage({
  from,
  to,
  subject,
  text,
  html,
}: {
  from: string
  to: string
  subject: string
  text: string
  html: string
}) {
  const boundary = `chome-${randomUUID()}`
  return [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@chome.local>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Body(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Body(html),
    `--${boundary}--`,
  ].join("\r\n")
}

function dotStuff(message: string) {
  return message
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => line.startsWith(".") ? `.${line}` : line)
    .join("\r\n")
}

function encodeBase64Body(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trimEnd()
}

function encodeHeader(value: string) {
  const sanitized = sanitizeHeader(value)
  if (/^[\x20-\x7E]*$/.test(sanitized)) return sanitized
  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`
}

function sanitizeHeader(value: string) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Encabezado de correo inválido")
  }
  return value
}

function extractEmailAddress(value: string) {
  const sanitized = sanitizeHeader(value).trim()
  const match = sanitized.match(/<([^<>]+)>$/)
  const address = (match?.[1] ?? sanitized).trim()
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new Error(`Dirección de correo inválida: ${value}`)
  }
  return address
}

function getEhloName() {
  return process.env.SMTP_EHLO_NAME?.replace(/[^a-zA-Z0-9.-]/g, "") || "localhost"
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
