import { describe, expect, it } from "vitest"
import { deviceState, isVersionBehind, type DeviceSnapshot } from "@/lib/apps/device-state"

const NOW = new Date("2026-11-22T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function device(partial: Partial<DeviceSnapshot>): DeviceSnapshot {
  return { lastSeenAt: ago(MIN), pendingCount: 0, failedCount: 0, oldestPendingAt: null, ...partial }
}

describe("estado de un teléfono", () => {
  it("un rechazo manda aunque esté al día", () => {
    expect(deviceState(device({ failedCount: 1 }), NOW)).toBe("error")
  })

  it("atascado: avisó con señal y tiene pendientes viejos", () => {
    const lastSeenAt = ago(10 * MIN)
    const oldestPendingAt = new Date(new Date(lastSeenAt).getTime() - 3 * HOUR).toISOString()
    expect(deviceState(device({ lastSeenAt, pendingCount: 2, oldestPendingAt }), NOW)).toBe("stuck")
  })

  it("enviando: pendientes recientes no es atascado", () => {
    const lastSeenAt = ago(10 * MIN)
    const oldestPendingAt = new Date(new Date(lastSeenAt).getTime() - 20 * MIN).toISOString()
    expect(deviceState(device({ lastSeenAt, pendingCount: 1, oldestPendingAt }), NOW)).toBe("ok")
  })

  it("sin señal con pendientes tras 24 h", () => {
    expect(deviceState(device({ lastSeenAt: ago(30 * HOUR), pendingCount: 1, oldestPendingAt: ago(31 * HOUR) }), NOW)).toBe("silent")
  })

  it("sin abrir tras 7 días", () => {
    expect(deviceState(device({ lastSeenAt: ago(8 * DAY) }), NOW)).toBe("silent")
  })

  it("6 días sin pendientes sigue al día", () => {
    expect(deviceState(device({ lastSeenAt: ago(6 * DAY) }), NOW)).toBe("ok")
  })

  it("versión atrasada", () => {
    expect(isVersionBehind("a", "b")).toBe(true)
    expect(isVersionBehind("b", "b")).toBe(false)
  })
})
