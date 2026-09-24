import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  afterThrows: false,
  headersRead: 0,
  drain: vi.fn(async () => ({ disabled: false, processed: 0, uploaded: 0, failed: 0, superseded: 0 })),
}))

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => {
    if (state.afterThrows) throw new Error("`after` was called outside a request scope. (E468)")
    state.callbacks.push(callback)
  },
}))
vi.mock("next/headers", () => ({
  headers: async () => {
    state.headersRead += 1
    return new Headers({ cookie: "authjs.session-token=abc; theme=dark" })
  },
}))
vi.mock("@/lib/services/generated-documents/drain", () => ({ drainGeneratedDocuments: state.drain }))
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { scheduleGeneratedDocumentDrain } = await import("@/lib/services/generated-documents/schedule")

beforeEach(() => {
  state.callbacks.length = 0
  state.afterThrows = false
  state.headersRead = 0
  state.drain.mockClear()
  process.env.GENERATED_DOCS_ARCHIVE_ENABLED = "true"
})

afterEach(() => {
  delete process.env.GENERATED_DOCS_ARCHIVE_ENABLED
})

describe("scheduleGeneratedDocumentDrain", () => {
  it("programa el archivado para después de responder, con la sesión de quien actuó", async () => {
    await scheduleGeneratedDocumentDrain("user-1")
    expect(state.drain).not.toHaveBeenCalled()
    expect(state.callbacks).toHaveLength(1)
    await state.callbacks[0]!()
    expect(state.drain).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "user-1" }))
    const calls = state.drain.mock.calls as unknown as Array<[{ credential: { cookieHeader: string } }]>
    expect(calls[0]![0].credential.cookieHeader).toBe("authjs.session-token=abc")
  })

  it("fuera de un request no lanza ni archiva: la fila queda para el cron", async () => {
    state.afterThrows = true
    await expect(scheduleGeneratedDocumentDrain("user-1")).resolves.toBeUndefined()
    expect(state.drain).not.toHaveBeenCalled()
  })

  it("un fallo dentro del callback no escapa", async () => {
    state.drain.mockRejectedValueOnce(new Error("Cloudreve caído"))
    await scheduleGeneratedDocumentDrain("user-1")
    await expect(state.callbacks[0]!()).resolves.toBeUndefined()
  })

  it("sin la llave de entorno ni siquiera lee la cookie", async () => {
    delete process.env.GENERATED_DOCS_ARCHIVE_ENABLED
    await scheduleGeneratedDocumentDrain("user-1")
    expect(state.headersRead).toBe(0)
    expect(state.callbacks).toHaveLength(0)
  })
})
