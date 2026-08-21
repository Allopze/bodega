import { test, expect, type Page } from "@playwright/test"
import { expectPageTitle, login, MINIMAL_PNG } from "./helpers"

/**
 * E2E: ejecución de una inspección, de alta a acta firmada
 * (`/prevencion/inspecciones` → `/prevencion/inspecciones/<runId>`).
 *
 * Es el flujo de terreno del módulo y no tenía ni un solo test de navegador:
 * las 16 acciones de `app/(app)/prevencion/inspecciones/actions.ts` sólo se
 * ejercitaban desde `lib/__tests__/prevention-inspections-postgres.test.ts`,
 * que llama al servicio sin pasar por el formulario. Justo ahí vivían B-01
 * (el gate se evaluaba contra el borrador en memoria mientras el servidor
 * puntuaba lo último guardado) y B-08 (a un relato libre se le ofrecía
 * "Cumple / No cumple" y su texto no tenía dónde guardarse).
 *
 * El instrumento es la plantilla aprobada del fixture (`insptpl-insp-e2e`,
 * Anexo 2 de extintores): cinco ítems puntuables con daño potencial declarado
 * —`manometro` es 'grave' → hallazgo Alto— y cinco que sólo registran
 * contenido, más un acta de cierre con dos firmas obligatorias.
 *
 * Cada test crea **su propia** inspección: declarar ejecutada es terminal, y
 * compartir una fila obligaría a fijar el orden entre tests.
 */
const PLANTILLA = "Inspección de Estado de Extintores"
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

/** Los cinco ítems que puntúan. El resto de la plantilla no cuenta para el %. */
const PUNTUABLES = ["Manómetro", "Sello", "Rótulo", "Manguera", "Certificado CECMEC"] as const

let contador = 0

/**
 * Da de alta una inspección y abre su detalle.
 *
 * La identificación del sujeto lleva la marca de la corrida porque es lo único
 * con lo que se puede localizar la fila recién creada: el código lo genera el
 * servidor (`INSP-<año>-<8 al azar>`).
 */
async function nuevaInspeccion(page: Page, opciones: {
  origen?: string
  sujetoInventario?: string
} = {}) {
  const identificacion = `E2E-${RUN}-${++contador}`
  await page.goto("/prevencion/inspecciones")
  await expectPageTitle(page, "Inspecciones")

  await page.getByRole("button", { name: "Nueva inspección" }).click()
  const dialog = page.getByRole("dialog", { name: "Nueva inspección" })
  await dialog.getByLabel("Plantilla").click()
  await page.getByRole("option", { name: new RegExp(`^${PLANTILLA} · E2E$`) }).click()
  await dialog.getByLabel("Faena de la inspección").click()
  await page.getByRole("option", { name: "Faena E2E", exact: true }).click()
  if (opciones.origen) {
    await dialog.getByLabel("Origen").click()
    await page.getByRole("option", { name: opciones.origen, exact: true }).click()
  }
  if (opciones.sujetoInventario) {
    await dialog.getByLabel("Sujeto inspeccionado").click()
    await page.getByRole("option", { name: opciones.sujetoInventario }).click()
  } else {
    await dialog.locator('input[name="subjectType"]').fill("extintor")
    await dialog.locator('input[name="subjectLabel"]').fill(identificacion)
  }
  await dialog.getByRole("button", { name: "Crear" }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })

  // Sin sujeto libre la fila se reconoce por el nombre congelado del recurso.
  const marca = opciones.sujetoInventario ? opciones.sujetoInventario.replace(/^(Recurso|Equipo) · /, "") : identificacion
  const fila = page.getByRole("row").filter({ hasText: marca }).first()
  await expect(fila).toBeVisible({ timeout: 30_000 })
  await fila.getByRole("link").first().click()
  await expect(page).toHaveURL(/\/prevencion\/inspecciones\/[^/?]+$/, { timeout: 30_000 })
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(PLANTILLA) })).toBeVisible()
  return { identificacion, marca }
}

/** Responde un ítem puntuable. Los rótulos son largos: basta un prefijo único. */
async function responder(page: Page, item: string, resultado: string, comentario?: string) {
  await page.getByLabel(`Resultado de ${item}`).click()
  await page.getByRole("option", { name: resultado, exact: true }).click()
  if (comentario !== undefined) await page.getByLabel(`Comentario de ${item}`).fill(comentario)
}

/** Deja los cinco puntuables conformes salvo el que se pida incumpliendo. */
async function responderTodo(page: Page, incumple?: string) {
  for (const item of PUNTUABLES) {
    await responder(page, item, item === incumple ? "No cumple" : "Cumple")
  }
}

/** El acta que declara la plantilla: resultado + las dos firmas obligatorias. */
async function firmarActa(page: Page, resultado = "Con observaciones") {
  await page.getByLabel("Resultado del acta").click()
  await page.getByRole("option", { name: resultado, exact: true }).click()
  await page.getByLabel("Firma de prevencionista").fill("Admin E2E")
  await page.getByLabel("Firma de supervisor").fill("Comprador E2E")
}

async function declararEjecutada(page: Page) {
  await page.getByRole("button", { name: "Declarar ejecutada" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Declarar ejecutada" }).click()
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 30_000 })
}

test.describe("Inspecciones — ejecución en terreno", () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  /**
   * B-05: sin poder marcar el origen, ninguna inspección podía acreditar como
   * originada por el comité paritario, que es lo que distingue la
   * certificación Mutual. Y función #11: el sujeto dejó de ser texto libre, de
   * modo que su etiqueta queda congelada desde el inventario.
   */
  test("crear una inspección congela su origen y el sujeto elegido del inventario", async ({ page }) => {
    await nuevaInspeccion(page, { origen: "Comité Paritario", sujetoInventario: "Recurso · Extintor PQS Pañol E2E" })

    await expect(page.getByText("Planificada").first()).toBeVisible()
    await expect(page.getByText("Comité Paritario")).toBeVisible()
    await expect(page.getByText("Extintor PQS Pañol E2E").first()).toBeVisible()
    await expect(page.getByText(`0 de 10 ítems respondidos`)).toBeVisible()
  })

  /**
   * El gate no dice "faltan datos": nombra cada ítem pendiente y el acta que
   * falta, y mantiene el envío deshabilitado dentro del propio diálogo.
   */
  test("el gate nombra cada ítem sin responder y el acta que falta", async ({ page }) => {
    await nuevaInspeccion(page)

    const aviso = page.locator("div").filter({ hasText: /^Aún no puede declararse ejecutada:/ }).first()
    await expect(aviso).toBeVisible()
    for (const item of PUNTUABLES) {
      await expect(aviso.getByRole("listitem").filter({ hasText: item })).toHaveCount(1)
    }
    // El acta entra al gate por su resultado: `validateClosingAct` corta en el
    // primer problema, y con el resultado sin declarar ése es el que aparece.
    await expect(aviso.getByRole("listitem")
      .filter({ hasText: "El resultado del acta no corresponde a las opciones de la plantilla." })).toHaveCount(1)

    await page.getByRole("button", { name: "Declarar ejecutada" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("button", { name: "Declarar ejecutada" })).toBeDisabled()
  })

  test("guardar respuestas deja la inspección en ejecución y proyecta el cumplimiento", async ({ page }) => {
    await nuevaInspeccion(page)

    await responder(page, "Manómetro", "Cumple")
    await responder(page, "Sello", "Cumple")
    await expect(page.getByText("2 de 10 ítems respondidos")).toBeVisible()
    // Previsto, entre paréntesis: la inspección todavía no se declaró
    // ejecutada, así que el porcentaje no es el firmado.
    await expect(page.getByText("100% (previsto)")).toBeVisible()

    // El aviso "Guardado correctamente." no sirve de señal: al aceptar el
    // guardado el servidor revalida, el árbol se remonta y `useOperation`
    // vuelve a su mensaje vacío, así que desaparece antes de poder afirmarlo.
    // El efecto persistido sí es estable — la ejecución arranca al guardar.
    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })

    await page.reload()
    await expect(page.getByText("2 de 10 ítems respondidos")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("En ejecución").first()).toBeVisible()
  })

  /**
   * B-03: la misma regla del CHECK `prevention_inspection_answer_requires_comment`,
   * evaluada antes de enviar. Sin esto Postgres reventaba el lote entero y el
   * usuario veía el texto crudo de la violación.
   */
  test("un \"No aplica\" sin motivo bloquea el guardado y con motivo lo desbloquea", async ({ page }) => {
    await nuevaInspeccion(page)

    await responder(page, "Certificado CECMEC", "No aplica")
    const aviso = page.locator("div").filter({ hasText: /^Corrige antes de guardar:/ }).first()
    await expect(aviso).toBeVisible()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeDisabled()

    await page.getByLabel("Comentario de Certificado CECMEC").fill("El extintor es nuevo y no exige certificado todavía.")
    await expect(aviso).toBeHidden()
    await expect(page.getByRole("button", { name: "Guardar respuestas" })).toBeEnabled()

    await page.getByRole("button", { name: "Guardar respuestas" }).click()
    await expect(page.getByText("En ejecución").first()).toBeVisible({ timeout: 30_000 })

    // El motivo es parte de la evidencia del "no aplica": tiene que sobrevivir.
    await page.reload()
    await expect(page.getByLabel("Comentario de Certificado CECMEC"))
      .toHaveValue("El extintor es nuevo y no exige certificado todavía.", { timeout: 15_000 })
  })

  /**
   * El recorrido completo: se declara ejecutada, el servidor puntúa 4 de 5
   * (los ítems de inventario no cuentan para el cumplimiento) y materializa un
   * hallazgo cuya criticidad sale del daño potencial de la plantilla, no del
   * criterio de quien la ejecuta.
   */
  test("declarar ejecutada calcula el cumplimiento y materializa el hallazgo con su criticidad", async ({ page }) => {
    await nuevaInspeccion(page)

    await responderTodo(page, "Manómetro")
    await firmarActa(page)
    await declararEjecutada(page)

    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("80%", { exact: true })).toBeVisible()

    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
    const hallazgo = page.getByRole("row").filter({ hasText: "Manómetro: aguja en zona verde." })
    await expect(hallazgo.getByText("Alta")).toBeVisible()
    await expect(hallazgo.getByText("Abierto")).toBeVisible()

    // El acta queda firmada y en modo lectura junto al resultado declarado.
    await expect(page.getByText("Con observaciones")).toBeVisible()
    await expect(page.getByText(/prevencionista:\s*Admin E2E/)).toBeVisible()
  })

  /**
   * B-08: un ítem que no expresa conformidad (`select`, `text`, `date`) se
   * responde con su contenido y queda como 'recorded'. Antes se le ofrecía
   * "Cumple / No cumple" sobre un relato libre, lo que además inflaba el
   * cumplimiento; ahora no entra al denominador.
   */
  test("los ítems que sólo registran contenido se guardan sin mover el cumplimiento", async ({ page }) => {
    await nuevaInspeccion(page)

    await page.getByLabel("Respuesta de Tipo de extintor").click()
    await page.getByRole("option", { name: "PQS (Polvo Químico Seco)" }).click()
    await page.getByLabel("Respuesta de Peso (kg)").fill("6")
    await page.getByLabel("Respuesta de Observaciones adicionales").fill("Ubicado junto a la puerta del pañol.")

    // Tres ítems respondidos y aún así no hay cumplimiento que calcular: lo
    // registrado no puntúa.
    await expect(page.getByText("3 de 10 ítems respondidos")).toBeVisible()
    await expect(page.getByText("No calculable")).toBeVisible()
    // Y el gate sigue exigiendo los cinco puntuables.
    await expect(page.getByRole("button", { name: "Declarar ejecutada" })).toBeVisible()
    const aviso = page.locator("div").filter({ hasText: /^Aún no puede declararse ejecutada:/ }).first()
    await expect(aviso.getByRole("listitem").filter({ hasText: "Manómetro" })).toHaveCount(1)

    await responderTodo(page, "Manómetro")
    await firmarActa(page)
    await declararEjecutada(page)

    await page.reload()
    await expect(page.getByText("80%", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Ubicado junto a la puerta del pañol.")).toBeVisible()
  })

  /**
   * Función #9: en terreno la conexión falla justo al cerrar. El envío queda en
   * IndexedDB y se reintenta; el servidor ya era idempotente por
   * `clientSubmissionId` y lo que faltaba era el cliente.
   */
  test("guardar sin conexión encola el cierre y sincronizar lo entrega", async ({ page }) => {
    await nuevaInspeccion(page)

    await responderTodo(page, "Sello")
    await firmarActa(page, "Operativo")

    await page.getByRole("button", { name: "Guardar sin conexión" }).click()
    await expect(page.getByText("Guardada en el dispositivo. Se enviará al recuperar conexión.")).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeVisible()

    // El aviso de éxito no se asserta: al aceptar el cierre el servidor
    // revalida, la inspección deja de ser editable y todo el bloque offline
    // —el aviso incluido— se desmonta. Lo que sí es estable es que la cola
    // quede vacía y que la ejecución haya quedado declarada.
    await page.getByRole("button", { name: "Sincronizar" }).click()
    await expect(page.getByText("1 cierre pendiente de sincronizar.")).toBeHidden({ timeout: 30_000 })

    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Hallazgos (1)" })).toBeVisible()
  })

  /**
   * La planilla física del turno: se sube, queda como evidencia del run y el
   * visor la deja al lado de las respuestas para poder cotejarlas. Exige
   * `prevention:inspections:ingest`, permiso aparte de ejecutar.
   */
  test("subir la planilla física la deja junto a las respuestas", async ({ page }) => {
    await nuevaInspeccion(page)

    await expect(page.getByRole("heading", { name: "Subir la planilla física" })).toBeVisible()
    // El input real es `sr-only` y lo dispara el botón; se alimenta directo.
    await page.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
      name: "planilla-e2e.png",
      mimeType: "image/png",
      buffer: MINIMAL_PNG,
    })

    // La subida recarga la página: el servidor es quien lee la planilla.
    await expect(page.getByRole("heading", { name: "Planilla original" })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole("button", { name: "Ampliar la planilla" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Agregar otra hoja" })).toBeVisible()
  })
})

/**
 * Función #8: `locationLatitude/Longitude` se aceptaban en el servicio desde el
 * principio y ninguna pantalla los enviaba nunca.
 *
 * La captura en sí **no se certifica acá, y no por falta de ganas**:
 * `next.config.ts` envía `Permissions-Policy: camera=(), microphone=(),
 * geolocation=()`, que apaga la API para todo el origen. Con esa cabecera
 * `getCurrentPosition` entra siempre por el callback de error, conceda el
 * navegador el permiso o no — de ahí que el test lo conceda explícitamente:
 * así queda demostrado que lo que falta no es el permiso del navegador.
 *
 * Lo que sí se certifica es la mitad que hoy corre en producción, y que es la
 * decisión de diseño: la ubicación es un dato de apoyo, así que su negativa
 * degrada en silencio y jamás bloquea el registro de la inspección. El día que
 * la cabecera admita `geolocation=(self)`, la aserción positiva entra sola.
 */
test.describe("Inspecciones — ubicación de la ejecución", () => {
  test("no poder ubicar el equipo se avisa y no bloquea el registro", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"])
    await context.setGeolocation({ latitude: -33.447487, longitude: -70.673676 })
    await login(page)
    await nuevaInspeccion(page)

    await page.getByRole("button", { name: "Capturar ubicación" }).click()
    await expect(page.getByText("No se pudo obtener la ubicación. La inspección se registra igual."))
      .toBeVisible({ timeout: 30_000 })

    // Degradación, no bloqueo: la inspección sigue siendo respondible y
    // declarable sin coordenadas.
    await responderTodo(page)
    await firmarActa(page, "Operativo")
    await declararEjecutada(page)
    await page.reload()
    await expect(page.getByText("Ejecutada").first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("100%", { exact: true })).toBeVisible()
  })
})
