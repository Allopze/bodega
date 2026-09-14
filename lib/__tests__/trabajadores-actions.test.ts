/**
 * Unit tests for worker admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockCanAccessWorksite = vi.hoisted(() => vi.fn(() => true))
const mockFindFirstWorker = vi.hoisted(() => vi.fn())
const mockFindFirstWorksite = vi.hoisted(() => vi.fn())
const mockGetWorkerOffboardingSummary = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockInsertWorker = vi.hoisted(() => vi.fn())
const mockUpdateWorkerFields = vi.hoisted(() => vi.fn())
const mockSetWorkerActive = vi.hoisted(() => vi.fn())
const mockOnWorkerEnteredDotacion = vi.hoisted(() => vi.fn())
const mockEvaluateWorksitePreventiveOrganization = vi.hoisted(() => vi.fn())
const mockResolveWorkerPosition = vi.hoisted(() => vi.fn())
const mockRecordWorkerPositionChange = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
  canAccessWorksite: mockCanAccessWorksite,
}))
vi.mock("@/db", () => ({
  db: {
    query: {
      workers: { findFirst: mockFindFirstWorker },
      worksites: { findFirst: mockFindFirstWorksite },
    },
    insert: mockInsert,
    update: mockUpdate,
    transaction: mockTransaction,
  },
}))
// La persistencia se mockea en su servicio y no como un ORM de mentira sobre
// `@/db`: lo que esta suite verifica es el trabajo de la action —permiso,
// alcance, validación y auditoría—, no cómo escribe Drizzle. El doble anterior
// se rompía cada vez que el servicio agregaba una consulta, y la falla parecía
// un bug del código nuevo.
vi.mock("@/lib/services/workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/workers")>()),
  insertWorker: mockInsertWorker,
  updateWorkerFields: mockUpdateWorkerFields,
  setWorkerActive: mockSetWorkerActive,
}))
// TRB-002 / E2E-008: sólo se dobla la consulta —que es de base de datos— y se
// conservan las funciones de redacción reales, para que la prueba compruebe el
// mensaje que de verdad ve quien traslada.
vi.mock("@/lib/services/worker-offboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/worker-offboarding")>()),
  getWorkerOffboardingSummary: mockGetWorkerOffboardingSummary,
}))
vi.mock("@/lib/services/worker-positions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/worker-positions")>()),
  resolveWorkerPosition: mockResolveWorkerPosition,
  recordWorkerPositionChange: mockRecordWorkerPositionChange,
}))
vi.mock("@/lib/services/pdtp-adapters/worker-lifecycle-connector", () => ({
  onWorkerEnteredDotacion: mockOnWorkerEnteredDotacion,
}))
vi.mock("@/lib/services/pdtp-adapters/preventive-organization-connector", () => ({
  evaluateWorksitePreventiveOrganization: mockEvaluateWorksitePreventiveOrganization,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

import { createWorker, updateWorker, toggleWorkerActive } from "@/app/(app)/admin/trabajadores/actions"
import type { ActionState } from "@/lib/validation/operations"

const prevState: ActionState = { ok: false, message: "" }

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1", email: "admin@test.cl", name: "Admin",
      roles: ["administrador"], permissions: ["admin:workers"],
      worksiteIds: ["ws-1"], primaryWorksiteId: "ws-1",
      avatarColor: "#000", isActive: true, ...overrides,
    },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("firstName", "Juan")
  fd.set("lastName", "Pérez")
  fd.set("worksiteId", "ws-1")
  fd.set("isActive", "on")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

function setupDbMocks() {
  const whereFn = vi.fn().mockResolvedValue(undefined)
  const setChain = { where: whereFn }
  const setFn = vi.fn().mockReturnValue(setChain)
  mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) })
  mockUpdate.mockReturnValue({ set: setFn })
  const written = { worker: { id: "w-1", worksiteId: "ws-1", isActive: true }, events: [] }
  mockInsertWorker.mockResolvedValue(written)
  mockUpdateWorkerFields.mockResolvedValue(written)
  mockSetWorkerActive.mockResolvedValue(written)
  mockResolveWorkerPosition.mockResolvedValue({
    position: { id: "worker-position-unclassified", name: "Sin clasificar" },
    created: false,
  })
  mockRecordWorkerPositionChange.mockResolvedValue(true)
  mockTransaction.mockImplementation(async (run) => run({}))
  mockFindFirstWorksite.mockResolvedValue({ id: "ws-1", name: "Faena Norte" })
  mockGetWorkerOffboardingSummary.mockResolvedValue({ workerId: "w-1", items: [], clear: true })
  mockOnWorkerEnteredDotacion.mockResolvedValue(undefined)
  mockEvaluateWorksitePreventiveOrganization.mockResolvedValue(undefined)
}

describe("createWorker", () => {
  beforeEach(() => { vi.resetAllMocks(); setupDbMocks(); mockCanAccessWorksite.mockReturnValue(true) })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await createWorker(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if scope denied", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockCanAccessWorksite.mockReturnValueOnce(false)
    const res = await createWorker(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("acceso")
  })

  it("returns error if RUT already exists", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "existing", rut: "11.111.111-1" })
    const res = await createWorker(prevState, makeFormData({ rut: "11.111.111-1" }))
    expect(res.ok).toBe(false)
    expect(res.fieldErrors?.rut).toBeDefined()
  })

  it("creates worker successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce(null)
    const res = await createWorker(prevState, makeFormData())
    expect(res.ok).toBe(true)
    expect(res.message).toContain("creado")
  })
})

describe("updateWorker", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDbMocks()
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await updateWorker(prevState, makeFormData({ id: "w-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if ID missing — Zod catches it", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await updateWorker(prevState, makeFormData())
    expect(res.ok).toBe(false)
  })

  it("returns error if worker not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce(null)
    const res = await updateWorker(prevState, makeFormData({ id: "w-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrado")
  })

  it("returns error if scope denied", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1" })
    mockCanAccessWorksite.mockReturnValueOnce(false)
    const res = await updateWorker(prevState, makeFormData({ id: "w-1" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("acceso")
  })

  it("updates worker successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1" })
    const res = await updateWorker(prevState, makeFormData({ id: "w-1" }))
    expect(res.ok).toBe(true)
    expect(res.message).toContain("actualizado")
  })

  /*
   * TRB-002 / E2E-008 (auditoría 2026-09-14): antes cambiar `worksiteId` era un
   * campo más y la action devolvía "actualizado" sin mirar nada. Quedaban atrás
   * actas TI abiertas, EPP entregado, accesos y cuadrillas de permisos, y nadie
   * se enteraba. Ahora se consulta el mismo módulo que ya responde eso para la
   * baja y el resultado vuelve en el mensaje y en la auditoría.
   */
  it("al trasladar de faena advierte de lo que queda abierto en el origen", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1", isActive: true })
    mockGetWorkerOffboardingSummary.mockResolvedValueOnce({
      workerId: "w-1",
      clear: false,
      items: [
        { kind: "it_assets", count: 1, label: "1 activo TI sin devolver", samples: ["ACT-1"] },
        { kind: "epp", count: 2, label: "2 entregas de EPP sin devolución", samples: ["ENT-1", "ENT-2"] },
      ],
    })

    const res = await updateWorker(prevState, makeFormData({ id: "w-1", worksiteId: "ws-2" }))

    expect(mockGetWorkerOffboardingSummary).toHaveBeenCalledWith("w-1")
    expect(res.ok).toBe(true)
    expect(res.message).toContain("trasladado")
    expect(res.message).toContain("Faena Norte")
    expect(res.message).toContain("1 activo TI sin devolver")
    expect(res.message).toContain("2 entregas de EPP sin devolución")
    // Lo pendiente queda escrito, no sólo dicho: el mensaje se lee una vez.
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      newState: expect.objectContaining({
        worksiteId: "ws-2",
        pendientesEnFaenaDeOrigen: expect.arrayContaining([
          expect.objectContaining({ kind: "it_assets" }),
        ]),
      }),
    }))
  })

  /*
   * Advierte, no bloquea: mismo criterio que `toggleWorkerActive`. El traslado
   * refleja un hecho ya ocurrido y tiene que poder registrarse igual.
   */
  it("registra el traslado aunque queden pendientes en el origen", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1", isActive: true })
    mockGetWorkerOffboardingSummary.mockResolvedValueOnce({
      workerId: "w-1",
      clear: false,
      items: [{ kind: "permit_crew", count: 1, label: "1 permiso de trabajo abierto", samples: ["PT-1"] }],
    })

    const res = await updateWorker(prevState, makeFormData({ id: "w-1", worksiteId: "ws-2" }))

    expect(res.ok).toBe(true)
    expect(mockUpdateWorkerFields).toHaveBeenCalled()
  })

  /** Guardar la ficha sin mover de faena no debe pagar una consulta de más. */
  it("no consulta pendientes cuando el guardado no cambia de faena", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1", isActive: true })
    const res = await updateWorker(prevState, makeFormData({ id: "w-1" }))
    expect(res.ok).toBe(true)
    expect(mockGetWorkerOffboardingSummary).not.toHaveBeenCalled()
  })

  /**
   * Mover de faena a alguien inactivo no lo incorpora a ninguna dotación
   * —mismo criterio que `deriveWorkerLifecycleEvents`—, así que no hay traslado
   * del que advertir.
   */
  it("no advierte al mover de faena a un trabajador inactivo", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", firstName: "Juan", lastName: "Pérez", worksiteId: "ws-1", isActive: false })
    const res = await updateWorker(prevState, makeFormData({ id: "w-1", worksiteId: "ws-2", isActive: "" }))
    expect(res.ok).toBe(true)
    expect(mockGetWorkerOffboardingSummary).not.toHaveBeenCalled()
  })
})

describe("toggleWorkerActive", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupDbMocks()
    mockCanAccessWorksite.mockReturnValue(true)
  })

  it("returns error if permission denied", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const fd = new FormData(); fd.set("id", "w-1"); fd.set("activate", "true")
    const res = await toggleWorkerActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("returns error if worker not found", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce(null)
    const fd = new FormData(); fd.set("id", "w-1"); fd.set("activate", "true")
    const res = await toggleWorkerActive(prevState, fd)
    expect(res.ok).toBe(false)
    expect(res.message).toContain("no encontrado")
  })

  it("toggles successfully", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockFindFirstWorker.mockResolvedValueOnce({ id: "w-1", worksiteId: "ws-1", isActive: false })
    const fd = new FormData(); fd.set("id", "w-1"); fd.set("activate", "true")
    const res = await toggleWorkerActive(prevState, fd)
    expect(res.ok).toBe(true)
    expect(res.message).toContain("activado")
  })
})
