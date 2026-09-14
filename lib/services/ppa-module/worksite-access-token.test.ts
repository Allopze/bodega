import { afterEach, describe, expect, it } from "vitest"

import {
  derivePpaWorksiteAccessToken,
  ppaWorksiteAccessQuery,
  verifyPpaWorksiteAccessToken,
} from "./worksite-access-token"

/**
 * PPA-001 (auditoría 2026-09-14): el enlace público repartía la faena como
 * `?faena=<worksiteId>`, un parámetro que no acredita nada. Este módulo es el
 * que la acredita, con el mismo mecanismo que ya usa el acuse de Prevención.
 */
describe("PPA-001 — token de acceso por faena", () => {
  const previous = { current: process.env.AUTH_SECRET, prev: process.env.AUTH_SECRET_PREVIOUS }
  afterEach(() => {
    process.env.AUTH_SECRET = previous.current
    process.env.AUTH_SECRET_PREVIOUS = previous.prev
  })

  it("el token de una faena no abre otra", () => {
    process.env.AUTH_SECRET = "secreto-a"
    delete process.env.AUTH_SECRET_PREVIOUS
    const tokenA = derivePpaWorksiteAccessToken("ws-1")

    expect(verifyPpaWorksiteAccessToken("ws-1", tokenA)).toBe(true)
    expect(verifyPpaWorksiteAccessToken("ws-2", tokenA)).toBe(false)
  })

  it("rechaza cualquier cosa que no sea un HMAC hexadecimal", () => {
    process.env.AUTH_SECRET = "secreto-a"
    for (const invalid of ["", "ws-1", "no-hex", null, undefined, 42, "a".repeat(64)]) {
      expect(verifyPpaWorksiteAccessToken("ws-1", invalid)).toBe(false)
    }
  })

  it("rotar AUTH_SECRET no invalida los QR ya pegados en terreno", () => {
    process.env.AUTH_SECRET = "secreto-viejo"
    delete process.env.AUTH_SECRET_PREVIOUS
    const repartido = derivePpaWorksiteAccessToken("ws-1")

    // Rotación: el nuevo secreto pasa a ser el vigente y el anterior queda
    // declarado, igual que en `authSecrets`.
    process.env.AUTH_SECRET = "secreto-nuevo"
    process.env.AUTH_SECRET_PREVIOUS = "secreto-viejo"

    expect(verifyPpaWorksiteAccessToken("ws-1", repartido)).toBe(true)
    expect(verifyPpaWorksiteAccessToken("ws-1", derivePpaWorksiteAccessToken("ws-1"))).toBe(true)
  })

  it("el enlace lleva la faena y su token", () => {
    process.env.AUTH_SECRET = "secreto-a"
    expect(ppaWorksiteAccessQuery("ws-1")).toBe(`?faena=ws-1&t=${derivePpaWorksiteAccessToken("ws-1")}`)
  })

  it("sin AUTH_SECRET no se emite un enlace en silencio", () => {
    delete process.env.AUTH_SECRET
    expect(() => derivePpaWorksiteAccessToken("ws-1")).toThrow(/AUTH_SECRET/)
  })
})
