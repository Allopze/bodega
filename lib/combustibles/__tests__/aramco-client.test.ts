import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AramcoAuthError,
  AramcoPayloadValidationError,
  AramcoUpstreamError,
  AramcoTwoFactorRequiredError,
  authenticateAramco,
  encodeAramcoLogin,
  fetchAramcoMovements,
  generateAramcoKeyboard,
} from "../aramco-client"

/** Decodifica el `login` base64 a sus pares clave/valor. */
function decodeLogin(login: string): Record<string, string> {
  const decoded = Buffer.from(login, "base64").toString("utf8")
  return Object.fromEntries(decoded.split("&").map((pair) => {
    const index = pair.indexOf("=")
    return [pair.slice(0, index), pair.slice(index + 1)]
  }))
}

describe("encodeAramcoLogin", () => {
  it("sends button indices instead of the password digits", () => {
    // Pares: 0:(3,0) 1:(5,7) 2:(9,1) 3:(2,4) 4:(8,6)
    // "780235" -> 7:1  8:4  0:0  2:3  3:0  5:1
    const fields = decodeLogin(encodeAramcoLogin("78023530-6", "780235", [3, 0, 5, 7, 9, 1, 2, 4, 8, 6]))
    expect(fields.password).toBe("140301")
    expect(fields.passwordType).toBe("2")
    expect(fields.documentNumber).toBe("78023530-6")
    expect(fields.passwordKeyboard).toBe("3 - 0,5 - 7,9 - 1,2 - 4,8 - 6")
  })

  it("emits an index whose pair contains the digit, for any keyboard", () => {
    // La propiedad que realmente importa: el layout es aleatorio en cada
    // pantalla, así que la correspondencia tiene que sostenerse siempre y no
    // sólo para el teclado del caso de arriba.
    for (let attempt = 0; attempt < 25; attempt++) {
      const keyboard = generateAramcoKeyboard()
      const password = "9042761538"
      const fields = decodeLogin(encodeAramcoLogin("1-9", password, keyboard))
      const pairs = fields.passwordKeyboard!.split(",").map((pair) => pair.split(" - ").map(Number))
      expect(fields.password).toHaveLength(password.length)
      for (const [position, digit] of [...password].entries()) {
        const index = Number(fields.password![position])
        expect(pairs[index]).toContain(Number(digit))
      }
    }
  })

  it("appends the operator only on the second call", () => {
    const keyboard = [3, 0, 5, 7, 9, 1, 2, 4, 8, 6]
    expect(decodeLogin(encodeAramcoLogin("1-9", "12", keyboard)).systemOperatorId).toBeUndefined()
    expect(decodeLogin(encodeAramcoLogin("1-9", "12", keyboard, 23645)).systemOperatorId).toBe("23645")
  })

  it("refuses a non-numeric password instead of spending a login attempt", () => {
    // Un carácter no numérico daría índice -1 y el portal recibiría una clave
    // corrupta, gastando uno de los intentos que terminan bloqueando la cuenta.
    expect(() => encodeAramcoLogin("1-9", "abc123", generateAramcoKeyboard())).toThrow(AramcoAuthError)
  })

  it("refuses a keyboard that is not a permutation of 0-9", () => {
    expect(() => encodeAramcoLogin("1-9", "12", [1, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toThrow(AramcoAuthError)
    expect(() => encodeAramcoLogin("1-9", "12", [1, 2, 3])).toThrow(AramcoAuthError)
  })
})

describe("generateAramcoKeyboard", () => {
  it("always produces the ten digits exactly once", () => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const keyboard = generateAramcoKeyboard()
      expect([...keyboard].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    }
  })
})

/* ── Red ─────────────────────────────────────────────────────────────────── */

const fetchMock = vi.fn()
const ACCOUNT = { userId: 34822, systemOperatorId: 23645, systemOperatorName: "CHOME", programType: 1, twoFactorAuthentication: null }
const VALID_MOVEMENT = {
  transactionId: 1,
  transactionDate: "2026-08-10T10:00:00",
  vehicleRegistrationPlate: "AB-CD12",
  cardNumber: "CARD-1",
  quantity: 10,
  originalAmount: 10_000,
  totalDiscountAmount: 0,
  amountToPay: 10_000,
  productName: "Diesel",
  productId: 1,
  vehicleOdometer: null,
  vehiclePreviousOdometer: null,
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: "", text: async () => JSON.stringify(body) }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe("authenticateAramco", () => {
  it("picks the fleet program and resolves the customer base url", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ ...ACCOUNT, programType: 2, systemOperatorId: 999 }, ACCOUNT]))
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", environment_type: "Customer" }))

    const session = await authenticateAramco("78023530-6", "780235")

    expect(session).toMatchObject({ token: "tok", baseUrl: "customers/23645/", systemOperatorId: 23645 })
    // El segundo POST lleva el operador elegido; el primero no.
    expect(decodeLogin(new URLSearchParams(fetchMock.mock.calls[1]![1].body).get("login")!).systemOperatorId).toBe("23645")
  })

  it("uses the cost-centre base url when the portal says so", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([ACCOUNT]))
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", environment_type: "CustomerCostCenter", user_id: 77 }))
    const session = await authenticateAramco("1-9", "1")
    expect(session.baseUrl).toBe("customers/77/costcenters/23645/")
  })

  it("regenerates the keyboard between the two calls", async () => {
    // El portal entrega un layout nuevo en cada pantalla; reutilizar el anterior
    // es justo lo que el esquema anti-keylogger intenta evitar.
    fetchMock
      .mockResolvedValueOnce(jsonResponse([ACCOUNT]))
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", environment_type: "Customer" }))
    await authenticateAramco("1-9", "1234567890")
    const first = decodeLogin(new URLSearchParams(fetchMock.mock.calls[0]![1].body).get("login")!)
    const second = decodeLogin(new URLSearchParams(fetchMock.mock.calls[1]![1].body).get("login")!)
    expect(second.passwordKeyboard).not.toBe(first.passwordKeyboard)
  })

  it("surfaces a two-factor requirement as its own actionable error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ ...ACCOUNT, twoFactorAuthentication: { verifyId: "abc" } }]))
    await expect(authenticateAramco("1-9", "1")).rejects.toThrow(AramcoTwoFactorRequiredError)
    // No se intenta pedir el token: nadie puede arreglarlo reintentando.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("fails clearly when the portal returns no account", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await expect(authenticateAramco("1-9", "1")).rejects.toThrow(AramcoAuthError)
  })

  it("treats a rejected credential as an auth error, not a transient failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "no" }, 401))
    await expect(authenticateAramco("1-9", "1")).rejects.toThrow(AramcoAuthError)
  })

  it("translates the portal's own internal faults into something actionable", async () => {
    // Visto en vivo: el backend de Aramco filtró un error de concurrencia de su
    // DbContext con HTTP 400. Volcarlo crudo en el toast no dice nada, y no es un
    // problema de credenciales.
    fetchMock
      .mockResolvedValueOnce(jsonResponse([ACCOUNT]))
      .mockResolvedValueOnce(jsonResponse({ error: "0", error_description: "A second operation started on this context before a previous asynchronous operation completed." }, 400))
    const error = await authenticateAramco("1-9", "1").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AramcoUpstreamError)
    expect((error as AramcoUpstreamError).message).toMatch(/no es un problema de credenciales/i)
    // El detalle crudo no se pierde: queda en el error para el log.
    expect((error as AramcoUpstreamError).detail).toContain("second operation")
  })

  it("keeps a 412 validation message from the portal as-is", async () => {
    // Esas sí son legibles y accionables: dicen qué campo rechazó el portal.
    fetchMock.mockResolvedValueOnce(jsonResponse({ validations: [{ message: "Clave incorrecta" }] }, 412))
    await expect(authenticateAramco("1-9", "1")).rejects.toThrow(/Clave incorrecta/)
  })

  it("classifies a locked account without leaking the raw portal payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      validations: [{ type: "LimitAttemptsReached", message: "Límite de intentos alcanzado. Usuario bloqueado." }],
    }, 412))

    const error = await authenticateAramco("1-9", "1").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AramcoAuthError)
    expect((error as Error).message).toMatch(/cuenta de Aramco está bloqueada/i)
    expect((error as Error).message).not.toContain("validations")
    expect((error as Error).message).not.toContain("LimitAttemptsReached")
  })

  it("does not call the portal at all without credentials", async () => {
    await expect(authenticateAramco("", "")).rejects.toThrow(AramcoAuthError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("fetchAramcoMovements", () => {
  const session = { token: "tok", baseUrl: "customers/23645/", systemOperatorId: 23645, customerName: "CHOME" }

  function decodeFilter(url: string): Record<string, unknown> {
    const encoded = decodeURI(url.split("?filter=")[1]!)
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))
  }

  it("sends the range in the portal's date format, inclusive on both ends", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [] }))
    await fetchAramcoMovements(session, "2026-02-01", "2026-02-28")

    const filter = decodeFilter(fetchMock.mock.calls[0]![0]) as { filter: { name: string; value: string; condition: string }[] }
    expect(filter.filter).toEqual([
      { name: "transactionDate", value: "01-02-2026 00:00:00", condition: "gte" },
      { name: "transactionDate", value: "28-02-2026 23:59:59", condition: "lte" },
    ])
  })

  it("walks every page instead of returning only the first", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ totalPages: 2, data: [{ ...VALID_MOVEMENT, transactionId: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ totalPages: 2, data: [{ ...VALID_MOVEMENT, transactionId: 2 }] }))
    const { movements } = await fetchAramcoMovements(session, "2026-01-01", "2026-12-31")
    expect(movements.map((movement) => movement.transactionId)).toEqual([1, 2])
    expect(decodeFilter(fetchMock.mock.calls[1]![0])).toMatchObject({ pageNumber: 2 })
  })

  it("sends the bearer token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [] }))
    await fetchAramcoMovements(session, "2026-01-01", "2026-01-31")
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer tok")
  })

  it("reports a malformed movement without discarding the valid ones", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [
      { ...VALID_MOVEMENT, transactionId: 1 },
      { ...VALID_MOVEMENT, transactionId: 2, quantity: null },
    ] }))

    const { movements, issues } = await fetchAramcoMovements(session, "2026-08-01", "2026-08-31")
    expect(movements.map((movement) => movement.transactionId)).toEqual([1])
    expect(issues).toEqual([{ index: 2, transactionId: 2, reason: "contrato de movimiento inválido", payload: expect.anything() }])
  })

  it("fails loudly only when NO row matches the contract", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [{ ...VALID_MOVEMENT, quantity: null }] }))

    await expect(fetchAramcoMovements(session, "2026-08-01", "2026-08-31"))
      .rejects.toBeInstanceOf(AramcoPayloadValidationError)
  })

  it("drops an identical repeat from paginated responses without failing the run", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [VALID_MOVEMENT, { ...VALID_MOVEMENT }] }))

    const { movements, issues } = await fetchAramcoMovements(session, "2026-08-01", "2026-08-31")
    expect(movements).toHaveLength(1)
    expect(issues).toEqual([])
  })

  it("sends a repeated id with different content to review instead of picking one", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ totalPages: 1, data: [VALID_MOVEMENT, { ...VALID_MOVEMENT, quantity: 99 }] }))

    const { movements, issues } = await fetchAramcoMovements(session, "2026-08-01", "2026-08-31")
    expect(movements).toHaveLength(1)
    expect(issues[0]).toMatchObject({ reason: "transactionId repetido con contenido distinto" })
  })
})
