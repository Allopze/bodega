// @vitest-environment jsdom

/**
 * `FulfillmentBacklogPanel` es un server component `async` que consulta la
 * base directamente (`countPdtpFulfillmentBacklog`), así que no se monta acá.
 * Lo que se cubre es `shouldOfferPdtpRevision`, la decisión pura que dispara
 * "Crear revisión v+1" cuando el contenido vigente ya no coincide con lo
 * firmado (QA 2026-09-16 P1(b)): tabla de verdad completa sobre sus tres
 * condiciones.
 */

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { describePdtpFulfillmentError, pdtpFulfillmentSourceLabel } from "@/lib/services/pdtp/backlog"
import { BacklogDetails, BacklogStatusList, shouldOfferPdtpRevision } from "./fulfillment-backlog-panel"

type Backlog = Parameters<typeof BacklogStatusList>[0]["backlog"]

const backlog = (over: Partial<Backlog> = {}): Backlog => ({
  pending: 0,
  errored: 0,
  rejected: 0,
  recentRejected: [],
  erroredWaitingOnActivation: 0,
  lastError: null,
  lastErrorDescription: null,
  digestDrift: false,
  digestVerificationUnavailable: false,
  digestVerificationMessage: null,
  ...over,
})

const NANOID_EVENTO = "MpRpdOL3wOdTmb2v0bAN4"
const NANOID_FAENA = "mHyTTFyYZMStchMpBaSmo"
const CRUDO = `[no-active-program] Sin programa PDTP activo para el evento epp:${NANOID_EVENTO} en faena ${NANOID_FAENA}.`

const allTrue = { digestDrift: true, programStatus: "active", canManageProgram: true }

describe("shouldOfferPdtpRevision", () => {
  it("ofrece la revisión cuando las tres condiciones se cumplen", () => {
    expect(shouldOfferPdtpRevision(allTrue)).toBe(true)
  })

  it("no ofrece la revisión sin desvío de huella", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, digestDrift: false })).toBe(false)
  })

  it("no ofrece la revisión si el programa no está activo (borrador o en revisión: el editor sigue disponible)", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, programStatus: "draft" })).toBe(false)
    expect(shouldOfferPdtpRevision({ ...allTrue, programStatus: "in_review" })).toBe(false)
  })

  it("no ofrece la revisión a quien no puede gestionar el programa", () => {
    expect(shouldOfferPdtpRevision({ ...allTrue, canManageProgram: false })).toBe(false)
  })
})

/* El panel mostraba "47 evento(s) en error" en rojo cuando los 47 eran hechos
 * esperando que se activara el programa —el estado normal entre firmar y
 * activar—, y debajo el `message` crudo de la excepción con nanoids adentro.
 * `erroredWaitingOnActivation` existía en el servicio desde antes y ningún
 * componente lo consumía. */
describe("BacklogStatusList — espera por activación separada del error real", () => {
  it("no pinta nada en rojo cuando todos los eventos esperan la activación", () => {
    render(<BacklogStatusList backlog={backlog({ errored: 47, erroredWaitingOnActivation: 47 })} />)

    expect(screen.getByText(/esperando que el programa esté vigente/i)).toBeInTheDocument()
    expect(screen.getByText("47")).toBeInTheDocument()
    expect(screen.queryByText(/en error, sin acreditar/i)).not.toBeInTheDocument()
  })

  it("separa el resto real cuando conviven las dos causas", () => {
    render(<BacklogStatusList backlog={backlog({ errored: 50, erroredWaitingOnActivation: 47 })} />)

    // 50 - 47: el rojo cuenta sólo lo que de verdad es una brecha de cableado.
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText(/en error, sin acreditar/i)).toBeInTheDocument()
    expect(screen.getByText("47")).toBeInTheDocument()
  })

  it("se comporta como antes cuando ninguno espera activación", () => {
    render(<BacklogStatusList backlog={backlog({ errored: 3 })} />)

    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText(/en error, sin acreditar/i)).toBeInTheDocument()
    expect(screen.queryByText(/esperando que el programa/i)).not.toBeInTheDocument()
  })
})

describe("BacklogDetails — sin identificadores internos en pantalla", () => {
  it("muestra el error traducido y nunca el nanoid del evento ni el de la faena", () => {
    render(
      <BacklogDetails
        backlog={backlog({
          errored: 47,
          erroredWaitingOnActivation: 47,
          lastError: CRUDO,
          lastErrorDescription: describePdtpFulfillmentError({
            lastError: CRUDO,
            sourceType: "epp",
            worksiteName: "Biodiversa",
            occurredAt: "2026-09-14T18:00:00.000Z",
          }),
        })}
      />,
    )

    expect(screen.getByText(/Biodiversa/)).toBeInTheDocument()
    expect(screen.getByText(/entrega de EPP/i)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(NANOID_EVENTO))).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(NANOID_FAENA))).not.toBeInTheDocument()
  })

  it("nombra el origen y la faena de un rechazo, no su sourceType ni su id", () => {
    render(
      <BacklogDetails
        backlog={backlog({
          rejected: 1,
          recentRejected: [{
            sourceType: "miper",
            sourceId: NANOID_EVENTO,
            occurredAt: "2026-03-02T12:00:00.000Z",
            reason: "El hecho ocurrió en 2025 y el programa vigente cubre 2026.",
            sourceLabel: "Matriz IPER",
            worksiteName: "Biodiversa",
            occurredOn: "02-03-2026",
          }],
        })}
      />,
    )

    expect(screen.getByText(/Matriz IPER/)).toBeInTheDocument()
    expect(screen.getByText(/Biodiversa/)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(NANOID_EVENTO))).not.toBeInTheDocument()
  })
})

describe("describePdtpFulfillmentError", () => {
  it("traduce el caso etiquetado nombrando faena, origen y día chileno", () => {
    const frase = describePdtpFulfillmentError({
      lastError: CRUDO,
      sourceType: "epp",
      worksiteName: "Biodiversa",
      occurredAt: "2026-09-14T18:00:00.000Z",
    })

    expect(frase).toContain("Biodiversa")
    expect(frase).toContain("14-09-2026")
    expect(frase).not.toContain(NANOID_FAENA)
    expect(frase).toMatch(/se acreditan solos/)
  })

  /* Un instante UTC de las 23:00 es todavía el día anterior en Chile: fechar el
   * hecho "mañana" en la faena donde ocurrió es exactamente lo que el panel no
   * puede hacer. */
  it("fecha el hecho en el día chileno, no en el UTC", () => {
    expect(describePdtpFulfillmentError({
      lastError: CRUDO,
      sourceType: "epp",
      worksiteName: "Biodiversa",
      occurredAt: "2026-09-15T02:00:00.000Z",
    })).toContain("14-09-2026")
  })

  it("cae en una frase genérica si falta el nombre de la faena", () => {
    const frase = describePdtpFulfillmentError({
      lastError: CRUDO, sourceType: "epp", worksiteName: null, occurredAt: null,
    })

    expect(frase).toContain("esa faena")
    expect(frase).not.toContain(NANOID_FAENA)
  })

  /* Un error arbitrario no se puede reescribir sin inventar: se muestra crudo,
   * que es peor copy pero información verdadera. */
  it("devuelve el mensaje tal cual si no lleva la etiqueta del motor", () => {
    expect(describePdtpFulfillmentError({
      lastError: "connection terminated unexpectedly",
      sourceType: "epp", worksiteName: "Biodiversa", occurredAt: null,
    })).toBe("connection terminated unexpectedly")
  })

  it("no inventa un error cuando no hay ninguno", () => {
    expect(describePdtpFulfillmentError({
      lastError: null, sourceType: null, worksiteName: null, occurredAt: null,
    })).toBeNull()
  })
})

describe("pdtpFulfillmentSourceLabel", () => {
  it("usa el mismo nombre que la navegación del módulo", () => {
    expect(pdtpFulfillmentSourceLabel("miper")).toBe("Matriz IPER")
    expect(pdtpFulfillmentSourceLabel("cgrd")).toBe("Gestión de riesgos de desastres")
    expect(pdtpFulfillmentSourceLabel("epp")).toBe("Entrega de EPP")
  })

  it("no filtra la clave cruda de un origen sin etiqueta declarada", () => {
    expect(pdtpFulfillmentSourceLabel("origen_nuevo_sin_declarar")).toBe("Otro origen")
  })
})
