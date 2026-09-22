/**
 * lib/__tests__/training-occurrences-catalog-pdtp-schedule.test.ts
 *
 * `training-occurrences-catalog.ts` congela en TypeScript las semanas en que cada
 * curso/campaña de capacitación acredita una actividad del PDTP (una ocurrencia de
 * capacitación acredita la celda de SU casilla vía `plannedPeriod`). Esta prueba es
 * la otra mitad del contrato, simétrica a `program-slots-2026.test.ts` (que hace lo
 * mismo para simulacros/CGRD/alcotest): para cada ítem del catálogo cuyo
 * `pdtpActivityNumbers` no esté vacío, el conjunto de semanas de su `schedule` debe
 * coincidir exactamente — sin celdas de más ni de menos — con el `schedule` que
 * `db/seed/pdtp-catalog-2026.json` declara para esa actividad.
 *
 * Sin esta prueba, una futura reprogramación del PDTP que no actualice el catálogo
 * de capacitación deja la celda real del programa en cero aunque la capacitación se
 * haya hecho: la ocurrencia acredita la casilla que ella misma declara, así que si
 * esa casilla apunta a un mes distinto al que el programa realmente planifica, el
 * crédito nunca llega a la celda que el PDTP espera ver marcada.
 *
 * Nota sobre la N°85: tres códigos del catálogo (CAM-01/02/06) acreditan la misma
 * actividad PDTP N°85, repartiéndose sus 4 celdas semanales entre los tres (ver
 * decisión documentada en el informe de la Task 5). Por eso la comparación no es
 * "cada ítem == el schedule completo de su actividad", sino "la UNIÓN de los ítems
 * que declaran una misma actividad == el schedule completo de esa actividad": para
 * los otros 17 ítems, con mapeo 1:1, la unión de un solo elemento es exactamente el
 * caso por-ítem simple.
 */

import { describe, expect, it } from "vitest"
import catalog from "@/db/seed/pdtp-catalog-2026.json"
import { PREDEFINED_TRAINING_CATALOG } from "@/lib/prevention/training-occurrences-catalog"

type CatalogEntry = { n: number; schedule?: { month: number; week: number }[] }
type CatalogFile = { activities: CatalogEntry[] }

function pdtpSlotKeysFor(activityNumber: number): string[] {
  const entry = (catalog as CatalogFile).activities.find((item) => item.n === activityNumber)
  if (!entry) throw new Error(`El catálogo PDTP no declara la actividad N°${activityNumber}.`)
  return (entry.schedule ?? []).map((cell) => `m${String(cell.month).padStart(2, "0")}-w${cell.week}`)
}

function sorted(values: readonly string[]): string[] {
  return values.slice().sort()
}

describe("el cronograma del catálogo de capacitación coincide con la grilla del PDTP 2026", () => {
  const itemsWithPdtpActivities = PREDEFINED_TRAINING_CATALOG.filter(
    (item) => item.pdtpActivityNumbers.length > 0,
  )

  it("hay al menos un ítem del catálogo con actividades PDTP mapeadas (la prueba no queda vacía)", () => {
    expect(itemsWithPdtpActivities.length).toBeGreaterThan(0)
  })

  it("ningún ítem mapea a más de una actividad PDTP a la vez (supuesto que simplifica el resto de la prueba)", () => {
    for (const item of itemsWithPdtpActivities) {
      expect(item.pdtpActivityNumbers.length).toBe(1)
    }
  })

  // Agrupa los códigos del catálogo por la actividad PDTP que acreditan. Para
  // los 17 ítems con mapeo 1:1 esto es un grupo de un solo elemento; para la
  // N°85 (CAM-01/02/06) es un grupo de tres.
  const codesByActivityNumber = new Map<number, string[]>()
  for (const item of itemsWithPdtpActivities) {
    const activityNumber = item.pdtpActivityNumbers[0]!
    codesByActivityNumber.set(activityNumber, [...(codesByActivityNumber.get(activityNumber) ?? []), item.code])
  }

  it.each([...codesByActivityNumber.entries()])(
    "N°%s (%s): la unión de semanas del catálogo coincide exactamente con el schedule del PDTP",
    (activityNumber, codes) => {
      const catalogSlots = sorted(
        PREDEFINED_TRAINING_CATALOG
          .filter((item) => codes.includes(item.code))
          .flatMap((item) => item.schedule.map((slot) => slot.slotKey)),
      )
      const pdtpSlots = sorted(pdtpSlotKeysFor(activityNumber))

      expect(catalogSlots).toEqual(pdtpSlots)
    },
  )

  it("dentro de un grupo compartido (N°85), ninguna semana se repite entre los códigos", () => {
    for (const [activityNumber, codes] of codesByActivityNumber) {
      if (codes.length <= 1) continue
      const allSlots = PREDEFINED_TRAINING_CATALOG
        .filter((item) => codes.includes(item.code))
        .flatMap((item) => item.schedule.map((slot) => slot.slotKey))

      expect(new Set(allSlots).size, `actividad N°${activityNumber}`).toBe(allSlots.length)
    }
  })
})
