import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildSequentialSkuMap } from "./normalize-epp-skus-logic"

describe("normalizador de SKUs", () => {
  it("salta SKUs conservados por productos fuera del conjunto activo", () => {
    const rows = Array.from({ length: 74 }, (_, index) => ({
      id: `active-${index + 1}`,
      name: `Producto ${String(index + 1).padStart(3, "0")}`,
      prefix: "EPP" as const,
      oldSku: `legacy-${index + 1}`,
    }))

    const assignments = buildSequentialSkuMap({
      rows,
      existingProducts: [
        { id: "inactive-072", sku: "EPP-072" },
        { id: "inactive-073", sku: "EPP-073" },
      ],
    })

    expect(assignments.find((row) => row.id === "active-72")?.newSku).toBe("EPP-074")
    expect(assignments.find((row) => row.id === "active-73")?.newSku).toBe("EPP-075")
    expect(assignments.map((row) => row.newSku)).not.toContain("EPP-072")
    expect(assignments.map((row) => row.newSku)).not.toContain("EPP-073")
    expect(new Set(assignments.map((row) => row.newSku)).size).toBe(assignments.length)
  })

  it("conserva el SKU canónico que un producto ya tiene, aunque rompa el orden alfabético", () => {
    // Antes esto devolvía ["EPP-001", "EPP-002"]: la secuencia seguía al nombre
    // y los dos productos intercambiaban código. El SKU es lo que quedó impreso
    // en las guías, así que ahora manda el código, no el alfabeto.
    const assignments = buildSequentialSkuMap({
      rows: [
        { id: "active-a", name: "A", prefix: "EPP", oldSku: "EPP-002" },
        { id: "active-b", name: "B", prefix: "EPP", oldSku: "EPP-001" },
      ],
      existingProducts: [
        { id: "active-a", sku: "EPP-002" },
        { id: "active-b", sku: "EPP-001" },
      ],
    })

    expect(assignments.map((row) => row.newSku)).toEqual(["EPP-002", "EPP-001"])
  })

  it("reparte el menor correlativo libre entre los productos sin SKU canónico", () => {
    const assignments = buildSequentialSkuMap({
      rows: [
        { id: "nuevo-1", name: "Antiparra nueva", prefix: "EPP", oldSku: "EPP-A1B2C3" },
        { id: "viejo", name: "Botín conocido", prefix: "EPP", oldSku: "EPP-002" },
        { id: "nuevo-2", name: "Casco nuevo", prefix: "EPP", oldSku: "EPP-Z9Y8X7" },
      ],
      existingProducts: [{ id: "inactivo", sku: "EPP-003" }],
    })

    // `EPP-002` está anclado y `EPP-003` reservado por un inactivo: los nuevos
    // toman 001 y 004.
    expect(assignments.map((row) => [row.id, row.newSku])).toEqual([
      ["nuevo-1", "EPP-001"],
      ["viejo", "EPP-002"],
      ["nuevo-2", "EPP-004"],
    ])
  })

  it("no ancla un producto reclasificado a otro prefijo", () => {
    const assignments = buildSequentialSkuMap({
      rows: [
        { id: "servicio", name: "Bordado espalda", prefix: "SRV", oldSku: "EPP-006" },
        { id: "epp", name: "Casco", prefix: "EPP", oldSku: "EPP-010" },
      ],
      existingProducts: [],
    })

    // El código EPP-006 dejó de describirlo, así que entra a la secuencia SRV.
    expect(assignments.map((row) => [row.id, row.newSku])).toEqual([
      ["servicio", "SRV-001"],
      ["epp", "EPP-010"],
    ])
  })

  it("es idempotente: renumerar el resultado no vuelve a mover ningún SKU", () => {
    // Cuatro productos con el mismo nombre —varias tallas del mismo botín— en
    // el orden determinista que entrega la consulta (`ORDER BY p.name, p.id`).
    // En producción la consulta no desempataba y estos cuatro se permutaban
    // entre sí en cada deploy, reescribiendo el código que guías y trazabilidad
    // muestran sobre documentos ya emitidos.
    const rows = [
      { id: "prod-a", name: "Botín V-Flex V73 Microfiber", prefix: "EPP" as const, oldSku: "EPP-025" },
      { id: "prod-b", name: "Botín V-Flex V73 Microfiber", prefix: "EPP" as const, oldSku: "EPP-026" },
      { id: "prod-c", name: "Botín V-Flex V73 Microfiber", prefix: "EPP" as const, oldSku: "EPP-023" },
      { id: "prod-d", name: "Botín V-Flex V73 Microfiber", prefix: "EPP" as const, oldSku: "EPP-024" },
    ]
    const existingProducts = rows.map((row) => ({ id: row.id, sku: row.oldSku }))

    const first = buildSequentialSkuMap({ rows, existingProducts })
    expect(first.filter((row) => row.oldSku !== row.newSku)).toEqual([])

    // Segunda corrida sobre el estado que dejó la primera: tampoco mueve nada,
    // y con el orden de entrada alterado —lo que hacía el plan de ejecución sin
    // desempate— el resultado es el mismo.
    const second = buildSequentialSkuMap({
      rows: [...first].reverse().map((row) => ({ ...row, oldSku: row.newSku })),
      existingProducts: first.map((row) => ({ id: row.id, sku: row.newSku })),
    })

    expect(second.filter((row) => row.oldSku !== row.newSku)).toEqual([])
    expect(new Map(second.map((row) => [row.id, row.newSku]))).toEqual(
      new Map(first.map((row) => [row.id, row.newSku])),
    )
  })

  // El anclaje hace que el orden ya no mueva a los productos que tienen código,
  // pero sigue decidiendo qué correlativo recibe cada producto nuevo. Eso vive
  // en el SQL, fuera del alcance de la función pura.
  it("la consulta del script desempata el orden con un criterio estable", () => {
    const source = readFileSync(join(__dirname, "normalize-epp-skus.ts"), "utf-8")
    const orderings = source.match(/^\s*ORDER BY p\..+$/gm) ?? []

    expect(orderings).toHaveLength(2)
    for (const ordering of orderings) {
      expect(ordering.trim()).toBe("ORDER BY p.name, p.id")
    }
  })
})
