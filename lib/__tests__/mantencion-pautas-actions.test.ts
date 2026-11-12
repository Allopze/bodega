import { beforeEach, describe, expect, it, vi } from "vitest"

const mock = vi.hoisted(() => ({ guard: vi.fn(), create: vi.fn(), revalidate: vi.fn(), redirect: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mock.guard }))
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }))
vi.mock("next/navigation", () => ({ redirect: mock.redirect }))
vi.mock("@/lib/actions/action-error-result", () => ({ actionErrorResult: () => ({ ok: false, message: "Error" }) }))
vi.mock("@/lib/services/mantencion/export-schedules", () => ({ exportSchedules: vi.fn() }))
vi.mock("@/lib/services/mantencion/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/mantencion/schedules")>()),
  createSchedule: mock.create, deleteSchedule: vi.fn(),
}))

const { createScheduleAction } = await import("@/app/(app)/mantencion/pautas/actions")
const form = (unit: string) => {
  const data = new FormData()
  data.set("name", "Pauta de prueba"); data.set("unit", unit); data.set("intervals", "10000 20000")
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mock.guard.mockResolvedValue({ session: { user: { id: "jefe", email: "jefe@example.test" } }, error: null })
})

describe("crear pauta: la unidad llega tal cual al servicio", () => {
  it("un valor que no es km ni h no se convierte en «km»: el servicio lo rechaza con su error de campo", async () => {
    mock.create.mockResolvedValue({ ok: false, message: "Elige si la pauta se mide en kilómetros o en horas.", field: "unit" })
    const result = await createScheduleAction({ ok: false } as never, form("millas"))
    expect(mock.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ unit: "millas" }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { unit: ["Elige si la pauta se mide en kilómetros o en horas."] } })
    expect(mock.redirect).not.toHaveBeenCalled()
  })

  it("«h» y «km» pasan sin cambios y la pauta creada abre su editor", async () => {
    mock.create.mockResolvedValue({ ok: true, data: { id: "sch-1" } })
    await createScheduleAction({ ok: false } as never, form("h"))
    expect(mock.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ unit: "h" }))
    await createScheduleAction({ ok: false } as never, form("km"))
    expect(mock.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ unit: "km" }))
    expect(mock.redirect).toHaveBeenCalledWith("/mantencion/pautas/sch-1")
  })
})
