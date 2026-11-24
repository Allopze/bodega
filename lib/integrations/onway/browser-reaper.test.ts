import { describe, expect, it } from "vitest"
import { descendantsOf, processGroups, type ChromiumProcess } from "./browser-reaper"

/**
 * El bug de producción del 2026-11-24: `server.kill()` mataba al driver de
 * Playwright y dejaba a Chromium —su hijo— reparentado a PID 1, girando al
 * 100 % de CPU para siempre. Estas pruebas fijan la parte pura del reaper: qué
 * procesos son de un lanzamiento y qué grupos hay que matar.
 */
const proc = (pid: number, ppid: number, pgid = pid): ChromiumProcess => ({
  pid,
  ppid,
  pgid,
  state: "S",
  comm: "chromium",
})

describe("descendantsOf", () => {
  it("encuentra hijos, nietos y bisnietos, no sólo el primer nivel", () => {
    const tree = [
      proc(10, 1),      // driver
      proc(11, 10),     // browser
      proc(12, 11),     // renderer
      proc(13, 12),     // utility del renderer
      proc(99, 1),      // ajeno
    ]

    expect(descendantsOf(10, tree).map((process) => process.pid).sort()).toEqual([11, 12, 13])
  })

  it("no incluye al propio padre", () => {
    const tree = [proc(10, 1), proc(11, 10)]

    expect(descendantsOf(10, tree).some((process) => process.pid === 10)).toBe(false)
  })

  it("un árbol vacío no inventa descendientes", () => {
    expect(descendantsOf(10, [])).toEqual([])
  })

  it("no entra en bucle si el censo trae un ciclo (no debería, pero no cuelga)", () => {
    const cyclic = [proc(10, 11), proc(11, 10)]

    expect(descendantsOf(10, cyclic).length).toBeLessThanOrEqual(2)
  })
})

describe("processGroups", () => {
  it("agrupa por pgid: es lo que se mata, no cada pid", () => {
    const processes = [
      proc(100, 1, 100),
      proc(101, 100, 100),
      proc(102, 1, 102),
    ]

    expect(processGroups(processes).sort()).toEqual([100, 102])
  })

  it("un mismo grupo repetido se mata una sola vez", () => {
    expect(processGroups([proc(1, 1, 500), proc(2, 1, 500), proc(3, 1, 500)])).toEqual([500])
  })

  it("sin procesos no hay grupos: el cierre no dispara ningún kill", () => {
    expect(processGroups([])).toEqual([])
  })
})
