import { describe, expect, it, vi } from "vitest"

/**
 * El solver no se puede probar contra Auth0 en CI, pero sí sus puertas: que no
 * se active sin habilitación explícita y sin modelo, y que el estado del widget
 * se lea sin depender de un navegador real.
 */

vi.mock("./onway-captcha-classifier", () => ({
  hasOnwayCaptchaClassifier: vi.fn(() => false),
  classifyOnwayCaptchaBoard: vi.fn(async () => null),
}))

import { hasOnwayCaptchaClassifier } from "./onway-captcha-classifier"
import { hasOnwayCaptchaToken, isOnwayCaptchaBlocked, onwayCaptchaSolverEnabled } from "./onway-captcha-solver"

const originalSolver = process.env.ONWAY_CAPTCHA_SOLVER

function setSolver(value: string | undefined) {
  if (value === undefined) delete process.env.ONWAY_CAPTCHA_SOLVER
  else process.env.ONWAY_CAPTCHA_SOLVER = value
}

describe("onwayCaptchaSolverEnabled", () => {
  it("está apagado salvo habilitación explícita", () => {
    vi.mocked(hasOnwayCaptchaClassifier).mockReturnValue(true)
    for (const value of [undefined, "", "false", "1", "yes", "TRUE"]) {
      setSolver(value)
      expect(onwayCaptchaSolverEnabled()).toBe(false)
    }
  })

  it("no se activa sin el modelo instalado, aunque esté habilitado", () => {
    setSolver("true")
    vi.mocked(hasOnwayCaptchaClassifier).mockReturnValue(false)
    expect(onwayCaptchaSolverEnabled()).toBe(false)
  })

  it("se activa sólo con habilitación explícita y modelo presente", () => {
    setSolver("true")
    vi.mocked(hasOnwayCaptchaClassifier).mockReturnValue(true)
    expect(onwayCaptchaSolverEnabled()).toBe(true)
    setSolver(originalSolver)
  })
})

function fakePage(options: {
  textareaValue?: string
  frames?: Array<{ url: string; token?: string; bodyText?: string; checked?: boolean }>
}) {
  const frames = (options.frames ?? []).map((frame) => ({
    url: () => frame.url,
    locator: () => ({
      getAttribute: async () => frame.token ?? null,
      count: async () => (frame.checked ? 1 : 0),
    }),
    evaluate: async () => frame.bodyText ?? "",
  }))
  return {
    evaluate: async () => (options.textareaValue ?? "").length,
    frames: () => frames,
  } as never
}

describe("hasOnwayCaptchaToken", () => {
  it("detecta el token en el textarea del portal", async () => {
    const page = {
      evaluate: async () => 32,
      frames: () => [],
    } as never
    await expect(hasOnwayCaptchaToken(page)).resolves.toBe(true)
  })

  it("no confunde un textarea vacío con un token", async () => {
    const page = { evaluate: async () => 0, frames: () => [] } as never
    await expect(hasOnwayCaptchaToken(page)).resolves.toBe(false)
  })

  it("acepta la casilla marcada en el frame anchor", async () => {
    const page = fakePage({
      frames: [{ url: "https://www.google.com/recaptcha/api2/anchor", checked: true }],
    })
    await expect(hasOnwayCaptchaToken(page)).resolves.toBe(true)
  })

  it("NO se declara resuelto por el token de desafío del bframe", async () => {
    // Regresión del 2026-11-25: `#recaptcha-token` vale ~4300 caracteres desde
    // que el desafío se pinta, con `getResponse()` vacío y la casilla sin
    // marcar. Se declaraba resuelto a los 587 ms y Auth0 rechazaba el envío.
    const page = {
      evaluate: async () => 0,
      frames: () => [
        {
          url: () => "https://www.google.com/recaptcha/api2/bframe",
          locator: () => ({ getAttribute: async () => "x".repeat(4302), count: async () => 0 }),
        },
      ],
    } as never
    await expect(hasOnwayCaptchaToken(page)).resolves.toBe(false)
  })
})

describe("isOnwayCaptchaBlocked", () => {
  it("reconoce el aviso de Google por consultas automatizadas", async () => {
    const page = {
      frames: () => [
        {
          url: () => "https://www.google.com/recaptcha/bframe",
          evaluate: async () =>
            "Es posible que tu red o computadora estén enviando consultas automatizadas. No podemos procesar tu solicitud.",
        },
      ],
    } as never
    await expect(isOnwayCaptchaBlocked(page)).resolves.toBe(true)
  })

  it("no marca bloqueo por un desafío normal", async () => {
    const page = {
      frames: () => [
        {
          url: () => "https://www.google.com/recaptcha/bframe",
          evaluate: async () => "Selecciona todas las imágenes con semáforos",
        },
      ],
    } as never
    await expect(isOnwayCaptchaBlocked(page)).resolves.toBe(false)
  })
})
