import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Acciones de «Turnos y ralentí»: cada una pide `flota:manage_shifts`, respeta el interruptor del submódulo,
 * entrega al servicio el actor y el alcance de la sesión y revalida la pantalla.
 */

const guard = vi.hoisted(() => vi.fn())
const operational = vi.hoisted(() => vi.fn())
const scopeOf = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const createShift = vi.hoisted(() => vi.fn())
const updateShift = vi.hoisted(() => vi.fn())
const voidShift = vi.hoisted(() => vi.fn())
const setDayMark = vi.hoisted(() => vi.fn())
const clearDayMark = vi.hoisted(() => vi.fn())
const setIdleTarget = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard }))
vi.mock("@/lib/auth/scope", () => ({ serviceWorksiteScope: scopeOf }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: operational }))
vi.mock("@/lib/services/fleet-shifts", () => ({ createShift, updateShift, voidShift, setDayMark, clearDayMark, setIdleTarget }))

const actions = await import("./actions")

const SESSION = { user: { id: "u-admin", email: "admin@chome.test" } }
const ACTOR = { userId: "u-admin", email: "admin@chome.test", scope: ["w-1"] }
const DENIED = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const INPUT = {
  vehicleId: "veh-1",
  shiftDate: "2026-11-19",
  startHour: 22,
  endHour: 6,
  operatorWorkerId: "wrk-1",
  notes: "",
}
const NOT_ENABLED = { ok: false, message: "Los turnos aún no están habilitados." }

describe("acciones de turnos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
    operational.mockResolvedValue(true)
    scopeOf.mockReturnValue(["w-1"])
  })

  describe("createShiftAction", () => {
    it("sin permiso no llama al servicio", async () => {
      guard.mockResolvedValue(DENIED)
      const result = await actions.createShiftAction(INPUT)
      expect(result).toMatchObject({ ok: false })
      expect(guard).toHaveBeenCalledWith("flota:manage_shifts", "/flota/turnos")
      expect(createShift).not.toHaveBeenCalled()
    })

    it("con el interruptor apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      expect(await actions.createShiftAction(INPUT)).toEqual(NOT_ENABLED)
      expect(createShift).not.toHaveBeenCalled()
    })

    it("rechaza una forma inválida sin llegar al servicio", async () => {
      expect((await actions.createShiftAction({ ...INPUT, startHour: 25 })).ok).toBe(false)
      expect((await actions.createShiftAction({ ...INPUT, shiftDate: "ayer" })).ok).toBe(false)
      expect((await actions.createShiftAction({ ...INPUT, operatorWorkerId: "" })).ok).toBe(false)
      expect(createShift).not.toHaveBeenCalled()
    })

    it("delega en el servicio con el actor y el alcance de la sesión, y revalida", async () => {
      createShift.mockResolvedValue({ ok: true, shiftId: "s-1" })
      const result = await actions.createShiftAction(INPUT)
      expect(result).toEqual({ ok: true, shiftId: "s-1" })
      expect(createShift).toHaveBeenCalledWith(ACTOR, INPUT)
      expect(revalidatePath).toHaveBeenCalledWith("/flota/turnos")
    })

    it("un rechazo del servicio llega tal cual y no revalida", async () => {
      const message = "Se cruza con el turno de Ana Pérez en KA-1 (19-11 22–06). Corrige el horario o edita ese turno."
      createShift.mockResolvedValue({ ok: false, message })
      expect(await actions.createShiftAction(INPUT)).toEqual({ ok: false, message })
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it("si el servicio lanza, devuelve un mensaje en vez de propagar el error", async () => {
      createShift.mockRejectedValue(new Error("boom"))
      const result = await actions.createShiftAction(INPUT)
      expect(result.ok).toBe(false)
    })
  })

  describe("updateShiftAction", () => {
    it("sin permiso no llama al servicio", async () => {
      guard.mockResolvedValue(DENIED)
      expect((await actions.updateShiftAction("s-1", INPUT)).ok).toBe(false)
      expect(updateShift).not.toHaveBeenCalled()
    })

    it("con el interruptor apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      expect(await actions.updateShiftAction("s-1", INPUT)).toEqual(NOT_ENABLED)
    })

    it("delega con el id del turno, el actor y el alcance", async () => {
      updateShift.mockResolvedValue({ ok: true, shiftId: "s-1" })
      await actions.updateShiftAction("s-1", INPUT)
      expect(updateShift).toHaveBeenCalledWith(ACTOR, "s-1", INPUT)
      expect(revalidatePath).toHaveBeenCalledWith("/flota/turnos")
    })
  })

  describe("voidShiftAction", () => {
    it("sin permiso no llama al servicio", async () => {
      guard.mockResolvedValue(DENIED)
      expect((await actions.voidShiftAction("s-1", "Se cargó en el equipo equivocado")).ok).toBe(false)
      expect(voidShift).not.toHaveBeenCalled()
    })

    it("con el interruptor apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      expect(await actions.voidShiftAction("s-1", "Se cargó en el equipo equivocado")).toEqual(NOT_ENABLED)
    })

    it("delega con el motivo y revalida", async () => {
      voidShift.mockResolvedValue({ ok: true })
      expect(await actions.voidShiftAction("s-1", "Se cargó en el equipo equivocado")).toEqual({ ok: true })
      expect(voidShift).toHaveBeenCalledWith(ACTOR, "s-1", "Se cargó en el equipo equivocado")
      expect(revalidatePath).toHaveBeenCalledWith("/flota/turnos")
    })
  })

  describe("marcas de día", () => {
    const MARK = { vehicleId: "veh-1", day: "2026-11-19", reason: "sin_operacion_programada" as const, notes: "" }

    it("setDayMarkAction: sin permiso, apagado y delegación", async () => {
      guard.mockResolvedValueOnce(DENIED)
      expect((await actions.setDayMarkAction(MARK)).ok).toBe(false)
      operational.mockResolvedValueOnce(false)
      expect(await actions.setDayMarkAction(MARK)).toEqual(NOT_ENABLED)
      expect(setDayMark).not.toHaveBeenCalled()

      setDayMark.mockResolvedValue({ ok: true })
      expect(await actions.setDayMarkAction(MARK)).toEqual({ ok: true })
      expect(setDayMark).toHaveBeenCalledWith(ACTOR, MARK)
    })

    it("setDayMarkAction rechaza un motivo que no existe", async () => {
      expect((await actions.setDayMarkAction({ ...MARK, reason: "vacaciones" as never })).ok).toBe(false)
      expect(setDayMark).not.toHaveBeenCalled()
    })

    it("clearDayMarkAction: apagado y delegación", async () => {
      operational.mockResolvedValueOnce(false)
      expect(await actions.clearDayMarkAction({ vehicleId: "veh-1", day: "2026-11-19" })).toEqual(NOT_ENABLED)

      clearDayMark.mockResolvedValue({ ok: true })
      await actions.clearDayMarkAction({ vehicleId: "veh-1", day: "2026-11-19" })
      expect(clearDayMark).toHaveBeenCalledWith(ACTOR, { vehicleId: "veh-1", day: "2026-11-19" })
    })
  })

  describe("setIdleTargetAction", () => {
    it("apagado y sin permiso no llegan al servicio", async () => {
      guard.mockResolvedValueOnce(DENIED)
      expect((await actions.setIdleTargetAction(25)).ok).toBe(false)
      operational.mockResolvedValueOnce(false)
      expect(await actions.setIdleTargetAction(25)).toEqual(NOT_ENABLED)
      expect(setIdleTarget).not.toHaveBeenCalled()
    })

    it("una meta fuera de 1 a 99 o con decimales no llega al servicio", async () => {
      expect((await actions.setIdleTargetAction(0)).ok).toBe(false)
      expect((await actions.setIdleTargetAction(100)).ok).toBe(false)
      expect((await actions.setIdleTargetAction(12.5)).ok).toBe(false)
      expect(setIdleTarget).not.toHaveBeenCalled()
    })

    it("delega con el actor y revalida", async () => {
      setIdleTarget.mockResolvedValue({ ok: true })
      expect(await actions.setIdleTargetAction(25)).toEqual({ ok: true })
      expect(setIdleTarget).toHaveBeenCalledWith(ACTOR, 25)
      expect(revalidatePath).toHaveBeenCalledWith("/flota/turnos")
    })
  })
})
