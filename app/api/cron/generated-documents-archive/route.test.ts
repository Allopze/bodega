import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  drain: vi.fn(),
  expire: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/services/cron-lock", () => ({ withCronLock: async (_name: string, run: () => Promise<unknown>) => run() }))
vi.mock("@/lib/services/generated-documents/drain", () => ({
  drainGeneratedDocuments: state.drain,
  expireUnrenderedSessionRows: state.expire,
}))

const { GET } = await import("./route")

function request(token?: string) {
  return new NextRequest("http://app:3000/api/cron/generated-documents-archive", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret-de-prueba"
  state.drain.mockReset()
  state.expire.mockReset()
  state.expire.mockResolvedValue(0)
  state.drain.mockResolvedValue({ disabled: false, processed: 2, uploaded: 2, failed: 0, superseded: 0 })
})

describe("GET /api/cron/generated-documents-archive", () => {
  it("sin el secreto correcto responde 401 y no procesa nada", async () => {
    const response = await GET(request("otro"))
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ outcome: "unauthorized", code: "GENDOCS_CRON_UNAUTHORIZED" })
    expect(state.drain).not.toHaveBeenCalled()
  })

  it("vence los PDF sin imprimir y procesa la cola sin sesión", async () => {
    const response = await GET(request("cron-secret-de-prueba"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcome: "success", code: "GENDOCS_CRON_SUCCESS", uploaded: 2 })
    expect(state.expire).toHaveBeenCalledTimes(1)
    expect(state.drain).toHaveBeenCalledWith({ limit: 50 })
  })

  it("con el archivado apagado responde disabled", async () => {
    state.drain.mockResolvedValue({ disabled: true, processed: 0, uploaded: 0, failed: 0, superseded: 0 })
    const response = await GET(request("cron-secret-de-prueba"))
    expect(await response.json()).toMatchObject({ ok: true, outcome: "disabled", code: "GENDOCS_CRON_DISABLED" })
  })

  it("una falla del procesador es 503 con su código", async () => {
    state.drain.mockRejectedValue(new Error("BD caída"))
    const response = await GET(request("cron-secret-de-prueba"))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, outcome: "failed", code: "GENDOCS_CRON_FAILED" })
  })
})
