/**
 * El enlace público del PPA se deriva del secreto del servidor y sólo se guarda
 * hasheado. Si `AUTH_SECRET` rota, un reenvío de la cola offline derivaba un
 * token distinto del hasheado en el insert original y el enlace devuelto daba
 * 404 sobre una fila correcta.
 */
import { afterEach, describe, expect, it } from "vitest"
import { derivePpaPublicToken, hashPpaPublicToken, resolvePpaPublicToken } from "./public-token"

const previous = { secret: process.env.AUTH_SECRET, rotated: process.env.AUTH_SECRET_PREVIOUS }

afterEach(() => {
  if (previous.secret === undefined) delete process.env.AUTH_SECRET
  else process.env.AUTH_SECRET = previous.secret
  if (previous.rotated === undefined) delete process.env.AUTH_SECRET_PREVIOUS
  else process.env.AUTH_SECRET_PREVIOUS = previous.rotated
})

describe("resolvePpaPublicToken", () => {
  it("recovers the link issued with the previous secret after a rotation", () => {
    process.env.AUTH_SECRET = "secreto-viejo"
    delete process.env.AUTH_SECRET_PREVIOUS
    const original = derivePpaPublicToken("csid-1")
    const storedHash = hashPpaPublicToken(original)

    // Rotación: el secreto nuevo manda y el viejo queda en la lista.
    process.env.AUTH_SECRET = "secreto-nuevo"
    process.env.AUTH_SECRET_PREVIOUS = "secreto-viejo"

    // Control: derivar con el secreto vigente ya NO abre la fila.
    expect(hashPpaPublicToken(derivePpaPublicToken("csid-1"))).not.toBe(storedHash)
    expect(resolvePpaPublicToken("csid-1", storedHash)).toBe(original)
  })

  it("returns null when no secret in the list opens the stored hash", () => {
    process.env.AUTH_SECRET = "secreto-nuevo"
    process.env.AUTH_SECRET_PREVIOUS = "otro-mas-viejo"

    expect(resolvePpaPublicToken("csid-1", hashPpaPublicToken("token-de-otra-parte"))).toBeNull()
  })

  it("keeps the current secret first: without rotation nothing changes", () => {
    process.env.AUTH_SECRET = "secreto-unico"
    delete process.env.AUTH_SECRET_PREVIOUS
    const token = derivePpaPublicToken("csid-2")

    expect(resolvePpaPublicToken("csid-2", hashPpaPublicToken(token))).toBe(token)
  })
})
