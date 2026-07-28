import { describe, expect, it } from "vitest"
import { isTemporaryAccountExpired } from "@/lib/auth/temporary-account"

describe("isTemporaryAccountExpired", () => {
  const nowMs = Date.parse("2026-07-28T12:00:00.000Z")

  it("permite una cuenta temporal sólo antes de su vencimiento", () => {
    expect(isTemporaryAccountExpired({ isTemporary: true, validUntil: "2026-07-28T12:00:01.000Z" }, nowMs)).toBe(false)
  })

  it("niega cuentas vencidas, sin vencimiento o con fecha inválida", () => {
    expect(isTemporaryAccountExpired({ isTemporary: true, validUntil: "2026-07-28T12:00:00.000Z" }, nowMs)).toBe(true)
    expect(isTemporaryAccountExpired({ isTemporary: true, validUntil: null }, nowMs)).toBe(true)
    expect(isTemporaryAccountExpired({ isTemporary: true, validUntil: "no-es-fecha" }, nowMs)).toBe(true)
  })

  it("no afecta cuentas permanentes", () => {
    expect(isTemporaryAccountExpired({ isTemporary: false, validUntil: null }, nowMs)).toBe(false)
  })
})
