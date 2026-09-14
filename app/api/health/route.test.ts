/**
 * HALLAZGO SEC-001 (S3/P2) — El endpoint de salud es público (lo declara
 * `proxy.ts` para que lo alcance el `HEALTHCHECK` de Docker) y hasta esta
 * remediación devolvía a cualquiera el detalle de infraestructura: estado de
 * la base, del volumen, porcentaje de disco libre y bytes libres absolutos.
 *
 * Estas pruebas fijan el contrato nuevo: sin sesión con
 * `admin:module_management` el cuerpo es un veredicto binario y el código HTTP
 * se conserva intacto —es lo único que consumen Docker y el despliegue—; con
 * ese permiso, el detalle completo sigue disponible para operar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { PlatformHealth } from "@/lib/services/platform-health"

const getPlatformHealth = vi.fn<() => Promise<PlatformHealth>>()
const auth = vi.fn<() => Promise<unknown>>()

vi.mock("@/lib/services/platform-health", () => ({ getPlatformHealth }))
vi.mock("@/lib/auth/auth", () => ({ auth }))

const SALUD_DEGRADADA: PlatformHealth = {
  status: "degraded",
  db: "connected",
  storage: "unreachable",
  disk: { status: "low_space", freePercent: 3, freeBytes: 258735423488 },
  timestamp: "2026-09-14T00:00:00.000Z",
}

async function llamarSalud() {
  const { GET } = await import("./route")
  const response = await GET()
  return { response, body: await response.json() }
}

describe("GET /api/health — superficie pública (SEC-001)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue(null)
    getPlatformHealth.mockResolvedValue(SALUD_DEGRADADA)
  })

  it("no revela base, volumen ni disco a un anónimo", async () => {
    const { body } = await llamarSalud()
    expect(Object.keys(body).sort()).toEqual(["status"])
    expect(JSON.stringify(body)).not.toContain("258735423488")
  })

  it("colapsa 'degraded' en 'ok' para el anónimo, que no debe saber qué falla", async () => {
    const { body } = await llamarSalud()
    expect(body.status).toBe("ok")
  })

  it("conserva el 503 que Docker y el despliegue leen como caída", async () => {
    getPlatformHealth.mockResolvedValue({ ...SALUD_DEGRADADA, status: "error", db: "disconnected" })
    const { response, body } = await llamarSalud()
    expect(response.status).toBe(503)
    expect(body).toEqual({ status: "error" })
  })

  it("sigue entregando el detalle completo a quien administra módulos", async () => {
    auth.mockResolvedValue({ user: { permissions: ["admin:module_management"] } })
    const { body } = await llamarSalud()
    expect(body).toEqual(SALUD_DEGRADADA)
  })

  it("no falla si la resolución de sesión revienta: degrada el cuerpo, no la ruta", async () => {
    auth.mockRejectedValue(new Error("sin contexto de petición"))
    const { response, body } = await llamarSalud()
    expect(response.status).toBe(200)
    expect(body).toEqual({ status: "ok" })
  })
})
