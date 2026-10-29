import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAccount, getActiveAccountId, saveAccount, setActiveAccount, setPin } from "../accounts"
import type { ApiFailure } from "../api"
import { bootstrapDevice, type BootstrapInput } from "../bootstrap"
import { setMeta, getMeta } from "../meta"
import { commitRecord, getQueueItem, markAuthorNeedsLogin } from "../queue"
import { putPhoto } from "../photo-store"
import { UUID, account, freshDb, photo, recordItem } from "./fixtures"

const user = (id: string) => ({ id, name: `Mecánico ${id}`, email: `${id}@e2e.chome.cl` })

function registers(userId: string) {
  return vi.fn(async () => ({ ok: true as const, account: await (async () => { const created = account(userId, { name: `Mecánico ${userId}` }); await saveAccount(created); return created })() }))
}
const fails = (failure: ApiFailure) => vi.fn(async () => ({ ok: false as const, failure }))
const networkDown: ApiFailure = { kind: "retry", message: "Sin señal", retryAfterMs: null, network: true }

const open = (input: Partial<BootstrapInput> & { sessionUser: BootstrapInput["sessionUser"] }) => bootstrapDevice({ fresh: true, ...input })

describe("arranque de la app: qué cuenta queda activa", () => {
  beforeEach(freshDb)

  it("primer ingreso con señal: pide la credencial, deja activa la cuenta y exige definir el PIN", async () => {
    const register = registers("u-1")
    const result = await open({ sessionUser: user("u-1"), register })
    expect(register).toHaveBeenCalledTimes(1)
    expect(result.activeUserId).toBe("u-1")
    expect(result.blocker).toBeNull()
    expect(result.pinSetupFor).toBe("u-1")
    expect(result.deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getActiveAccountId()).toBe("u-1")
  })

  it("el deviceId es estable entre aperturas", async () => {
    const a = await open({ sessionUser: user("u-1"), register: registers("u-1") })
    const b = await open({ sessionUser: user("u-1"), register: registers("u-1") })
    expect(b.deviceId).toBe(a.deviceId)
  })

  it("recargar con la misma sesión NO devuelve la tablet al primer mecánico", async () => {
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    await setPin("u-1", "1111")
    await saveAccount(account("u-2"))
    await setPin("u-2", "2222")
    await setActiveAccount("u-2") // cambió de cuenta con el PIN, sin pasar por el login
    const again = await open({ sessionUser: user("u-1"), register: registers("u-1") })
    expect(again.activeUserId).toBe("u-2")
  })

  it("un ingreso nuevo por el login manda: la sesión es de otra persona y acaba de poner su contraseña", async () => {
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    await setPin("u-1", "1111")
    const result = await open({ sessionUser: user("u-2"), register: registers("u-2") })
    expect(result.activeUserId).toBe("u-2")
    expect(await getActiveAccountId()).toBe("u-2")
    expect(await getAccount("u-1")).not.toBeNull() // la cuenta anterior sigue en el equipo
  })

  it("sin señal, con el HTML del caché (no fresco): no pide credencial y sigue con la cuenta del equipo", async () => {
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    await setPin("u-1", "1111")
    const register = registers("u-9")
    const result = await open({ sessionUser: user("u-9"), fresh: false, register })
    expect(register).not.toHaveBeenCalled()
    expect(result.activeUserId).toBe("u-1")
    expect(result.blocker).toBeNull()
    expect(result.pinSetupFor).toBeNull()
  })

  it("primera vez sin señal: no se puede entrar", async () => {
    const result = await open({ sessionUser: user("u-1"), register: fails(networkDown) })
    expect(result.activeUserId).toBeNull()
    expect(result.blocker).toBe("needs-signal")
  })

  it("sin permiso (403) lo dice y no deja la cuenta activa", async () => {
    const result = await open({ sessionUser: user("u-1"), register: fails({ kind: "auth", status: 403, message: "sin permiso" }) })
    expect(result.blocker).toBe("no-permission")
  })

  it("una credencial por vencer se renueva con la sesión viva y conserva el PIN", async () => {
    await saveAccount(account("u-1", { expiresAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString() }))
    await setPin("u-1", "1234")
    const register = vi.fn(async () => {
      const previous = await getAccount("u-1")
      const renewed = { ...account("u-1"), pin: previous?.pin ?? null, token: "token-nuevo" }
      await saveAccount(renewed)
      return { ok: true as const, account: renewed }
    })
    const result = await open({ sessionUser: user("u-1"), register })
    expect(register).toHaveBeenCalledTimes(1)
    expect(result.pinSetupFor).toBeNull()
  })

  it("al renovar la credencial, lo que esperaba que entrara de nuevo vuelve a pendiente", async () => {
    await saveAccount(account("u-1", { status: "needs_login" }))
    await setPin("u-1", "1234")
    await putPhoto(photo(UUID(11)))
    await putPhoto(photo(UUID(12)))
    await commitRecord(recordItem(UUID(1), "u-1", [UUID(11), UUID(12)]), { draftKey: "u-1:P" })
    await markAuthorNeedsLogin("u-1")
    expect((await getQueueItem(UUID(1)))?.status).toBe("needs_login")
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    expect((await getQueueItem(UUID(1)))?.status).toBe("pending")
  })

  it("«Olvidé mi PIN»: al volver con su contraseña define uno nuevo", async () => {
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    await setPin("u-1", "1111")
    await setMeta("pinResetFor", "u-1")
    const result = await open({ sessionUser: user("u-1"), register: registers("u-1") })
    expect(result.pinSetupFor).toBe("u-1")
    expect(await getMeta("pinResetFor")).toBeNull()
  })

  it("el PIN de otra cuenta no se borra porque alguien más pidió olvidarlo", async () => {
    await open({ sessionUser: user("u-1"), register: registers("u-1") })
    await setPin("u-1", "1111")
    await setMeta("pinResetFor", "u-2")
    const result = await open({ sessionUser: user("u-1"), register: registers("u-1") })
    expect(result.pinSetupFor).toBeNull()
    expect((await getAccount("u-1"))?.pin).not.toBeNull()
  })
})
