import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * La caída del 2026-11-22 al 11-24 dejó 46 equipos sin posición durante 2 días
 * y 16 h. El estado era visible en TI › Integraciones, pero nadie entra ahí a
 * menos que ya sospeche: estos avisos existen para que la próxima vez alguien
 * se entere.
 */
interface NotifiedUser {
  type: string
  title: string
  body: string
  entityHref: string
  dedupeKey: string
}

const mocks = vi.hoisted(() => ({
  createNotifications: vi.fn(async (_userIds: string[], _input: NotifiedUser) => undefined),
  getUserIdsWithPermission: vi.fn(async (_permission: string): Promise<string[]> => ["user-gps-1"]),
}))

/** El aviso que se intentó crear en la llamada `index` (0 = el último caso probado). */
function notified(index = 0): NotifiedUser {
  const call = mocks.createNotifications.mock.calls[index]
  if (!call) throw new Error(`createNotifications no se llamó en el índice ${index}`)
  return call[1]
}

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/services/notification-create", () => ({
  createNotifications: (...args: unknown[]) => Reflect.apply(mocks.createNotifications, null, args),
}))
vi.mock("@/lib/services/notification-targeting", () => ({
  getUserIdsWithPermission: (...args: unknown[]) => Reflect.apply(mocks.getUserIdsWithPermission, null, args),
}))

const { alertOnwayNeedsAttention, ONWAY_ALERT_RECIPIENT_PERMISSION } = await import("./onway-alerts")

const NOW = new Date("2026-11-24T18:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUserIdsWithPermission.mockResolvedValue(["user-gps-1"])
})

describe("avisos de OnWay", () => {
  it("avisa a quien puede resolver la verificación, no a todo el mundo", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })

    expect(mocks.getUserIdsWithPermission).toHaveBeenCalledWith(ONWAY_ALERT_RECIPIENT_PERMISSION)
    expect(mocks.createNotifications).toHaveBeenCalledWith(["user-gps-1"], expect.objectContaining({
      type: "system_alert",
      entityHref: "/flota/monitoreo",
    }))
  })

  it("dice qué hacer, no un código técnico", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })

    const input = notified()
    expect(input.title).toContain("verificación")
    expect(input.body).toContain("Resolver verificación")
    expect(input.body).not.toContain("ONWAY_INTERACTIVE_AUTH_REQUIRED")
  })

  it("cuenta cuánto lleva detenido cuando hay una última captura conocida", async () => {
    await alertOnwayNeedsAttention({
      code: "ONWAY_INTERACTIVE_AUTH_REQUIRED",
      latestObservedAt: "2026-11-22T01:30:00.000Z",
      now: NOW,
    })

    expect(notified().body).toContain("2026-11-22 01:30")
  })

  it("avisa una sola vez por código y día: el índice de dedupe evita el correo repetido", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })
    await alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })

    expect(notified(0).dedupeKey).toBe(notified(1).dedupeKey)
    expect(notified().dedupeKey).toBe("onway-attention:ONWAY_INTERACTIVE_AUTH_REQUIRED:2026-11-24")
  })

  it("un hipo de red no despierta a nadie", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_PORTAL_TIMEOUT", now: NOW })

    expect(mocks.createNotifications).not.toHaveBeenCalled()
  })

  it("un fallo de respuesta aislado tampoco: no hay nada que una persona pueda hacer", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_RESPONSE_INVALID", now: NOW })

    expect(mocks.createNotifications).not.toHaveBeenCalled()
  })

  it("avisa de credenciales rechazadas y de una cuenta sin equipos", async () => {
    await alertOnwayNeedsAttention({ code: "ONWAY_AUTH_REJECTED", now: NOW })
    await alertOnwayNeedsAttention({ code: "ONWAY_SNAPSHOT_EMPTY", now: NOW })

    expect(notified(0).title).toContain("rechazó las credenciales")
    expect(notified(1).title).toContain("no devolvió ningún equipo")
  })

  it("si nadie tiene el permiso, lo registra y no revienta", async () => {
    mocks.getUserIdsWithPermission.mockResolvedValue([])

    await expect(alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })).resolves.toBeUndefined()
    expect(mocks.createNotifications).not.toHaveBeenCalled()
  })

  it("un fallo del servicio de notificaciones no se propaga a la corrida", async () => {
    mocks.createNotifications.mockRejectedValue(new Error("smtp caído"))

    await expect(alertOnwayNeedsAttention({ code: "ONWAY_INTERACTIVE_AUTH_REQUIRED", now: NOW })).resolves.toBeUndefined()
  })
})
