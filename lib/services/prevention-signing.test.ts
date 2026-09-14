/**
 * INC-002 (auditoría 2026-09-14) — La excepción de firma propia recae en el
 * mismo rol que ejecuta la prevención.
 *
 * `prevention:sign_own_work` está concedida a `prevencionista`, que en una
 * faena también inspecciona, redacta la MIPER, propone CAPA y participa en las
 * investigaciones: la segregación se cumple formalmente pero se ejerce en una
 * sola persona, y a diferencia de los `*:override_segregation` —puntuales, con
 * motivo escrito, sólo para `administrador`— no dejaba rastro alguno.
 *
 * Lo que estas pruebas fijan es lo corregible sin decidir política: la
 * decisión distingue las tres situaciones y dice cuándo hizo falta la
 * excepción, para que el llamador la registre. A quién se concede el permiso
 * sigue siendo una decisión de la organización.
 */
import { describe, expect, it } from "vitest"
import { resolveOwnWorkSigning } from "./prevention-signing"

const CON_EXCEPCION = ["prevention:sign_own_work"]
const SIN_EXCEPCION: string[] = []

describe("resolveOwnWorkSigning", () => {
  it("no consume la excepción cuando la etapa previa la firmó otra persona", () => {
    expect(resolveOwnWorkSigning({
      signedByUserId: "ana", actorUserId: "bruno", permissions: CON_EXCEPCION, what: "Publicar",
    })).toEqual({ ok: true, usedException: false })
  })

  it("no consume la excepción cuando la etapa previa fue un acto del sistema", () => {
    // `null` es una conciliación automática: no hay a quién separar.
    expect(resolveOwnWorkSigning({
      signedByUserId: null, actorUserId: "ana", permissions: CON_EXCEPCION, what: "Publicar",
    })).toEqual({ ok: true, usedException: false })
  })

  it("marca el uso de la excepción cuando firma la misma persona", () => {
    const decision = resolveOwnWorkSigning({
      signedByUserId: "ana", actorUserId: "ana", permissions: CON_EXCEPCION, what: "Publicar",
    })
    expect(decision.ok).toBe(true)
    // Éste es el dato que antes no existía: el registro quedaba idéntico al de
    // una firma con dos personas distintas.
    expect(decision.usedException).toBe(true)
  })

  it("bloquea la firma propia sin la excepción, con un mensaje legible", () => {
    const decision = resolveOwnWorkSigning({
      signedByUserId: "ana", actorUserId: "ana", permissions: SIN_EXCEPCION, what: "Publicar la matriz",
    })
    expect(decision.ok).toBe(false)
    expect(decision.usedException).toBe(false)
    expect(decision.message).toMatch(/persona distinta/i)
  })
})
