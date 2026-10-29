import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { PIN_BASE_LOCK_MS, checkPin, getAccount, pinLockMs, saveAccount, setPin } from "../accounts"
import { hashPin, isValidPin, verifyPinHash } from "../pin"
import { account, freshDb } from "./fixtures"

describe("PIN local", () => {
  it("guarda PBKDF2 con sal propia y verifica el correcto", async () => {
    const stored = await hashPin("1234", 1_000)
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.salt).toMatch(/^[0-9a-f]{32}$/)
    expect(stored.hash).not.toContain("1234")
    expect(await verifyPinHash("1234", stored)).toBe(true)
  })

  it("rechaza un PIN incorrecto o mal formado", async () => {
    const stored = await hashPin("1234", 1_000)
    expect(await verifyPinHash("1235", stored)).toBe(false)
    expect(await verifyPinHash("123", stored)).toBe(false)
    expect(await verifyPinHash("12345", stored)).toBe(false)
    expect(await verifyPinHash("abcd", stored)).toBe(false)
  })

  it("el mismo PIN con dos sales da hashes distintos", async () => {
    const a = await hashPin("4321", 1_000)
    const b = await hashPin("4321", 1_000)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })

  it("son exactamente 4 dígitos", () => {
    expect(isValidPin("0000")).toBe(true)
    expect(isValidPin("123")).toBe(false)
    expect(isValidPin("12a4")).toBe(false)
    expect(isValidPin("")).toBe(false)
    return expect(hashPin("12", 1_000)).rejects.toThrow()
  })
})

describe("PIN de una cuenta del dispositivo", () => {
  beforeEach(freshDb)

  it("definir y verificar con la cuenta guardada (sin señal)", async () => {
    await saveAccount(account("u-1"))
    await setPin("u-1", "2468")
    expect((await getAccount("u-1"))?.pin?.hash).toBeTruthy()
    expect(await checkPin("u-1", "2468")).toEqual({ ok: true })
  })

  it("un PIN errado cuenta los intentos que quedan y a los 5 bloquea un rato", async () => {
    await saveAccount(account("u-1"))
    await setPin("u-1", "2468")
    const now = 1_000_000
    for (const left of [4, 3, 2, 1]) expect(await checkPin("u-1", "0000", now)).toEqual({ ok: false, locked: false, attemptsLeft: left })
    const fifth = await checkPin("u-1", "0000", now)
    expect(fifth).toEqual({ ok: false, locked: true, until: now + PIN_BASE_LOCK_MS })
    // Bloqueada: ni el PIN correcto entra hasta que pase la espera.
    expect(await checkPin("u-1", "2468", now + 1_000)).toMatchObject({ ok: false, locked: true })
    expect(await checkPin("u-1", "2468", now + PIN_BASE_LOCK_MS + 1)).toEqual({ ok: true })
    expect((await getAccount("u-1"))?.pinFailures).toBe(0)
  })

  it("la espera se duplica con cada fallo extra hasta un tope", () => {
    expect(pinLockMs(4)).toBe(0)
    expect(pinLockMs(5)).toBe(30_000)
    expect(pinLockMs(6)).toBe(60_000)
    expect(pinLockMs(30)).toBe(300_000)
  })

  it("una cuenta sin PIN no deja entrar", async () => {
    await saveAccount(account("u-1"))
    expect(await checkPin("u-1", "1234")).toMatchObject({ ok: false })
  })
})
