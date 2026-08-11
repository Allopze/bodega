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
    expect(second.items.map((item) => item.key)).toEqual(["121"])
    expect(second.nextCursor).toBeNull()
    expect(second.deferred).toBe(false)
  })

  it("wraps safely when resolved candidates disappear before the stored cursor", () => {
    const candidates = [{ key: "010" }, { key: "020" }]
    const selection = chooseSalesXmlCandidates(candidates, "999", 120)

    expect(selection.items.map((item) => item.key)).toEqual(["010", "020"])
  })
})
