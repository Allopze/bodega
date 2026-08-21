import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login } from "./helpers"

/**
 * E2E: plantillas (`/prevencion/inspecciones/plantillas`) y programación
 * (`/prevencion/inspecciones/programacion`) del motor de inspecciones.
 *
 * Hasta ahora las siete acciones de esta pantalla —incorporar, aprobar,
 * retirar, declarar acreditación PDTP, programar, editar/desactivar la
 * programación y materializarla— sólo estaban cubiertas por
 * `lib/__tests__/prevention-inspections-postgres.test.ts`, que llama al
 * servicio directamente. Ningún test tocaba el formulario que las invoca.
 *
 * Este archivo opera sobre **`inspeccion_contenedores`**, y no sobre la
 * plantilla `insptpl-insp-e2e` del fixture (`inspeccion_extintores`), porque
 * aprobar una versión reemplaza a la vigente **del mismo código**
 * (`supersedePreviousApproved`): compartir definición con los specs de
 * ejecución los dejaría sin instrumento aprobado si ambos archivos caen en
 * workers distintos a la vez.
 *
 * La etiqueta de versión lleva la marca de la corrida porque el índice
 * `prevention_inspection_template_version_unique` es (código, etiqueta), y con
 * `retries: 1` en CI un reintento volvería a incorporar la misma.
 */
const DEFINICION = "Inspección de Contenedores"
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

function filaPlantilla(page: Page, version: string) {
  return page.getByRole("row").filter({ hasText: DEFINICION }).filter({ hasText: version })
}

/** Abre el alta de programación, esté la pestaña vacía o con filas. */
async function nuevoPrograma(page: Page) {
  await page.getByRole("button", { name: "Nuevo programa" }).first().click()
}

/** Incorpora `inspeccion_contenedores` con una etiqueta propia; queda en borrador. */
async function incorporar(page: Page, version: string) {
  await page.getByRole("button", { name: "Publicar nueva versión" }).click()
  const dialog = page.getByRole("dialog", { name: "Publicar nueva versión" })
  await dialog.getByLabel("Definición del catálogo SST").click()
  await page.getByRole("option", { name: DEFINICION, exact: true }).click()
  await dialog.getByLabel("Tipo de instrumento").click()
  await page.getByRole("option", { name: "Inspección", exact: true }).click()
  await dialog.locator('input[name="versionLabel"]').fill(version)
  await dialog.getByRole("button", { name: "Incorporar" }).click()
  return dialog
}

test.describe("Inspecciones — catálogo de instrumentos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones/plantillas")
    await expectPageTitle(page, "Plantillas de inspección")
  })

  /**
   * `listImportableDefinitions` excluye dos familias por motivos distintos:
   * las evaluaciones de personas pertenecen al módulo de Evaluaciones, y el
   * Anexo 7 no tiene un solo ítem puntuable, así que en este motor no podría
   * calcular cumplimiento ni levantar un hallazgo. El servicio lo comprueba
   * además al recibir el código; acá se verifica que tampoco se ofrezcan.
   */
  test("el picker no ofrece evaluaciones de personas ni el Anexo 7", async ({ page }) => {
    await page.getByRole("button", { name: "Publicar nueva versión" }).click()
    const dialog = page.getByRole("dialog", { name: "Publicar nueva versión" })
    await dialog.getByLabel("Definición del catálogo SST").click()

    await expect(page.getByRole("option", { name: DEFINICION, exact: true })).toBeVisible()
    await expect(page.getByRole("option", { name: "Lista de Chequeo: Trabajador Nuevo" })).toHaveCount(0)
    await expect(page.getByRole("option", { name: "Lista de Chequeo: Control de Seguimiento" })).toHaveCount(0)
    await expect(page.getByRole("option", { name: "Observación Planeada" })).toHaveCount(0)
  })

  test("incorporar deja un borrador que no puede programarse hasta aprobarlo", async ({ page }) => {
    const version = `E2E-${RUN}-A`
    await incorporar(page, version)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    const fila = filaPlantilla(page, version)
    await expect(fila.getByText("Borrador")).toBeVisible({ timeout: 15_000 })

    // Programar exige una plantilla aprobada, y el picker sólo lista esas: el
    // borrador recién incorporado no debe aparecer todavía.
    await page.goto("/prevencion/inspecciones/programacion")
    // Sin programaciones el alta aparece dos veces —en la barra y como acción
    // del estado vacío—, así que el rótulo por sí solo no identifica un botón.
    await nuevoPrograma(page)
    let programa = page.getByRole("dialog", { name: "Nueva programación" })
    await programa.getByLabel("Plantilla").click()
    // Se espera a que el listado exista antes de negar: sin un ancla positiva,
    // `toHaveCount(0)` pasaría igual con el popover todavía sin montar.
    await expect(page.getByRole("option", { name: /Inspección de Estado de Extintores · E2E$/ })).toBeVisible()
    await expect(page.getByRole("option", { name: new RegExp(`${DEFINICION} · ${version}`) })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()

    await page.goto("/prevencion/inspecciones/plantillas")
    await fila.getByRole("button", { name: "Aprobar" }).click()
    const aprobar = page.getByRole("dialog")
    await aprobar.locator('textarea[name="reason"]').fill("Instrumento revisado y habilitado para la faena E2E.")
    await aprobar.getByRole("button", { name: "Aprobar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(fila.getByText("Aprobada")).toBeVisible({ timeout: 15_000 })
    await expect(fila.getByRole("button", { name: "Aprobar" })).toHaveCount(0)

    // Y ahora sí es programable.
    await page.goto("/prevencion/inspecciones/programacion")
    await nuevoPrograma(page)
    programa = page.getByRole("dialog", { name: "Nueva programación" })
    await programa.getByLabel("Plantilla").click()
    await expect(page.getByRole("option", { name: new RegExp(`${DEFINICION} · ${version}`) })).toBeVisible()
  })

  /**
   * C-10: sin el mensaje traducido el usuario veía el texto crudo de Postgres
   * ("duplicate key value violates unique constraint …") y el diálogo se
   * quedaba abierto sin explicar qué corregir.
   */
  test("repetir la etiqueta de versión se rechaza con un mensaje legible", async ({ page }) => {
    const version = `E2E-${RUN}-B`
    await incorporar(page, version)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    const dialog = await incorporar(page, version)
    await expect(dialog.getByRole("status")).toContainText(`Ya existe la versión "${version}"`, { timeout: 30_000 })
    await expect(dialog).toBeVisible()
  })

  /**
   * La plantilla nace cableada al programa anual: `defaultPdtpActivityNumbers`
   * toma el `n` que declara el sembrado (contenedores → n=29). Antes nacía sin
   * acreditar, `onInspectionCompleted` era un no-op y la inspección jamás
   * llegaba al PDTP — el estado de todas las plantillas hasta 2026-08-04.
   */
  test("la plantilla llega acreditando su actividad y la acreditación se puede corregir", async ({ page }) => {
    const version = `E2E-${RUN}-C`
    await incorporar(page, version)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    await page.reload()

    const fila = filaPlantilla(page, version)
    await expect(fila.getByText("N° 29")).toBeVisible({ timeout: 15_000 })

    await fila.getByRole("button", { name: "Acreditación PDTP" }).click()
    const dialog = page.getByRole("dialog")
    // Se normalizan a enteros ordenados y sin repetir, así que el desorden y
    // los separadores mezclados del enunciado son parte de lo que se prueba.
    await dialog.locator('input[name="numbers"]').fill("27, 24 24")
    await dialog.getByRole("button", { name: "Guardar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(fila.getByText("N° 24, 27")).toBeVisible({ timeout: 15_000 })
  })

  /**
   * Retirar borra la fila sólo si nunca se usó. La otra rama —conservarla como
   * reemplazada cuando tiene ejecuciones— la cubre
   * `prevention-inspections-postgres.test.ts`: llegar ahí por pantalla exigiría
   * ejecutar una inspección completa con este instrumento.
   */
  test("retirar un instrumento que nunca se usó lo borra del catálogo", async ({ page }) => {
    const version = `E2E-${RUN}-D`
    await incorporar(page, version)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    await page.reload()

    const fila = filaPlantilla(page, version)
    await expect(fila).toHaveCount(1, { timeout: 15_000 })

    await fila.getByRole("button", { name: "Retirar" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator('textarea[name="reason"]').fill("Instrumento incorporado por error durante la prueba E2E.")
    await dialog.getByRole("button", { name: "Retirar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(fila).toHaveCount(0, { timeout: 15_000 })
  })
})

test.describe("Inspecciones — programación por faena y frecuencia", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones/programacion")
    await expectPageTitle(page, "Programación de inspecciones")
  })

  /**
   * A-10/A-11/B-04 de la auditoría 2026-08-18, los tres en un solo recorrido
   * porque son el ciclo de vida de una misma programación: nace con un
   * intervalo propio (que el formulario no ofrecía), se edita y se desactiva
   * (que no se podía), y se materializa por el mismo camino que el cron.
   */
  test("crear, materializar, editar y desactivar una programación", async ({ page }, testInfo) => {
    const sujeto = `Extintores pañol ${RUN}`
    // El intervalo identifica la fila, y un reintento en CI deja viva la
    // programación del intento anterior: sin variarlo, el localizador
    // resolvería a dos filas idénticas y el test moriría por modo estricto.
    const intervalo = String(15 + testInfo.retry)
    // "Primera fecha" viene pre-llenada con hoy en la zona de operación, que es
    // contra la que calcula el servidor (`todayInChile`).
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" })
    const paso = Number(intervalo)
    /** `nextDueAfter` es aritmética de días sobre la fecha vencida, sin husos. */
    const enDias = (dias: number) => {
      const fecha = new Date(`${hoy}T12:00:00Z`)
      fecha.setUTCDate(fecha.getUTCDate() + dias)
      return fecha.toISOString().slice(0, 10)
    }

    await nuevoPrograma(page)
    const dialog = page.getByRole("dialog", { name: "Nueva programación" })
    await dialog.getByLabel("Plantilla").click()
    await page.getByRole("option", { name: /Inspección de Estado de Extintores · E2E$/ }).click()
    await dialog.getByLabel("Faena del programa").click()
    await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
    await dialog.getByLabel("Frecuencia").click()
    await page.getByRole("option", { name: "Mensual", exact: true }).click()
    // A-10: el Zod y el CHECK siempre aceptaron `intervalDays`; el formulario
    // no lo ofrecía, así que la frecuencia mandaba sola.
    await dialog.locator('input[name="intervalDays"]').fill(intervalo)
    await dialog.locator('input[name="subjectType"]').fill(sujeto)
    // "Primera fecha" viene pre-llenada con hoy al abrir el diálogo.
    await dialog.getByRole("button", { name: "Programar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    // La fila no lleva el tipo de sujeto, así que se ancla por plantilla y se
    // distingue por el intervalo propio que sólo esta programación declara.
    const fila = page.getByRole("row")
      .filter({ hasText: "Inspección de Estado de Extintores" })
      .filter({ hasText: `cada ${intervalo} día(s)` })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })
    await expect(fila.getByText("Mensual")).toBeVisible()
    await expect(fila.getByText("Sin asignar")).toBeVisible()

    // B-04: "Ejecutar ahora" materializa por `materializeProgramRuns`, el mismo
    // camino del cron diario. Con `programId` explícito el materializador **no
    // exige vencimiento** —es una ejecución bajo demanda—, así que cada clic
    // crea la del período vigente y corre `nextDueOn` un intervalo. Que la
    // fecha avance es la prueba de que se materializó: el índice único
    // (programId, scheduledFor) sólo se defendería de un choque con el cron.
    await expect(fila.getByRole("cell", { name: hoy })).toBeVisible()

    await fila.getByRole("button", { name: "Ejecutar ahora" }).click()
    await expect(fila.getByRole("cell", { name: enDias(paso) })).toBeVisible({ timeout: 15_000 })

    await fila.getByRole("button", { name: "Ejecutar ahora" }).click()
    await expect(fila.getByRole("cell", { name: enDias(paso * 2) })).toBeVisible({ timeout: 15_000 })

    await fila.getByRole("button", { name: "Editar" }).click()
    const editar = page.getByRole("dialog", { name: "Editar programación" })
    await editar.getByLabel("Frecuencia").click()
    await page.getByRole("option", { name: "Semanal", exact: true }).click()
    await editar.getByLabel("Asignada a").click()
    await page.getByRole("option", { name: "Admin E2E", exact: true }).click()
    await editar.locator('input[name="intervalDays"]').fill(intervalo)
    await editar.getByRole("button", { name: "Guardar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await expect(fila.getByText("Semanal")).toBeVisible({ timeout: 15_000 })
    await expect(fila.getByText("Admin E2E")).toBeVisible()

    // Desactivar es el borrado: los runs ya materializados conservan su origen.
    await fila.getByRole("button", { name: "Desactivar" }).click()
    await expect(fila.getByRole("cell", { name: "No", exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(fila.getByRole("button", { name: "Activar" })).toBeVisible()
    await expect(fila.getByRole("button", { name: "Ejecutar ahora" })).toHaveCount(0)
  })
})
