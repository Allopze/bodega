import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const browserMocks = vi.hoisted(() => {
  const context = {
    newPage: vi.fn<() => Promise<unknown>>(() => new Promise(() => {})),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const browser = { newContext: vi.fn().mockResolvedValue(context), on: vi.fn() }
  const server = { wsEndpoint: vi.fn().mockReturnValue("ws://127.0.0.1/test"), kill: vi.fn().mockResolvedValue(undefined), process: vi.fn() }
  return {
    context, browser, server,
    launch: vi.fn().mockResolvedValue(browser),
    launchServer: vi.fn().mockResolvedValue(server),
    connect: vi.fn().mockResolvedValue(browser),
  }
})

vi.mock("playwright", () => ({ chromium: { launch: browserMocks.launch, launchServer: browserMocks.launchServer, connect: browserMocks.connect } }))

import { withCopecPortalSession } from "../copec-reports"
import { _resetPoolForTesting, withBrowserContext } from "@/lib/pdf/browser-pool"

const request = [{ product: "diesel" as const, from: "2025-01-01", to: "2025-01-31" }]

describe("navegador de Copec sin respuesta", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    browserMocks.context.newPage.mockReset().mockImplementation(() => new Promise(() => {}))
    browserMocks.context.close.mockReset().mockResolvedValue(undefined)
    browserMocks.browser.newContext.mockReset().mockResolvedValue(browserMocks.context)
    browserMocks.server.kill.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    _resetPoolForTesting()
    vi.useRealTimers()
  })

  it("termina la consulta y detiene su navegador si Chromium no abre la página", async () => {
    const pending = withCopecPortalSession((session) => session.download(request, "TCT"))
    const failure = pending.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(30_001)

    expect(await failure).toEqual(expect.objectContaining({ message: expect.stringMatching(/navegador.*Copec/i) }))
    expect(browserMocks.context.close).toHaveBeenCalledOnce()
    expect(browserMocks.server.kill).toHaveBeenCalledOnce()
    expect(browserMocks.launch).not.toHaveBeenCalled()
  })

  it("no libera el turno hasta detener el proceso si también se bloquea el cierre del contexto", async () => {
    browserMocks.context.close.mockImplementationOnce(() => new Promise(() => {}))
    let finishKill!: () => void
    browserMocks.server.kill.mockImplementationOnce(() => new Promise<void>((resolve) => { finishKill = resolve }))
    let releasePdf!: () => void
    const pdfGate = new Promise<void>((resolve) => { releasePdf = resolve })
    let pdfStarted!: () => void
    const pdfReady = new Promise<void>((resolve) => { pdfStarted = resolve })
    const busyPdf = withBrowserContext({}, async () => { pdfStarted(); await pdfGate })
    await pdfReady
    let pageAttempted!: () => void
    const pageReady = new Promise<void>((resolve) => { pageAttempted = resolve })
    browserMocks.context.newPage.mockImplementationOnce(() => { pageAttempted(); return new Promise(() => {}) })
    const pending = withCopecPortalSession((session) => session.download(request, "TCT"))
    const failure = pending.catch((error: unknown) => error)
    await pageReady
    let queuedStarted = false
    const queued = withBrowserContext({}, async () => { queuedStarted = true })

    expect(browserMocks.context.newPage).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_001)
    expect(browserMocks.context.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5_001)
    expect(browserMocks.server.kill).toHaveBeenCalledOnce()
    expect(queuedStarted).toBe(false)
    finishKill()
    await expect(failure).resolves.toBeInstanceOf(Error)
    await queued
    expect(queuedStarted).toBe(true)
    releasePdf()
    await busyPdf
  })

  it("detiene el proceso si la creación del contexto no responde, sin ejecutar la consulta", async () => {
    browserMocks.browser.newContext.mockImplementationOnce(() => new Promise(() => {}))
    const run = vi.fn()
    const pending = withCopecPortalSession(run)
    const failure = pending.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(30_001)

    expect(await failure).toBeInstanceOf(Error)
    expect(run).not.toHaveBeenCalled()
    expect(browserMocks.server.kill).toHaveBeenCalledOnce()
  })

  it("deja de esperar si los turnos de PDF están ocupados y no arranca más tarde", async () => {
    let releasePdf!: () => void
    const pdfGate = new Promise<void>((resolve) => { releasePdf = resolve })
    let startCount = 0
    let pdfsStarted!: () => void
    const pdfsReady = new Promise<void>((resolve) => { pdfsStarted = resolve })
    const runPdf = async () => { if (++startCount === 2) pdfsStarted(); await pdfGate }
    const pdfs = Promise.all([withBrowserContext({}, runPdf), withBrowserContext({}, runPdf)])
    await pdfsReady
    let failure: unknown
    const pending = withCopecPortalSession(async () => "no debería empezar")
    void pending.catch((error: unknown) => { failure = error })

    await vi.advanceTimersByTimeAsync(30_001)
    expect(failure).toEqual(expect.objectContaining({ message: expect.stringMatching(/navegador.*ocupado/i) }))
    releasePdf()
    await pdfs
    await Promise.resolve()
    expect(browserMocks.launchServer).not.toHaveBeenCalled()
  })

  it("si falla el cierre supervisado, espera a que termine el proceso antes de entregar el resultado", async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: vi.fn() })
    browserMocks.server.process.mockReturnValue(child)
    browserMocks.server.kill.mockRejectedValueOnce(new Error("supervisor unavailable"))
    let finished = false
    const pending = withCopecPortalSession(async () => "terminada")
    void pending.then(() => { finished = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(child.kill).toHaveBeenCalledWith("SIGKILL")
    expect(finished).toBe(false)
    child.emit("exit", null, "SIGKILL")
    await expect(pending).resolves.toBe("terminada")
  })

  it("termina el proceso aislado si falla la conexión antes de abrir el contexto", async () => {
    browserMocks.connect.mockRejectedValueOnce(new Error("connect failed"))
    await expect(withCopecPortalSession(async () => "no debería ejecutarse")).rejects.toThrow("connect failed")
    expect(browserMocks.server.kill).toHaveBeenCalledOnce()
  })

  it("no inicia sesión si la página aparece después de vencer el plazo", async () => {
    let resolvePage!: (page: unknown) => void
    browserMocks.context.newPage.mockImplementationOnce(() => new Promise((resolve) => { resolvePage = resolve }))
    const page = { setDefaultTimeout: vi.fn() }
    const pending = withCopecPortalSession((session) => session.download(request, "TCT"))
    const stopped = pending.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(30_001)
    expect(await stopped).toBeInstanceOf(Error)
    resolvePage(page)
    await Promise.resolve()

    expect(browserMocks.server.kill).toHaveBeenCalledOnce()
    expect(page.setDefaultTimeout).not.toHaveBeenCalled()
  })
})
