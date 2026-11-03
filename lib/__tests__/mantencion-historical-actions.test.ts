import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({
  guard: vi.fn(), preview: vi.fn(), commit: vi.fn(), link: vi.fn(), revalidate: vi.fn(),
}))
vi.mock("@/lib/auth/can", () => ({
  guardPermission: mock.guard,
  can: (session: { user: { permissions: string[] } }, permission: string) => session.user.permissions.includes(permission),
}))
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }))
vi.mock("@/lib/actions/action-error-result", () => ({ actionErrorResult: () => ({ ok: false, message: "Error" }) }))
vi.mock("@/lib/services/mantencion/historical-import", () => ({
  previewHistoricalImport: mock.preview, commitHistoricalImport: mock.commit, linkHistoricalRecord: mock.link,
}))

const { previewHistoricalAction, commitHistoricalAction, linkHistoricalAction } = await import("@/app/(app)/mantencion/registros/historicos/actions")
const permitted = { session: { user: { id: "jefe", email: "jefe@example.test", permissions: ["mant:records:view_all"] } }, error: null }
const upload = (name = "historial.xlsx") => { const form = new FormData(); form.set("file", new File(["datos"], name)); return form }

beforeEach(() => { vi.clearAllMocks(); mock.guard.mockResolvedValue(permitted) })

describe("autorización de la importación histórica", () => {
  it("rechaza todas las escrituras si falta la gestión de equipos", async () => {
    mock.guard.mockResolvedValue({ session: null, error: { ok: false, message: "Sin permiso" } })
    expect((await previewHistoricalAction(upload())).ok).toBe(false)
    expect((await commitHistoricalAction(upload())).ok).toBe(false)
    expect((await linkHistoricalAction({ sourceKey: "x", vehicleId: "v1" })).ok).toBe(false)
    expect(mock.preview).not.toHaveBeenCalled(); expect(mock.commit).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled()
  })
  it("también exige acceso de lectura global antes de procesar el archivo", async () => {
    mock.guard.mockResolvedValue({ session: { user: { ...permitted.session.user, permissions: [] } }, error: null })
    expect((await previewHistoricalAction(upload())).ok).toBe(false)
    expect((await commitHistoricalAction(upload())).ok).toBe(false)
    expect((await linkHistoricalAction({ sourceKey: "x", vehicleId: "v1" })).ok).toBe(false)
    expect(mock.preview).not.toHaveBeenCalled(); expect(mock.commit).not.toHaveBeenCalled(); expect(mock.link).not.toHaveBeenCalled()
  })
  it("valida el archivo y registra al usuario autenticado al confirmar", async () => {
    expect((await previewHistoricalAction(upload("datos.txt"))).ok).toBe(false)
    mock.preview.mockResolvedValue({ ok: true, data: {} })
    expect((await previewHistoricalAction(upload())).ok).toBe(true)
    expect(mock.preview).toHaveBeenCalledWith(expect.any(ArrayBuffer), "historial.xlsx")
    mock.commit.mockResolvedValue({ ok: true, data: {} })
    expect((await commitHistoricalAction(upload())).ok).toBe(true)
    expect(mock.commit).toHaveBeenCalledWith({ userId: "jefe", email: "jefe@example.test" }, expect.any(ArrayBuffer), "historial.xlsx")
    expect(mock.revalidate).toHaveBeenCalledWith("/mantencion/registros/historicos")
  })
})
