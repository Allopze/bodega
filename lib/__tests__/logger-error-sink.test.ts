/**
 * El logger reenvía a Sentry por un sink que registra sentry.server.config.ts,
 * sin importar el SDK. Lo que fija esta suite: qué llega al sink y qué no.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { logger, setLoggerErrorSink } from "@/lib/logger"

describe("logger → sink de errores (Sentry)", () => {
  const sink = vi.fn()

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    setLoggerErrorSink(sink)
  })

  afterEach(() => {
    setLoggerErrorSink(null)
    sink.mockReset()
    vi.restoreAllMocks()
  })

  it("reenvía el Error suelto, con su stack original", () => {
    const err = new Error("boom")
    logger.error("[accion] falló", err)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0]![0]).toBe(err)
  })

  it("encuentra el Error anidado en el contexto estilo pino", () => {
    const err = new Error("portal caído")
    logger.error({ err, faena: "F1" }, "sync DTE falló")
    expect(sink.mock.calls[0]![0]).toBe(err)
  })

  it("no reenvía un logger.error sin Error: queda sólo en stdout", () => {
    // Es el caso de onRequestError, que reporta a Sentry por su propia vía.
    logger.error("[request] error no capturado", { path: "/x", message: "boom" })
    expect(sink).not.toHaveBeenCalled()
  })

  it("no reenvía warn", () => {
    logger.warn("degradado", new Error("x"))
    expect(sink).not.toHaveBeenCalled()
  })

  it("un sink que lanza no rompe al que loguea", () => {
    sink.mockImplementation(() => { throw new Error("sentry caído") })
    expect(() => logger.error(new Error("x"))).not.toThrow()
  })

  it("el logger no importa el SDK (los scripts bundleados con esbuild lo arrastrarían)", () => {
    const fuente = readFileSync(path.join(process.cwd(), "lib/logger.ts"), "utf-8")
    expect(fuente).not.toMatch(/from\s+["']@sentry\//)
    expect(fuente).not.toMatch(/import\(\s*["']@sentry\//)
  })
})
