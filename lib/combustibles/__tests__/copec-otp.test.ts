import { describe, expect, it, vi } from "vitest"
import { CopecOtpTimeoutError, extractCopecOtp, readCopecOtpConfig, waitForCopecOtp, type CopecOtpMailbox, type CopecOtpMessage } from "../copec-otp"

// Estructura real del correo de Copec (2026-10), con el código reemplazado.
const EMAIL_HTML = `<html><head><title>Neo Tac Copec</title><style>.style7 { font-size: 9pt; color: #023C75; } .bg { color: #666666; }</style></head>
<body><table><tr><td><p>Hola Automatizaci&#243;n Plataforma ,</p><p>Tu código de verificación para TCT es:</p>
<p style='font-size:24px;font-weight:bold;letter-spacing:4px;'>482915</p><p>El código vence en 10 minutos y es de un solo uso.</p>
<p class="footer">Copec S.A. 999999</p></td></tr></table></body></html>`

describe("extractCopecOtp", () => {
  it("toma el código del párrafo que sigue a la frase, no otro número de 6 cifras", () => {
    expect(extractCopecOtp(EMAIL_HTML)).toBe("482915")
  })

  it("acepta la frase con entidades HTML", () => {
    expect(extractCopecOtp("<p>Tu c&oacute;digo de verificaci&#243;n para TAE es:</p><p>003117</p>")).toBe("003117")
  })

  it("no inventa un código si el correo no trae la frase", () => {
    expect(extractCopecOtp("<p>Estado de cuenta 202610</p><p>Total 123456</p>")).toBeNull()
  })
})

describe("readCopecOtpConfig", () => {
  it("devuelve null si falta una variable", () => {
    expect(readCopecOtpConfig({ COPEC_OTP_IMAP_HOST: "h", COPEC_OTP_IMAP_USER: "u" })).toBeNull()
  })

  it("usa 993 por defecto", () => {
    expect(readCopecOtpConfig({ COPEC_OTP_IMAP_HOST: "h", COPEC_OTP_IMAP_USER: "u", COPEC_OTP_IMAP_PASSWORD: "p" })).toMatchObject({ port: 993 })
  })
})

function mailbox(batches: CopecOtpMessage[][]): CopecOtpMailbox & { used: number[] } {
  const used: number[] = []
  return {
    used,
    unreadSince: vi.fn(async () => batches.shift() ?? []),
    markUsed: vi.fn(async (id: number) => { used.push(id) }),
    close: vi.fn(async () => {}),
  }
}

const requestedAt = new Date("2026-10-21T16:53:00.000Z")
const message = (id: number, at: string, code: string): CopecOtpMessage => ({
  id,
  receivedAt: new Date(at),
  body: `<p>Tu código de verificación para TCT es:</p><p>${code}</p>`,
})

describe("waitForCopecOtp", () => {
  it("espera hasta que llega el correo y lo marca usado", async () => {
    const box = mailbox([[], [], [message(7, "2026-10-21T16:53:09.000Z", "111222")]])

    await expect(waitForCopecOtp(box, requestedAt, { sleep: async () => {} })).resolves.toBe("111222")
    expect(box.used).toEqual([7])
  })

  it("con dos códigos dentro del margen, usa el más nuevo", async () => {
    // Un código sin usar de un intento anterior no sirve: Copec ya emitió otro.
    const box = mailbox([[
      message(5, "2026-10-21T16:52:30.000Z", "000111"),
      message(6, "2026-10-21T16:53:05.000Z", "999888"),
    ]])

    await expect(waitForCopecOtp(box, requestedAt, { sleep: async () => {} })).resolves.toBe("999888")
    expect(box.used).toEqual([6])
  })

  it("ignora correos anteriores al login, fuera del margen de reloj", async () => {
    let clock = requestedAt.getTime()
    const box = mailbox([[message(2, "2026-10-21T10:42:00.000Z", "555666")]])

    await expect(waitForCopecOtp(box, requestedAt, {
      timeoutMs: 6_000,
      pollMs: 3_000,
      sleep: async (ms) => { clock += ms },
      now: () => clock,
    })).rejects.toBeInstanceOf(CopecOtpTimeoutError)
    expect(box.used).toEqual([])
  })
})
