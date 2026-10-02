// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import { useRowsFromSource } from "./use-rows-from-source"

const entry = (id: string, rowNumber: number) => ({ id, rowNumber, hazard: `Peligro ${rowNumber}` }) as MiperEntrySnapshot

describe("useRowsFromSource", () => {
  it("una foto nueva del servidor llega a las filas en el mismo render, sin un render intermedio con las viejas", () => {
    const first = { entries: [entry("e1", 1)] }
    const seen: string[][] = []
    const hook = renderHook(({ source }) => {
      const [rows] = useRowsFromSource(source)
      seen.push(rows.map((row) => row.id))
      return rows
    }, { initialProps: { source: first } })
    expect(hook.result.current.map((row) => row.id)).toEqual(["e1"])

    // Lo que trae `router.push(?fila=nuevo)` tras crear un riesgo: otra foto con la fila nueva.
    const second = { entries: [entry("e1", 1), entry("nuevo", 2)] }
    seen.length = 0
    hook.rerender({ source: second })
    expect(seen.length).toBeGreaterThan(0)
    // Cada ejecución del render posterior al cambio —también la que React descarta— ya ve la fila nueva.
    for (const ids of seen) expect(ids).toEqual(["e1", "nuevo"])
    expect(hook.result.current).toBe(second.entries)
  })

  it("entre fotos, setRows sigue mandando (guardado optimista) y la misma foto no lo pisa", () => {
    const source = { entries: [entry("e1", 1)] }
    const hook = renderHook(({ source }) => useRowsFromSource(source), { initialProps: { source } })
    act(() => { hook.result.current[1]((rows) => rows.map((row) => ({ ...row, hazard: "Editado" }))) })
    expect(hook.result.current[0][0]!.hazard).toBe("Editado")

    // Un re-render con la MISMA foto (otro estado del padre) no reinicia lo editado.
    hook.rerender({ source })
    expect(hook.result.current[0][0]!.hazard).toBe("Editado")

    // Una foto nueva sí manda, y después setRows vuelve a funcionar sobre ella.
    const next = { entries: [entry("e1", 1), entry("e2", 2)] }
    hook.rerender({ source: next })
    expect(hook.result.current[0].map((row) => row.hazard)).toEqual(["Peligro 1", "Peligro 2"])
    act(() => { hook.result.current[1]((rows) => rows.filter((row) => row.id !== "e1")) })
    expect(hook.result.current[0].map((row) => row.id)).toEqual(["e2"])
  })

  it("una foto atrasada (la que Next restaura al volver «atrás») no pisa una fila que el cliente ya guardó en una versión más nueva", () => {
    // El cliente guardó e1 dos veces (versión 3); la foto que llega es la de antes de esos guardados.
    const known: Record<string, number> = { e1: 3, e2: 1 }
    const versionOf = (id: string) => known[id]
    const first = { entries: [entry("e1", 1), entry("e2", 2)] }
    const hook = renderHook(({ source, serverVersions }) => useRowsFromSource(source, { serverVersions, versionOf }), {
      initialProps: { source: first, serverVersions: { e1: 1, e2: 1 } as Record<string, number> },
    })
    act(() => { hook.result.current[1]((rows) => rows.map((row) => (row.id === "e1" ? { ...row, hazard: "Guardado en v3" } : row))) })

    const stale = { entries: [entry("e1", 1), { ...entry("e2", 2), hazard: "Cambiado por otra persona" }, entry("e3", 3)] }
    hook.rerender({ source: stale, serverVersions: { e1: 1, e2: 2, e3: 1 } })
    // e1: el cliente conoce la v3 y la foto trae la v1 → queda la fila del cliente.
    expect(hook.result.current[0].find((row) => row.id === "e1")!.hazard).toBe("Guardado en v3")
    // e2: el servidor trae una versión más nueva que la del cliente → manda la foto.
    expect(hook.result.current[0].find((row) => row.id === "e2")!.hazard).toBe("Cambiado por otra persona")
    // Lo demás sale de la foto: aparece e3 y se respeta su orden.
    expect(hook.result.current[0].map((row) => row.id)).toEqual(["e1", "e2", "e3"])
  })

  it("con versiones iguales manda la foto del servidor, y sin nada que conservar se devuelve la foto tal cual", () => {
    const versionOf = (id: string) => ({ e1: 2 } as Record<string, number>)[id]
    const hook = renderHook(({ source, serverVersions }) => useRowsFromSource(source, { serverVersions, versionOf }), {
      initialProps: { source: { entries: [entry("e1", 1)] }, serverVersions: { e1: 1 } as Record<string, number> },
    })
    act(() => { hook.result.current[1]((rows) => rows.map((row) => ({ ...row, hazard: "Optimista" }))) })
    const fresh = { entries: [{ ...entry("e1", 1), hazard: "Del servidor" }] }
    hook.rerender({ source: fresh, serverVersions: { e1: 2 } })
    expect(hook.result.current[0]).toBe(fresh.entries)
  })
})
