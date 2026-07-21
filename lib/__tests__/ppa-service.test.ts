import { describe, it, expect, vi, beforeEach } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
  },
}))

// Mock schema objects
vi.mock("@/db/schema/worksites", () => ({
  workers: {
    id: "workers.id",
    firstName: "workers.firstName",
    lastName: "workers.lastName",
    rut: "workers.rut",
    position: "workers.position",
    worksiteId: "workers.worksiteId",
    isActive: "workers.isActive",
  },
  worksites: {
    id: "worksites.id",
    name: "worksites.name",
  },
}))

import { buildPpaExport, findWorkerByRut } from "@/lib/services/ppa"

function ppaRow(id: string, worksiteId = "ws-1") {
  return {
    id,
    worksiteId,
    workerId: null,
    workerName: `Trabajador ${id}`,
    workerRut: "11111111-1",
    manualIdentificacion: false,
    tipoTrabajo: "conductor_batea",
    esCritica: false,
    resultado: "aprobado_auto",
    estado: "aprobado_auto",
    triggeredReasons: [],
    decision: null,
    accionCorrectiva: null,
    reviewedAt: null,
    createdAt: "2026-06-29T10:00:00.000Z",
  }
}

describe("findWorkerByRut service", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("retorna null si el RUT está vacío", async () => {
    expect(await findWorkerByRut("")).toBeNull()
  })

  it("busca al trabajador usando RUT limpio y normalizado", async () => {
    const limitMock = vi.fn().mockResolvedValue([
      {
        id: "w-1",
        firstName: "Carlos",
        lastName: "Sánchez",
        rut: "12345678-9",
        position: "Operador",
        worksiteId: "ws-1",
        worksiteName: "Obra Central",
      },
    ])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock })
    mockSelect.mockReturnValue({ from: fromMock })

    const res = await findWorkerByRut(" 12.345.678-9 ")
    expect(res).toEqual({
      id: "w-1",
      firstName: "Carlos",
      lastName: "Sánchez",
      rut: "12345678-9",
      position: "Operador",
      worksiteId: "ws-1",
      worksiteName: "Obra Central",
    })

    // Comprobar que select fue llamado
    expect(mockSelect).toHaveBeenCalled()
    expect(fromMock).toHaveBeenCalled()
    expect(leftJoinMock).toHaveBeenCalled()
    expect(whereMock).toHaveBeenCalled()
  })

  it("retorna null si no encuentra coincidencias", async () => {
    const limitMock = vi.fn().mockResolvedValue([])
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock })
    const leftJoinMock = vi.fn().mockReturnValue({ where: whereMock })
    const fromMock = vi.fn().mockReturnValue({ leftJoin: leftJoinMock })
    mockSelect.mockReturnValue({ from: fromMock })

    const res = await findWorkerByRut("11111111-1")
    expect(res).toBeNull()
  })
})

describe("buildPpaExport", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("lee una fila extra para reportar truncado en exportaciones grandes", async () => {
    const submissions = Array.from({ length: 10_001 }, (_, index) => ppaRow(`ppa-${index}`))
    const offsetMock = vi.fn().mockResolvedValue(submissions)
    const limitMock = vi.fn().mockReturnValue({ offset: offsetMock })
    const orderByMock = vi.fn().mockReturnValue({ limit: limitMock })
    const whereSubmissionsMock = vi.fn().mockReturnValue({ orderBy: orderByMock })
    const fromSubmissionsMock = vi.fn().mockReturnValue({ where: whereSubmissionsMock })

    const whereWorksitesMock = vi.fn().mockResolvedValue([{ id: "ws-1", name: "Faena 1" }])
    const fromWorksitesMock = vi.fn().mockReturnValue({ where: whereWorksitesMock })
    const fromCorrectiveMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) })
    const fromActorsMock = vi.fn().mockResolvedValue([])

    mockSelect
      .mockReturnValueOnce({ from: fromSubmissionsMock })
      .mockReturnValueOnce({ from: fromWorksitesMock })
      .mockReturnValueOnce({ from: fromCorrectiveMock })
      .mockReturnValueOnce({ from: fromActorsMock })

    const report = await buildPpaExport("all")

    expect(limitMock).toHaveBeenCalledWith(10_001)
    expect(report.rows).toHaveLength(10_000)
    expect(report.rowLimitApplied).toBe(true)
    expect(report.headers).toEqual(expect.arrayContaining([
      "Verificada por", "Reinicio autorizado", "Cerrado", "Código CAPA", "Evidencias CAPA", "Evaluación eficacia",
    ]))
  })
})
