import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "next-auth"

/**
 * ANA-002, PER-T01 y PER-T02 (auditoría 2026-09-14).
 *
 * `unstable_cache` no se puede ejecutar fuera de un request de Next, así que
 * `next/cache` se sustituye por un doble que registra cómo se declaró cada
 * caché (clave, TTL y etiquetas) y qué etiquetas se invalidan. Lo que se afirma
 * aquí es exactamente el contrato que faltaba: que los dos tableros pesados
 * pasan por una caché declarada, que su clave separa alcances distintos, y que
 * una mutación de una faena no invalida las de las demás.
 */
interface CacheDeclaration {
  keyParts: string[]
  options: { revalidate?: number; tags?: string[] }
  calls: unknown[][]
}
const declarations: CacheDeclaration[] = []
const revalidatedTags: string[] = []
const revalidatedPaths: string[] = []

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown, keyParts: string[], options: CacheDeclaration["options"]) => {
    const declaration: CacheDeclaration = { keyParts, options, calls: [] }
    declarations.push(declaration)
    return (...args: unknown[]) => {
      declaration.calls.push(args)
      return fn(...args)
    }
  },
  revalidateTag: (tag: string) => { revalidatedTags.push(tag) },
  revalidatePath: (path: string) => { revalidatedPaths.push(path) },
}))

const analyticsDashboard = vi.hoisted(() => vi.fn(async (_session: unknown, _filters: unknown) => ({ marca: "analítica" })))
const integrityCases = vi.hoisted(() => vi.fn(async (_session: unknown, _filters: unknown) => [{ id: "caso-1" }]))
vi.mock("@/lib/services/analytics-module/dashboard", () => ({ getAnalyticsDashboard: analyticsDashboard }))
vi.mock("@/lib/services/operational-integrity/ledger", () => ({ listOperationalIntegrityCases: integrityCases }))

const {
  getCachedAnalyticsDashboard, getCachedOperationalIntegrityCases,
  readModelScopeKey, HEAVY_READ_MODEL_TTL_SECONDS,
} = await import("@/lib/services/read-model-cache")
const {
  revalidateOperationalViews, revalidateOperationalIntegrityBoard, badgeCountsTags,
  badgeCountsWorksiteTag, BADGE_COUNTS_TAG, BADGE_COUNTS_GLOBAL_TAG, OPERATIONAL_INTEGRITY_TAG,
} = await import("@/lib/services/operational-cache")

function session(worksiteIds: string[], overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: "2099-01-01",
    user: {
      id: "u-1", name: "QA", email: "qa@test.local", roles: [], isGlobal: false, isActive: true,
      worksiteIds, primaryWorksiteId: worksiteIds[0] ?? null, avatarColor: null,
      permissions: ["analytics:view", "warehouse:view_traceability"],
      ...overrides,
    },
  } as unknown as Session
}

beforeEach(() => {
  revalidatedTags.length = 0
  revalidatedPaths.length = 0
  for (const declaration of declarations) declaration.calls.length = 0
  analyticsDashboard.mockClear()
  integrityCases.mockClear()
})

describe("caché de los tableros pesados (ANA-002 / PER-T02)", () => {
  /**
   * Antes de esto ningún tablero tenía caché: Analítica disparaba sus veintiún
   * agregados en cada visita y en cada cambio de filtro.
   */
  it("la analítica y la cola de integridad se declaran con TTL y etiqueta propias", () => {
    const analytics = declarations.find((entry) => entry.keyParts.includes("analytics-dashboard"))
    const integrity = declarations.find((entry) => entry.keyParts.includes("operational-integrity-cases"))

    expect(analytics, "el tablero de Analítica no pasa por unstable_cache").toBeDefined()
    expect(integrity, "la cola de integridad no pasa por unstable_cache").toBeDefined()
    expect(analytics!.options.revalidate).toBe(HEAVY_READ_MODEL_TTL_SECONDS)
    expect(integrity!.options.revalidate).toBe(HEAVY_READ_MODEL_TTL_SECONDS)
    expect(analytics!.options.tags).toEqual(["analytics-dashboard"])
    expect(integrity!.options.tags).toEqual([OPERATIONAL_INTEGRITY_TAG])
  })

  /** 30 s es el envejecimiento que la plataforma ya declara para los badges. */
  it("el TTL es el mismo que la caché declarada del layout, no un valor inventado", () => {
    expect(HEAVY_READ_MODEL_TTL_SECONDS).toBe(30)
  })

  /**
   * El riesgo de introducir una caché compartida es servirle a una sesión el
   * tablero de otra: la clave lleva el alcance completo, no el id de usuario.
   */
  it("dos alcances distintos no comparten entrada de caché", async () => {
    const analytics = declarations.find((entry) => entry.keyParts.includes("analytics-dashboard"))!
    await getCachedAnalyticsDashboard(session(["faena-a"]), { fromDate: "2026-01-01", toDate: "2026-01-31" })
    await getCachedAnalyticsDashboard(session(["faena-b"]), { fromDate: "2026-01-01", toDate: "2026-01-31" })

    const [primera, segunda] = analytics.calls
    expect(primera![0]).not.toEqual(segunda![0])
    expect(JSON.stringify(analytics.calls)).toContain("faena-a")
  })

  it("los filtros se normalizan antes de la clave: sin fechas y el rango por defecto son la misma entrada", async () => {
    const analytics = declarations.find((entry) => entry.keyParts.includes("analytics-dashboard"))!
    await getCachedAnalyticsDashboard(session(["faena-a"]))

    expect(analytics.calls[0]![1]).toMatchObject({ fromDate: expect.any(String), toDate: expect.any(String) })
  })

  it("un permiso distinto cambia la clave: la caché no puede filtrar datos entre roles", () => {
    const conCostos = readModelScopeKey(session(["faena-a"], { permissions: ["analytics:view", "combustibles:view_costs"] }))
    const sinCostos = readModelScopeKey(session(["faena-a"], { permissions: ["analytics:view"] }))

    expect(conCostos).not.toEqual(sinCostos)
  })

  it("la cola de integridad se sirve por su caché y llega al servicio con el alcance de la sesión", async () => {
    await getCachedOperationalIntegrityCases(session(["faena-a"]), { domain: "stock" })

    expect(integrityCases).toHaveBeenCalledTimes(1)
    expect(integrityCases.mock.calls[0]![0]).toMatchObject({ user: { worksiteIds: ["faena-a"], isGlobal: false } })
    expect(integrityCases.mock.calls[0]![1]).toEqual({ domain: "stock" })
  })
})

describe("invalidación acotada por faena (PER-T01)", () => {
  /**
   * Antes `revalidateOperationalViews` invalidaba siempre la etiqueta única
   * `badge-counts`: registrar una recepción en una faena vaciaba los badges de
   * todos los usuarios de la plataforma.
   */
  it("una mutación con faena declarada no invalida la etiqueta de las demás faenas", () => {
    revalidateOperationalViews(["/entregas"], { worksiteId: "faena-a" })

    expect(revalidatedTags).toContain(badgeCountsWorksiteTag("faena-a"))
    expect(revalidatedTags).not.toContain(badgeCountsWorksiteTag("faena-b"))
    expect(revalidatedTags).not.toContain(BADGE_COUNTS_TAG)
  })

  it("las sesiones con visión global se invalidan con cualquier faena", () => {
    revalidateOperationalViews([], { worksiteId: "faena-a" })

    expect(revalidatedTags).toContain(BADGE_COUNTS_GLOBAL_TAG)
    expect(badgeCountsTags({ isGlobal: true, worksiteIds: [] })).toContain(BADGE_COUNTS_GLOBAL_TAG)
  })

  it("sin faena declarada se conserva la invalidación general: perder un badge es peor que recalcularlo", () => {
    revalidateOperationalViews(["/compras"])

    expect(revalidatedTags).toEqual([BADGE_COUNTS_TAG])
    expect(revalidatedPaths).toEqual(["/dashboard", "/pendientes", "/compras"])
  })

  it("las etiquetas de una sesión de faena cruzan con su propia faena y con ninguna otra", () => {
    const tags = badgeCountsTags({ isGlobal: false, worksiteIds: ["faena-a"] })

    expect(tags).toEqual([BADGE_COUNTS_TAG, badgeCountsWorksiteTag("faena-a")])
    expect(tags).not.toContain(badgeCountsWorksiteTag("faena-b"))
  })

  it("la cola de integridad se invalida sola, sin arrastrar badges ni tablero", () => {
    revalidateOperationalIntegrityBoard()

    expect(revalidatedTags).toEqual([OPERATIONAL_INTEGRITY_TAG])
    expect(revalidatedPaths).toEqual([])
  })
})
