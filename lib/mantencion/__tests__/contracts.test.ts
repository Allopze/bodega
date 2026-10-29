import { describe, expect, it } from "vitest"
import { correctiveRecordSchema, observationReplySchema, photoMetaSchema, preventiveRecordSchema, syncRecordSchema, workshopUpdateSchema } from "../contracts"

/*
 * Lo que el CONTRATO ya impide (reglas 8 y 9). Las reglas que cruzan campos o
 * dependen de la base —una preventiva necesita 1 foto de filtros y 1 del sticker,
 * «No se usaron repuestos» excluye la lista, el aviso sobre 12 h— las valida el
 * servidor al recibir el registro y las cubren sus pruebas.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const NOW = "2026-10-28T15:00:00-03:00"

const common = {
  vehicleId: "veh-1",
  reading: 40_312,
  workDate: "2026-10-28",
  signedAt: NOW,
  offlineSince: null,
  deviceId: uuid(99),
  appVersion: "1.0.0",
  readingJumpConfirmed: false,
  duplicateConfirmed: false,
  correctsRecordId: null,
}

const corrective = {
  ...common,
  id: uuid(1),
  kind: "C" as const,
  photos: [{ id: uuid(10), kind: "correctiva" as const }],
  jobs: [{ workTypeId: "wt-1", hours: 2, noParts: true, parts: [] }],
  oilIds: [],
  noOilChange: true,
  executor: { kind: "yo" as const },
  description: "Cambio de manguera",
  inWorkshop: false,
  workshopEntryDate: null,
  workshopReason: null,
  workOrder: null,
  driverIds: ["drv-1"],
}

const preventive = {
  ...common,
  id: uuid(2),
  kind: "P" as const,
  photos: [{ id: uuid(11), kind: "filtros" as const }, { id: uuid(12), kind: "sticker" as const }],
  scheduleId: "sch-1",
  scheduleVersion: 1,
  intervalValue: 40_000,
  suggestedIntervalValue: 40_000,
  manualScheduleReason: null,
  items: [{ itemKey: "km1", value: "R" as const, reason: null }],
  notes: "Sin novedad",
}

describe("regla 9 · correctiva obligatoria (lo que el contrato exige)", () => {
  it("un registro completo es válido", () => {
    expect(correctiveRecordSchema.safeParse(corrective).success).toBe(true)
    expect(syncRecordSchema.safeParse(corrective).success).toBe(true)
  })

  const withHours = (hours: number) => ({ ...corrective, jobs: [{ workTypeId: "wt-1", hours, noParts: true, parts: [] }] })

  it("horas por trabajo entre 0,5 y 72 en pasos de 0,5", () => {
    for (const hours of [0.5, 1, 1.5, 12.5, 72]) expect(correctiveRecordSchema.safeParse(withHours(hours)).success, String(hours)).toBe(true)
    for (const hours of [0, 0.4, 0.75, 1.25, 72.5, 73, -1]) expect(correctiveRecordSchema.safeParse(withHours(hours)).success, String(hours)).toBe(false)
  })

  it("un mismo tipo de trabajo no se repite y el total no pasa de 72 horas", () => {
    const job = (workTypeId: string, hours: number) => ({ workTypeId, hours, noParts: true, parts: [] })
    expect(correctiveRecordSchema.safeParse({ ...corrective, jobs: [job("wt-1", 1), job("wt-2", 1)] }).success).toBe(true)
    expect(correctiveRecordSchema.safeParse({ ...corrective, jobs: [job("wt-1", 1), job("wt-1", 2)] }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, jobs: [job("wt-1", 40), job("wt-2", 32)] }).success).toBe(true)
    expect(correctiveRecordSchema.safeParse({ ...corrective, jobs: [job("wt-1", 40), job("wt-2", 32.5)] }).success).toBe(false)
  })

  it("al menos un trabajo, una descripción de 5 caracteres y un conductor", () => {
    expect(correctiveRecordSchema.safeParse({ ...corrective, jobs: [] }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, description: "Rota" }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, description: "  Rota " }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, description: "Rotas" }).success).toBe(true)
    expect(correctiveRecordSchema.safeParse({ ...corrective, driverIds: [] }).success).toBe(false)
  })

  it("quién hizo el trabajo: otro mecánico exige su usuario y un taller externo, el taller", () => {
    expect(correctiveRecordSchema.safeParse({ ...corrective, executor: { kind: "otro_mecanico" } }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, executor: { kind: "otro_mecanico", userId: "u-2" } }).success).toBe(true)
    expect(correctiveRecordSchema.safeParse({ ...corrective, executor: { kind: "externo" } }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, executor: { kind: "externo", workshopId: "w-1" } }).success).toBe(true)
  })

  it("el mensaje de cada error está en español", () => {
    const result = correctiveRecordSchema.safeParse({ ...corrective, jobs: [], description: "x" })
    expect(result.success).toBe(false)
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message)
      expect(messages).toContain("Agrega al menos un trabajo.")
      expect(messages).toContain("Describe el trabajo realizado.")
    }
  })
})

describe("regla 8 · fotos obligatorias (lo que el contrato exige)", () => {
  it("una correctiva lleva de 1 a 3 fotos", () => {
    const photos = (count: number) => Array.from({ length: count }, (_, i) => ({ id: uuid(20 + i), kind: "correctiva" as const }))
    expect(correctiveRecordSchema.safeParse({ ...corrective, photos: [] }).success).toBe(false)
    expect(correctiveRecordSchema.safeParse({ ...corrective, photos: photos(3) }).success).toBe(true)
    expect(correctiveRecordSchema.safeParse({ ...corrective, photos: photos(4) }).success).toBe(false)
  })

  it("una preventiva sin fotos no pasa el contrato", () => {
    expect(preventiveRecordSchema.safeParse(preventive).success).toBe(true)
    expect(preventiveRecordSchema.safeParse({ ...preventive, photos: [] }).success).toBe(false)
  })

  it("la foto declara su huella sha256, el sello y su origen", () => {
    const meta = { kind: "filtros", sha256: "a".repeat(64), width: 1600, height: 1200, stampedAt: NOW, takenAtExif: null, exif: null, deviceId: uuid(99) }
    expect(photoMetaSchema.safeParse(meta).success).toBe(true)
    expect(photoMetaSchema.safeParse({ ...meta, sha256: "xyz" }).success).toBe(false)
    expect(photoMetaSchema.safeParse({ ...meta, sha256: "A".repeat(64) }).success).toBe(false)
    expect(photoMetaSchema.safeParse({ ...meta, kind: "otra" }).success).toBe(false)
    expect(photoMetaSchema.safeParse({ ...meta, stampedAt: "28-10-2026" }).success).toBe(false)
  })
})

describe("preventiva y datos comunes", () => {
  it("las observaciones son obligatorias («sin novedad» si no hay nada)", () => {
    expect(preventiveRecordSchema.safeParse({ ...preventive, notes: "" }).success).toBe(false)
    expect(preventiveRecordSchema.safeParse({ ...preventive, notes: "ok" }).success).toBe(false)
    expect(preventiveRecordSchema.safeParse({ ...preventive, notes: "sin novedad" }).success).toBe(true)
  })

  it("la lectura no es negativa y la fecha va como AAAA-MM-DD", () => {
    expect(preventiveRecordSchema.safeParse({ ...preventive, reading: -1 }).success).toBe(false)
    expect(preventiveRecordSchema.safeParse({ ...preventive, workDate: "28-10-2026" }).success).toBe(false)
  })

  it("el id del registro es un UUID (la idempotencia depende de él)", () => {
    expect(preventiveRecordSchema.safeParse({ ...preventive, id: "no-es-uuid" }).success).toBe(false)
  })

  it("syncRecordSchema distingue preventiva y correctiva por `kind`", () => {
    const parsed = syncRecordSchema.safeParse(preventive)
    expect(parsed.success && parsed.data.kind).toBe("P")
    expect(syncRecordSchema.safeParse({ ...preventive, kind: "X" }).success).toBe(false)
  })
})

describe("taller y observaciones", () => {
  const update = { id: uuid(30), recordId: uuid(1), createdAt: NOW, deviceId: uuid(99) }

  it("«Sigue en taller» exige contar en qué está; «Ya salió», la fecha", () => {
    expect(workshopUpdateSchema.safeParse({ ...update, kind: "sigue", note: "Esperando repuesto" }).success).toBe(true)
    expect(workshopUpdateSchema.safeParse({ ...update, kind: "sigue", note: "ok" }).success).toBe(false)
    expect(workshopUpdateSchema.safeParse({ ...update, kind: "salio", exitDate: "2026-10-28" }).success).toBe(true)
    expect(workshopUpdateSchema.safeParse({ ...update, kind: "salio" }).success).toBe(false)
  })

  it("la respuesta a una observación no puede ir vacía", () => {
    expect(observationReplySchema.safeParse({ observationId: "obs-1", response: "Listo" }).success).toBe(true)
    expect(observationReplySchema.safeParse({ observationId: "obs-1", response: " " }).success).toBe(false)
  })
})
