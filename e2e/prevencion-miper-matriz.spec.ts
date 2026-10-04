import { test, expect, type Locator, type Page } from "@playwright/test"
import { expectPageTitle, listRecord, login } from "./helpers"

/**
 * E2E: portada de la MIPER por faena (Fase B, spec §7) y el mapa de riesgos.
 *
 * Cubre:
 *   • La portada lista TODAS las faenas del alcance, con y sin MIPER, sin las
 *     pestañas ni el filtro «Responsable» de antes.
 *   • Cada cifra de la franja lleva exactamente a su subconjunto (A1), y
 *     «Riesgos críticos sin control» dice lo mismo que el KPI del tablero.
 *   • «Crear MIPER» desde una faena sin MIPER: el diálogo llega con la faena.
 *   • El mapa de riesgos (CGRD) responde.
 *
 * Corre como admin (alcance global, los cuatro permisos MIPER). Las cifras se
 * comparan con lo que se ve al llegar en el MISMO momento, no con números
 * fijos: en CI la base es compartida dentro del shard y otras pruebas MIPER
 * crean o sellan matrices.
 */
const PORTADA = "/prevencion/miper"
/** Filas de la tabla (escritorio). `tr[data-worksite-id]` no cuenta la fila del estado vacío. */
const filas = (page: Page) => page.locator("tbody tr[data-worksite-id]")
const cifra = (page: Page, rotulo: string) => page.getByRole("link", { name: new RegExp(`^${rotulo}`) })

async function valorDe(link: Locator, rotulo: string): Promise<number> {
  const texto = (await link.textContent()) ?? ""
  const valor = texto.slice(rotulo.length).match(/\d+/)
  expect(valor, `«${rotulo}» sin cifra: ${texto}`).not.toBeNull()
  return Number(valor![0])
}

/**
 * Sigue una cifra de la franja hasta su subconjunto y devuelve su valor. Deja
 * la página en el destino.
 *
 * - Con valor mayor que cero, la cifra es un enlace: se lee, se sigue y la
 *   lista muestra su subconjunto.
 * - En cero no enlaza (A1: no lleva a una lista vacía). Se comprueba que la
 *   franja la muestra en 0 y que su destino, abierto a mano, está vacío.
 *
 * `cuenta` dice qué suma la cifra:
 * - `faenas` (por defecto): una por fila, así que llegan exactamente esas filas.
 * - `riesgos`: «Riesgos críticos sin control» suma riesgos de todas las filas
 *   (`portfolioSummary.critical`), y una faena puede tener varios. Llegan entre 1
 *   y `valor` faenas. La suma exacta por fila la comprueba quien llama.
 *
 * Cuál de las dos ramas corre depende de la base. Recién sembrada, «En
 * revisión» y «Riesgos críticos sin control» están en cero; en CI, las demás
 * pruebas MIPER del shard pueden dejarlas en más.
 */
async function seguirCifra(page: Page, rotulo: string, destino: string, { cuenta = "faenas" }: { cuenta?: "faenas" | "riesgos" } = {}): Promise<number> {
  await page.goto(PORTADA)
  // La portada se pinta en el servidor: con la tabla a la vista, la franja ya está completa.
  await expect(page.getByRole("table", { name: "MIPER por faena" })).toBeVisible()
  const link = cifra(page, rotulo)
  if (await link.count() === 0) {
    await expect(page.getByRole("main")).toContainText(new RegExp(`${rotulo}\\s*0(?!\\d)`))
    await page.goto(`${PORTADA}?${destino}`)
    await expect(filas(page)).toHaveCount(0)
    return 0
  }
  const esperado = await valorDe(link, rotulo)
  expect(esperado, `«${rotulo}» en cero no debería enlazar`).toBeGreaterThan(0)
  await link.click()
  await expect(page).toHaveURL(new RegExp(`\\?${destino}$`))
  if (cuenta === "faenas") {
    await expect(filas(page)).toHaveCount(esperado)
  } else {
    await expect.poll(() => filas(page).count(), { message: `«${rotulo}» llega a alguna faena` }).toBeGreaterThanOrEqual(1)
    await expect.poll(() => filas(page).count(), { message: `«${rotulo}» no llega a más faenas que riesgos` }).toBeLessThanOrEqual(esperado)
  }
  return esperado
}

test.describe("Prevención — portada MIPER por faena", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("lista todas las faenas del alcance, con y sin MIPER, sin pestañas ni filtro «Responsable»", async ({ page }) => {
    await page.goto(PORTADA)
    await expect(page).toHaveURL(/\/prevencion\/miper/)
    await expectPageTitle(page, "Matriz de riesgos")
    await expect(page.getByRole("table", { name: "MIPER por faena" })).toBeVisible()
    // Una faena con MIPER: su nombre enlaza a ella.
    await expect(listRecord(page, "Faena E2E").getByRole("link", { name: "Faena E2E", exact: true })).toBeVisible()
    // Una faena activa sin MIPER también viene, con su acción de creación.
    await expect(listRecord(page, "Faena Sin CPHS E2E")).toContainText("Sin MIPER")
    await expect(listRecord(page, "Faena Sin CPHS E2E").getByRole("button", { name: "Crear matriz", exact: true })).toBeVisible()
    // Lo retirado no vuelve.
    await expect(page.getByRole("tab", { name: "Por hacer" })).toHaveCount(0)
    await expect(page.getByRole("combobox", { name: "Responsable" })).toHaveCount(0)
  })

  test("cada cifra de la franja lleva exactamente a su subconjunto", async ({ page }) => {
    for (const { rotulo, destino } of [
      { rotulo: "Faenas con MIPER", destino: "estado=con_miper" },
      { rotulo: "En revisión", destino: "estado=en_revision" },
      { rotulo: "Requieren mi acción", destino: "vista=mias" },
    ]) {
      await seguirCifra(page, rotulo, destino)
    }

    // «Riesgos críticos sin control» suma riesgos: llega a las faenas que los tienen y la suma por fila coincide.
    const total = await seguirCifra(page, "Riesgos críticos sin control", "sincontrol=1", { cuenta: "riesgos" })
    // El chip sale del mismo render que filtra la lista: visible el chip, las filas ya son las acotadas.
    await expect(page.getByRole("button", { name: "Eliminar filtro Riesgos críticos", exact: true })).toBeVisible()
    const porFila = await filas(page).evaluateAll((rows) => rows.map((row) => Number(row.textContent?.match(/(\d+) críticos? sin control/)?.[1] ?? 0)))
    expect(porFila.every((n) => n > 0)).toBe(true)
    expect(porFila.reduce((suma, n) => suma + n, 0)).toBe(total)

    // Y es la misma cifra que el KPI del tablero: una sola definición.
    await page.goto("/dashboard?vista=prevencion")
    const kpi = page.locator("[data-kpi-card]").filter({ hasText: "Riesgos críticos sin control" })
    await expect(kpi).toBeVisible()
    expect(Number(((await kpi.textContent()) ?? "").match(/Riesgos críticos sin control\s*(\d+)/)?.[1])).toBe(total)
  })

  test("Crear matriz desde una faena sin MIPER", async ({ page }) => {
    await page.goto(PORTADA)
    await expect(listRecord(page, "Oficina Central E2E")).toContainText("Sin MIPER")
    await listRecord(page, "Oficina Central E2E").getByRole("button", { name: "Crear matriz", exact: true }).click()
    await page.getByRole("dialog", { name: "Crear matriz de riesgos" }).getByRole("button", { name: /^Completar en la plataforma/ }).click()
    const dialog = page.getByRole("dialog", { name: "Nueva MIPER" })
    // La faena llega elegida desde la fila.
    await expect(dialog.getByRole("combobox")).toContainText("Oficina Central E2E")
    await dialog.getByLabel("Período").fill("2041")
    await dialog.getByRole("radio", { name: "Matriz vacía" }).check()
    await dialog.getByLabel("Motivo").fill("Elaboración inicial de la faena, creada desde su fila en la portada.")
    await dialog.getByRole("button", { name: "Crear borrador" }).click()
    // Abre con la «Ficha del documento», igual que «Nueva MIPER».
    await expect(page).toHaveURL(/\/prevencion\/miper\/riskmatrix-[^?]+\?ficha=1/)
    await expect(page.getByRole("dialog", { name: "Ficha del documento" })).toBeVisible()

    await page.goto(PORTADA)
    await expect(listRecord(page, "Oficina Central E2E")).toContainText("Borrador")
    await expect(listRecord(page, "Oficina Central E2E").getByRole("button", { name: "Crear matriz", exact: true })).toHaveCount(0)
  })
})

// El mapa se trasladó a CGRD el 2026-09-22. El flujo completo del plano y sus
// marcadores vive en prevencion-cgrd-risk-map.spec.ts; acá sólo queda que la
// pantalla responde y se titula como corresponde.
test.describe("Prevención — mapa de riesgos", () => {
  test("navegación al mapa de riesgos interactivo", async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/cgrd/mapa")
    await expect(page).toHaveURL(/\/prevencion\/cgrd\/mapa/)
    await expectPageTitle(page, /Mapa de riesgos|Peligros y riesgos/i)
  })
})
