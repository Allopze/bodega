import { beforeEach, describe, expect, it, vi } from "vitest"

const mockLimit = vi.hoisted(() => vi.fn())
const mockWhere = vi.hoisted(() => vi.fn(() => ({ limit: mockLimit })))
const mockSecondLeftJoin = vi.hoisted(() => vi.fn(() => ({ where: mockWhere })))
const mockFirstLeftJoin = vi.hoisted(() => vi.fn(() => ({ leftJoin: mockSecondLeftJoin })))
const mockFrom = vi.hoisted(() => vi.fn(() => ({ leftJoin: mockFirstLeftJoin })))
const mockSelect = vi.hoisted(() => vi.fn(() => ({ from: mockFrom })))
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock("@/lib/services/notifications", () => ({
  getUserIdsWithPermission: vi.fn(),
  notifyAfterCommit: vi.fn(),
  notifyManyUser: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

import { getPpaByToken } from "@/lib/services/ppa"
import { hashPpaPublicToken } from "@/lib/services/ppa-module/public-token"

describe("getPpaByToken", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when the permanent public token was manually revoked", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        submission: {
          id: "ppa-1",
          publicToken: hashPpaPublicToken("tok-revoked"),
          publicTokenRevokedAt: "2026-06-28T12:00:00.000Z",
          worksiteId: "ws-1",
          workerName: "Trabajador Prueba",
        },
        worksiteName: "Faena",
        supervisor: "Supervisor",
        prevencionista: "Prevencionista",
      },
    ])

    await expect(getPpaByToken("tok-revoked")).resolves.toBeNull()
  })

  /**
   * S-PPA-02: el valor almacenado es un hash, no una credencial. Antes la
   * consulta comparaba también contra el token en claro, así que quien viera
   * `public_token` en la base entraba — y al entrar lo reescribía, rompiendo el
   * enlace legítimo del trabajador.
   */
  it("no abre el PPA cuando se presenta el hash almacenado, y no ejecuta ningún update", async () => {
    const hash = hashPpaPublicToken("tok-legitimo")
    // La consulta busca hash(hash), que no corresponde a ninguna fila.
    mockLimit.mockResolvedValueOnce([])

    await expect(getPpaByToken(hash)).resolves.toBeNull()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("abre el PPA sólo con el token en claro y sin reescribir la fila", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        submission: {
          id: "ppa-2",
          publicToken: hashPpaPublicToken("tok-legitimo"),
          publicTokenRevokedAt: null,
          worksiteId: "ws-1",
          workerName: "Trabajador Prueba",
        },
        worksiteName: "Faena",
        supervisor: "Supervisor",
        prevencionista: "Prevencionista",
      },
    ])

    const result = await getPpaByToken("tok-legitimo")
    expect(result?.id).toBe("ppa-2")
    // El resultado nunca expone el hash almacenado.
    expect(result).not.toHaveProperty("publicToken")
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
