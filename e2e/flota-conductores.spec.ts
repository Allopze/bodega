import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login, textoVisible } from "./helpers"

/**
 * `/flota/conductores`: licencias de conducir por faena.
 *
 * Los cuatro trabajadores salen de `e2e/setup-db.ts` (bloque «Conductores
 * (licencias)»), todos en «Faena E2E» y con un cargo que exige A4 o A5:
 *
 * - QA Conductor Vencida: licencia vencida hace 20 días.
 * - QA Conductor PorVencer: vence en 10 días.
 * - QA Conductor Vigente: vence en 400 días.
 * - QA Conductor SinLicencia: el cargo la exige y no tiene ninguna.
 *
 * El orden importa: el primer test lee los datos tal como se sembraron y los
 * siguientes los modifican (renuevan, registran, quitan). Cada uno toca a una
 * persona distinta para no pisarse.
 *
 * Los textos de la lista se buscan con `textoVisible` y los controles por rol:
 * la lista se dibuja dos veces (tabla y tarjetas móviles) y una de las dos
 * siempre está oculta.
 */

const NOMBRES = {
  vencida: "QA Conductor Vencida",
  porVencer: "QA Conductor PorVencer",
  vigente: "QA Conductor Vigente",
  sinLicencia: "QA Conductor SinLicencia",
} as const

type Segmento = "Requieren atención" | "Vigentes" | "Todos"

/** El segmento por su rótulo, sin atarse al número: «Requieren atención · 3». */
const segmento = (page: Page, nombre: Segmento) =>
  page.getByRole("button", { name: new RegExp(`^${nombre} · \\d+$`) })

const contador = async (page: Page, nombre: Segmento) =>
  Number((await segmento(page, nombre).textContent())?.match(/(\d+)$/)?.[1])

const hojaDeLicencia = (page: Page) => page.getByRole("dialog", { name: "Licencia de conducir" })

/** La fila de la tabla (en escritorio); las tarjetas móviles no son `row`. */
const filaDe = (page: Page, nombre: string) => page.getByRole("row", { name: new RegExp(nombre) })

test.describe("Flota — Conductores", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("los segmentos traen su contador y viajan en la URL", async ({ page }) => {
    await page.goto("/flota/conductores")
    await expectPageTitle(page, "Conductores")

    // Hay una licencia vencida, una por vencer y alguien sin licencia: abre en «Requieren atención».
    await expect(segmento(page, "Requieren atención")).toHaveAttribute("aria-pressed", "true")
    await expect(textoVisible(page, NOMBRES.vencida)).toBeVisible()
    await expect(textoVisible(page, NOMBRES.porVencer)).toBeVisible()
    await expect(textoVisible(page, NOMBRES.sinLicencia)).toBeVisible()
    await expect(textoVisible(page, NOMBRES.vigente)).toHaveCount(0)

    await segmento(page, "Vigentes").click()
    await expect(page).toHaveURL(/estado=vigentes/)
    await expect(segmento(page, "Vigentes")).toHaveAttribute("aria-pressed", "true")
    await expect(textoVisible(page, NOMBRES.vigente)).toBeVisible()
    await expect(textoVisible(page, NOMBRES.vencida)).toHaveCount(0)

    await segmento(page, "Todos").click()
    await expect(page).toHaveURL(/estado=todos/)
    for (const nombre of Object.values(NOMBRES)) await expect(textoVisible(page, nombre)).toBeVisible()

    // Las dos vistas parten el conjunto: lo que cuenta «Todos» es lo que suman las otras dos.
    expect(await contador(page, "Todos")).toBe(
      (await contador(page, "Requieren atención")) + (await contador(page, "Vigentes")),
    )

    // Cada estado dice qué le pasa a la persona con palabras, no sólo con color. Se busca la pastilla
    // por su texto exacto: el nombre de la fila también contiene «Vencida» y «Vigente».
    await expect(filaDe(page, NOMBRES.vencida).getByText("Vencida", { exact: true })).toBeVisible()
    await expect(filaDe(page, NOMBRES.porVencer).getByText("Por vencer", { exact: true })).toBeVisible()
    await expect(filaDe(page, NOMBRES.vigente).getByText("Vigente", { exact: true })).toBeVisible()
    await expect(filaDe(page, NOMBRES.sinLicencia).getByText("Sin licencia", { exact: true })).toBeVisible()
    await expect(filaDe(page, NOMBRES.sinLicencia)).toContainText("su cargo exige A4 o A5")
    // La licencia vencida lleva su observación bajo el estado.
    await expect(filaDe(page, NOMBRES.vencida)).toContainText("Prórroga por 6 meses")
  })

  test("el filtro de faena viaja en la URL y se quita con su chip", async ({ page }) => {
    await page.goto("/flota/conductores?estado=todos")

    await page.getByRole("combobox", { name: "Faena", exact: true }).click()
    await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
    await expect(page).toHaveURL(/faena=ws-e2e/)
    await expect(textoVisible(page, NOMBRES.vencida)).toBeVisible()

    await page.getByRole("button", { name: "Eliminar filtro Faena", exact: true }).click()
    await expect(page).not.toHaveURL(/faena=/)
    await expect(page.getByRole("button", { name: "Eliminar filtro Faena", exact: true })).toHaveCount(0)
  })

  test("elegir clases y fecha y guardar renueva una licencia vencida", async ({ page }) => {
    await page.goto("/flota/conductores?estado=todos")
    await page.getByRole("button", { name: `Actualizar licencia de ${NOMBRES.vencida}` }).click()

    const hoja = hojaDeLicencia(page)
    await expect(hoja).toBeVisible()
    await expect(hoja.getByText(NOMBRES.vencida)).toBeVisible()

    // La licencia vencida trae A4 y A5; se le suma la B (si una corrida anterior ya la dejó marcada, no se toca).
    const clases = hoja.getByRole("group", { name: "Clases", exact: true })
    await expect(clases.getByRole("button", { name: /^A4\b/ })).toHaveAttribute("aria-pressed", "true")
    const claseB = clases.getByRole("button", { name: /^B\b/ })
    if ((await claseB.getAttribute("aria-pressed")) !== "true") await claseB.click()
    await expect(claseB).toHaveAttribute("aria-pressed", "true")

    // La vista previa dice cómo quedará antes de guardar.
    await hoja.getByRole("button", { name: "En 4 años", exact: true }).click()
    await expect(hoja.getByText("Vigente", { exact: true })).toBeVisible()

    await hoja.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(hoja).toBeHidden()
    await expect(page.getByText(`Licencia de ${NOMBRES.vencida} guardada`)).toBeVisible()

    // La fila cambia en su lugar: vigente, con las tres clases.
    const fila = filaDe(page, NOMBRES.vencida)
    await expect(fila.getByText("Vigente", { exact: true })).toBeVisible()
    await expect(fila.getByRole("listitem")).toHaveCount(3)
  })

  test("«Registrar licencia» busca entre quienes no tienen y abre el mismo formulario", async ({ page }) => {
    await page.goto("/flota/conductores?estado=todos")
    await page.getByRole("button", { name: "Registrar licencia", exact: true }).click()

    const hoja = hojaDeLicencia(page)
    await expect(hoja).toBeVisible()
    await hoja.getByRole("combobox", { name: "Trabajador" }).fill("SinLicencia")
    await page.getByRole("option", { name: new RegExp(NOMBRES.sinLicencia) }).click()

    // Elegida la persona aparece su cargo y lo que éste exige.
    await expect(hoja.getByText("Conductor de camión E2E")).toBeVisible()
    await expect(hoja.getByText(/Su cargo exige A4 o A5/)).toBeVisible()

    await hoja.getByRole("group", { name: "Clases", exact: true }).getByRole("button", { name: /^A5\b/ }).click()
    await hoja.getByRole("button", { name: "En 4 años", exact: true }).click()
    await hoja.getByRole("button", { name: "Guardar", exact: true }).click()
    await expect(hoja).toBeHidden()

    const fila = filaDe(page, NOMBRES.sinLicencia)
    await expect(fila.getByText("Vigente", { exact: true })).toBeVisible()
    // Ya tiene licencia: la acción de la fila pasa de «Registrar» a «Actualizar».
    await expect(fila.getByRole("button", { name: `Actualizar licencia de ${NOMBRES.sinLicencia}` })).toBeVisible()
  })

  test("?editar= abre la hoja de esa persona y se limpia al cerrarla", async ({ page }) => {
    await page.goto("/flota/conductores?editar=worker-lic-porvencer-e2e")

    const hoja = hojaDeLicencia(page)
    await expect(hoja).toBeVisible()
    await expect(hoja.getByText(NOMBRES.porVencer)).toBeVisible()

    await hoja.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(hoja).toBeHidden()
    await expect(page).not.toHaveURL(/editar=/)
  })

  test("quitar la licencia pide confirmación y deja a la persona sin licencia", async ({ page }) => {
    await page.goto("/flota/conductores?editar=worker-lic-vigente-e2e")

    const hoja = hojaDeLicencia(page)
    await expect(hoja).toBeVisible()
    const quitar = hoja.getByRole("button", { name: "Quitar licencia", exact: true })
    await quitar.click()

    // Cancelar no quita nada.
    const confirmar = page.getByRole("dialog", { name: "Quitar licencia" })
    await expect(confirmar).toBeVisible()
    await confirmar.getByRole("button", { name: "Cancelar", exact: true }).click()
    await expect(confirmar).toBeHidden()
    await expect(hoja).toBeVisible()

    await quitar.click()
    await confirmar.getByRole("button", { name: "Quitar licencia", exact: true }).click()
    await expect(page.getByText(`Licencia de ${NOMBRES.vigente} quitada`)).toBeVisible()
    await expect(hoja).toBeHidden()

    // Su cargo la exige: pasa a «Sin licencia», que es de «Requieren atención».
    const fila = filaDe(page, NOMBRES.vigente)
    await expect(fila.getByText("Sin licencia", { exact: true })).toBeVisible()
    await expect(fila).toContainText("su cargo exige A4 o A5")
  })

  test("avisa cuántos trabajadores no tienen cargo y lleva a asignarlo", async ({ page }) => {
    await page.goto("/flota/conductores")

    // Los trabajadores del sembrado E2E no tienen cargo: sin cargo no se sabe si conducen.
    await expect(textoVisible(page, /trabajadores? de tus faenas no tienen? cargo/)).toBeVisible()
    await expect(page.getByRole("link", { name: "Asignar cargos", exact: true })).toHaveAttribute(
      "href",
      "/admin/trabajadores?vista=sin-cargo",
    )
  })

  test.describe("en el teléfono", () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test("cada persona es una tarjeta con su estado y una acción de 44 px", async ({ page }) => {
      await page.goto("/flota/conductores?estado=todos")

      await expect(textoVisible(page, NOMBRES.vencida)).toBeVisible()
      const accion = page.getByRole("button", { name: `Actualizar licencia de ${NOMBRES.vencida}` })
      await expect(accion).toBeVisible()
      const caja = await accion.boundingBox()
      expect(caja?.height ?? 0).toBeGreaterThanOrEqual(44)

      // El segmento y el botón de registrar también alcanzan los 44 px.
      for (const objetivo of [segmento(page, "Todos"), page.getByRole("button", { name: "Registrar licencia", exact: true })]) {
        const medida = await objetivo.boundingBox()
        expect(medida?.height ?? 0).toBeGreaterThanOrEqual(44)
      }
    })
  })
})
