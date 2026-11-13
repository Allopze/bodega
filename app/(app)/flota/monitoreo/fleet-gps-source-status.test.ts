import { describe, expect, it } from "vitest"
import type { FleetGpsProviderRun } from "@/lib/services/fleet-gps"
import { buildSourceStatusRow, failureMessage, staleSinceLabel } from "./fleet-gps-source-status"

const NOW = Date.parse("2026-11-13T12:00:00.000Z")
const run = (overrides: Partial<FleetGpsProviderRun> = {}): FleetGpsProviderRun => ({
  provider: "onway", id: "r1", status: "success", startedAt: "2026-11-13T11:00:00.000Z", finishedAt: "2026-11-13T11:00:05.000Z",
  errorCode: null, devicesReceived: 10, devicesAccepted: 10, devicesUnmatched: 0, ...overrides,
})
const base = { provider: "onway" as const, latestAt: "2026-11-13T11:59:00.000Z", stale: false, run: run(), unmatched: 0, canManage: true }

describe("buildSourceStatusRow", () => {
  it("una fuente sana es una fila «Al día» sin avisos ni acciones", () => {
    expect(buildSourceStatusRow(base, NOW)).toMatchObject({ name: "OnWay", badge: "Al día", tone: "success", messages: [], actions: [] })
  })

  it("una fuente que nadie configuró no tiene fila", () => {
    expect(buildSourceStatusRow({ ...base, latestAt: null, run: null }, NOW)).toBeNull()
  })

  it("una falla no muestra el código en el mensaje: lo explica y deja el código en el detalle técnico", () => {
    const row = buildSourceStatusRow({ ...base, run: run({ status: "failed", errorCode: "ONWAY_SNAPSHOT_EMPTY" }) }, NOW)!
    expect(row.badge).toBe("Falló")
    expect(row.tone).toBe("danger")
    expect(row.messages.join(" ")).not.toMatch(/ONWAY_/)
    expect(row.messages[0]).toContain("no devolvió ningún equipo")
    expect(row.technicalDetail).toBe("ONWAY_SNAPSHOT_EMPTY")
    expect(row.actions).toEqual([{ label: "Revisar credenciales", kind: "settings" }])
  })

  it("una fuente atrasada dice hace cuánto, en días pasado el día, y lleva a la configuración", () => {
    const row = buildSourceStatusRow({ ...base, latestAt: "2026-10-31T12:00:00.000Z", stale: true }, NOW)!
    expect(row).toMatchObject({ badge: "Atrasada", tone: "warning" })
    expect(row.messages[0]).toContain("desde hace 13 días")
    expect(row.actions).toEqual([{ label: "Ver configuración", kind: "settings" }])
  })

  it("quien no administra ve el atraso pero no las acciones ni las fallas", () => {
    const row = buildSourceStatusRow({ ...base, canManage: false, run: null, unmatched: null, latestAt: "2026-10-31T12:00:00.000Z", stale: true }, NOW)!
    expect(row.badge).toBe("Atrasada")
    expect(row.actions).toEqual([])
    expect(row.technicalDetail).toBeNull()
    const failedForOthers = buildSourceStatusRow({ ...base, canManage: false, run: run({ status: "failed", errorCode: "X" }) }, NOW)!
    expect(failedForOthers.badge).toBe("Al día")
  })

  it("los dispositivos de OnWay sin patente única llevan al catálogo; las unidades de Wialon sin vehículo, a vincularlas", () => {
    const onway = buildSourceStatusRow({ ...base, unmatched: 7 }, NOW)!
    expect(onway.messages[0]).toContain("7 dispositivos sin una patente única")
    expect(onway.actions).toEqual([{ label: "Revisar catálogo de vehículos", kind: "link", href: "/admin/flota-catalogos/vehiculos" }])
    const wialon = buildSourceStatusRow({ ...base, provider: "wialon", run: run({ provider: "wialon" }), unmatched: 1 }, NOW)!
    expect(wialon.messages[0]).toContain("1 unidad sin vehículo")
    expect(wialon.actions).toEqual([{ label: "Vincular unidades", kind: "settings" }])
  })

  it("un parcial de OnWay con dispositivos sin vincular se explica por esos dispositivos, no se avisa dos veces", () => {
    const row = buildSourceStatusRow({ ...base, run: run({ status: "partial" }), unmatched: 2 }, NOW)!
    expect(row.messages).toHaveLength(1)
    expect(row.badge).toBe("Con pendientes")
    const alone = buildSourceStatusRow({ ...base, run: run({ status: "partial" }) }, NOW)!
    expect(alone.badge).toBe("Incompleta")
  })

  it("una falla y un atraso conviven: la falla manda en la insignia y ambos se dicen", () => {
    const row = buildSourceStatusRow({ ...base, stale: true, latestAt: "2026-11-12T12:00:00.000Z", run: run({ status: "failed", errorCode: "ONWAY_AUTH_REJECTED" }) }, NOW)!
    expect(row.badge).toBe("Falló")
    expect(row.messages).toHaveLength(2)
  })
})

describe("failureMessage y staleSinceLabel", () => {
  it("un código desconocido o ausente tiene un mensaje genérico, nunca el código", () => {
    expect(failureMessage(null)).toBe("No se pudo completar la última actualización.")
    expect(failureMessage("OTRO")).not.toContain("OTRO")
  })

  it("habla en minutos, horas y días con su singular", () => {
    expect(staleSinceLabel("2026-11-13T11:59:00.000Z", NOW)).toBe("1 minuto")
    expect(staleSinceLabel("2026-11-13T09:00:00.000Z", NOW)).toBe("3 horas")
    expect(staleSinceLabel("2026-11-12T12:00:00.000Z", NOW)).toBe("1 día")
  })
})
