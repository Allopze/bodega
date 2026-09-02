/**
 * Mapeo de protocolos MINSAL a actividades del PDTP.
 *
 * Es un test barato que protege un acoplamiento frágil: el mapa vive en el
 * conector y las claves salen del catálogo de `lib/prevention/minsal-protocols`,
 * así que renombrar un código allá rompería la acreditación en silencio.
 */

import { describe, expect, it } from "vitest"
import { MINSAL_PROTOCOL_CODES } from "@/lib/prevention/minsal-protocols"
import {
  PDTP_PROTOCOL_ACTIVITY_NUMBERS,
  pdtpActivityNumberForProtocol,
} from "./hygiene-accreditation-connector"

describe("pdtpActivityNumberForProtocol", () => {
  it("mapea los cuatro protocolos que el programa 2026 planifica", () => {
    expect(pdtpActivityNumberForProtocol("prexor")).toBe(46)
    expect(pdtpActivityNumberForProtocol("tmert")).toBe(47)
    expect(pdtpActivityNumberForProtocol("psicosocial")).toBe(48)
    expect(pdtpActivityNumberForProtocol("uv")).toBe(49)
  })

  it("devuelve null para los protocolos sin actividad en el programa", () => {
    // Pronunciarse sobre ellos es correcto y no acredita: el programa 2026 no
    // los planifica.
    expect(pdtpActivityNumberForProtocol("silice")).toBeNull()
    expect(pdtpActivityNumberForProtocol("citostaticos")).toBeNull()
    expect(pdtpActivityNumberForProtocol("hiperbaria")).toBeNull()
    expect(pdtpActivityNumberForProtocol("frio_calor")).toBeNull()
  })

  it("devuelve null para un código que no existe en el catálogo", () => {
    expect(pdtpActivityNumberForProtocol("inventado")).toBeNull()
  })

  it("sólo mapea códigos que el catálogo MINSAL reconoce", () => {
    // Si alguien renombra un protocolo en el catálogo, el mapa queda apuntando a
    // una clave muerta y la actividad deja de acreditarse sin que nada falle.
    for (const code of Object.keys(PDTP_PROTOCOL_ACTIVITY_NUMBERS)) {
      expect(MINSAL_PROTOCOL_CODES).toContain(code)
    }
  })

  it("no asigna dos protocolos a la misma actividad", () => {
    const numbers = Object.values(PDTP_PROTOCOL_ACTIVITY_NUMBERS)
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})
