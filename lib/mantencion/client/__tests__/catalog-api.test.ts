import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAccount, saveAccount } from "../accounts"
import { classifyStatus, fetchCatalog, postRecord, requestCredential, uploadPhoto } from "../api"
import { loadStoredCatalog, refreshCatalog } from "../catalog-sync"
import { account, catalog, freshDb, json, photo, preventivePayload, UUID } from "./fixtures"

const CATALOG = catalog("u-1")
const request = (fetchImpl: ReturnType<typeof vi.fn>, index = 0) => ({ url: String(fetchImpl.mock.calls[index]?.[0]), init: fetchImpl.mock.calls[index]?.[1] as RequestInit })

describe("clasificación de respuestas (contrato de SyncRecordResponse)", () => {
  it("401/403 piden entrar de nuevo; red, 408, 429 y 5xx reintentan; el resto es un rechazo", () => {
    for (const status of [401, 403]) expect(classifyStatus(status)).toBe("auth")
    for (const status of [408, 429, 500, 502, 503, 504]) expect(classifyStatus(status)).toBe("retry")
    for (const status of [400, 404, 409, 413, 422]) expect(classifyStatus(status)).toBe("reject")
  })

  it("un 422 con campo y motivo llega tal cual a la pantalla", async () => {
    const result = await postRecord("t", preventivePayload(UUID(1), [UUID(2), UUID(3)]), vi.fn(async () => json(422, { ok: false, code: "invalid", message: "La lectura es menor que la anterior.", field: "reading" })) as unknown as typeof fetch)
    expect(result).toMatchObject({ kind: "reject", status: 422, field: "reading", message: "La lectura es menor que la anterior." })
  })

  it("un 429 respeta Retry-After", async () => {
    const result = await postRecord("t", preventivePayload(UUID(1), [UUID(2), UUID(3)]), vi.fn(async () => json(429, { ok: false, code: "rate_limited", message: "Muchos envíos" }, { "retry-after": "60" })) as unknown as typeof fetch)
    expect(result).toMatchObject({ kind: "retry", retryAfterMs: 60_000, network: false })
  })

  it("sin red es un reintento marcado como falla de red", async () => {
    const result = await postRecord("t", preventivePayload(UUID(1), [UUID(2), UUID(3)]), vi.fn(async () => { throw new TypeError("Failed to fetch") }) as unknown as typeof fetch)
    expect(result).toMatchObject({ kind: "retry", network: true })
  })

  it("un envío repetido (200 con el mismo folio) vale como confirmación", async () => {
    const result = await postRecord("t", preventivePayload(UUID(1), [UUID(2), UUID(3)]), vi.fn(async () => json(200, { ok: true, id: UUID(1), folio: "MP-BIO-0001", receivedAt: "2026-10-28T15:00:00.000Z", duplicate: true, warnings: [] })) as unknown as typeof fetch)
    expect(result).toMatchObject({ kind: "ok", value: { folio: "MP-BIO-0001", duplicate: true } })
  })

  it("la foto sube por multipart con el archivo, su huella y la credencial del autor", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    await uploadPhoto("token-u-1", photo(UUID(11)), fetchImpl as unknown as typeof fetch)
    const { url, init } = request(fetchImpl)
    expect(url).toBe(`/api/mantencion/sync/fotos/${UUID(11)}`)
    expect(init.method).toBe("PUT")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-u-1")
    expect(init.credentials).toBe("omit")
    const form = init.body as FormData
    expect(form.get("file")).toBeInstanceOf(Blob)
    expect(JSON.parse(String(form.get("meta")))).toMatchObject({ kind: "filtros", sha256: "a".repeat(64), deviceId: UUID(900) })
  })

  it("la credencial se pide con la sesión de la plataforma (cookie) y sin Bearer", async () => {
    const fetchImpl = vi.fn(async () => json(200, { token: "t", expiresAt: "2026-11-28T00:00:00.000Z", user: { id: "u-1", name: "J", email: "j@x.cl" } }))
    await requestCredential(UUID(900), "Android · Chrome", fetchImpl as unknown as typeof fetch)
    const { url, init } = request(fetchImpl)
    expect(url).toBe("/api/mantencion/dispositivo")
    expect(init.credentials).toBe("same-origin")
    expect(JSON.parse(String(init.body))).toEqual({ deviceId: UUID(900), label: "Android · Chrome" })
    expect(init.headers).not.toHaveProperty("Authorization")
  })
})

describe("catálogo con ETag", () => {
  beforeEach(freshDb)

  it("guarda el catálogo con su ETag y la segunda vez pregunta con If-None-Match (304 = sin cambios)", async () => {
    await saveAccount(account("u-1"))
    const first = vi.fn(async (url: RequestInfo | URL) => String(url).includes("alcance=todos")
      ? json(200, { version: "o1", equipment: [] }, { etag: '"o1"' })
      : json(200, CATALOG, { etag: '"v1"' }))
    expect(await refreshCatalog("u-1", { fetchImpl: first as unknown as typeof fetch })).toBe("updated")
    const stored = await loadStoredCatalog("u-1")
    expect(stored?.etag).toBe('"v1"')
    expect(stored?.others?.etag).toBe('"o1"')

    const second = vi.fn(async () => new Response(null, { status: 304 }))
    expect(await refreshCatalog("u-1", { fetchImpl: second as unknown as typeof fetch })).toBe("unchanged")
    expect((request(second, 0).init.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"')
    expect((request(second, 1).init.headers as Record<string, string>)["If-None-Match"]).toBe('"o1"')
  })

  it("una lectura del catálogo nunca usa la cookie", async () => {
    const fetchImpl = vi.fn(async () => json(200, CATALOG, { etag: '"v1"' }))
    await fetchCatalog("token-u-1", null, fetchImpl as unknown as typeof fetch)
    expect(request(fetchImpl).init.credentials).toBe("omit")
  })

  it("un 401 deja la cuenta pidiendo entrar de nuevo, sin borrar el catálogo que ya tenía", async () => {
    await saveAccount(account("u-1"))
    await refreshCatalog("u-1", { fetchImpl: vi.fn(async () => json(200, CATALOG, { etag: '"v1"' })) as unknown as typeof fetch, withOthers: false })
    const outcome = await refreshCatalog("u-1", { fetchImpl: vi.fn(async () => json(401, { ok: false, code: "unauthorized", message: "vencida" })) as unknown as typeof fetch, withOthers: false })
    expect(outcome).toBe("needs_login")
    expect((await getAccount("u-1"))?.status).toBe("needs_login")
    expect((await loadStoredCatalog("u-1"))?.catalog.equipment).toHaveLength(1)
  })

  it("sin señal conserva el catálogo y lo informa", async () => {
    await saveAccount(account("u-1"))
    await refreshCatalog("u-1", { fetchImpl: vi.fn(async () => json(200, CATALOG, { etag: '"v1"' })) as unknown as typeof fetch, withOthers: false })
    const outcome = await refreshCatalog("u-1", { fetchImpl: vi.fn(async () => { throw new TypeError("Failed to fetch") }) as unknown as typeof fetch, withOthers: false })
    expect(outcome).toBe("offline")
    expect(await loadStoredCatalog("u-1")).not.toBeNull()
  })

  it("una cuenta con la credencial vencida no pide nada", async () => {
    await saveAccount(account("u-1", { expiresAt: new Date(Date.now() - 1000).toISOString() }))
    const fetchImpl = vi.fn()
    expect(await refreshCatalog("u-1", { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("skipped")
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
