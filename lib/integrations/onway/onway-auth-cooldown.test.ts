import { describe, expect, it } from "vitest"
import {
  ONWAY_CAPTCHA_BLOCK_HOURS,
  ONWAY_INTERACTIVE_AUTH_COOLDOWN_MS,
  isOnwayCaptchaBlockActive,
  isOnwayInteractiveAuthCooldownActive,
} from "./onway-auth-cooldown"

/**
 * Regresión del GPS detenido del 2026-11-22 al 11-24: Auth0 pedía CAPTCHA en
 * cada corrida y el cron reintentaba cada 5 minutos, 2 873 veces seguidas. La
 * cuarentena baja ese ritmo sin apagar la integración.
 */
const NOW = new Date("2026-11-24T18:00:00.000Z")

const failedInteractive = (minutesAgo: number) => ({
  startedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  status: "failed",
  errorCode: "ONWAY_INTERACTIVE_AUTH_REQUIRED",
})

describe("cuarentena por verificación interactiva de OnWay", () => {
  it("sin corridas no hay cuarentena", () => {
    expect(isOnwayInteractiveAuthCooldownActive(undefined, NOW)).toBe(false)
  })

  it("una corrida que se rindió esperando el desafío hace poco frena el reintento", () => {
    expect(isOnwayInteractiveAuthCooldownActive(failedInteractive(0), NOW)).toBe(true)
    expect(isOnwayInteractiveAuthCooldownActive(failedInteractive(29), NOW)).toBe(true)
  })

  it("pasada la cuarentena se vuelve a intentar: el portal pudo dejar de pedir el desafío", () => {
    const justPast = ONWAY_INTERACTIVE_AUTH_COOLDOWN_MS / 60_000 + 1
    expect(isOnwayInteractiveAuthCooldownActive(failedInteractive(justPast), NOW)).toBe(false)
  })

  it("una corrida exitosa la levanta, sin importar cuán reciente sea", () => {
    expect(isOnwayInteractiveAuthCooldownActive({
      startedAt: NOW.toISOString(),
      status: "success",
      errorCode: null,
    }, NOW)).toBe(false)
  })

  it("un fallo por otra causa no la activa: ese problema se arregla distinto", () => {
    expect(isOnwayInteractiveAuthCooldownActive({
      startedAt: NOW.toISOString(),
      status: "failed",
      errorCode: "ONWAY_PORTAL_TIMEOUT",
    }, NOW)).toBe(false)
  })

  it("una corrida en curso no la activa: para eso está el lock", () => {
    expect(isOnwayInteractiveAuthCooldownActive({
      startedAt: NOW.toISOString(),
      status: "running",
      errorCode: null,
    }, NOW)).toBe(false)
  })

  it("un fallo interactivo viejo no frena el trabajo para siempre", () => {
    expect(isOnwayInteractiveAuthCooldownActive(failedInteractive(60 * 24), NOW)).toBe(false)
  })
})

describe("cuarentena por bloqueo de Google", () => {
  const blocked = (hoursAgo: number) => ({
    startedAt: new Date(NOW.getTime() - hoursAgo * 60 * 60_000).toISOString(),
    status: "failed",
    errorCode: "ONWAY_CAPTCHA_BLOCKED",
  })

  it("sin corridas no hay bloqueo", () => {
    expect(isOnwayCaptchaBlockActive(undefined, NOW)).toBe(false)
  })

  it("un bloqueo reciente frena el intento automático", () => {
    expect(isOnwayCaptchaBlockActive(blocked(0), NOW)).toBe(true)
    expect(isOnwayCaptchaBlockActive(blocked(ONWAY_CAPTCHA_BLOCK_HOURS - 0.5), NOW)).toBe(true)
  })

  it("pasada la ventana se vuelve a intentar", () => {
    expect(isOnwayCaptchaBlockActive(blocked(ONWAY_CAPTCHA_BLOCK_HOURS + 0.5), NOW)).toBe(false)
  })

  it("un fallo de verificación interactiva NO activa el bloqueo: son remedios distintos", () => {
    expect(isOnwayCaptchaBlockActive(failedInteractive(0), NOW)).toBe(false)
  })

  it("una corrida exitosa lo levanta", () => {
    expect(isOnwayCaptchaBlockActive({
      startedAt: NOW.toISOString(),
      status: "success",
      errorCode: null,
    }, NOW)).toBe(false)
  })

  it("un bloqueo no impide para siempre volver a intentar", () => {
    expect(isOnwayCaptchaBlockActive(blocked(24 * 30), NOW)).toBe(false)
  })
})
