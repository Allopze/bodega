import { describe, expect, it } from "vitest"
import { buildRows } from "../fleet-view"
import { flowReducer, type FlowAction } from "../flow"
import { buildFlowEnv } from "../flow-env"
import { buildRecord, draftFromRejected } from "../flow-record"
import { newDraft, normalizeDraft, stepsFor, type FlowDraft } from "../flow-types"
import { analyzeLecture, checklistCounts, validateAll, type FlowCtx } from "../flow-validate"
import { SCHEDULE, UUID, equipment, recordItem, storedCatalog } from "./fixtures"

const TODAY = "2026-10-28"

function ctxFor(overrides: Parameters<typeof equipment>[0] = {}): FlowCtx {
  const row = buildRows(storedCatalog("u-1", [equipment(overrides)]), [])[0] ?? null
  return { row, today: TODAY }
}

function run(draft: FlowDraft, ctx: FlowCtx, ...actions: FlowAction[]): FlowDraft {
  return actions.reduce((state, action) => flowReducer(state, action), draft)
}

const start = (ctx: FlowCtx, kind: "P" | "C" = "P") => newDraft({ userId: "u-1", kind, vehicleId: ctx.row?.eq.id ?? null, schedule: ctx.row?.schedule ?? null, now: new Date("2026-10-28T15:00:00Z") })

/** Lleva un borrador preventivo hasta Revisar, con todo marcado «Realizado». */
function preventiveAtReview(ctx: FlowCtx): FlowDraft {
  const env = buildFlowEnv(ctx)
  let draft = start(ctx)
  draft = run(draft, ctx, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
  expect(stepsFor("P")[draft.step]).toBe("pauta")
  const groups = Array.from({ length: 2 }, (_, i) => i)
  for (const group of groups) draft = run(draft, ctx, { type: "markGroup", group })
  draft = run(draft, ctx, { type: "next", env })
  expect(stepsFor("P")[draft.step]).toBe("fotos")
  draft = run(draft, ctx, { type: "photo", slot: "filtros", id: UUID(11) }, { type: "photo", slot: "sticker", id: UUID(12) }, { type: "patch", patch: { notes: "sin novedad" } }, { type: "next", env })
  expect(stepsFor("P")[draft.step]).toBe("revisar")
  return draft
}

describe("reductor del flujo: «Cambiar» desde Revisar", () => {
  it("cambiar la fecha vuelve directo a Revisar (no invalida nada intermedio)", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = preventiveAtReview(ctx)
    draft = run(draft, ctx, { type: "goStep", step: 1, backToReview: true })
    expect(draft.step).toBe(1)
    expect(draft.ret).toBe(4)
    draft = run(draft, ctx, { type: "patch", patch: { workDate: "2026-10-27" } }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("revisar")
    expect(draft.ret).toBeNull()
  })

  it("cambiar la lectura a otra pauta con ítems nuevos invalida la pauta y se detiene ahí", () => {
    // Sin lecturas previas: ningún aviso de salto ni de orden interfiere.
    const ctx = ctxFor({ readings: [], initialReading: null })
    const env = buildFlowEnv(ctx)
    let draft = start(ctx)
    draft = run(draft, ctx, { type: "patch", patch: { readingText: "20200" } }, { type: "next", env })
    expect(draft.intervalValue).toBe(20_000)
    expect(draft.checklist).toHaveLength(3)
    for (const group of [0, 1]) draft = run(draft, ctx, { type: "markGroup", group })
    draft = run(draft, ctx, { type: "next", env }, { type: "photo", slot: "filtros", id: UUID(11) }, { type: "photo", slot: "sticker", id: UUID(12) }, { type: "patch", patch: { notes: "sin novedad" } }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("revisar")

    // La pauta de 40.000 km trae un ítem más («Cambio líquido»): el mecánico debe marcarlo.
    draft = run(draft, ctx, { type: "goStep", step: 1, backToReview: true }, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    expect(draft.intervalValue).toBe(40_000)
    expect(stepsFor("P")[draft.step]).toBe("pauta")
    expect(draft.ret).toBe(4)
    expect(draft.marks.m1).toBe("R")
    draft = run(draft, ctx, { type: "markGroup", group: 1 }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("revisar")
    expect(draft.ret).toBeNull()
  })

  it("cambiar la lectura dentro de la misma pauta vuelve directo a Revisar", () => {
    const ctx = ctxFor({ readings: [], initialReading: null })
    const env = buildFlowEnv(ctx)
    let draft = preventiveAtReview(ctx)
    draft = run(draft, ctx, { type: "goStep", step: 1, backToReview: true }, { type: "patch", patch: { readingText: "40900" } }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("revisar")
  })

  it("cambiar el equipo invalida lectura y pauta: se detiene en la lectura", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = preventiveAtReview(ctx)
    draft = run(draft, ctx, { type: "goStep", step: 0, backToReview: true })
    draft = run(draft, ctx, { type: "pickEquipment", vehicleId: "veh-2", schedule: ctx.row!.schedule })
    expect(draft.readingText).toBe("")
    expect(draft.marks).toEqual({})
    expect(draft.checklist).toEqual([])
    const ctx2 = ctxFor({ id: "veh-2", code: "KA-141" })
    draft = run(draft, ctx2, { type: "next", env: buildFlowEnv(ctx2) })
    expect(stepsFor("P")[draft.step]).toBe("lectura")
    expect(draft.ret).toBe(4)
    void env
  })

  it("«Atrás» abandona el modo «volver a Revisar»", () => {
    const ctx = ctxFor()
    let draft = preventiveAtReview(ctx)
    draft = run(draft, ctx, { type: "goStep", step: 2, backToReview: true }, { type: "back" })
    expect(draft.step).toBe(1)
    expect(draft.ret).toBeNull()
  })

  it("no avanza con errores y los deja a la vista", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    const draft = run(start(ctx), ctx, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("lectura")
    expect(draft.errors.reading).toMatch(/odómetro/)
  })
})

describe("pauta", () => {
  it("«Todo realizado» marca sólo lo que falta y respeta lo ya marcado", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    draft = run(draft, ctx, { type: "mark", key: "m1", value: "NA" }, { type: "markGroup", group: 0 })
    expect(draft.marks).toMatchObject({ m1: "NA", m2: "R" })
  })

  it("un «No realizado» sin motivo bloquea; con motivo pasa", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    for (const group of [0, 1]) draft = run(draft, ctx, { type: "markGroup", group })
    draft = run(draft, ctx, { type: "mark", key: "f1", value: "NR" })
    expect(checklistCounts(draft).missingReason).toBe(1)
    draft = run(draft, ctx, { type: "next", env })
    expect(draft.errors.pauta).toBeTruthy()
    draft = run(draft, ctx, { type: "reason", key: "f1", text: "Falta repuesto" }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("fotos")
  })

  it("al completar el sistema abierto se abre el siguiente pendiente", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    expect(draft.openGroup).toBe(0)
    draft = run(draft, ctx, { type: "mark", key: "m1", value: "R" }, { type: "mark", key: "m2", value: "R" })
    expect(draft.openGroup).toBe(1)
  })

  it("la regla de marca X oculta el ítem y W lo avisa", () => {
    const ctx = ctxFor()
    const analysis = analyzeLecture({ ...start(ctx), readingText: "40312" }, ctx.row)
    expect(analysis.items.find((item) => item.key === "m1")?.manufacturerWarning).toBe(true)
    expect(analysis.items).toHaveLength(4)
  })
})

describe("lectura", () => {
  it("pide confirmar un salto de lectura y no lo pregunta dos veces", () => {
    const ctx = ctxFor({ readings: [{ value: 10_000, date: "2026-10-01", source: "MP-BIO-0001" }] })
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "50000" } }, { type: "next", env })
    expect(draft.errors.jump).toMatch(/40\.000 km más que la última vez/)
    expect(stepsFor("P")[draft.step]).toBe("lectura")
    draft = run(draft, ctx, { type: "patch", patch: { ackJump: { reading: 50_000, workDate: draft.workDate } } })
    expect(draft.errors.jump).toBeUndefined()
    draft = run(draft, ctx, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("pauta")
  })

  it("avisa una preventiva repetida con la anterior y permite continuar", () => {
    const ctx = ctxFor({ recentPreventives: [{ id: "prev-1", folio: "MP-BIO-0001", reading: 40_000, date: "2026-10-25", intervalValue: 40_000 }] })
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    expect(draft.errors.duplicate).toBeTruthy()
    expect(analyzeLecture(draft, ctx.row).duplicate?.folio).toBe("MP-BIO-0001")
    draft = run(draft, ctx, { type: "patch", patch: { ackDuplicate: "prev-1" } }, { type: "next", env })
    expect(stepsFor("P")[draft.step]).toBe("pauta")
  })

  it("una lectura menor que la anterior dice cuál choca", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    const draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "39000" } }, { type: "next", env })
    expect(draft.errors.reading).toMatch(/Es menor que la lectura de 40\.312 km del 01-10-2026/)
  })

  it("elegir otra pauta exige motivo; la fecha no puede ser futura", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx), ctx, { type: "patch", patch: { readingText: "40312", intervalIndex: 1 } }, { type: "next", env })
    expect(draft.errors.ivReason).toBeTruthy()
    draft = run(draft, ctx, { type: "patch", patch: { intervalReason: "la anterior quedó incompleta", workDate: "2026-12-01" } }, { type: "next", env })
    expect(draft.errors.workDate).toMatch(/futura/)
  })
})

describe("registro firmado", () => {
  const input = (ctx: FlowCtx) => ({ row: ctx.row!, deviceId: UUID(900), appVersion: "1.0", offlineSince: null, now: new Date("2026-10-28T15:30:00Z") })

  it("una preventiva completa se convierte en un registro válido para el servidor", () => {
    const ctx = ctxFor()
    const built = buildRecord(preventiveAtReview(ctx), input(ctx))
    expect(built.ok).toBe(true)
    if (!built.ok || built.payload.kind !== "P") return
    expect(built.payload.scheduleVersion).toBe(3)
    expect(built.payload.items).toHaveLength(4)
    expect(built.payload.photos.map((photo) => photo.kind)).toEqual(["filtros", "sticker"])
    expect(built.summary.intervalValue).toBe(40_000)
    expect(validateAll(preventiveAtReview(ctx), stepsFor("P"), ctx)).toBeNull()
  })

  it("guarda la pauta con la versión del borrador aunque el catálogo cambie", () => {
    const ctx = ctxFor()
    const draft = preventiveAtReview(ctx)
    const newer = { ...ctx.row!, schedule: { ...SCHEDULE, version: 4 } }
    const built = buildRecord(draft, { ...input(ctx), row: newer })
    expect(built.ok && built.payload.kind === "P" && built.payload.scheduleVersion).toBe(3)
  })

  it("una correctiva incompleta muestra el primer problema; completa, se valida", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx, "C"), ctx, { type: "patch", patch: { readingText: "40400" } }, { type: "next", env })
    expect(stepsFor("C")[draft.step]).toBe("trabajo")
    draft = run(draft, ctx, { type: "next", env })
    expect(Object.keys(draft.errors).sort()).toEqual(["description", "drivers", "oil", "photos", "workTypes", "workshop"])
    draft = run(draft, ctx,
      { type: "jobAdd", workTypeId: "t-1" }, { type: "jobNoParts", workTypeId: "t-1", noParts: true }, { type: "noOilChange" },
      { type: "patch", patch: { description: "Cambio de manguera", inWorkshop: true, workshopReason: "Espera un repuesto" } },
      { type: "toggleId", field: "driverIds", id: "d-1" }, { type: "photoAdd", id: UUID(21) }, { type: "jobHours", workTypeId: "t-1", hours: 3 })
    expect(draft.errors).toEqual({})
    const built = buildRecord(draft, input(ctx))
    expect(built.ok && built.payload.kind === "C" && built.payload.jobs[0]?.hours).toBe(3)
    expect(built.ok && built.payload.kind === "C" && built.payload.workshopReason).toBe("Espera un repuesto")
  })

  it("trabajos: un tipo no se repite, repuestos o «sin repuestos» por trabajo, y el motivo de taller es obligatorio con «Sí»", () => {
    const ctx = ctxFor()
    const env = buildFlowEnv(ctx)
    let draft = run(start(ctx, "C"), ctx, { type: "patch", patch: { readingText: "40400" } }, { type: "next", env },
      { type: "jobAdd", workTypeId: "t-1" }, { type: "jobAdd", workTypeId: "t-1" }, { type: "jobAdd", workTypeId: "t-2" })
    expect(draft.jobs.map((job) => job.workTypeId)).toEqual(["t-1", "t-2"])
    draft = run(draft, ctx, { type: "noOilChange" }, { type: "patch", patch: { description: "Cambio de manguera", inWorkshop: true } },
      { type: "toggleId", field: "driverIds", id: "d-1" }, { type: "photoAdd", id: UUID(21) },
      { type: "jobPart", workTypeId: "t-1", index: 0, field: "description", text: "Manguera" }, { type: "jobNoParts", workTypeId: "t-2", noParts: true },
      { type: "next", env })
    expect(Object.keys(draft.errors)).toEqual(["workshopReason"])
    draft = run(draft, ctx, { type: "jobNoParts", workTypeId: "t-2", noParts: false }, { type: "patch", patch: { workshopReason: "Espera repuesto" } }, { type: "next", env })
    expect(Object.keys(draft.errors)).toEqual(["job:t-2"])
    draft = run(draft, ctx, { type: "jobRemove", workTypeId: "t-2" }, { type: "next", env })
    expect(draft.errors).toEqual({})
  })

  it("un borrador con el formato anterior se normaliza sin perder lo escrito", () => {
    const ctx = ctxFor()
    const { jobs: _jobs, workshopReason: _reason, ...base } = start(ctx, "C")
    const old = { ...base, workTypeIds: ["t-1", "t-2"], hours: 4.5, noParts: false, parts: [{ quantity: "2", description: "Manguera" }] } as unknown as FlowDraft
    const draft = normalizeDraft(old)
    expect(draft.jobs.map((job) => [job.workTypeId, job.hours])).toEqual([["t-1", 4.5], ["t-2", 1]])
    expect(draft.jobs[0]?.parts).toEqual([{ quantity: "2", description: "Manguera" }])
    expect(draft.workshopReason).toBe("")
    expect("workTypeIds" in draft).toBe(false)
  })

  it("«No se cambió aceite» y los aceites se excluyen", () => {
    const ctx = ctxFor()
    let draft = start(ctx, "C")
    draft = run(draft, ctx, { type: "toggleId", field: "oilIds", id: "o-1" }, { type: "noOilChange" })
    expect(draft.oilIds).toEqual([])
    expect(draft.noOilChange).toBe(true)
  })

  it("«Corregir y reenviar» arma un borrador nuevo en Revisar con las mismas fotos", () => {
    const ctx = ctxFor()
    const item = recordItem(UUID(1), "u-1", [UUID(11), UUID(12)])
    const draft = draftFromRejected(item, ctx.row!, new Date("2026-10-29T09:00:00Z"))
    expect(draft.id).not.toBe(UUID(1))
    expect(draft.replacesQueueId).toBe(UUID(1))
    expect(stepsFor("P")[draft.step]).toBe("revisar")
    expect(draft.photos).toMatchObject({ filtros: UUID(11), sticker: UUID(12) })
    expect(draft.marks.m1).toBe("R")
  })
})
