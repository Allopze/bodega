import { describe, expect, it } from "vitest"
import {
  countOf,
  formatCLP,
  formatDate,
  formatDateDisplay,
  formatDateSafe,
  formatDateTime,
  formatFileSize,
  formatQty,
  pluralize,
  pluralizeUnit,
  VALUE_MISSING,
} from "@/lib/utils"
import { addDays, localDateToISO, parseLocalDate, todayLocalISO } from "@/lib/sst/date"

/**
 * Snapshots de formato (TASK-UI-012).
 *
 * El criterio pide "snapshots de formatos" y "plural correcto". Existía el
 * contrato compartido —una sola función por tipo de dato— pero nada congelaba
 * su salida: cambiar una opción de `Intl` alteraba fecha, moneda o unidad en
 * toda la aplicación sin que fallara una sola prueba. Un formato es una decisión
 * de producto tanto como un color; esto la fija.
 *
 * Se congela la **salida literal**, no el comportamiento aproximado: el valor de
 * estas pruebas está justamente en que un cambio de separador o de orden
 * día/mes las rompa.
 */
describe("formato de fecha", () => {
  it("usa el orden chileno con guiones y cuatro dígitos de año", () => {
    expect(formatDate("2026-08-03T15:04:05.000Z")).toBe("03-08-2026")
    expect(formatDate("2026-01-09T12:00:00.000Z")).toBe("09-01-2026")
  })

  it("acompaña la hora en 24 h", () => {
    // Zona America/Santiago: la salida es hora local, no UTC.
    expect(formatDateTime("2026-08-03T15:04:05.000Z")).toMatch(/^03-08-2026 \d{2}:\d{2}$/)
  })

  it("muestra una fecha ISO sin desplazarla por zona horaria", () => {
    // `formatDateDisplay` recibe una fecha sin hora: interpretarla como UTC y
    // renderizarla en Santiago la retrasaba un día. Ese fue un defecto real.
    expect(formatDateDisplay("2026-08-03")).toBe("03-08-2026")
    expect(formatDateDisplay("2026-01-01")).toBe("01-01-2026")
  })

  it("dice que no hay dato en vez de imprimir Invalid Date", () => {
    expect(formatDateSafe(null)).toBe("—")
    expect(formatDateSafe(undefined)).toBe("—")
    expect(formatDateSafe("")).toBe("—")
  })
})

describe("formato de moneda y cantidad", () => {
  it("usa el peso chileno sin decimales y con punto de miles", () => {
    expect(formatCLP(1_234_567)).toBe("$1.234.567")
    expect(formatCLP(0)).toBe("$0")
    // El signo va delante del símbolo (decisión de producto, 2026-08-04):
    // `es-CL` produce "$-4.500" y se antepone a "-$4.500", que es como se lee
    // un negativo en un documento contable.
    expect(formatCLP(-4_500)).toBe("-$4.500")
    expect(formatCLP(-1_234_567)).toBe("-$1.234.567")
    // El cero negativo no debe imprimirse con signo.
    expect(formatCLP(-0)).toBe("$0")
  })

  it("separa miles en cantidades y concuerda la unidad", () => {
    expect(formatQty(1_500)).toBe("1.500")
    expect(formatQty(1, "unidad")).toBe("1 unidad")
    expect(formatQty(2, "unidad")).toBe("2 unidades")
  })

  it("escala el tamaño de archivo con separador decimal chileno", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(null)).toBe("—")
    expect(formatFileSize(2_048)).toBe("2 KB")
    expect(formatFileSize(1_572_864)).toBe("1,5 MB")
  })
})

describe("pluralización", () => {
  it("aplica las reglas del español sin tabla por sitio", () => {
    expect(pluralize(1, "pantalla")).toBe("pantalla")
    expect(pluralize(2, "pantalla")).toBe("pantallas")
    expect(pluralize(0, "pantalla")).toBe("pantallas")
    expect(pluralize(2, "submódulo")).toBe("submódulos")
    // consonante → +es, -z → -ces, -ión → -iones, irregulares conocidos
    expect(pluralize(2, "mes")).toBe("meses")
    expect(pluralize(2, "vez")).toBe("veces")
    expect(pluralize(3, "observación")).toBe("observaciones")
    expect(pluralize(2, "ítem")).toBe("ítems")
  })

  it("acepta una forma plural explícita para frases compuestas", () => {
    expect(pluralize(2, "ítem seleccionado", "ítems seleccionados")).toBe("ítems seleccionados")
  })

  it("concuerda la unidad de medida", () => {
    expect(pluralizeUnit(1, "unidad")).toBe("unidad")
    expect(pluralizeUnit(3, "unidad")).toBe("unidades")
  })

  // El defecto que motivó `countOf`: la frase quedaba correcta y sin la cifra.
  it("countOf trae la cifra junto al sustantivo", () => {
    expect(countOf(1, "pantalla")).toBe("1 pantalla")
    expect(countOf(3, "pantalla")).toBe("3 pantallas")
    expect(countOf(1_500, "registro")).toBe("1.500 registros")
    expect(countOf(0, "submódulo")).toBe("0 submódulos")
  })
})

describe("fechas SST y fechas de producto son el mismo calendario", () => {
  it("una fecha ISO local va y vuelve sin desplazarse", () => {
    const iso = "2026-08-03"
    expect(localDateToISO(parseLocalDate(iso))).toBe(iso)
  })

  it("sumar días cruza el fin de mes correctamente", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(addDays("2026-08-03", -3)).toBe("2026-07-31")
  })

  /*
   * Las dos fuentes de formato que el inventario señala como duplicadas
   * (`lib/utils.ts` y `lib/sst/date.ts`) tienen que coincidir. Hoy lo hacen;
   * esta prueba es lo que impide que dejen de hacerlo en silencio, que era el
   * riesgo real de tener dos fuentes para un contrato.
   */
  it("ambas fuentes coinciden en el día de hoy", () => {
    expect(formatDateDisplay(todayLocalISO())).toBe(formatDate(parseLocalDate(todayLocalISO())))
  })
})

/**
 * Estados de valor: ausente, desconocido, legacy y zona horaria (TASK-UI-012).
 *
 * La tarea los declaraba y nadie los había diseñado. Sondearlos destapó que
 * cada formateador improvisaba: uno lanzaba, otro inventaba una fecha de 1969 y
 * los numéricos escribían "NaN" en pantalla. Estas pruebas fijan el contrato
 * único, y son especialmente valiosas porque el caso que cubren —dato sucio en
 * producción— es el que nunca aparece en un entorno sembrado.
 */
describe("estados de valor", () => {
  it("un dato ausente se dice, no se inventa", () => {
    expect(formatDate(null as never)).toBe(VALUE_MISSING)
    expect(formatDateTime(undefined as never)).toBe(VALUE_MISSING)
    expect(formatDateSafe(null)).toBe(VALUE_MISSING)
    expect(formatFileSize(null)).toBe(VALUE_MISSING)
  })

  // Era "31-12-1969": la época presentada como una fecha real. Una mentira
  // verosímil es peor que un hueco, porque nadie la cuestiona.
  it("nunca renderiza la época como si fuera un dato", () => {
    expect(formatDate(null as never)).not.toContain("1969")
    expect(formatDateTime(null as never)).not.toContain("1969")
  })

  // Antes lanzaba `Invalid time value`, y en un Server Component un solo campo
  // sucio se lleva la página entera al `error.tsx`.
  it("un valor corrupto no tumba la pantalla", () => {
    expect(() => formatDate("no-es-fecha")).not.toThrow()
    expect(() => formatDateTime("2026-13-45T99:99")).not.toThrow()
    expect(formatDate("no-es-fecha")).toBe(VALUE_MISSING)
  })

  it("ningún formateador escribe NaN en pantalla", () => {
    for (const salida of [formatQty(NaN), formatCLP(NaN), formatFileSize(NaN), formatQty(Infinity), formatCLP(-Infinity)]) {
      expect(salida).toBe(VALUE_MISSING)
      expect(salida).not.toMatch(/NaN|Infinity/)
    }
  })

  /*
   * Zona horaria: la decisión es una sola —todo se muestra en hora de Chile
   * continental— y el riesgo real es el proceso corriendo en UTC, que durante
   * las últimas horas del día chileno devuelve el día equivocado.
   */
  it("una marca UTC de madrugada se muestra con el día chileno, no el UTC", () => {
    // 2026-08-05T02:00Z son las 22:00 del 4 de agosto en Chile continental.
    expect(formatDate("2026-08-05T02:00:00.000Z")).toBe("04-08-2026")
    expect(formatDateTime("2026-08-05T02:00:00.000Z")).toMatch(/^04-08-2026 2[0-3]:\d{2}$/)
  })
})
