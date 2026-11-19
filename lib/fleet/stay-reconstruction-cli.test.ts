import { describe, expect, it } from "vitest"
import { parseSnapshots, parseStayCliArgs } from "./stay-reconstruction-cli"

describe("parseStayCliArgs", () => {
  it("lee las banderas con = y aplica los valores por defecto", () => {
    expect(parseStayCliArgs(["--out=informe.xlsx"])).toEqual({
      apply: false, maxGapDays: 7, snapshotsFile: null, out: "informe.xlsx", actorEmail: null,
    })
    expect(parseStayCliArgs(["--apply", "--max-gap-days=3", "--snapshots=p.json", "--out", "i.xlsx", "--actor-email=a@b.cl"])).toEqual({
      apply: true, maxGapDays: 3, snapshotsFile: "p.json", out: "i.xlsx", actorEmail: "a@b.cl",
    })
  })

  it("exige un informe Excel y un tope válido", () => {
    expect(() => parseStayCliArgs([])).toThrow(/--out/)
    expect(() => parseStayCliArgs(["--out=informe.csv"])).toThrow(/Excel|xlsx/)
    expect(() => parseStayCliArgs(["--out=i.xlsx", "--max-gap-days=-1"])).toThrow(/max-gap-days/)
    expect(() => parseStayCliArgs(["--out=i.xlsx", "--max-gap-days=x"])).toThrow(/max-gap-days/)
  })
})

describe("parseSnapshots", () => {
  it("valida las filas de la planilla", () => {
    expect(parseSnapshots(JSON.stringify([{ date: "2026-08-21", code: "KA-71", plate: "CBJY-18", worksiteName: " Santa Fe " }]))).toEqual([
      { date: "2026-08-21", code: "KA-71", plate: "CBJY-18", worksiteName: "Santa Fe" },
    ])
    expect(() => parseSnapshots("no es json")).toThrow(/JSON/)
    expect(() => parseSnapshots("{}")).toThrow(/lista/)
    expect(() => parseSnapshots(JSON.stringify([{ date: "21-08-2026", code: "KA-71", worksiteName: "X" }]))).toThrow(/Fila 1.*date/)
    expect(() => parseSnapshots(JSON.stringify([{ date: "2026-08-21", worksiteName: "X" }]))).toThrow(/plate.*code/)
  })
})
