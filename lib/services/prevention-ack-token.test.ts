/**
 * PREV-M06 (informe 2026-09-26, parte temporal): el enlace público de acuse
 * era un HMAC determinista por (tipo, id) sin vencimiento. Un enlace impreso o
 * reenviado por WhatsApp seguía abriendo el acuse para siempre mientras el
 * permiso no terminara. T7a cerró la ventana por estado del permiso; esta suite
 * cierra la ventana por tiempo: el token v2 lleva su vencimiento firmado.
 *
 * Antes de la corrección fallaban todas: `checkPreventionAckToken` no existía y
 * el token era un hex de 64 caracteres sin vencimiento.
 */
import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkPreventionAckToken,
  derivePreventionAckToken,
  preventionAckLink,
  verifyPreventionAckToken,
} from "@/lib/services/prevention-ack-token"
import { parsePreventionAckLegacyUntil, parsePreventionAckTtlDays, validateEnv } from "@/lib/env"

const SECRET = "secreto-de-prueba-m06"
const CREW = "crew-m06"
const DAY = 86_400_000
// 2026-09-27 12:00 hora de Chile (UTC-3 en septiembre).
const NOW = new Date("2026-09-27T15:00:00Z")

const saved = { ...process.env }

function v1(secret: string, targetId = CREW) {
  return createHmac("sha256", secret).update(`prevention:ack:v1:permiso:${targetId}`).digest("hex")
}

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET
  delete process.env.AUTH_SECRET_PREVIOUS
  delete process.env.PREVENTION_ACK_TTL_DAYS
  delete process.env.PREVENTION_ACK_LEGACY_UNTIL
})

afterEach(() => {
  process.env = { ...saved }
})

describe("PREV-M06 — token v2 con vencimiento firmado", () => {
  it("emite v2.<exp>.<hmac> y lo acepta dentro del plazo", () => {
    const token = derivePreventionAckToken("permiso", CREW, NOW)
    expect(token).toMatch(/^v2\.\d+\.[0-9a-f]{64}$/)
    expect(checkPreventionAckToken("permiso", CREW, token, NOW)).toBe("valid")
    expect(checkPreventionAckToken("permiso", CREW, token, new Date(NOW.getTime() + 13 * DAY))).toBe("valid")
    expect(verifyPreventionAckToken("permiso", CREW, token, NOW)).toBe(true)
  })

  it("por defecto vence a los 14 días, al cierre del día chileno", () => {
    const { expiresAt } = preventionAckLink("permiso", CREW, NOW)
    // 2026-10-11 23:59:59 en Chile = 2026-10-12 03:00 UTC (horario de verano desde el 6-sep: UTC-3).
    expect(expiresAt.toISOString()).toBe("2026-10-12T03:00:00.000Z")
    // El mismo día se reimprime el mismo enlace: el vencimiento se redondea al día.
    expect(derivePreventionAckToken("permiso", CREW, new Date(NOW.getTime() + 3600_000)))
      .toBe(derivePreventionAckToken("permiso", CREW, NOW))
  })

  it("un enlace vencido responde 'expired', distinto de uno inválido", () => {
    const token = derivePreventionAckToken("permiso", CREW, NOW)
    const despues = new Date(NOW.getTime() + 15 * DAY)
    expect(checkPreventionAckToken("permiso", CREW, token, despues)).toBe("expired")
    expect(verifyPreventionAckToken("permiso", CREW, token, despues)).toBe(false)
  })

  it("respeta PREVENTION_ACK_TTL_DAYS", () => {
    process.env.PREVENTION_ACK_TTL_DAYS = "2"
    const token = derivePreventionAckToken("permiso", CREW, NOW)
    expect(checkPreventionAckToken("permiso", CREW, token, new Date(NOW.getTime() + 2 * DAY))).toBe("valid")
    expect(checkPreventionAckToken("permiso", CREW, token, new Date(NOW.getTime() + 3 * DAY))).toBe("expired")
  })

  it("alargar el vencimiento a mano invalida la firma", () => {
    const token = derivePreventionAckToken("permiso", CREW, NOW)
    const [, exp, mac] = token.split(".")
    const alargado = `v2.${Number(exp) + 365 * 86_400}.${mac}`
    expect(checkPreventionAckToken("permiso", CREW, alargado, NOW)).toBe("invalid")
    expect(checkPreventionAckToken("permiso", CREW, alargado, new Date(NOW.getTime() + 30 * DAY))).toBe("invalid")
  })

  it("el token de otro integrante o de otro tipo no abre este destino", () => {
    expect(checkPreventionAckToken("permiso", CREW, derivePreventionAckToken("permiso", "otro", NOW), NOW)).toBe("invalid")
    expect(checkPreventionAckToken("permiso", CREW, derivePreventionAckToken("capacitacion", CREW, NOW), NOW)).toBe("invalid")
  })

  it("rechaza basura sin lanzar", () => {
    for (const token of [undefined, null, 42, "", "v2", "v2.abc.def", `v2.1.${"z".repeat(64)}`, `v3.1.${"a".repeat(64)}`]) {
      expect(checkPreventionAckToken("permiso", CREW, token, NOW)).toBe("invalid")
    }
  })

  it("rotar AUTH_SECRET no invalida los enlaces vigentes emitidos con el anterior", () => {
    const token = derivePreventionAckToken("permiso", CREW, NOW)
    process.env.AUTH_SECRET = "secreto-nuevo"
    expect(checkPreventionAckToken("permiso", CREW, token, NOW)).toBe("invalid")
    process.env.AUTH_SECRET_PREVIOUS = `otro, ${SECRET}`
    expect(checkPreventionAckToken("permiso", CREW, token, NOW)).toBe("valid")
    // Rotado y además vencido: sigue siendo vencido, no inválido.
    expect(checkPreventionAckToken("permiso", CREW, token, new Date(NOW.getTime() + 20 * DAY))).toBe("expired")
  })
})

describe("PREV-M06 — enlaces v1 heredados (sin vencimiento)", () => {
  it("se rechazan por defecto como vencidos", () => {
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET), NOW)).toBe("expired")
  })

  it("se aceptan mientras PREVENTION_ACK_LEGACY_UNTIL esté en el futuro (hora de Chile)", () => {
    process.env.PREVENTION_ACK_LEGACY_UNTIL = "2026-10-01"
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET), NOW)).toBe("valid")
    // Último minuto del 1-oct en Chile (02:59 UTC del 2-oct): aún vale.
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET), new Date("2026-10-02T02:59:00Z"))).toBe("valid")
    // Medianoche chilena del 2-oct: ya no.
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET), new Date("2026-10-02T03:00:00Z"))).toBe("expired")
  })

  it("un v1 falsificado sigue siendo inválido aunque haya ventana de transición", () => {
    process.env.PREVENTION_ACK_LEGACY_UNTIL = "2026-10-01"
    expect(checkPreventionAckToken("permiso", CREW, v1("otro-secreto"), NOW)).toBe("invalid")
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET, "otro"), NOW)).toBe("invalid")
  })

  it("también prueba los secretos rotados", () => {
    process.env.PREVENTION_ACK_LEGACY_UNTIL = "2026-10-01"
    process.env.AUTH_SECRET_PREVIOUS = SECRET
    process.env.AUTH_SECRET = "secreto-nuevo"
    expect(checkPreventionAckToken("permiso", CREW, v1(SECRET), NOW)).toBe("valid")
  })
})

describe("PREV-M06 — validación de las variables de entorno", () => {
  it("TTL: por defecto 14, acepta enteros 1–90 y rechaza el resto", () => {
    expect(parsePreventionAckTtlDays(undefined)).toBe(14)
    expect(parsePreventionAckTtlDays("")).toBe(14)
    expect(parsePreventionAckTtlDays(" 7 ")).toBe(7)
    for (const raw of ["0", "-1", "1.5", "91", "catorce", "14d"]) {
      expect(() => parsePreventionAckTtlDays(raw), raw).toThrow(/PREVENTION_ACK_TTL_DAYS/)
    }
  })

  it("LEGACY_UNTIL: vacío = sin ventana; fecha ISO real = medianoche chilena del día siguiente", () => {
    expect(parsePreventionAckLegacyUntil(undefined)).toBeNull()
    expect(parsePreventionAckLegacyUntil("  ")).toBeNull()
    expect(parsePreventionAckLegacyUntil("2026-10-01")!.toISOString()).toBe("2026-10-02T03:00:00.000Z")
    // Invierno: UTC-4.
    expect(parsePreventionAckLegacyUntil("2026-06-10")!.toISOString()).toBe("2026-06-11T04:00:00.000Z")
    for (const raw of ["2026-02-30", "01-10-2026", "mañana", "2026-10-01T10:00"]) {
      expect(() => parsePreventionAckLegacyUntil(raw), raw).toThrow(/PREVENTION_ACK_LEGACY_UNTIL/)
    }
  })

  it("validateEnv falla al arrancar con un valor inválido", () => {
    process.env.DATABASE_URL = "postgres:///x"
    process.env.PREVENTION_ACK_TTL_DAYS = "cero"
    expect(() => validateEnv()).toThrow(/PREVENTION_ACK_TTL_DAYS/)
    process.env.PREVENTION_ACK_TTL_DAYS = "14"
    process.env.PREVENTION_ACK_LEGACY_UNTIL = "31/12/2026"
    expect(() => validateEnv()).toThrow(/PREVENTION_ACK_LEGACY_UNTIL/)
    delete process.env.PREVENTION_ACK_LEGACY_UNTIL
    expect(() => validateEnv()).not.toThrow()
  })

  it("con un TTL inválido no se emite enlace (en vez de emitir uno con plazo equivocado)", () => {
    process.env.PREVENTION_ACK_TTL_DAYS = "0"
    expect(() => derivePreventionAckToken("permiso", CREW, NOW)).toThrow(/PREVENTION_ACK_TTL_DAYS/)
  })
})
