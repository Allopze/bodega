import { describe, expect, it } from "vitest"
import { hasArrayPayload, runPerDeviceWithinBudget, unwrapArray } from "./onway-client"

/**
 * El historial y los viajes de OnWay nunca se guardaron (hallazgo 2026-11-19):
 * el portal responde el historial como `{ value: [...] }` y los viajes como
 * `{ is_session_alive, routes: [...] }`, claves que el cliente no reconocía.
 */
describe("OnWay array payloads", () => {
  it("reads the history (`value`) and latest-trips (`routes`) envelopes", () => {
    const history = { $type: "Response`1", value: [{ sequence: 1 }] }
    const trips = { is_session_alive: true, routes: [{ row: 1 }] }

    expect(hasArrayPayload(history)).toBe(true)
    expect(unwrapArray(history)).toEqual([{ sequence: 1 }])
    expect(hasArrayPayload(trips)).toBe(true)
    expect(unwrapArray(trips)).toEqual([{ row: 1 }])
  })

  it("still rejects an object without any known array", () => {
    expect(hasArrayPayload({ is_session_alive: true })).toBe(false)
    expect(unwrapArray({ is_session_alive: true })).toEqual([])
  })
})

/**
 * Medido contra el portal real (2026-11-19, 50 equipos): el historial de 2 h
 * pedido en serie tarda ~72 s y, sumado al detalle y los viajes, pasaba el
 * plazo de 110 s de la telemetría; de a 5 tarda ~14 s (24 h: ~36 s).
 */
describe("runPerDeviceWithinBudget", () => {
  it("runs at most `concurrency` devices at a time", async () => {
    let running = 0
    let peak = 0
    const done: number[] = []
    const result = await runPerDeviceWithinBudget([1, 2, 3, 4, 5, 6, 7], async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      done.push(n)
      running--
    }, { concurrency: 3, stopStartingAt: Number.POSITIVE_INFINITY })

    expect(peak).toBe(3)
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result).toEqual({ skipped: 0 })
  })

  it("stops starting new devices once the budget is spent and reports how many it skipped", async () => {
    let clock = 0
    const started: number[] = []
    const result = await runPerDeviceWithinBudget([1, 2, 3, 4, 5], async (n) => {
      started.push(n)
      clock += 10
    }, { concurrency: 1, stopStartingAt: 25, now: () => clock })

    // 1 empieza en 0, 2 en 10, 3 en 20; a las 30 ya pasó el tope.
    expect(started).toEqual([1, 2, 3])
    expect(result).toEqual({ skipped: 2 })
  })

  it("keeps going when one device fails", async () => {
    const done: number[] = []
    const result = await runPerDeviceWithinBudget([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("portal")
      done.push(n)
    }, { concurrency: 2, stopStartingAt: Number.POSITIVE_INFINITY })

    expect(done.sort()).toEqual([1, 3])
    expect(result).toEqual({ skipped: 0 })
  })
})
