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
 * los otros ítems, con mapeo 1:1, la unión de un solo elemento es exactamente el
 * caso por-ítem simple.
 *
 * Nota sobre la N°38 (Task 16, 2026-09-23): a diferencia de la N°85, sus 5
 * códigos (CAP-22..26) NO se reparten las semanas — cada uno declara el
 * cronograma COMPLETO de la actividad (decisión explícita del usuario, ver el
 * comentario junto a CAP-22 en `training-occurrences-catalog.ts`). La unión
 * "cruda" de sus slots tiene entonces 5 copias de cada semana en vez de una,
 * así que la comparación contra el schedule del PDTP deduplica primero para
 * este grupo — ver `REPLICATED_ACTIVITY_NUMBERS` más abajo.
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

/**
 * Actividades cuyo grupo compartido modela "N ítems idénticos" en vez de "N
 * ítems que se reparten las semanas". Hoy sólo la N°38 (Task 16): sus 5
 * códigos declaran el mismo cronograma completo a propósito.
 */
const REPLICATED_ACTIVITY_NUMBERS = new Set([38])

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
      const rawCatalogSlots = PREDEFINED_TRAINING_CATALOG
        .filter((item) => codes.includes(item.code))
        .flatMap((item) => item.schedule.map((slot) => slot.slotKey))
      // N°38 (Task 16): los 5 códigos repiten el mismo cronograma completo a
      // propósito, así que la unión cruda trae 5 copias de cada semana —
      // deduplicar antes de comparar contra el schedule (único) del PDTP.
      const catalogSlots = sorted(
        REPLICATED_ACTIVITY_NUMBERS.has(activityNumber) ? Array.from(new Set(rawCatalogSlots)) : rawCatalogSlots,
      )
      const pdtpSlots = sorted(pdtpSlotKeysFor(activityNumber))

      /*
       * Task 8 (2026-09-22): las N°16 y 57 son `on_demand` en el PDTP — el
       * cronograma maestro no les declara ninguna celda de mes/semana
       * (`schedule: []`), así que `pdtpSlots` queda vacío para ambas. El
       * catálogo, sin embargo, NO puede espejar ese vacío con un
       * `schedule()` igualmente vacío: `occurrenceSeedRows` no generaría
       * ninguna fila y el ítem quedaría sin ninguna ocurrencia que un
       * operador pueda marcar hecha ni que `occurrence-gap-connector.ts`
       * pueda vencer — es decir, sin instrumento vivo, que es exactamente el
       * defecto que la Task 8 corrige. Por eso usan el centinela `annual`
       * (la misma representación que ya usa CAP-01 para "sin cronograma
       * específico, una vez al año"), y la comparación exacta no aplica: se
       * verifica en cambio que el PDTP de verdad no declara celdas para
       * ellas y que el catálogo de verdad usa el centinela.
       */
      if (pdtpSlots.length === 0) {
        expect(catalogSlots).toEqual(["annual"])
        return
      }

      expect(catalogSlots).toEqual(pdtpSlots)
    },
  )

  it("dentro de un grupo compartido por reparto (N°85), ninguna semana se repite entre los códigos", () => {
    for (const [activityNumber, codes] of codesByActivityNumber) {
      if (codes.length <= 1 || REPLICATED_ACTIVITY_NUMBERS.has(activityNumber)) continue
      const allSlots = PREDEFINED_TRAINING_CATALOG
        .filter((item) => codes.includes(item.code))
        .flatMap((item) => item.schedule.map((slot) => slot.slotKey))

      expect(new Set(allSlots).size, `actividad N°${activityNumber}`).toBe(allSlots.length)
    }
  })

  /*
   * Task 16 (2026-09-23): el contrato opuesto al de arriba. La N°38 no
   * reparte semanas entre sus 5 códigos: cada uno declara el cronograma
   * COMPLETO (48 celdas) porque las 5 charlas deben ocurrir en la MISMA
   * celda, no en celdas distintas. Si un futuro cambio dejara a alguno de
   * los 5 con menos semanas que las otras, el catálogo dejaría de
   * representar "5 charlas todas las semanas" sin que ningún otro test lo
   * detectara — la prueba de arriba no lo cubre porque excluye a propósito
   * los grupos de `REPLICATED_ACTIVITY_NUMBERS`.
   */
  it("dentro de un grupo compartido por réplica (N°38), los códigos declaran el mismo cronograma completo", () => {
    let checkedAtLeastOneGroup = false
    for (const [activityNumber, codes] of codesByActivityNumber) {
      if (!REPLICATED_ACTIVITY_NUMBERS.has(activityNumber)) continue
      checkedAtLeastOneGroup = true
      expect(codes.length, `actividad N°${activityNumber}`).toBeGreaterThan(1)

      const schedules = PREDEFINED_TRAINING_CATALOG
        .filter((item) => codes.includes(item.code))
        .map((item) => sorted(item.schedule.map((slot) => slot.slotKey)))

      for (const s of schedules) {
        expect(s).toEqual(schedules[0])
      }
    }
    expect(checkedAtLeastOneGroup).toBe(true)
  })
})
