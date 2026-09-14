/**
 * HALLAZGO AUD-001 (S3/P1) — «La auditoría registra quién y qué, pero casi
 * nunca desde dónde».
 *
 * `audit_log` tiene columna `ip_address` desde el principio y `recordAudit`
 * aceptaba el parámetro, pero de 309 llamadas sólo dos lo pasaban. Conceder un
 * permiso, corregir un folio o abrir datos de salud quedaba sin origen. La
 * remediación resuelve la IP dentro de `recordAudit` para que ningún llamador
 * pueda olvidarla, sin romper los caminos sin petición.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockValues = vi.fn().mockResolvedValue(undefined)
const mockInsert = vi.fn(() => ({ values: mockValues }))
const headersMock = vi.fn<() => Promise<Headers>>()

vi.mock("@/db", () => ({ db: { insert: () => mockInsert(), execute: vi.fn() } }))
vi.mock("next/headers", () => ({ headers: () => headersMock() }))

async function auditar(extra: Record<string, unknown> = {}) {
  const { recordAudit } = await import("../audit")
  await recordAudit({ userId: "usr-1", action: "update", entityType: "user", entityId: "u1", ...extra })
  return mockValues.mock.calls.at(-1)?.[0] as { ipAddress?: string }
}

describe("Origen de la auditoría (AUD-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockValues.mockResolvedValue(undefined)
    mockInsert.mockReturnValue({ values: mockValues })
  })

  it("anota la IP del cliente sin que el llamador la pase: antes se perdía en 307 de 309 sitios", async () => {
    headersMock.mockResolvedValue(new Headers({ "cf-connecting-ip": "203.0.113.24" }))
    expect((await auditar()).ipAddress).toBe("203.0.113.24")
  })

  it("no inventa origen cuando no se puede establecer con confianza", async () => {
    // Sólo `x-forwarded-for`, que la plataforma declara entrada del atacante:
    // la bitácora prefiere el vacío a un dato falsificable.
    headersMock.mockResolvedValue(new Headers({ "x-forwarded-for": "190.1.2.3" }))
    expect((await auditar()).ipAddress).toBeUndefined()
  })

  it("respeta la IP explícita de quien ya la resolvió (exportación de incidentes, TAE)", async () => {
    headersMock.mockResolvedValue(new Headers({ "cf-connecting-ip": "203.0.113.24" }))
    expect((await auditar({ ipAddress: "198.51.100.7" })).ipAddress).toBe("198.51.100.7")
  })

  it("no rompe la auditoría de cron y scripts, que no tienen petición en curso", async () => {
    headersMock.mockRejectedValue(new Error("`headers` was called outside a request scope"))
    const fila = await auditar()
    expect(fila.ipAddress).toBeUndefined()
    expect(mockInsert).toHaveBeenCalled()
  })
})
