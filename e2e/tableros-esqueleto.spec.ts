import { test, expect, type Page } from "@playwright/test"
import { login } from "./helpers"

/**
 * E2E: los tres tableros de Control operacional comparten un esqueleto (crítica UI/UX
 * 2026-11-15). Antes cada uno ponía el período, la faena y la exportación en otro lugar y con
 * otro valor por defecto: Mantención y GPS en el cuerpo y en «últimos 6 meses», Combustible el
 * período en la cabecera, la faena entre los pasos y los gráficos, y «Tu faena: …» en la TopBar
 * al lado de «Todas las faenas».
 *
 * Fija: en la cabecera (`banner`) van, en este orden, la faena (si quien mira ve más de una), el
 * período y —con el permiso de exportar del módulo— «Exportar Excel» del tablero; los tres abren
 * en el mes en curso; y el chip «Tu faena» no convive con el selector.
 *
 * Locators: el `PageHeader` deja una copia de sus acciones para móvil (`lg:hidden`); `getByRole`
 * ignora la oculta, así que buscar dentro de `banner` no tropieza con ella.
 */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

function mesEnCurso(): string {
  // El mes de Chile: la prueba corre en el mismo huso que el servidor de E2E.
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).format(new Date()).split("-")
  return `${MESES[Number(month) - 1]} ${year}`
}

const TABLEROS = [
  { ruta: "/mantencion/panel", exporta: true },
  { ruta: "/combustibles", exporta: true },
  // Con `flota:export` (decisión 2026-11-15) el tablero GPS también exporta sus tablas.
  { ruta: "/flota/indicadores", exporta: true },
] as const

async function cabecera(page: Page) {
  const banner = page.getByRole("banner")
  await expect(banner.getByRole("group", { name: "Período", exact: true })).toBeVisible()
  return banner
}

test.describe("Esqueleto común de los tableros", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  for (const { ruta, exporta } of TABLEROS) {
    test(`${ruta}: faena, período y exportación en la cabecera, en el mes en curso`, async ({ page }) => {
      await page.goto(ruta)
      const banner = await cabecera(page)
      const periodo = banner.getByRole("group", { name: "Período", exact: true })

      // Abre en el mes en curso, igual en los tres.
      await expect(periodo).toContainText(mesEnCurso())

      // La faena, si se ofrece, va antes del período; y entonces no hay un «Tu faena» al lado.
      const faena = banner.getByRole("combobox", { name: "Faena del tablero" })
      if (await faena.count()) {
        const [faenaX, periodoX] = await Promise.all([faena.boundingBox(), periodo.boundingBox()])
        expect(faenaX!.x).toBeLessThan(periodoX!.x)
        await expect(banner.getByText(/^Tu faena:/)).toHaveCount(0)
      }

      // Ninguna fila de filtros en el cuerpo duplica la faena.
      await expect(page.getByRole("main").getByRole("combobox", { name: /faena/i })).toHaveCount(0)

      const exportar = banner.getByRole("button", { name: /^Exportar Excel/ })
      if (exporta) {
        await expect(exportar).toBeVisible()
        const [periodoX, exportarX] = await Promise.all([periodo.boundingBox(), exportar.boundingBox()])
        expect(exportarX!.x).toBeGreaterThan(periodoX!.x)
      } else {
        await expect(exportar).toHaveCount(0)
      }
    })
  }
})
