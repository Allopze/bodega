/**
 * Patrón P1 (auditoría 2026-09-14): `CAT-002`, `CLI-001` y `PRV-002` son el
 * mismo defecto en tres maestros — la identidad tributaria o de medida es
 * mutable después de haber sido usada.
 */
import { describe, expect, it, vi } from "vitest"
import {
  assertIdentityStable,
  changedIdentityFields,
  identityLockedMessage,
  MasterIdentityError,
} from "./master-identity"

const campo = (before: string | null, after: string | null) =>
  ({ key: "rut", label: "el RUT", before, after })

describe("changedIdentityFields", () => {
  it("no ve cambio donde sólo hay espacios o nada", () => {
    expect(changedIdentityFields([campo("76.123.456-7", "76.123.456-7")])).toEqual([])
    expect(changedIdentityFields([campo("76.123.456-7", "  76.123.456-7 ")])).toEqual([])
    expect(changedIdentityFields([campo(null, "")])).toEqual([])
    expect(changedIdentityFields([campo(null, undefined as unknown as string)])).toEqual([])
  })

  it("ve el cambio y conserva ambos valores para poder nombrarlos", () => {
    expect(changedIdentityFields([campo("76.123.456-7", "99.888.777-6")])).toEqual([
      { key: "rut", label: "el RUT", before: "76.123.456-7", after: "99.888.777-6" },
    ])
  })

  it("poner un valor donde no había también es cambio de identidad", () => {
    expect(changedIdentityFields([campo(null, "76.123.456-7")])).toHaveLength(1)
  })

  it("informa varios campos a la vez", () => {
    const cambios = changedIdentityFields([
      campo("76.123.456-7", "99.888.777-6"),
      { key: "unitOfMeasure", label: "la unidad de medida", before: "unidad", after: "caja" },
    ])
    expect(cambios.map((c) => c.key)).toEqual(["rut", "unitOfMeasure"])
  })
})

describe("identityLockedMessage", () => {
  it("nombra el campo, el motivo y la salida", () => {
    const mensaje = identityLockedMessage(
      changedIdentityFields([campo("76.123.456-7", "99.888.777-6")]),
      "el cliente ya tiene facturas emitidas",
      "Crea otro cliente.",
    )
    expect(mensaje).toBe(
      'No se puede cambiar el RUT («76.123.456-7» → «99.888.777-6»): ' +
      'el cliente ya tiene facturas emitidas. Crea otro cliente.',
    )
  })

  it("enumera dos campos con «y», no con coma final", () => {
    const mensaje = identityLockedMessage(
      changedIdentityFields([
        { key: "a", label: "la unidad de medida", before: "unidad", after: "caja" },
        { key: "b", label: "la condición de servicio", before: "no", after: "sí" },
      ]),
      "el producto ya tiene inventario",
      "Crea otro producto.",
    )
    expect(mensaje).toContain("la unidad de medida («unidad» → «caja») y la condición de servicio")
  })
})

describe("assertIdentityStable", () => {
  it("no consulta la historia si no cambió la identidad", async () => {
    const hasHistory = vi.fn(async () => true)
    await assertIdentityStable({
      fields: [campo("76.123.456-7", "76.123.456-7")],
      hasHistory, reason: "da igual", remedy: "da igual",
    })
    expect(hasHistory).not.toHaveBeenCalled()
  })

  it("deja pasar el cambio en un maestro que todavía no se usó", async () => {
    await expect(assertIdentityStable({
      fields: [campo("76.123.456-7", "99.888.777-6")],
      hasHistory: async () => false,
      reason: "r", remedy: "m",
    })).resolves.toBeUndefined()
  })

  it("bloquea el cambio con historia y dice qué campo fue", async () => {
    const error = await assertIdentityStable({
      fields: [campo("76.123.456-7", "99.888.777-6")],
      hasHistory: async () => true,
      reason: "el cliente ya tiene facturas emitidas",
      remedy: "Crea otro cliente.",
    }).catch((err) => err)

    expect(error).toBeInstanceOf(MasterIdentityError)
    expect((error as MasterIdentityError).fieldKeys).toEqual(["rut"])
    expect((error as Error).message).toContain("ya tiene facturas emitidas")
  })
})
