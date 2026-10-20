import { test, expect, type Locator, type Page } from "@playwright/test"
import { PLANTILLA_INSPECCION, expectPageTitle, login } from "./helpers"

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
/**
 * El recorrido "borrador → aprobada → programable" necesita una definición
 * **sin anexo oficial**: `approveInspectionTemplate` exige a las que sí lo
 * tienen (`OFFICIAL_INSPECTION_SOURCES`) una versión documental vinculada cuyo
 * checksum coincida con el del binario SGI, y la Biblioteca SST del entorno E2E
 * no tiene ese archivo. `inspeccion_area` nace `platform_definition`, así que
 * se aprueba por pantalla sin paridad documental. La contracara —que un anexo
 * oficial se niegue a aprobarse sin fuente— la cubre su propio test más abajo.
 */
const DEFINICION_LIBRE = "Inspección de área de trabajo"
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

/**
 * La fila de una versión. Se ancla por la etiqueta de versión y no por el
 * nombre: el catálogo tiene una fila por instrumento, y un borrador que convive
 * con una versión aprobada es una SUBFILA («Nueva versión en borrador») que no
 * repite el nombre. La etiqueta lleva la marca de la corrida, así que es única.
 */
function filaPlantilla(page: Page, version: string) {
  return page.getByRole("row").filter({ hasText: version })
}

/**
 * Una acción de la fila que no es su siguiente paso vive en «Más acciones de …».
 * El menú no es modal (abre diálogos), así que se abre con un clic y se elige el ítem.
 */
async function elegirAccion(page: Page, fila: Locator, accion: string | RegExp) {
  await fila.getByRole("button", { name: /^Más acciones de/ }).click()
  await page.getByRole("menuitem", { name: accion }).click()
}

/** Abre el alta de programación, esté la pestaña vacía o con filas. */
async function nuevoPrograma(page: Page) {
  await page.getByRole("button", { name: "Nuevo programa" }).first().click()
}

/**
 * I-01 (auditoría UI/UX 2026-08-25): cada materialización avanza `nextDueOn`
 * un intervalo completo, así que a partir del segundo clic el programa queda
 * fuera de ciclo y el botón abre un `ConfirmDialog` en vez de navegar directo.
 * El primer clic sobre una vencida sigue sin pedir confirmación.
 */
async function crearYAbrirInspeccion(page: Page, fila: Locator) {
  await fila.getByRole("button", { name: "Crear y abrir inspección" }).click()
  const confirmacion = page.getByRole("dialog", { name: "Esta programación aún no vence" })
  if (await confirmacion.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmacion.getByRole("button", { name: "Crear igual y mover la fecha" }).click()
  }
  await expect(page).toHaveURL(/\/prevencion\/inspecciones\/[^/]+$/)
}

/** Incorpora la definición indicada con una etiqueta propia; queda en borrador. */
async function incorporar(page: Page, version: string, definicion: string = DEFINICION) {
  await page.getByRole("button", { name: "Incorporar borrador" }).click()
  const dialog = page.getByRole("dialog", { name: "Incorporar nueva versión como borrador" })
  await dialog.getByLabel("Definición del catálogo SST").click()
  await page.getByRole("option", { name: definicion, exact: true }).click()
  await dialog.getByLabel("Tipo de instrumento").click()
  await page.getByRole("option", { name: "Inspección", exact: true }).click()
  await dialog.locator('input[name="versionLabel"]').fill(version)
  await dialog.getByRole("button", { name: "Incorporar como borrador" }).click()
  return dialog
}

test.describe("Inspecciones — catálogo de instrumentos", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto("/prevencion/inspecciones/plantillas")
    await expectPageTitle(page, "Plantillas de inspección")
  })

  /**
   * P1-12: antes se aprobaba y se declaraba la paridad sin poder leer una sola
   * pregunta. El nombre del instrumento abre su cuestionario en una hoja de solo
   * lectura, con el acta y el detalle técnico (hashes, planilla) plegado.
   */
  test("el nombre del instrumento abre su cuestionario, y el detalle técnico viene plegado", async ({ page }) => {
    await page.getByRole("button", { name: "Inspección de Estado de Extintores", exact: true }).first().click()
    const hoja = page.getByRole("dialog", { name: "Inspección de Estado de Extintores" })
    await expect(hoja.getByText("Cierre de inspección del extintor")).toBeVisible({ timeout: 15_000 })
    await expect(hoja.getByText("Prevencionista · Supervisor")).toBeVisible()
    const tecnico = hoja.locator("details").filter({ hasText: "Detalle técnico" })
    await expect(tecnico).not.toHaveAttribute("open", "")
    await hoja.getByRole("button", { name: "Cerrar" }).click()
    await expect(hoja).toHaveCount(0)
  })

  /**
   * `listImportableDefinitions` excluye dos familias por motivos distintos:
   * las evaluaciones de personas pertenecen al módulo de Evaluaciones, y el
   * Anexo 7 no tiene un solo ítem puntuable, así que en este motor no podría
   * calcular cumplimiento ni levantar un hallazgo. El servicio lo comprueba
   * además al recibir el código; acá se verifica que tampoco se ofrezcan.
   */
  test("el picker no ofrece evaluaciones de personas", async ({ page }) => {
    await page.getByRole("button", { name: "Incorporar borrador" }).click()
    const dialog = page.getByRole("dialog", { name: "Incorporar nueva versión como borrador" })
    await dialog.getByLabel("Definición del catálogo SST").click()

    await expect(page.getByRole("option", { name: DEFINICION, exact: true })).toBeVisible()
    await expect(page.getByRole("option", { name: "Lista de Chequeo: Trabajador Nuevo" })).toHaveCount(0)
    await expect(page.getByRole("option", { name: "Lista de Chequeo: Control de Seguimiento" })).toHaveCount(0)
    // El Anexo 7 sí se ofrece: desde que se digitalizó con `recordsPreventiveActions`
    // aporta al motor —registra acciones preventivas— aunque no puntúe.
    await expect(page.getByRole("option", { name: "Observación Planeada" })).toHaveCount(1)
  })

  test("incorporar deja un borrador que no puede programarse hasta aprobarlo", async ({ page }) => {
    const version = `E2E-${RUN}-A`
    await incorporar(page, version, DEFINICION_LIBRE)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    const fila = filaPlantilla(page, version)
    // `exact`: la subfila de un borrador que convive con una versión aprobada
    // dice además «Nueva versión en borrador».
    await expect(fila.getByText("Borrador", { exact: true })).toBeVisible({ timeout: 15_000 })

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
    await expect(page.getByRole("option", { name: new RegExp(`${DEFINICION_LIBRE} · ${version}`) })).toHaveCount(0)
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
    await expect(fila.getByText("Aprobada", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(fila.getByRole("button", { name: "Aprobar" })).toHaveCount(0)

    // Y ahora sí es programable.
    await page.goto("/prevencion/inspecciones/programacion")
    await nuevoPrograma(page)
    programa = page.getByRole("dialog", { name: "Nueva programación" })
    await programa.getByLabel("Plantilla").click()
    await expect(page.getByRole("option", { name: new RegExp(`${DEFINICION_LIBRE} · ${version}`) })).toBeVisible()
  })

  /**
   * La contracara del test anterior. Los anexos del SGI
   * (`OFFICIAL_INSPECTION_SOURCES`) nacen `provenanceKind: "official_document"`
   * y `approveInspectionTemplate` les exige una versión de la Biblioteca SST
   * vinculada, con paridad declarada y el checksum del binario original.
   *
   * La pantalla ya no ofrece «Aprobar» ni «Declarar paridad» cuando el servidor
   * los va a rechazar (patrón I-04): dice qué falta y ofrece «Vincular fuente».
   * Antes el botón estaba, el diálogo se llenaba, y sólo al confirmar aparecía
   * «no puede aprobarse sin una versión oficial vinculada».
   */
  test("un anexo oficial incompleto no ofrece Aprobar: dice que falta vincular la planilla", async ({ page }) => {
    const version = `E2E-${RUN}-E`
    await incorporar(page, version)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await page.reload()
    const fila = filaPlantilla(page, version)
    await expect(fila.getByText("Borrador", { exact: true })).toBeVisible({ timeout: 15_000 })

    await expect(fila.getByText("Falta vincular la planilla oficial.")).toBeVisible()
    await expect(fila.getByRole("button", { name: "Aprobar" })).toHaveCount(0)
    await expect(fila.getByRole("button", { name: "Declarar paridad" })).toHaveCount(0)
    // Lo que sí se puede hacer: vincular la planilla, que es el siguiente paso de la fila.
    await expect(fila.getByRole("button", { name: "Vincular fuente" })).toBeVisible()
  })

  /**
   * El diálogo de incorporar dice la verdad sobre la fuente: es obligatoria
   * para un anexo oficial, y si la Biblioteca SST no tiene el archivo con el
   * checksum del anexo lo avisa en vez de pedir lo imposible. La Biblioteca del
   * entorno E2E no tiene ese archivo, así que acá se ve el aviso.
   */
  test("incorporar un anexo oficial avisa que la planilla es obligatoria y que la Biblioteca no la tiene", async ({ page }) => {
    await page.getByRole("button", { name: "Incorporar borrador" }).click()
    const dialog = page.getByRole("dialog", { name: "Incorporar nueva versión como borrador" })
    await dialog.getByLabel("Definición del catálogo SST").click()
    await page.getByRole("option", { name: DEFINICION, exact: true }).click()

    await expect(dialog.getByText("Obligatoria: este instrumento transcribe un anexo oficial.")).toBeVisible()
    await expect(dialog.getByText(/No hay en la Biblioteca SST una versión vigente con el checksum del anexo oficial/)).toBeVisible()
    await expect(dialog.getByText(/alguien con permiso de aprobación —puedes ser tú—/)).toBeVisible()
    // Sin el archivo no hay con qué cumplirla: el borrador se puede incorporar y la planilla se vincula después.
    await expect(dialog.getByRole("button", { name: "Incorporar como borrador" })).toBeEnabled()
    await dialog.getByRole("button", { name: "Cancelar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
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

    // El rechazo es un aviso del propio diálogo (`role="alert"`), que sigue abierto.
    const dialog = await incorporar(page, version)
    await expect(dialog.getByRole("alert")).toContainText(`Ya existe la versión "${version}"`, { timeout: 30_000 })
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
    // La celda es corta a propósito («N° 29»); el nombre de la actividad va en su tooltip.
    await expect(fila.getByText("N° 29")).toBeVisible({ timeout: 15_000 })

    /* Corregir la acreditación ya no es marcar números del programa anual: desde
     * la centralización del catálogo corporativo el diálogo cablea IDENTIDADES
     * (`pdtp_accreditation_bindings`), y los números quedan como snapshot
     * histórico —por eso la celda de la fila sigue diciendo N° 29 después de
     * guardar: `setInspectionTemplatePdtpActivities` los conserva a propósito—.
     * Lo que se verifica acá es el cableado nuevo, releído desde la base.
     *
     * Los dos selectores son popovers de `PdtpActivityPicker`, con el mismo
     * rótulo accesible en su disparador ("N actividades seleccionadas"): el
     * primero es "Al declarar ejecutada" y el segundo "Al revisar y cerrar". */
    await elegirAccion(page, fila, "Acreditación PDTP")
    const dialog = page.getByRole("dialog")
    // El fixture E2E no da identidad de catálogo a las actividades del programa:
    // la plantilla acredita por número y el diálogo lo dice, y avisa que ese
    // número no tiene equivalente. Sin cambios todavía, «Guardar» no se ofrece.
    await expect(dialog.getByText(/Hoy acredita por número de actividad \(N° 29\)/)).toBeVisible()
    await expect(dialog.getByText(/N° 29 no tiene actividad en el catálogo corporativo/)).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Guardar" })).toBeDisabled()
    const ejecucion = dialog.getByRole("button", { name: /actividades? seleccionadas?/ }).first()
    await ejecucion.click()
    await page.getByRole("option", { name: /Inspección de contenedores E2E/ }).click()
    await page.getByRole("option", { name: /Orden y aseo de la faena E2E/ }).click()
    await page.keyboard.press("Escape")
    await expect(ejecucion).toHaveText(/2 actividades seleccionadas/)
    await dialog.getByRole("button", { name: "Guardar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    // Releer desde la base: el diálogo abre con las dos identidades cableadas.
    await page.reload()
    await elegirAccion(page, fila, "Acreditación PDTP")
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /actividades? seleccionadas?/ }).first(),
    ).toHaveText(/2 actividades seleccionadas/, { timeout: 15_000 })
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

    // «Retirar…» es la acción destructiva: va aparte, al pie del menú «Más acciones de …».
    await elegirAccion(page, fila, "Retirar…")
    const dialog = page.getByRole("dialog")
    await dialog.locator('textarea[name="reason"]').fill("Instrumento incorporado por error durante la prueba E2E.")
    // El botón que confirma el acto destructivo se llama como el acto.
    await dialog.getByRole("button", { name: "Retirar plantilla" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    // El mensaje de resultado («Plantilla eliminada: …») es un toast de 4 s: se afirma
    // el efecto persistido, que es lo que no caduca.

    await page.reload()
    await expect(fila).toHaveCount(0, { timeout: 15_000 })
  })

  /**
   * La tabla es UNA fila por instrumento, no una por versión: la que está en uso es la fila y
   * lo reemplazado o retirado sólo se lee en el historial de la vista previa. Un instrumento con
   * varias versiones ocupaba varias filas con el mismo nombre y la vigente se perdía entre ellas.
   */
  test("hay una sola fila por instrumento y las versiones viejas no se listan", async ({ page }) => {
    const nombre = page.getByRole("button", { name: PLANTILLA_INSPECCION, exact: true })
    await expect(nombre).toHaveCount(1, { timeout: 15_000 })
    const fila = page.getByRole("row").filter({ has: nombre })
    await expect(fila).toHaveCount(1)
    await expect(fila.getByText("Aprobada", { exact: true })).toBeVisible()
    // La vigente no cuelga ninguna subfila.
    await expect(fila.getByText("Nueva versión en borrador")).toHaveCount(0)
    // «Reemplazadas o retiradas» es una opción del filtro de estado, no filas mezcladas con las vigentes.
    await page.getByRole("combobox", { name: "Filtrar plantillas por estado" }).click()
    await expect(page.getByRole("option", { name: "Reemplazadas o retiradas", exact: true })).toBeVisible()
  })

  /**
   * Un borrador nuevo de un instrumento que ya tiene una versión aprobada no es otro instrumento:
   * es «la nueva versión», y se pinta como subfila de la principal (que no repite el nombre).
   */
  test("un borrador nuevo de un instrumento vigente cuelga como subfila «Nueva versión en borrador»", async ({ page }) => {
    const vigente = `E2E-${RUN}-F`
    const nueva = `E2E-${RUN}-G`
    await incorporar(page, vigente, DEFINICION_LIBRE)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    await page.reload()
    await filaPlantilla(page, vigente).getByRole("button", { name: "Aprobar" }).click()
    const aprobar = page.getByRole("dialog")
    await aprobar.locator('textarea[name="reason"]').fill("Instrumento revisado y habilitado para la faena E2E.")
    await aprobar.getByRole("button", { name: "Aprobar" }).click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

    await incorporar(page, nueva, DEFINICION_LIBRE)
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
    await page.reload()

    const subfila = filaPlantilla(page, nueva)
    await expect(subfila).toHaveCount(1, { timeout: 15_000 })
    await expect(subfila.getByText("Nueva versión en borrador")).toBeVisible()
    await expect(subfila.getByText("Borrador", { exact: true })).toBeVisible()
    // La principal es la aprobada, y es la única que lleva el nombre del instrumento.
    const principal = filaPlantilla(page, vigente)
    await expect(principal).toHaveCount(1)
    await expect(principal.getByText("Aprobada", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Inspección de área de trabajo", exact: true })).toHaveCount(1)
  })

  /**
   * «Ver cuestionario» está en «Más acciones de …»: el menú no es modal (abre una hoja o un
   * diálogo) y la hoja muestra las secciones del instrumento, que es lo que se decide al aprobar.
   * Escape la cierra y devuelve el foco al disparador.
   */
  test("«Más acciones» → «Ver cuestionario» abre la hoja con las secciones y Escape la cierra", async ({ page }) => {
    const fila = page.getByRole("row").filter({ has: page.getByRole("button", { name: PLANTILLA_INSPECCION, exact: true }) })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })
    const disparador = fila.getByRole("button", { name: `Más acciones de ${PLANTILLA_INSPECCION}`, exact: true })
    await elegirAccion(page, fila, "Ver cuestionario")

    const hoja = page.getByRole("dialog", { name: PLANTILLA_INSPECCION })
    for (const seccion of ["1. Inventario del extintor", "2. Estado del extintor", "3. Observaciones generales"]) {
      await expect(hoja.getByRole("heading", { name: seccion })).toBeVisible({ timeout: 15_000 })
    }
    await expect(hoja.getByText("Manómetro: aguja en zona verde.")).toBeVisible()
    await expect(hoja.getByText("Cierre de inspección del extintor")).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(hoja).toHaveCount(0)
    await expect(disparador).toBeFocused()
  })

  /**
   * «Retirar…» es la acción destructiva y va aparte, al pie del menú. Abre su diálogo con la
   * consecuencia dicha y un motivo obligatorio; acá sólo se cancela (retirar la plantilla de
   * extintores la dejaría sin instrumento a los demás specs).
   */
  test("«Retirar…» abre su diálogo destructivo con la consecuencia y «Cancelar» no retira nada", async ({ page }) => {
    const fila = page.getByRole("row").filter({ has: page.getByRole("button", { name: PLANTILLA_INSPECCION, exact: true }) })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })

    await elegirAccion(page, fila, "Retirar…")
    const dialog = page.getByRole("dialog", { name: `Retirar ${PLANTILLA_INSPECCION}` })
    await expect(dialog.getByText(/Deja de poder programarse y ejecutarse/)).toBeVisible()
    await expect(dialog.locator('textarea[name="reason"]')).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Retirar plantilla" })).toBeVisible()

    await dialog.getByRole("button", { name: "Cancelar" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(fila).toHaveCount(1)
    await expect(fila.getByText("Aprobada", { exact: true })).toBeVisible()
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
    // I-17: la columna "Próxima" se renderiza con `formatDate` (dd-mm-yyyy,
    // es-CL), no como la cadena ISO cruda — la celda hay que buscarla en ese formato.
    const comoCelda = (iso: string) => iso.split("-").reverse().join("-")

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
    let fila = page.getByRole("row")
      .filter({ hasText: "Inspección de Estado de Extintores" })
      .filter({ hasText: `cada ${intervalo} días` })
    await expect(fila).toHaveCount(1, { timeout: 15_000 })
    await expect(fila.getByText("Mensual")).toBeVisible()
    await expect(fila.getByText("Sin asignar")).toBeVisible()

    // B-04: "Ejecutar ahora" materializa por `materializeProgramRuns`, el mismo
    // camino del cron diario. Con `programId` explícito el materializador **no
    // exige vencimiento** —es una ejecución bajo demanda—, así que cada clic
    // crea la del período vigente y corre `nextDueOn` un intervalo. Que la
    // fecha avance es la prueba de que se materializó: el índice único
    // (programId, scheduledFor) sólo se defendería de un choque con el cron.
    await expect(fila.getByRole("cell", { name: comoCelda(hoy) })).toBeVisible()

    // Este primer clic regulariza el ciclo vigente (nextDueOn == hoy, no pide
    // confirmación); de acá en adelante cada clic cae fuera de ciclo y el
    // helper confirma el diálogo de I-01 antes de navegar.
    /**
     * Se recarga dentro del poll, no se espera sobre el DOM ya pintado.
     *
     * En dos de cuatro corridas completas la tabla salió con la fecha vencida
     * mientras `prevention_inspection_programs.next_due_on` ya tenía la nueva
     * —comprobado por consulta directa—, así que lo que llegó tarde fue el
     * render, no la escritura. Un `toBeVisible` sobre la página ya cargada
     * consume sus quince segundos sin volver a pedirla nunca.
     */
    async function esperarProxima(iso: string) {
      await expect.poll(async () => {
        await page.goto("/prevencion/inspecciones/programacion")
        return page.getByRole("row")
          .filter({ hasText: "Inspección de Estado de Extintores" })
          .filter({ hasText: `cada ${intervalo} días` })
          .getByRole("cell", { name: comoCelda(iso) })
          .count()
      }, { timeout: 30_000 }).toBeGreaterThan(0)
      return page.getByRole("row")
        .filter({ hasText: "Inspección de Estado de Extintores" })
        .filter({ hasText: `cada ${intervalo} días` })
    }

    await crearYAbrirInspeccion(page, fila)
    fila = await esperarProxima(enDias(paso))

    await crearYAbrirInspeccion(page, fila)
    fila = await esperarProxima(enDias(paso * 2))

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
    await fila.getByRole("button", { name: "Detener" }).click()
    const detener = page.getByRole("dialog", { name: "¿Detener esta programación?" })
    await detener.locator('textarea[name="reason"]').fill("Programa detenido al terminar su ciclo de prueba E2E.")
    await detener.getByRole("button", { name: "Detener programación" }).click()
    await expect(fila.getByRole("cell", { name: "Detenida", exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(fila.getByRole("button", { name: "Reactivar" })).toBeVisible()
    await expect(fila.getByRole("button", { name: "Crear y abrir inspección" })).toHaveCount(0)
  })
})
