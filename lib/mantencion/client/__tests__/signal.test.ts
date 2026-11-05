// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { getOfflineSince, isOnline, reportReachable, resetSignalForTests, startSignalTracking } from "../signal"
import { getMeta } from "../meta"
import { freshDb } from "./fixtures"

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const setOnLine = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true })

describe("señal", () => {
  beforeEach(async () => { await freshDb(); resetSignalForTests() })

  it("guarda desde cuándo no hay señal y lo borra al volver", async () => {
    setOnLine(true)
    const stop = startSignalTracking()
    await settle()
    expect(isOnline()).toBe(true)
    expect(getOfflineSince()).toBeNull()

    setOnLine(false)
    window.dispatchEvent(new Event("offline"))
    await settle()
    expect(isOnline()).toBe(false)
    const since = getOfflineSince()
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    setOnLine(true)
    window.dispatchEvent(new Event("online"))
    await settle()
    expect(getOfflineSince()).toBeNull()
    stop()
  })

  it("una plataforma que no contesta cuenta como sin señal aunque el navegador diga que hay red", async () => {
    setOnLine(true)
    reportReachable(false)
    expect(isOnline()).toBe(false)
    reportReachable(true)
    expect(isOnline()).toBe(true)
  })

  it("el evento «online» limpia la marca aunque el navegador nunca haya pasado a «offline»", async () => {
    // El caso real: wifi sin salida. El navegador siempre estuvo «en línea», así que no
    // dispara `offline`; antes de la corrección `unreachable` quedaba prendido para siempre.
    setOnLine(true)
    const stop = startSignalTracking()
    await settle()
    reportReachable(false)
    await settle()
    expect(isOnline()).toBe(false)
    expect(getOfflineSince()).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    window.dispatchEvent(new Event("online"))
    await settle()
    expect(isOnline()).toBe(true)
    expect(getOfflineSince()).toBeNull()
    stop()
  })

  it("un éxito tras una falla de red deja la app en línea y sin hora de corte, incluso si la marca venía de antes", async () => {
    setOnLine(true)
    const stop = startSignalTracking()
    await settle()
    reportReachable(false)
    await settle()
    expect(isOnline()).toBe(false)
    expect(await getMeta("offlineSince")).not.toBeNull()

    // Lo que hace un refresco que sí responde (`reportReachable(true)` en catálogo o historial).
    reportReachable(true)
    await settle()
    expect(isOnline()).toBe(true)
    expect(getOfflineSince()).toBeNull()
    expect(await getMeta("offlineSince")).toBeNull()
    stop()
  })
})
