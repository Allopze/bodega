import ExcelJS from "exceljs"
import type { Session } from "next-auth"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  revalidatePath: vi.fn(),
  recordAudit: vi.fn(async () => undefined),
  acceptTalanaFusible: vi.fn(),
  loadTalanaDifferences: vi.fn(),
  listTalanaRuns: vi.fn(),
  listTalanaRunItems: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, revalidateTag: vi.fn() }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mocks.guardPermission }))
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/integrations/talana/talana-read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/talana/talana-read")>()),
  acceptTalanaFusible: mocks.acceptTalanaFusible,
  loadTalanaDifferences: mocks.loadTalanaDifferences,
  listTalanaRuns: mocks.listTalanaRuns,
  listTalanaRunItems: mocks.listTalanaRunItems,
}))

import { acceptTalanaFusibleAction, exportTalanaXlsxAction } from "./actions"

function session(isGlobal: boolean, worksiteIds: string[] = []): Session {
  return {
    user: {
      id: "user-rrhh", name: "RRHH", email: "rrhh@test.cl", roles: [], permissions: ["admin:workers_hr"],
      worksiteIds, primaryWorksiteId: null, avatarColor: null, isActive: true, isGlobal,
    },
    expires: "2030-01-01T00:00:00.000Z",
  } satisfies Session
}

const DIFFERENCES = [
  { code: "faena_distinta", fixIn: "revisar", workerId: "w-1", worksiteId: "ws-a", personLabel: "Ana Pérez", rut: "11111111-1", detail: "Chome: Teno · Talana: Masisa" },
  { code: "activo_sin_contrato", fixIn: "revisar", workerId: "w-2", worksiteId: "ws-b", personLabel: "Beto Rojas", rut: "22222222-2", detail: "No figura en Talana." },
  { code: "sin_ficha_en_chome", fixIn: "revisar", workerId: null, worksiteId: null, personLabel: "Luis Gomez", rut: "33333333-3", detail: "Sin ficha." },
]

const RUN = { id: "run-1", mode: "simulate", status: "success", startedAt: "2026-11-08T09:30:00.000Z" }

const ITEMS = [
  { id: "i-1", runId: "run-1", workerId: "w-1", worksiteId: "ws-a", worksiteName: "Masisa", displayName: "Ana Pérez", rut: "11111111-1", kind: "cargo", outcome: "planned", reasonCode: null, beforeLabel: "Auxiliar", afterLabel: "Operador de maquinaria" },
  { id: "i-2", runId: "run-1", workerId: null, worksiteId: null, worksiteName: null, displayName: "Luis Gomez", rut: "33333333-3", kind: "alta", outcome: "skipped", reasonCode: "faena_sin_mapeo", beforeLabel: null, afterLabel: null },
]

async function workbookOf(result: Awaited<ReturnType<typeof exportTalanaXlsxAction>>) {
  if (!result.ok) throw new Error(`export falló: ${result.message}`)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(result.data.base64, "base64") as unknown as ArrayBuffer)
  return workbook
}

const cellText = (workbook: ExcelJS.Workbook, sheet: string) =>
  (workbook.getWorksheet(sheet)?.getSheetValues() ?? []).slice(2).map((row) => (Array.isArray(row) ? row.slice(1).map((cell) => (cell instanceof Date ? "<fecha>" : String(cell ?? ""))) : []))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.guardPermission.mockResolvedValue({ session: session(true), error: null })
  mocks.loadTalanaDifferences.mockResolvedValue({ differences: DIFFERENCES, syncedAt: "2026-11-08T09:35:00.000Z" })
  mocks.listTalanaRuns.mockResolvedValue([RUN])
  mocks.listTalanaRunItems.mockResolvedValue(ITEMS)
})

describe("exportTalanaXlsxAction", () => {
  it("exige admin:workers_hr y no lee nada sin él", async () => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })

    const result = await exportTalanaXlsxAction()

    expect(result.ok).toBe(false)
    expect(mocks.guardPermission).toHaveBeenCalledWith("admin:workers_hr", "/admin/talana")
    expect(mocks.loadTalanaDifferences).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it("genera un libro con las hojas «Diferencias» y «Cambios de la última corrida»", async () => {
    const result = await exportTalanaXlsxAction()
    const workbook = await workbookOf(result)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Diferencias", "Cambios de la última corrida", "Metadatos"])
    expect(cellText(workbook, "Diferencias")).toEqual([
      ["Ana Pérez", "11111111-1", "Faena distinta", "Chome: Teno · Talana: Masisa", "Revisar"],
      ["Beto Rojas", "22222222-2", "Activo en Chome sin contrato en Talana", "No figura en Talana.", "Revisar"],
      ["Luis Gomez", "33333333-3", "Contrato en Talana sin ficha en Chome", "Sin ficha.", "Revisar"],
    ])
    expect(cellText(workbook, "Cambios de la última corrida")).toEqual([
      ["Ana Pérez", "11111111-1", "Masisa", "Cambio de cargo", "Auxiliar", "Operador de maquinaria", "Simulado", "", "<fecha>"],
      ["Luis Gomez", "33333333-3", "", "Alta", "", "", "Omitido", "Centro de costo sin faena", "<fecha>"],
    ])
    if (result.ok) expect(result.data.filename).toMatch(/^talana_\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it("deja constancia de la exportación en la auditoría", async () => {
    await exportTalanaXlsxAction()

    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-rrhh",
      action: "export",
      entityType: "talana_export",
      newState: { differences: 3, changes: 2, runId: "run-1" },
    }))
  })

  it("una sesión acotada exporta sólo las filas de sus faenas y nunca las que no tienen faena", async () => {
    mocks.guardPermission.mockResolvedValue({ session: session(false, ["ws-a"]), error: null })

    const workbook = await workbookOf(await exportTalanaXlsxAction())

    expect(cellText(workbook, "Diferencias").map((row) => row[0])).toEqual(["Ana Pérez"])
    expect(cellText(workbook, "Cambios de la última corrida").map((row) => row[0])).toEqual(["Ana Pérez"])
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ newState: { differences: 1, changes: 1, runId: "run-1" } }))
  })

  it("sin ninguna corrida exporta las diferencias y una hoja de cambios vacía", async () => {
    mocks.listTalanaRuns.mockResolvedValue([])

    const workbook = await workbookOf(await exportTalanaXlsxAction())

    expect(mocks.listTalanaRunItems).not.toHaveBeenCalled()
    expect(cellText(workbook, "Diferencias")).toHaveLength(3)
    expect(cellText(workbook, "Cambios de la última corrida")).toEqual([])
  })

  it("si la lectura falla devuelve un mensaje seguro, sin detalle interno", async () => {
    mocks.loadTalanaDifferences.mockRejectedValue(new Error("Failed query: select * from talana_contracts"))

    const result = await exportTalanaXlsxAction()

    expect(result).toEqual({ ok: false, message: "No se pudo generar el Excel. Inténtalo de nuevo." })
  })
})

describe("acceptTalanaFusibleAction", () => {
  it("exige admin:workers_hr", async () => {
    mocks.guardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "No tienes permisos para realizar esta acción" } })

    const result = await acceptTalanaFusibleAction({ runId: "run-1" })

    expect(result).toEqual({ ok: false, message: "No tienes permisos para realizar esta acción" })
    expect(mocks.acceptTalanaFusible).not.toHaveBeenCalled()
  })

  it("rechaza un identificador vacío o ajeno al formato", async () => {
    expect((await acceptTalanaFusibleAction({ runId: "" })).ok).toBe(false)
    expect((await acceptTalanaFusibleAction({ runId: "x".repeat(200) })).ok).toBe(false)
    expect(mocks.acceptTalanaFusible).not.toHaveBeenCalled()
  })

  it("rearma con la identidad de la sesión y refresca la pantalla", async () => {
    mocks.acceptTalanaFusible.mockResolvedValue(true)

    const result = await acceptTalanaFusibleAction({ runId: "run-1" })

    expect(result.ok).toBe(true)
    expect(mocks.acceptTalanaFusible).toHaveBeenCalledWith("run-1", { userId: "user-rrhh", email: "rrhh@test.cl" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/talana")
  })

  it("si la corrida ya no está detenida o ya la revisó otra persona, lo dice y refresca", async () => {
    mocks.acceptTalanaFusible.mockResolvedValue(false)

    const result = await acceptTalanaFusibleAction({ runId: "run-1" })

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/ya no está detenida o ya fue revisada/)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/talana")
  })

  it("si el servicio falla devuelve un mensaje seguro", async () => {
    mocks.acceptTalanaFusible.mockRejectedValue(new Error("Failed query: update talana_sync_runs"))

    const result = await acceptTalanaFusibleAction({ runId: "run-1" })

    expect(result).toEqual({ ok: false, message: "No se pudo rearmar el fusible. Inténtalo de nuevo." })
  })
})
