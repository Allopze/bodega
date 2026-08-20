import { describe, expect, it } from "vitest"
import { chooseSalesXmlCandidates } from "../sales-xml-cursor"

describe("sales XML cursor", () => {
  it("processes more than 120 candidates in deterministic resumable batches", () => {
    const candidates = Array.from({ length: 121 }, (_, index) => ({ key: String(index + 1).padStart(3, "0") }))

    const first = chooseSalesXmlCandidates(candidates, null, 120)
    const second = chooseSalesXmlCandidates(candidates, first.nextCursor, 120)

    expect(first.items).toHaveLength(120)
    expect(first.items[0]?.key).toBe("001")
    expect(first.items.at(-1)?.key).toBe("120")
    expect(first.nextCursor).toBe("120")
    expect(first.deferred).toBe(true)
    // La segunda corrida retoma por donde iba: la cola nunca se pierde. El
    // resto del lote se rellena con los candidatos que siguen sin resolver
    // (acá los 121 lo están, porque nadie los enriqueció entremedio), que es
    // justamente lo que hay que reintentar.
    expect(second.items[0]?.key).toBe("121")
    expect(second.items).toHaveLength(120)
  })

  it("no deja fuera un documento registrado con fecha anterior al cursor", () => {
    // El folio 1210 no resuelve nunca (XML corrupto) y congela el cursor; el
    // folio 1300 se registró tarde, con fecha anterior. Antes quedaba excluido
    // en todas las corridas siguientes.
    const cursor = "2026-07-14|033|000000001180|fel:sale:433:33:1180:78023530-6"
    const rezagado = { key: "2026-07-03|033|000000001300|fel:sale:433:33:1300:78023530-6" }
    const atascado = { key: "2026-07-28|033|000000001210|fel:sale:433:33:1210:78023530-6" }

    const selection = chooseSalesXmlCandidates([rezagado, atascado], cursor, 120)

    expect(selection.items.map((item) => item.key)).toEqual([atascado.key, rezagado.key])
    expect(selection.deferred).toBe(false)
  })

  it("atiende primero lo posterior al cursor y difiere el rezagado si no cabe", () => {
    const cursor = "2026-07-14|033|000000001180|fel:sale:433:33:1180:78023530-6"
    const rezagado = { key: "2026-07-03|033|000000001300|fel:sale:433:33:1300:78023530-6" }
    const atascado = { key: "2026-07-28|033|000000001210|fel:sale:433:33:1210:78023530-6" }

    const selection = chooseSalesXmlCandidates([rezagado, atascado], cursor, 1)

    expect(selection.items.map((item) => item.key)).toEqual([atascado.key])
    expect(selection.deferred).toBe(true)
    expect(selection.nextCursor).toBe(atascado.key)
  })

  it("wraps safely when resolved candidates disappear before the stored cursor", () => {
    const candidates = [{ key: "010" }, { key: "020" }]
    const selection = chooseSalesXmlCandidates(candidates, "999", 120)

    expect(selection.items.map((item) => item.key)).toEqual(["010", "020"])
  })
})
