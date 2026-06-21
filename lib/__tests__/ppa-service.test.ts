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

import { findWorkerByRut } from "@/lib/services/ppa"

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
