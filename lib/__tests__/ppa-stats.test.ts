import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())
const mockExecute = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    execute: mockExecute,
    update: mockUpdate,
    query: { ppaSubmissions: { findFirst: mockFindFirst } },
  },
}))

import { getPpaStats, closePpa } from "@/lib/services/ppa"

beforeEach(() => {
  vi.resetAllMocks()
})

/**
 * Configura los mocks para getPpaStats:
 *   1) db.select() → aggregate totals (sequential, first call)
 *   2) Promise.all → db.execute() + db.select() × 2 (parallel, calls 2-4)
 */
function mockStatsQueries({
  totals,
  topReasons,
  topTareas,
  topFaenas,
}: {
  totals: {
    total: number
    detenidos: number
    aprobadosAuto: number
    autorizados: number
    rechazados: number
    pendientes: number
    avgResponseMinutes: number | null
  }
  topReasons?: { reason: string; count: number }[]
  topTareas?: { tipoTrabajo: string; count: number }[]
  topFaenas?: { worksiteName: string; count: number }[]
}) {
  // 1) Aggregate totals — select().from().where() (sequential, consumed first)
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([totals]),
    }),
  })

  // 2-4) Parallel queries via Promise.all (consumed in parallel)
  // Call order within Promise.all: execute, select×2
  mockExecute.mockResolvedValueOnce(
    (topReasons ?? []).map((r) => ({ reason: r.reason, count: r.count })),
  )
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(topTareas ?? []),
          }),
        }),
      }),
    }),
  })
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(topFaenas ?? []),
            }),
          }),
        }),
      }),
    }),
  })
}

describe("getPpaStats", () => {
  it("calcula indicadores, faenas con desviaciones y tiempo de respuesta", async () => {
    mockStatsQueries({
      totals: {
        total: 3,
        detenidos: 2,
        aprobadosAuto: 1,
        autorizados: 1,
        rechazados: 0,
        pendientes: 1,
        avgResponseMinutes: 30,
      },
      topReasons: [
        { reason: "no_seguro", count: 1 },
        { reason: "faltan_controles", count: 1 },
      ],
      topTareas: [
        { tipoTrabajo: "conductor_batea", count: 2 },
        { tipoTrabajo: "operador_maquinaria_pesada", count: 1 },
      ],
      topFaenas: [
        { worksiteName: "Faena 2", count: 2 },
      ],
    })

    const s = await getPpaStats("all")
    expect(s.total).toBe(3)
    expect(s.detenidos).toBe(2)
    expect(s.aprobadosAuto).toBe(1)
    expect(s.autorizados).toBe(1)
    expect(s.pendientes).toBe(1)
    expect(s.porcentajeDesviaciones).toBe(67)
    expect(s.avgResponseMinutes).toBe(30)
    expect(s.topFaenas[0]).toEqual({ worksiteName: "Faena 2", count: 2 })
    expect(s.topReasons).toHaveLength(2)
    expect(s.topTareas).toHaveLength(2)
  })

  it("avgResponseMinutes es null sin revisiones", async () => {
    mockStatsQueries({
      totals: {
        total: 1,
        detenidos: 0,
        aprobadosAuto: 1,
        autorizados: 0,
        rechazados: 0,
        pendientes: 0,
        avgResponseMinutes: null,
      },
      topFaenas: [],
    })
    const s = await getPpaStats("all")
    expect(s.avgResponseMinutes).toBeNull()
    expect(s.topFaenas).toEqual([])
  })

  it("devuelve vacío si el alcance no incluye faenas", async () => {
    const s = await getPpaStats([])
    expect(s.total).toBe(0)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

/** Mock para getPpa (usado dentro de closePpa): select().from().leftJoin().where().limit() */
function getPpaRow(submission: Record<string, unknown>) {
  const limitMock = vi.fn().mockResolvedValue([{ submission, worksiteName: "Faena 1" }])
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
  const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
  const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock })
  mockSelect.mockReturnValue({ from: fromMock })
}

describe("closePpa", () => {
  it("cierra un caso autorizado", async () => {
    getPpaRow({ id: "p1", worksiteId: "ws1", estado: "autorizado" })
    const closedRow = { id: "p1", worksiteId: "ws1", estado: "cerrado" }
    const returningMock = vi.fn().mockResolvedValue([closedRow])
    const updWhere = vi.fn().mockReturnValue({ returning: returningMock })
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: updWhere }) })

    const res = await closePpa("p1", "all")
    expect(res.estado).toBe("cerrado")
    expect(mockUpdate).toHaveBeenCalled()
  })

  it("rechaza cerrar un caso aún detenido", async () => {
    getPpaRow({ id: "p1", worksiteId: "ws1", estado: "detenido" })
    await expect(closePpa("p1", "all")).rejects.toThrow(/autorizados o rechazados/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("falla si el PPA no existe o está fuera de alcance", async () => {
    const limitMock = vi.fn().mockResolvedValue([])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ leftJoin: leftJoinMock }) })

    await expect(closePpa("nope", "all")).rejects.toThrow(/no encontrado/i)
  })
})
