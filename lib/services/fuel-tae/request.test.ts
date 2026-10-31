import { describe, expect, it, vi } from "vitest"

vi.mock("sharp", () => ({ default: vi.fn() }))
vi.mock("@/lib/services/tae-ocr", () => ({ extractMeterReading: vi.fn() }))

const { parseFieldLoadRequest, parseInternalFieldLoadRequest } = await import("./request")

function payload(extra: Record<string, unknown> = {}) {
  return {
    clientSubmissionId: "client-submission-0001",
    worksiteId: "ws-1",
    loadingPointId: "lp-1",
    vehicleId: "veh-1",
    productId: "prod-1",
    supplyMediumId: "medium-1",
    equipmentCode: "CA-14",
    plate: "KPRT14",
    driverName: "Juan Pérez",
    supervisorName: "Rodrigo Pino",
    meterType: "odometer",
    meterReading: 182310,
    liters: 185,
    removedSealNumber: "004512",
    installedSealNumber: "004530",
    ...extra,
  }
}

function form(body: unknown) {
  const data = new FormData()
  data.set("payload", typeof body === "string" ? body : JSON.stringify(body))
  return data
}

const PAST = { loadedAt: "2026-10-12T14:30", reason: "Se anotó en papel y no se ingresó a tiempo" }

describe("parseFieldLoadRequest (vía pública por QR)", () => {
  it("descarta pastLoad y acknowledgeDuplicate aunque lleguen en el payload: un QR no fecha cargas", async () => {
    const parsed = await parseFieldLoadRequest(form(payload({ pastLoad: PAST, acknowledgeDuplicate: true })))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.input).not.toHaveProperty("pastLoad")
    expect(parsed.input).not.toHaveProperty("acknowledgeDuplicate")
    expect(Object.keys(parsed.input)).not.toContain("pastLoad")
    // Lo demás del payload sí pasa.
    expect(parsed.input).toMatchObject({ vehicleId: "veh-1", liters: 185 })
  })

  it("una carga pública normal sigue validándose igual", async () => {
    const parsed = await parseFieldLoadRequest(form(payload()))
    expect(parsed.ok).toBe(true)
    const bad = await parseFieldLoadRequest(form(payload({ liters: 0 })))
    expect(bad.ok).toBe(false)
    const notJson = await parseFieldLoadRequest(form("{no es json"))
    expect(notJson).toMatchObject({ ok: false, status: 400, body: { message: "Datos del formulario inválidos" } })
  })
})

describe("parseInternalFieldLoadRequest (la app)", () => {
  it("conserva pastLoad y acknowledgeDuplicate", async () => {
    const parsed = await parseInternalFieldLoadRequest(form(payload({ pastLoad: PAST, acknowledgeDuplicate: true })))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.input.pastLoad).toEqual(PAST)
    expect(parsed.input.acknowledgeDuplicate).toBe(true)
  })

  it("sin pastLoad, acknowledgeDuplicate queda en falso y pastLoad ausente", async () => {
    const parsed = await parseInternalFieldLoadRequest(form(payload()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.input.pastLoad ?? null).toBeNull()
    expect(parsed.input.acknowledgeDuplicate).toBe(false)
  })

  it("un pastLoad mal formado se rechaza con 400 y el motivo en palabras", async () => {
    const shortReason = await parseInternalFieldLoadRequest(form(payload({ pastLoad: { ...PAST, reason: "olvido" } })))
    expect(shortReason).toMatchObject({ ok: false, status: 400 })
    if (!shortReason.ok) expect(shortReason.body.message).toContain("10 caracteres")
    const badDate = await parseInternalFieldLoadRequest(form(payload({ pastLoad: { ...PAST, loadedAt: "12/10/2026 14:30" } })))
    expect(badDate).toMatchObject({ ok: false, status: 400 })
  })
})
