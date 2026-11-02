import { describe, expect, it } from "vitest"
import { buildRows } from "../fleet-view"
import { flowReducer, type FlowAction } from "../flow"
import { buildFlowEnv } from "../flow-env"
import { buildRecord, draftFromRejected } from "../flow-record"
import { firstStepIndex, newDraft, normalizeDraft, stepsFor, type FlowDraft } from "../flow-types"
import { validateAll, validateStep, type FlowCtx } from "../flow-validate"
import { newRecordItem } from "../queue"
import { UUID, correctivePayload, equipment, storedCatalog } from "./fixtures"

const ctx: FlowCtx = { row: buildRows(storedCatalog("u-1", [equipment()]), [])[0] ?? null, today: "2026-10-28" }
const input = { row: ctx.row!, deviceId: UUID(900), appVersion: "1.0", offlineSince: null, now: new Date("2026-10-28T15:30:00Z") }
const run = (draft: FlowDraft, ...actions: FlowAction[]) => actions.reduce((state, action) => flowReducer(state, action), draft)
const start = (kind: "P" | "C", workOrderId: string | null = null) =>
  newDraft({ userId: "u-1", kind, vehicleId: "veh-1", schedule: ctx.row?.schedule ?? null, workOrderId, now: new Date("2026-10-28T15:00:00Z") })

/** Una correctiva lista salvo lo del taller, que es justo lo que cambia con la OT. */
function correctiveReady(workOrderId: string | null): FlowDraft {
  return run(start("C", workOrderId),
    { type: "patch", patch: { readingText: "40400", description: "Cambio de manguera" } },
    { type: "jobAdd", workTypeId: "t-1" }, { type: "jobNoParts", workTypeId: "t-1", noParts: true }, { type: "noOilChange" },
    { type: "toggleId", field: "driverIds", id: "d-1" }, { type: "photoAdd", id: UUID(21) })
}

describe("registro desde una OT", () => {
  it("la correctiva enlazada manda workOrderId, nunca «queda en taller» ni el Nº de papel, y no pregunta por el taller", () => {
    const draft = run(correctiveReady("ot-1"), { type: "patch", patch: { workOrder: "32401" } })
    expect(validateStep(draft, "trabajo", ctx)).toEqual({})
    expect(validateAll(draft, stepsFor("C"), ctx)).toBeNull()
    const built = buildRecord(draft, input)
    expect(built.ok).toBe(true)
    if (!built.ok || built.payload.kind !== "C") return
    expect(built.payload).toMatchObject({ workOrderId: "ot-1", inWorkshop: false, workshopEntryDate: null, workshopReason: null, workOrder: null })
    expect(built.summary).toMatchObject({ inWorkshop: false, workshopEntryDate: null })
  })

  it("sin OT todo sigue igual: pide «¿queda en taller?» y el payload no trae workOrderId", () => {
    const draft = correctiveReady(null)
    expect(validateStep(draft, "trabajo", ctx).workshop).toBeTruthy()
    const ready = run(draft, { type: "patch", patch: { inWorkshop: false, workOrder: "32401" } })
    const built = buildRecord(ready, input)
    expect(built.ok && built.payload.kind === "C" && built.payload.workOrder).toBe("32401")
    expect(built.ok && "workOrderId" in built.payload).toBe(false)
  })

  it("una preventiva desde la OT también viaja enlazada", () => {
    const env = buildFlowEnv(ctx)
    let draft = run(start("P", "ot-1"), { type: "patch", patch: { readingText: "40312" } }, { type: "next", env })
    for (const group of [0, 1]) draft = run(draft, { type: "markGroup", group })
    draft = run(draft, { type: "next", env }, { type: "photo", slot: "filtros", id: UUID(11) }, { type: "photo", slot: "sticker", id: UUID(12) }, { type: "patch", patch: { notes: "sin novedad" } })
    const built = buildRecord(draft, input)
    expect(built.ok && built.payload.workOrderId).toBe("ot-1")
  })

  it("el equipo queda fijo: no se vuelve al paso «Equipo» ni se cambia de equipo", () => {
    const env = buildFlowEnv(ctx)
    let draft = start("C", "ot-1")
    expect(draft.step).toBe(1)
    expect(firstStepIndex(draft)).toBe(1)
    expect(run(draft, { type: "back" }).step).toBe(1)
    expect(run(draft, { type: "goStep", step: 0, backToReview: false }).step).toBe(1)
    expect(run(draft, { type: "pickEquipment", vehicleId: "veh-2", schedule: null }).vehicleId).toBe("veh-1")
    draft = run(draft, { type: "patch", patch: { readingText: "40400" } }, { type: "next", env })
    expect(stepsFor("C")[draft.step]).toBe("trabajo")
    expect(run(draft, { type: "back" }).step).toBe(1)
    // Sin OT, el paso 0 sigue disponible.
    expect(run(start("C"), { type: "back" }).step).toBe(0)
  })

  it("un borrador guardado antes de las OT se lee sin OT", () => {
    const { workOrderId: _omit, ...legacy } = start("C")
    expect(normalizeDraft(legacy as unknown as FlowDraft).workOrderId).toBeNull()
  })

  it("corregir un registro rechazado que estaba enlazado conserva la OT y no vuelve a preguntar por el taller", () => {
    const rejected = newRecordItem({
      authorUserId: "u-1",
      payload: correctivePayload(UUID(1), UUID(51), { workOrderId: "ot-1", inWorkshop: false, workshopEntryDate: null, workshopReason: null }),
      photoIds: [UUID(51)],
      summary: { kind: "C", vehicleId: "veh-1", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", unit: "km", intervalValue: null, workDate: "2026-10-28", reading: 40_400, inWorkshop: false, workshopEntryDate: null },
    })
    const draft = draftFromRejected(rejected, ctx.row!)
    expect(draft).toMatchObject({ workOrderId: "ot-1", inWorkshop: null })
    expect(validateStep(draft, "trabajo", ctx).workshop).toBeUndefined()
    expect(buildRecord(draft, input).ok).toBe(true)
  })
})
