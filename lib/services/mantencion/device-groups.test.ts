import { describe, expect, it } from "vitest"
import type { DeviceCredentialRow } from "./device-credentials"
import { describeLastUse, friendlyDeviceName, groupDevicesByPerson } from "./device-groups"

const NOW = new Date("2026-10-30T16:00:00Z") // 13:00 en Chile (horario de verano, UTC-3)

function row(overrides: Partial<DeviceCredentialRow>): DeviceCredentialRow {
  return {
    id: "c1", userId: "u1", userName: "Ana Pérez", userEmail: "ana@chome.cl", deviceId: "1fbe6a56-aaaa-bbbb-cccc-000000000001",
    label: "Android · Chrome", createdAt: "2026-10-28T15:00:00Z", expiresAt: "2026-11-27T15:00:00Z",
    lastUsedAt: "2026-10-30T15:00:00Z", revokedAt: null, status: "vigente", ...overrides,
  }
}

describe("friendlyDeviceName", () => {
  it("dice «Sistema · Navegador» al revés y en cristiano", () => {
    expect(friendlyDeviceName("Android · Chrome")).toBe("Chrome en Android")
    expect(friendlyDeviceName("iPhone · Safari")).toBe("Safari en iPhone")
    expect(friendlyDeviceName("Windows · Edge")).toBe("Edge en Windows")
  })

  it("no inventa lo que la app no pudo reconocer", () => {
    expect(friendlyDeviceName("Dispositivo · Chrome")).toBe("Chrome")
    expect(friendlyDeviceName("iPad · navegador")).toBe("iPad")
    expect(friendlyDeviceName("Dispositivo · navegador")).toBe("Dispositivo sin identificar")
  })

  it("deja tal cual una etiqueta que no tiene esa forma y nombra la ausencia", () => {
    expect(friendlyDeviceName("E2E permisos")).toBe("E2E permisos")
    expect(friendlyDeviceName("Tablet del taller · Chrome")).toBe("Tablet del taller · Chrome")
    expect(friendlyDeviceName(null)).toBe("Dispositivo sin nombre")
    expect(friendlyDeviceName("   ")).toBe("Dispositivo sin nombre")
  })
})

describe("describeLastUse", () => {
  it("hoy y ayer llevan la hora; más atrás, los días y la fecha", () => {
    expect(describeLastUse("2026-10-30T15:00:00Z", NOW)).toBe("hoy, 12:00")
    expect(describeLastUse("2026-10-29T22:10:00Z", NOW)).toBe("ayer, 19:10")
    expect(describeLastUse("2026-10-25T15:00:00Z", NOW)).toBe("hace 5 días (25-10-2026)")
  })

  it("sin uso lo dice, y un reloj adelantado no produce «en 2 días»", () => {
    expect(describeLastUse(null, NOW)).toBe("Todavía no sincroniza")
    expect(describeLastUse("2026-11-01T15:00:00Z", NOW)).toBe("hoy, 13:00")
  })
})

describe("groupDevicesByPerson", () => {
  it("agrupa por persona, lo vigente aparte de la historia, y ordena por actividad", () => {
    const groups = groupDevicesByPerson([
      row({ id: "a1", lastUsedAt: "2026-10-30T10:00:00Z", deviceId: "aaaaaaaa-1" }),
      row({ id: "a2", lastUsedAt: "2026-10-30T15:30:00Z", deviceId: "bbbbbbbb-2" }),
      row({ id: "a3", status: "revocada", revokedAt: "2026-10-29T12:00:00Z", deviceId: "cccccccc-3" }),
      row({ id: "b1", userId: "u2", userName: "Beto Soto", userEmail: "beto@chome.cl", status: "vencida", expiresAt: "2026-10-01T15:00:00Z", deviceId: "dddddddd-4" }),
      row({ id: "c1", userId: "u3", userName: "Carla Ríos", userEmail: "carla@chome.cl", lastUsedAt: "2026-10-30T15:50:00Z", deviceId: "eeeeeeee-5" }),
    ], NOW)

    expect(groups.map((group) => group.userName)).toEqual(["Carla Ríos", "Ana Pérez", "Beto Soto"])
    const ana = groups[1]!
    // La usada más recientemente primero.
    expect(ana.active.map((device) => device.id)).toEqual(["a2", "a1"])
    expect(ana.past.map((device) => [device.id, device.status, device.endDate])).toEqual([["a3", "revocada", "29-10-2026"]])
    expect(ana.active[0]).toMatchObject({ name: "Chrome en Android", code: "bbbbbbbb", connected: "28-10-2026", endDate: "27-11-2026", lastUse: "hoy, 12:30" })
    // Quien sólo tiene historia va al final y sin vigentes.
    expect(groups[2]!.active).toEqual([])
    expect(groups[2]!.past[0]).toMatchObject({ status: "vencida", endDate: "01-10-2026" })
  })

  it("la búsqueda puede encontrar un teléfono por su código", () => {
    const [group] = groupDevicesByPerson([row({ deviceId: "1fbe6a56-aaaa" })], NOW)
    expect(group!.active[0]!.searchText).toContain("1fbe6a56")
  })

  it("sin credenciales no hay secciones", () => {
    expect(groupDevicesByPerson([], NOW)).toEqual([])
  })
})
