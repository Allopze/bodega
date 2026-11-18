import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Acciones de «Trasladar equipos»: cada una pide su permiso, respeta el interruptor del submódulo,
 * entrega al servicio el alcance de la sesión y revalida las pantallas que muestran la faena de un equipo.
 */

const guard = vi.hoisted(() => vi.fn())
const operational = vi.hoisted(() => vi.fn())
const scopeOf = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const revalidateFicha = vi.hoisted(() => vi.fn())
const listCandidates = vi.hoisted(() => vi.fn())
const transferVehicles = vi.hoisted(() => vi.fn())
const voidTransfer = vi.hoisted(() => vi.fn())
const listTransfers = vi.hoisted(() => vi.fn())
const worksiteRows = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {}
  for (const method of ["select", "from", "where"]) chain[method] = () => chain
  chain.orderBy = () => worksiteRows()
  return { db: chain }
})
vi.mock("next/cache", () => ({ revalidatePath }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: guard, can: () => true }))
vi.mock("@/lib/auth/scope", () => ({ serviceWorksiteScope: scopeOf }))
vi.mock("@/lib/services/module-toggles", () => ({ isRouteOperational: operational }))
vi.mock("@/lib/routing/revalidate-vehicle-ficha", () => ({ revalidateVehicleFicha: revalidateFicha }))
vi.mock("@/lib/reports/export-module/excel-builder", () => ({ xlsxToBase64: async () => "BASE64" }))
vi.mock("@/lib/reports/export-metadata", () => ({ addExportMetadataSheet: vi.fn() }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/fleet-transfers", () => ({
  listTransferCandidates: listCandidates,
  transferVehicles,
  voidTransfer,
  listTransfers,
  isFleetStayInvariantError: (error: unknown) => error instanceof Error && error.message.includes("FLEET_STAY_INVARIANT"),
}))

const actions = await import("./actions")

const SESSION = { user: { id: "u-jefe", email: "jefe@chome.test" } }
const DENIED = { session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } }
const INPUT = {
  toWorksiteId: "w-2",
  effectiveDate: "2026-11-10",
  reason: "Cambio de contrato en la faena",
  authorizedBy: "Jefa de operaciones",
  vehicleIds: ["veh-1", "veh-2"],
}

describe("acciones de traslados", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guard.mockResolvedValue({ session: SESSION, error: null })
    operational.mockResolvedValue(true)
    scopeOf.mockReturnValue(["w-1", "w-2"])
  })

  describe("transferVehiclesAction", () => {
    it("sin permiso no llama al servicio", async () => {
      guard.mockResolvedValue(DENIED)
      const result = await actions.transferVehiclesAction(INPUT)
      expect(result).toMatchObject({ ok: false })
      expect(guard).toHaveBeenCalledWith("flota:transfer", "/flota/traslados")
      expect(transferVehicles).not.toHaveBeenCalled()
    })

    it("con el submódulo apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      const result = await actions.transferVehiclesAction(INPUT)
      expect(result).toEqual({ ok: false, message: "Los traslados aún no están habilitados." })
      expect(transferVehicles).not.toHaveBeenCalled()
    })

    it("rechaza una forma inválida sin llegar al servicio", async () => {
      const result = await actions.transferVehiclesAction({ ...INPUT, vehicleIds: "veh-1" } as never)
      expect(result.ok).toBe(false)
      expect(transferVehicles).not.toHaveBeenCalled()
    })

    it("pasa el alcance de la sesión y revalida las pantallas afectadas", async () => {
      transferVehicles.mockResolvedValue({ ok: true, message: "Traslado T-0001 registrado.", data: { transferId: "t-1", folio: "T-0001", moved: 2, copecRecheckFrom: null, manualImportNotice: null } })
      const result = await actions.transferVehiclesAction(INPUT)
      expect(result.ok).toBe(true)
      expect(transferVehicles).toHaveBeenCalledWith({ userId: "u-jefe", email: "jefe@chome.test", scope: ["w-1", "w-2"] }, INPUT)
      const paths = revalidatePath.mock.calls.map((call) => call[0])
      expect(paths).toEqual(expect.arrayContaining(["/flota", "/flota/traslados", "/mantencion/equipos"]))
      expect(revalidateFicha).toHaveBeenCalledWith("veh-1")
      expect(revalidateFicha).toHaveBeenCalledWith("veh-2")
    })

    it("un rechazo del servicio devuelve sus errores por fila y no revalida", async () => {
      const failure = { ok: false, message: "Revisa los equipos marcados.", rowErrors: { "veh-1": "Ya está en Mininco." } }
      transferVehicles.mockResolvedValue(failure)
      expect(await actions.transferVehiclesAction(INPUT)).toEqual(failure)
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it("convierte el error del trigger en un mensaje legible", async () => {
      transferVehicles.mockRejectedValue(new Error("boom FLEET_STAY_INVARIANT"))
      const result = await actions.transferVehiclesAction(INPUT)
      expect(result).toEqual({ ok: false, message: "Para cambiar de faena usa «Trasladar equipos»." })
    })
  })

  describe("voidTransferAction", () => {
    it("sin permiso no anula", async () => {
      guard.mockResolvedValue(DENIED)
      expect(await actions.voidTransferAction({ transferId: "t-1", reason: "Fecha mal digitada" })).toMatchObject({ ok: false })
      expect(voidTransfer).not.toHaveBeenCalled()
    })

    it("con el submódulo apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      expect(await actions.voidTransferAction({ transferId: "t-1", reason: "Fecha mal digitada" }))
        .toEqual({ ok: false, message: "Los traslados aún no están habilitados." })
    })

    it("anula con el alcance de la sesión y revalida", async () => {
      voidTransfer.mockResolvedValue({ ok: true, message: "Traslado anulado." })
      const result = await actions.voidTransferAction({ transferId: "t-1", reason: "Fecha mal digitada" })
      expect(result.ok).toBe(true)
      expect(voidTransfer).toHaveBeenCalledWith({ userId: "u-jefe", email: "jefe@chome.test", scope: ["w-1", "w-2"] }, { transferId: "t-1", reason: "Fecha mal digitada" })
      expect(revalidatePath).toHaveBeenCalledWith("/flota/traslados")
      expect(revalidatePath).toHaveBeenCalledWith("/flota")
      expect(revalidatePath).toHaveBeenCalledWith("/flota/[id]", "layout")
    })

    it("no revalida si el servicio rechaza", async () => {
      voidTransfer.mockResolvedValue({ ok: false, message: "No se puede anular." })
      expect(await actions.voidTransferAction({ transferId: "t-1", reason: "Fecha mal digitada" })).toEqual({ ok: false, message: "No se puede anular." })
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })

  describe("listTransferCandidatesAction", () => {
    it("exige flota:transfer y respeta el interruptor", async () => {
      guard.mockResolvedValue(DENIED)
      expect(await actions.listTransferCandidatesAction()).toMatchObject({ ok: false })
      expect(guard).toHaveBeenCalledWith("flota:transfer", "/flota/traslados")
      guard.mockResolvedValue({ session: SESSION, error: null })
      operational.mockResolvedValue(false)
      expect(await actions.listTransferCandidatesAction()).toEqual({ ok: false, message: "Los traslados aún no están habilitados." })
    })

    it("devuelve candidatos, faenas activas en alcance y la ventana de fechas", async () => {
      listCandidates.mockResolvedValue([{ vehicleId: "veh-1" }])
      worksiteRows.mockResolvedValue([{ id: "w-1", name: "Mininco" }])
      const result = await actions.listTransferCandidatesAction()
      expect(listCandidates).toHaveBeenCalledWith(["w-1", "w-2"])
      expect(result).toMatchObject({
        ok: true,
        data: { candidates: [{ vehicleId: "veh-1" }], worksites: [{ id: "w-1", name: "Mininco" }], window: { min: expect.stringMatching(/^\d{4}-\d{2}-01$/), max: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) } },
      })
    })
  })

  describe("exportTransfersAction", () => {
    it("exige flota:export", async () => {
      guard.mockResolvedValue(DENIED)
      expect(await actions.exportTransfersAction({ from: "2026-10-01", to: "2026-11-18" })).toMatchObject({ ok: false })
      expect(guard).toHaveBeenCalledWith("flota:export", "/flota/traslados")
    })

    it("con el submódulo apagado avisa que aún no está habilitado", async () => {
      operational.mockResolvedValue(false)
      expect(await actions.exportTransfersAction({ from: "2026-10-01", to: "2026-11-18" }))
        .toEqual({ ok: false, message: "Los traslados aún no están habilitados." })
    })

    it("arma un libro con una fila por equipo", async () => {
      listTransfers.mockResolvedValue([{
        id: "t-1", folio: "T-0001", effectiveDate: "2026-11-10", toWorksiteId: "w-2", toWorksiteName: "Santa Fe",
        items: [
          { vehicleId: "veh-1", code: "KA-1", plate: "ABCD-12", fromWorksiteId: "w-1", fromWorksiteName: "Mininco" },
          { vehicleId: "veh-2", code: "KA-2", plate: "EFGH-34", fromWorksiteId: "w-1", fromWorksiteName: "Mininco" },
        ],
        reason: "Cambio de contrato", authorizedBy: "Jefa", createdByName: "Ana", createdAt: "2026-11-11T12:00:00.000Z",
        voidedAt: null, voidReason: null, voidable: true,
      }])
      const result = await actions.exportTransfersAction({ from: "2026-10-01", to: "2026-11-18" })
      expect(listTransfers).toHaveBeenCalledWith(["w-1", "w-2"], { from: "2026-10-01", to: "2026-11-18" })
      expect(result).toMatchObject({ ok: true, data: { base64: "BASE64", filename: expect.stringMatching(/^traslados_.*\.xlsx$/) } })
    })
  })
})
