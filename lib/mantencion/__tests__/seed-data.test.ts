import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

// El archivo y sus reglas son datos puros: no necesitan base (el servicio de carga la importa por tipos y por `db`).
vi.mock("@/db", () => ({ db: {} }))

import { checklistFor, inheritedIntervalFor } from "../schedule"
import { deriveFolioCode, isValidPlate, nameKey, normalizeCode, normalizePlate } from "../normalize"
import type { MantScheduleSnapshot } from "../types"
import { cleanItemName } from "@/lib/services/mantencion/seed-schedules"
import { parseMantSeedData, type MantSeedData } from "@/lib/services/mantencion/seed"

const FILE = path.resolve(process.cwd(), "db/seed/mantencion-seed.json")
const raw = (): unknown => JSON.parse(readFileSync(FILE, "utf8"))
const data = parseMantSeedData(raw())
const clone = (): MantSeedData => structuredClone(data)

// La referencia validada con la jefatura vive en `docs/mantencion/referencias/`,
// que está fuera de git junto con las planillas y notas del cliente: en un
// checkout limpio —el CI— no existe. Su sha256 fija la copia de `db/seed` en
// cualquier checkout; la comparación directa corre donde el archivo está.
const VALIDATED_REFERENCE_SHA256 = "5b905cb2b3ebc1ea31acb75de910176d5040a639df78aceb5dc18ed2fe3eed60"
const REFERENCE = path.resolve(process.cwd(), "docs/mantencion/referencias/seed-mantencion.json")

describe("db/seed/mantencion-seed.json (§13)", () => {
  it("es copia exacta de la referencia validada con la jefatura (desviación D13)", () => {
    expect(createHash("sha256").update(readFileSync(FILE)).digest("hex")).toBe(VALIDATED_REFERENCE_SHA256)
  })

  it.skipIf(!existsSync(REFERENCE))("coincide byte a byte con la referencia local, cuando está", () => {
    expect(readFileSync(FILE, "utf8")).toBe(readFileSync(REFERENCE, "utf8"))
  })

  it("trae lo que dice la especificación", () => {
    expect(data.faenas).toHaveLength(10)
    expect(data.tiposEquipo).toHaveLength(10)
    expect(data.talleresExternos).toHaveLength(10)
    expect(data.conductores).toHaveLength(27)
    expect(data.mecanicos).toHaveLength(7)
    expect(data.equipos).toHaveLength(120)
    expect(data.pautas).toHaveLength(2)
  })

  it("las dos pautas: intervalos y cantidad de ítems", () => {
    const camiones = data.pautas.find((p) => p.id === "p-camiones")!
    const maquinaria = data.pautas.find((p) => p.id === "p-maquinaria")!
    expect(camiones).toMatchObject({ nombre: "Camiones y tractos", unidad: "km", intervalos: [10_000, 20_000, 40_000, 80_000, 160_000] })
    expect(maquinaria).toMatchObject({ nombre: "Maquinaria pesada", unidad: "h", intervalos: [300, 600, 900, 1_200] })
    expect(camiones.grupos.flatMap((g) => g.items)).toHaveLength(53)
    expect(maquinaria.grupos.flatMap((g) => g.items)).toHaveLength(37)
  })

  it("§19-3: los 37 ítems de maquinaria aplican en los cuatro intervalos", () => {
    const maquinaria = data.pautas.find((p) => p.id === "p-maquinaria")!
    for (const item of maquinaria.grupos.flatMap((g) => g.items)) expect(item.aplicaPorIntervalo, item.clave).toEqual([1, 1, 1, 1])
  })

  it("cada equipo mide en la unidad de su tipo y de su pauta", () => {
    const unitByType = new Map(data.tiposEquipo.map((t) => [nameKey(t.nombre), t.unidad]))
    const unitBySchedule = new Map(data.pautas.map((p) => [p.id, p.unidad]))
    for (const e of data.equipos) {
      expect(e.unidad, e.codigo).toBe(unitByType.get(nameKey(e.tipo)))
      expect(e.unidad, e.codigo).toBe(unitBySchedule.get(e.pautaId))
    }
  })

  it("regla 16: todo equipo con patente distinta de su código la trae en un formato válido; los demás van como «Sin patente»", () => {
    const sinPatente = data.equipos.filter((e) => normalizeCode(e.patente) === normalizeCode(e.codigo))
    expect(sinPatente).toHaveLength(11)
    for (const e of data.equipos.filter((x) => !sinPatente.includes(x))) {
      const plate = normalizePlate(e.patente)
      expect(plate && isValidPlate(plate), `${e.codigo} · ${e.patente}`).toBe(true)
    }
    // Las cinco patentes que no calzan con ningún formato son códigos de equipo repetidos como patente.
    const invalid = data.equipos.filter((e) => { const p = normalizePlate(e.patente); return !p || !isValidPlate(p) })
    expect(invalid.map((e) => e.codigo).sort()).toEqual(["GR-08", "TO-23", "TO-27", "TO-34", "TO-37"])
    for (const e of invalid) expect(sinPatente).toContain(e)
  })

  it("los códigos y las patentes no se repiten", () => {
    expect(new Set(data.equipos.map((e) => normalizeCode(e.codigo))).size).toBe(120)
    expect(new Set(data.equipos.map((e) => normalizeCode(e.patente))).size).toBe(120)
  })

  it("cuatro faenas aparecen sólo en los equipos: la carga las crea con un folio derivado que no choca con los demás", () => {
    const listed = new Set(data.faenas.map((f) => nameKey(f.nombre)))
    const extra = [...new Set(data.equipos.map((e) => e.faena))].filter((name) => !listed.has(nameKey(name))).sort()
    expect(extra).toEqual(["Calymag", "Ecoservitran", "Fab. Puertas", "Panguipulli"])
    const taken = new Set(data.faenas.map((f) => f.codigoFolio))
    expect(taken.size).toBe(10)
    const derived = extra.map((name) => { const code = deriveFolioCode(name, taken); taken.add(code); return code })
    expect(derived).toEqual(["CAL", "ECO", "FAB", "PAN"])
  })

  it("los mecánicos trabajan en faenas de la lista", () => {
    const listed = new Set(data.faenas.map((f) => nameKey(f.nombre)))
    for (const m of data.mecanicos) expect(listed.has(nameKey(m.faena)), m.nombre).toBe(true)
  })
})

describe("§19-1 · actividades por confirmar", () => {
  it("el asterisco sale del nombre y queda la nota «Por confirmar»", () => {
    expect(cleanItemName("Regulación válvulas motor*")).toEqual({ name: "Regulación válvulas motor", note: "Por confirmar" })
    expect(cleanItemName("Cambio aceite dirección**")).toEqual({ name: "Cambio aceite dirección", note: "Por confirmar" })
    expect(cleanItemName("Inspección visual general")).toEqual({ name: "Inspección visual general", note: null })
  })

  it("sólo dos ítems del archivo llevan asterisco (km15 y km46)", () => {
    const marked = data.pautas.flatMap((p) => p.grupos.flatMap((g) => g.items)).filter((i) => i.nombre.includes("*")).map((i) => i.clave)
    expect(marked).toEqual(["km15", "km46"])
  })
})

/** Snapshot de la pauta de camiones con la marca como id, para ejercitar las reglas del archivo con `checklistFor`. */
function camionesSnapshot(): MantScheduleSnapshot {
  const pauta = data.pautas.find((p) => p.id === "p-camiones")!
  const marcas = pauta.reglasPorMarca!.marcas
  return {
    id: pauta.id, name: pauta.nombre, unit: pauta.unidad, version: 1, intervals: pauta.intervalos,
    groups: pauta.grupos.map((g) => ({
      name: g.nombre,
      items: g.items.map((i) => ({ key: i.clave, name: cleanItemName(i.nombre).name, applies: i.aplicaPorIntervalo.map((f) => f === 1) })),
    })),
    brandRules: pauta.reglasPorMarca!.filas.flatMap((fila) => fila.claveItem
      ? marcas.map((marca, col) => ({ itemKey: fila.claveItem!, brandId: marca, value: fila.valores[col] as "A" | "W" | "X" }))
      : []),
  }
}

describe("reglas por marca del archivo aplicadas con la regla 5", () => {
  const snapshot = camionesSnapshot()
  const keysFor = (interval: number, brand: string | null) => checklistFor(snapshot, interval, brand).map((i) => i.key)

  it("nueve actividades de planilla por siete marcas; «Diagnóstico electrónico motor» queda sin ítem (§19-2)", () => {
    const filas = data.pautas.find((p) => p.id === "p-camiones")!.reglasPorMarca!.filas
    expect(filas).toHaveLength(9)
    expect(filas.filter((f) => f.claveItem === null).map((f) => f.actividadPlanilla)).toEqual(["Diagnóstico electrónico motor"])
    expect(snapshot.brandRules).toHaveLength(8 * 7)
  })

  it("X oculta: «Cambio filtro caja automatizada» no aparece para Ford Cargo, Volkswagen ni Sinotruk a los 40.000 km", () => {
    for (const brand of ["Ford Cargo", "Volkswagen", "Sinotruk"]) expect(keysFor(40_000, brand), brand).not.toContain("km22")
    for (const brand of ["Scania", "Mercedes", "MAN", "Freightliner"]) expect(keysFor(40_000, brand), brand).toContain("km22")
  })

  it("W avisa: MAN muestra km22 con «Confirmar con pauta del fabricante» y Scania sin aviso", () => {
    const warn = (brand: string) => checklistFor(snapshot, 40_000, brand).find((i) => i.key === "km22")?.manufacturerWarning
    expect(warn("MAN")).toBe(true)
    expect(warn("Scania")).toBe(false)
  })

  it("el ítem que aplica sólo desde los 80.000 km (km46) no aparece antes, y después sale con aviso para Scania", () => {
    expect(keysFor(40_000, "Scania")).not.toContain("km46")
    expect(checklistFor(snapshot, 80_000, "Scania").find((i) => i.key === "km46")?.manufacturerWarning).toBe(true)
    expect(checklistFor(snapshot, 80_000, "Ford Cargo").find((i) => i.key === "km46")?.manufacturerWarning).toBe(false)
  })

  it("una marca fuera de la tabla (Volvo) recibe todos los ítems de la columna, sin ocultar ni avisar", () => {
    const pauta = data.pautas.find((p) => p.id === "p-camiones")!
    const esperados = pauta.grupos.flatMap((g) => g.items).filter((i) => i.aplicaPorIntervalo[2] === 1).map((i) => i.clave)
    const items = checklistFor(snapshot, 40_000, "Volvo")
    expect(items.map((i) => i.key)).toEqual(esperados)
    expect(items.every((i) => !i.manufacturerWarning)).toBe(true)
  })

  it("a los 10.000 km aplican sólo los ítems de la primera columna", () => {
    const pauta = data.pautas.find((p) => p.id === "p-camiones")!
    expect(keysFor(10_000, null)).toHaveLength(pauta.grupos.flatMap((g) => g.items).filter((i) => i.aplicaPorIntervalo[0] === 1).length)
  })

  it("regla 15 sobre la pauta real: un intervalo de 30.000 km hereda la columna de 10.000", () => {
    expect(inheritedIntervalFor(snapshot.intervals, 30_000)).toBe(10_000)
    expect(inheritedIntervalFor(snapshot.intervals, 60_000)).toBe(20_000)
  })
})

describe("parseMantSeedData rechaza un archivo inconsistente antes de escribir nada", () => {
  it("equipo con una pauta que no existe", () => {
    const bad = clone(); bad.equipos[0]!.pautaId = "p-fantasma"
    expect(() => parseMantSeedData(bad)).toThrow(/pauta p-fantasma no existe/)
  })

  it("equipo repetido", () => {
    const bad = clone(); bad.equipos[1]!.codigo = bad.equipos[0]!.codigo
    expect(() => parseMantSeedData(bad)).toThrow(/Equipo repetido/)
  })

  it("equipo con un tipo que no está en la lista de tipos", () => {
    const bad = clone(); bad.equipos[0]!.tipo = "Helicóptero"
    expect(() => parseMantSeedData(bad)).toThrow(/Helicóptero/)
  })

  it("ítem con distinto número de columnas que de intervalos", () => {
    const bad = clone(); bad.pautas[0]!.grupos[0]!.items[0]!.aplicaPorIntervalo = [1, 1]
    expect(() => parseMantSeedData(bad)).toThrow(/columnas/)
  })

  it("regla de marca con valores que no son A, W o X, o que apunta a un ítem inexistente", () => {
    const badValue = clone(); badValue.pautas[0]!.reglasPorMarca!.filas[0]!.valores = "AWAAAWZ"
    expect(() => parseMantSeedData(badValue)).toThrow(/valores inválidos/)
    const badKey = clone(); badKey.pautas[0]!.reglasPorMarca!.filas[0]!.claveItem = "km999"
    expect(() => parseMantSeedData(badKey)).toThrow(/km999/)
  })

  it("código de folio que no son tres letras mayúsculas", () => {
    const bad = clone(); bad.faenas[0]!.codigoFolio = "bio"
    expect(() => parseMantSeedData(bad)).toThrow()
  })

  it("parsea el archivo real sin cambios", () => {
    const parsed: MantSeedData = parseMantSeedData(raw())
    expect(parsed.equipos[0]).toMatchObject({ codigo: "KA-135", patente: "RBYD-98", faena: "Arauco", pautaId: "p-camiones" })
  })
})
