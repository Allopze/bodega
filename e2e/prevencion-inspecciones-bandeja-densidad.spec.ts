import { test, expect } from "@playwright/test"
import postgres from "postgres"
import { login, textoVisible } from "./helpers"

/**
 * La bandeja de inspecciones: lo que el usuario entiende en los primeros cinco
 * segundos.
 *
 * Dos cosas se certifican acá y no en los specs hermanos:
 *
 * 1. Una ejecución **cancelada** con fecha programada en el pasado no se marca
 *    "Vencida". La tabla de escritorio comparaba sólo la fecha y la pintaba en
 *    rojo mientras el KPI "Vencidas" —que excluye canceladas en SQL— la contaba
 *    en cero: la pantalla se contradecía a sí misma en la primera fila.
 * 2. La fila de KPI tiene cuatro tiles (regla A1) y los cuatro filtran esta
 *    misma lista. "Programaciones vencidas" navegaba a otra ruta con la misma
 *    apariencia de filtro; ahora es un aviso aparte.
 *
 * La fila `QA-INSP-CANCELADA` se crea y se borra acá: el seed compartido lo
 * leen decenas de specs y no se le agregan ejecuciones por una aserción.
 */

const RUN_ID = "qa-insp-cancelada-vencida"
// El código no contiene la palabra "cancelada" a propósito: `getByText` busca
// por subcadena y sin distinguir mayúsculas, así que un `QA-INSP-CANCELADA`
// hacía que la aserción sobre el badge de estado resolviera también el código
// de la fila y muriera por strict mode.
const RUN_CODE = "QA-INSP-9001"
const SCHEDULED_FOR = "2020-01-15"

function client() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error("Falta E2E_DATABASE_URL para sembrar la ejecución cancelada.")
  return postgres(url, { max: 1 })
}

test.beforeAll(async () => {
  const sql = client()
  try {
    await sql`
      insert into prevention_inspection_runs (
        id, code, template_id, worksite_id, subject_label, scheduled_for, status,
        cancelled_by_user_id, cancelled_at, cancellation_reason,
        created_by_user_id
      ) values (
        ${RUN_ID}, ${RUN_CODE}, 'insptpl-insp-e2e', 'ws-e2e', 'Extintor QA Cancelado',
        ${SCHEDULED_FOR}, 'cancelled',
        'user-admin-e2e', now(), 'La faena retiró el extintor antes de inspeccionarlo.',
        'user-admin-e2e'
      )
      on conflict (id) do nothing
    `
  } finally {
    await sql.end()
  }
})

test.afterAll(async () => {
  const sql = client()
  try {
    await sql`delete from prevention_inspection_runs where id = ${RUN_ID}`
  } finally {
    await sql.end()
  }
})

test.describe("Inspecciones — la bandeja se entiende de una lectura", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test("una cancelada con fecha pasada no se marca vencida", async ({ page }) => {
    await page.goto(`/prevencion/inspecciones?q=${RUN_CODE}`)
    const fila = page.getByRole("row").filter({ hasText: RUN_CODE })
    await expect(fila).toBeVisible({ timeout: 30_000 })
    await expect(fila.getByText("Cancelada", { exact: true })).toBeVisible()
    // `textoVisible` y no `.first()`: las tarjetas `md:hidden` siguen en el DOM
    // y `.first()` devolvería justamente el nodo oculto.
    await expect(textoVisible(page, /Vencida ·/)).toHaveCount(0)
    await expect(fila.getByText("Programada · 15-01-2020")).toBeVisible()
  })

  test("la fila de KPI tiene cuatro tiles y ninguno se va de la lista", async ({ page }) => {
    await page.goto("/prevencion/inspecciones")
    for (const label of ["Pendientes de revisión", "Con hallazgos abiertos", "Con hallazgo grave", "Vencidas"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible({ timeout: 30_000 })
    }
    await expect(page.getByText("Programaciones vencidas")).toHaveCount(0)
  })

  test("un tile en cero no es pulsable", async ({ page }) => {
    // Sin ejecuciones vencidas en el seed, "Vencidas" marca 0: un clic sólo
    // podía llevar a una lista vacía.
    await page.goto("/prevencion/inspecciones")
    const vencidas = page.getByRole("button", { name: /Vencidas/ }).first()
    await expect(vencidas).toBeVisible({ timeout: 30_000 })
    await expect(vencidas).toBeDisabled()
    await expect(textoVisible(page, "Ninguna fuera de plazo")).toBeVisible()
  })
})

/**
 * La cabecera lleva acciones; la navegación vive en el menú.
 *
 * "Seguimiento", "Plantillas" y "Programación" eran botones del encabezado y no
 * son acciones de la pantalla: son rutas hermanas. Plantillas y Programación ya
 * estaban en el menú lateral —duplicadas—, y Seguimiento sólo se alcanzaba por
 * ese botón, así que se sumó al menú al quitarlo de la cabecera.
 */
test.describe("Inspecciones — cabecera y navegación no se pisan", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones")
  })

  test("la cabecera conserva sólo las acciones de página", async ({ page }) => {
    // `getByRole("banner")` desde que la TopBar salió de `<main>` y recuperó el
    // rol de landmark. Antes este locator no resolvía nada en toda la
    // aplicación y había que acotar por `#main-content > header`.
    const cabecera = page.getByRole("banner")
    await expect(cabecera.getByRole("link", { name: "Exportar Excel" })).toBeVisible({ timeout: 30_000 })
    await expect(cabecera.getByRole("button", { name: "Nueva inspección" })).toBeVisible()
    for (const ruta of ["Plantillas", "Programación", "Seguimiento"]) {
      await expect(cabecera.getByRole("link", { name: ruta, exact: true })).toHaveCount(0)
    }
    await expect(cabecera.getByRole("button", { name: "Más acciones de inspecciones" })).toHaveCount(0)
  })

  test("el menú lateral lista las tres rutas hermanas y Seguimiento llega", async ({ page }) => {
    const menu = page.getByRole("navigation", { name: "Navegación" })
    for (const ruta of ["Seguimiento", "Plantillas", "Programación"]) {
      await expect(menu.getByRole("link", { name: ruta, exact: true })).toBeVisible({ timeout: 30_000 })
    }
    await menu.getByRole("link", { name: "Seguimiento", exact: true }).click()
    await expect(page).toHaveURL(/\/prevencion\/inspecciones\/seguimiento/, { timeout: 30_000 })
  })
})
