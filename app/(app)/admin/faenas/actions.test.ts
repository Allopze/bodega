import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Tipo y alias de faena (Trinorma): permiso `admin:worksites` y faena dentro del alcance en el servidor.
 * La lógica de negocio (alias conflictivos, auditoría) la cubre `trinorma-maestros-pglite.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  canAccessWorksite: vi.fn(),
  setKind: vi.fn(),
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({}), query: { worksites: { findFirst: vi.fn() } } } }))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission, canAccessWorksite: mocks.canAccessWorksite, can: vi.fn(() => true) }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: vi.fn(() => ({ mode: "some", ids: ["w-a"] })) }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/services/worksite-lifecycle", () => ({ setWorksiteActive: vi.fn() }))
vi.mock("@/lib/services/worksite-create", () => ({ createWorksiteTx: vi.fn() }))
vi.mock("@/lib/services/worksite-kind", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/services/worksite-kind")>()), setWorksiteKindTx: mocks.setKind }))
vi.mock("@/lib/services/worksite-aliases", () => ({ addWorksiteAliasTx: mocks.addAlias, removeWorksiteAliasTx: mocks.removeAlias }))

const { setWorksiteKindAction, addWorksiteAliasAction, removeWorksiteAliasAction } = await import("./actions")

const SESSION = { user: { id: "u-1", email: "a@chome.test" } }
const prev = { ok: false } as const
function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.set(key, value)
  return data
}

const CASES = [
  { name: "setWorksiteKindAction", run: () => setWorksiteKindAction(prev, form({ id: "w-a", kind: "deposito" })), service: mocks.setKind },
  { name: "addWorksiteAliasAction", run: () => addWorksiteAliasAction(prev, form({ id: "w-a", alias: "Fundo" })), service: mocks.addAlias },
  { name: "removeWorksiteAliasAction", run: () => removeWorksiteAliasAction(prev, form({ id: "w-a", aliasId: "al-1" })), service: mocks.removeAlias },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePermission.mockResolvedValue(SESSION)
  mocks.canAccessWorksite.mockReturnValue(true)
  mocks.setKind.mockResolvedValue({ ok: true, changed: true, message: "Tipo cambiado." })
  mocks.addAlias.mockResolvedValue({ ok: true, message: "Alias agregado.", data: { id: "al-1" } })
  mocks.removeAlias.mockResolvedValue({ ok: true, message: "Alias quitado.", data: undefined })
})

describe.each(CASES)("$name", ({ run, service }) => {
  it("sin el permiso admin:worksites rechaza y no escribe", async () => {
    mocks.requirePermission.mockRejectedValue(new Error("Forbidden"))
    expect(await run()).toEqual({ ok: false, message: "Sin permisos" })
    expect(service).not.toHaveBeenCalled()
  })

  it("con una faena fuera del alcance de la sesión rechaza y no escribe", async () => {
    mocks.canAccessWorksite.mockReturnValue(false)
    expect(await run()).toEqual({ ok: false, message: "No tienes acceso a esta faena" })
    expect(service).not.toHaveBeenCalled()
  })

  it("con permiso y alcance escribe y devuelve el mensaje del servicio", async () => {
    const result = await run()
    expect(result.ok).toBe(true)
    expect(service).toHaveBeenCalledTimes(1)
  })
})

describe("validaciones propias", () => {
  it("rechaza un tipo de faena inválido sin llamar al servicio", async () => {
    const result = await setWorksiteKindAction(prev, form({ id: "w-a", kind: "inventado" }))
    expect(result.ok).toBe(false)
    expect(mocks.setKind).not.toHaveBeenCalled()
  })

  it("el rechazo del alias (conflicto) vuelve como error del campo", async () => {
    mocks.addAlias.mockResolvedValue({ ok: false, message: "«Fundo» ya es alias de la faena X." })
    const result = await addWorksiteAliasAction(prev, form({ id: "w-a", alias: "Fundo" }))
    expect(result).toMatchObject({ ok: false, message: "«Fundo» ya es alias de la faena X.", fieldErrors: { alias: ["«Fundo» ya es alias de la faena X."] } })
  })
})
