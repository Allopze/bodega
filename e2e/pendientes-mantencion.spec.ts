import AxeBuilder from "@axe-core/playwright"
import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import type postgres from "postgres"
import { AXE_DISABLED_RULES, AXE_TAGS } from "./accessibility-targets"
import { clearRateLimits, selectRadixById } from "./helpers"
import { chileDay, withSql } from "./mantencion-3-helpers"

/**
 * E2E · Mantención en «Mis pendientes» y en los avisos del menú (brief
 * `docs/mantencion/brief-mis-pendientes.md` §7.4).
 *
 * Cada rol ve lo suyo, con el mismo cálculo en la lista y en el aviso del menú:
 *
 *   - jefe (`jefe.mant@`, global): OT por asignar y notas de pedido; al asignar, la fila sale y el aviso baja;
 *   - administrador de contrato de Biodiversa: «Dar conformidad por …»; al cerrarla, desaparece;
 *   - supervisor de Biodiversa: UNA fila de registros con enlace a la lista filtrada, que abre en «Por revisar»;
 *   - mecánico (`mecanico1@`): sus OT asignadas y no las de otro;
 *   - una persona sin permisos de Mantención: ni filas ni avisos.
 *
 * Con estado y en orden. Autocontenida: siembra sus propias filas por SQL (prefijo `QA_PEND`) y las borra al terminar, así que
 * no depende de lo que dejaron las specs de Mantención. Los usuarios son los de `e2e/fixtures/mantencion-setup.ts`
 * (contraseña `chome2026`).
 *
 * El aviso del menú se guarda 30 s por usuario (`unstable_cache` en `app/(app)/layout.tsx`); las acciones de Mantención lo
 * invalidan (`revalidateOperationalViews`), pero lo que entra por SQL no. Por eso se lee con `expect.poll` y recarga, como
 * `control-operacional-navegacion.spec.ts`.
 *
 * Locators según «Locators in this repository» de `qa/AGENTS.md`: la lista de pendientes se pinta dos veces (tabla en
 * escritorio, tarjetas en móvil) y sólo `getByRole` ignora la oculta.
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

const JEFE = "jefe.mant@e2e.chome.cl"
const SUPERVISOR = "supervisor@e2e.chome.cl"
const ADMIN_CONTRATO = "admin.contrato@e2e.chome.cl"
const MECANICO = "mecanico1@e2e.chome.cl"
const MECANICO_2 = "mecanico2@e2e.chome.cl"
/** Un `jefe_terreno`: sin ningún permiso de Mantención (sólo inspecciones). */
const SIN_MANTENCION = "jefe.faena@e2e.chome.cl"
const NOMBRE_MECANICO = "Mecánico Uno E2E"
const PREFIJO = "QA_PEND"

/** Lo que el sembrado deja: las filas y los equipos con los que se reconocen en la cola. */
const datos = {
  /** Equipo de cada fila, para leer «… a KA-135» en el título. Dos equipos distintos: uno por mecánico. */
  equipoA: "",
  equipoB: "",
  faenaId: "",
  faenaNombre: "",
  otPorAsignar: `${PREFIJO}-OT-0001`,
  otConformidad: `${PREFIJO}-OT-0002`,
  otDelMecanico: `${PREFIJO}-OT-0003`,
  otDelOtroMecanico: `${PREFIJO}-OT-0004`,
  nota: `${PREFIJO}-NP-0001`,
}

/** Errores de consola y de página de UNA prueba. */
function vigilarConsola(page: Page): string[] {
  const errores: string[] = []
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error" && !/favicon/i.test(mensaje.text())) errores.push(mensaje.text())
  })
  page.on("pageerror", (error) => errores.push(error.message))
  return errores
}

/** Entra como `email` sin suponer adónde aterriza su rol (el mecánico o el administrador de contrato no ven el tablero). */
async function entrar(page: Page, email: string) {
  for (const intento of [1, 2]) {
    await clearRateLimits()
    await page.goto("/login")
    await page.getByLabel("Correo electrónico", { exact: true }).fill(email)
    await page.getByLabel("Contraseña", { exact: true }).fill("chome2026")
    await page.getByRole("button", { name: "Ingresar", exact: true }).click()
    try {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
      return
    } catch (error) {
      if (intento === 2) throw error
    }
  }
}

const COLA = "/pendientes?module=mantencion"
const COLA_DE_LA_PRUEBA = `${COLA}&q=${PREFIJO}`

/** Los títulos de las filas de la cola (la segunda celda de cada fila de la tabla de escritorio). */
async function titulosDeLaCola(page: Page): Promise<string[]> {
  const tabla = page.getByRole("table", { name: "Pendientes operacionales" })
  // Con la cola vacía no hay tabla: el estado vacío la reemplaza.
  if ((await tabla.count()) === 0) return []
  return tabla.locator("tbody tr").evaluateAll((filas) => filas.map((fila) => fila.querySelector("td:nth-child(2) a")?.textContent?.trim() ?? ""))
}

const ES_OT = /^(Asignar mecánico a |Recibir .+ del taller$|Dar conformidad por |Ingresar .+ a taller$|Trabajar en )/
const ES_NOTA = /^Resolver repuestos de /
const REGISTROS = /^Revisar (\d+) registros? de mantención$/

/** Lo que dicen las filas de la cola: filas de OT, notas y REGISTROS (cada fila de registros trae el conteo de su faena). */
async function cifrasDeLaLista(page: Page): Promise<{ ot: number; notas: number; registros: number }> {
  await page.goto(COLA)
  await expect(page.getByRole("heading", { level: 2, name: "Lista de pendientes" })).toBeVisible()
  const titulos = await titulosDeLaCola(page)
  return {
    ot: titulos.filter((titulo) => ES_OT.test(titulo)).length,
    notas: titulos.filter((titulo) => ES_NOTA.test(titulo)).length,
    registros: titulos.reduce((suma, titulo) => suma + Number(REGISTROS.exec(titulo)?.[1] ?? 0), 0),
  }
}

/** El número del aviso de un ítem del menú, por href. Sin aviso (cero) no hay número. «99+» se lee como 99. */
async function avisoDelMenu(page: Page, href: string): Promise<number> {
  const enlace = page.getByRole("navigation", { name: "Navegación", exact: true }).locator(`a[href="${href}"]`).first()
  await expect(enlace).toBeVisible()
  return Number(((await enlace.innerText()).match(/\d+/) ?? ["0"])[0])
}

/**
 * Los tres avisos de Mantención. La pantalla de Órdenes de trabajo es de Mantención, así que su grupo del menú viene
 * abierto. Se recarga hasta que el aviso alcanza a `esperado`: la caché de 30 s puede traer el número de antes.
 */
async function esperarAvisos(page: Page, esperado: { ot: number; notas: number; registros: number }) {
  await expect.poll(async () => {
    await page.goto("/mantencion/ot")
    return {
      ot: await avisoDelMenu(page, "/mantencion/ot"),
      notas: await avisoDelMenu(page, "/mantencion/notas-pedido"),
      registros: await avisoDelMenu(page, "/mantencion/registros"),
    }
  }, { timeout: 75_000, intervals: [1_000, 5_000, 10_000], message: "los avisos del menú deben coincidir con la lista" }).toEqual(esperado)
}

test.beforeAll(async () => {
  await withSql(async (sql) => {
    await limpiar(sql)
    const usuario = async (email: string) => {
      const [fila] = await sql`select id, name from users where email = ${email}`
      if (!fila) throw new Error(`El sembrado E2E no trae a ${email}`)
      return { id: fila.id as string, name: fila.name as string }
    }
    const jefe = await usuario(JEFE)
    const supervisor = await usuario(SUPERVISOR)
    const admin = await usuario(ADMIN_CONTRATO)
    const mecanico = await usuario(MECANICO)
    const mecanico2 = await usuario(MECANICO_2)

    // Dos equipos de Biodiversa (la faena del supervisor, del administrador de contrato y del mecánico de la prueba).
    const equipos = await sql`
      select v.id, v.code, v.plate, v.worksite_id, w.name as worksite
      from fuel_vehicles v
      join mant_equipment_profiles p on p.vehicle_id = v.id
      join worksites w on w.id = v.worksite_id
      where w.name = 'Biodiversa' and v.is_active = true and v.code is not null
      order by v.code desc
      limit 2`
    const equipoA = equipos[0]
    const equipoB = equipos[1]
    if (!equipoA || !equipoB) throw new Error("Biodiversa necesita dos equipos con ficha de mantención en la carga inicial")
    datos.equipoA = equipoA.code as string
    datos.equipoB = equipoB.code as string
    datos.faenaId = equipoA.worksite_id as string
    datos.faenaNombre = equipoA.worksite as string
    const instantanea = (equipo: typeof equipoA) => sql.json({ code: equipo.code, plate: equipo.plate, noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: equipo.worksite, unit: "km" })

    const base = (id: string, folio: string, equipo: typeof equipoA, estado: string) => ({
      id, folio, vehicleId: equipo.id as string, worksiteId: equipo.worksite_id as string, snapshot: instantanea(equipo), estado,
    })
    const alta = async (ot: ReturnType<typeof base>, mecanicoId: string | null) => {
      await sql`
        insert into mant_work_orders (
          id, folio, vehicle_id, worksite_id, equipment_snapshot, repair, maintenance, request_date, requested_by_user_id, requester_name,
          repair_description, status, assigned_to_user_id, assigned_by_user_id, assigned_at
        ) values (
          ${ot.id}, ${ot.folio}, ${ot.vehicleId}, ${ot.worksiteId}, ${ot.snapshot}, true, false, ${chileDay(-2)}, ${jefe.id}, 'QA_Pendientes',
          'QA_ Reparación de prueba de pendientes', ${ot.estado}, ${mecanicoId}, ${mecanicoId ? jefe.id : null}, ${mecanicoId ? new Date().toISOString() : null}
        )`
    }

    // 1. Por asignar (jefe).
    await alta(base(randomUUID(), datos.otPorAsignar, equipoA, "solicitada"), null)
    // 2. Por conformidad (administrador de contrato): recepcionada, con todo lo que exige cada estado.
    const entrada = new Date(Date.now() - 6 * 86_400_000).toISOString()
    const salida = new Date(Date.parse(entrada) + 30 * 3_600_000).toISOString()
    const conformidad = base(randomUUID(), datos.otConformidad, equipoA, "recepcionada")
    await sql`
      insert into mant_work_orders (
        id, folio, vehicle_id, worksite_id, equipment_snapshot, repair, maintenance, request_date, requested_by_user_id, requester_name, repair_description,
        status, assigned_to_user_id, assigned_by_user_id, assigned_at,
        workshop_kind, workshop_entry_at, estimated_delivery_date, started_at, started_by_user_id,
        workshop_exit_at, finished_at, finished_by_user_id,
        received_at, receiver_name, received_by_user_id, received_recorded_at
      ) values (
        ${conformidad.id}, ${conformidad.folio}, ${conformidad.vehicleId}, ${conformidad.worksiteId}, ${conformidad.snapshot}, true, false, ${chileDay(-8)}, ${jefe.id}, 'QA_Pendientes',
        'QA_ Reparación de prueba de pendientes', 'recepcionada', ${mecanico.id}, ${jefe.id}, ${entrada},
        'interno', ${entrada}, ${chileDay(-3)}, ${entrada}, ${mecanico.id},
        ${salida}, ${salida}, ${mecanico.id},
        ${salida}, 'QA_ Recibe Taller', ${admin.id}, ${salida}
      )`
    // 3 y 4. Una asignada al mecánico de la prueba y otra, de otro equipo, a otro mecánico.
    const delMecanico = base(randomUUID(), datos.otDelMecanico, equipoA, "asignada")
    await alta(delMecanico, mecanico.id)
    await alta(base(randomUUID(), datos.otDelOtroMecanico, equipoB, "asignada"), mecanico2.id)

    // Una nota de pedido por resolver (jefe), con dos líneas pendientes, sobre la OT del mecánico.
    const notaId = randomUUID()
    await sql`
      insert into mant_parts_notes (id, code, work_order_id, vehicle_id, worksite_id, requested_by_user_id, equipment_stopped, status)
      values (${notaId}, ${datos.nota}, ${delMecanico.id}, ${delMecanico.vehicleId}, ${delMecanico.worksiteId}, ${mecanico.id}, true, 'enviada')`
    // El estado de una nota es siempre el del último evento de su historial: sembrada a mano, lleva su evento «creada».
    await sql`
      insert into mant_parts_note_events (id, note_id, kind, from_status, to_status, actor_user_id)
      values (${randomUUID()}, ${notaId}, 'creada', null, 'enviada', ${mecanico.id})`
    await sql`
      insert into mant_parts_note_items (id, note_id, description, quantity, unit_of_measure, sort_order)
      values (${randomUUID()}, ${notaId}, ${`${PREFIJO} Filtro de aceite`}, 2, 'unidad', 0), (${randomUUID()}, ${notaId}, ${`${PREFIJO} Manguera`}, 1, 'unidad', 1)`

    // Un registro firmado por el mecánico, por revisar en Biodiversa (lo ve el supervisor; no lo firmó él).
    await sql`
      insert into mant_records (
        id, folio, kind, vehicle_id, equipment_snapshot, worksite_id, reading, unit, work_date, registered_by, executor_kind, executor_user_id, executor_name, signed_at
      ) values (
        ${randomUUID()}, ${`${PREFIJO}-MC-0001`}, 'C', ${equipoA.id}, ${instantanea(equipoA)}, ${equipoA.worksite_id}, 41000, 'km', ${chileDay(-1)},
        ${mecanico.id}, 'yo', ${mecanico.id}, ${mecanico.name}, ${new Date().toISOString()}
      )`
    // El supervisor no revisa lo que firmó él: este queda fuera de su fila (y del aviso).
    await sql`
      insert into mant_records (
        id, folio, kind, vehicle_id, equipment_snapshot, worksite_id, reading, unit, work_date, registered_by, executor_kind, executor_user_id, executor_name, signed_at
      ) values (
        ${randomUUID()}, ${`${PREFIJO}-MC-0002`}, 'C', ${equipoA.id}, ${instantanea(equipoA)}, ${equipoA.worksite_id}, 41010, 'km', ${chileDay(-1)},
        ${supervisor.id}, 'yo', ${supervisor.id}, ${supervisor.name}, ${new Date().toISOString()}
      )`
  })
})

test.afterAll(async () => {
  await withSql(limpiar)
})

/**
 * Borra lo sembrado: las notas primero (apuntan a la OT) y los registros por su folio. El historial de una nota es append-only
 * (trigger `mant_parts_note_events_append_only`, migración 0405) y una nota con historial no se borra (FK restrict): el trigger se
 * apaga SÓLO dentro de la transacción que borra el historial de estas notas y vuelve a encenderse con ella (como `clearNoteHistory`
 * de las pruebas PGlite).
 */
async function limpiar(sql: postgres.Sql) {
  await sql.begin(async (tx) => {
    await tx`alter table mant_parts_note_events disable trigger mant_parts_note_events_append_only`
    await tx`delete from mant_parts_note_events where note_id in (select id from mant_parts_notes where code like ${`${PREFIJO}-NP-%`})`
    await tx`alter table mant_parts_note_events enable trigger mant_parts_note_events_append_only`
    await tx`delete from mant_parts_notes where code like ${`${PREFIJO}-NP-%`}`
  })
  await sql`delete from mant_records where folio like ${`${PREFIJO}-MC-%`}`
  await sql`delete from mant_work_order_events where work_order_id in (select id from mant_work_orders where folio like ${`${PREFIJO}-OT-%`})`
  await sql`delete from mant_work_orders where folio like ${`${PREFIJO}-OT-%`}`
}

test.describe("Mantención en «Mis pendientes»", () => {
  test("a · el jefe ve sus OT por asignar y las notas, con los avisos del menú iguales a la lista", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, JEFE)
    await page.goto(COLA_DE_LA_PRUEBA)
    await expect(page.getByRole("heading", { level: 1, name: "Mis pendientes" })).toBeVisible()

    // Sus filas: por asignar y la nota. NO la conformidad (es del administrador de contrato) ni la OT ya asignada al mecánico.
    await expect(page.getByRole("link", { name: `Asignar mecánico a ${datos.equipoA}` }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: `Resolver repuestos de ${datos.equipoA}` }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: /^Dar conformidad por / })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /^Ingresar .+ a taller$/ })).toHaveCount(0)

    // La fila dice faena, folio y estado; el módulo es «Mantención».
    const tabla = page.getByRole("table", { name: "Pendientes operacionales" })
    const fila = tabla.getByRole("row").filter({ hasText: datos.otPorAsignar })
    await expect(fila).toContainText("Mantención")
    await expect(fila).toContainText(datos.faenaNombre)
    await expect(fila).toContainText("Por asignar")

    // Los tres avisos del menú son lo que dice la lista (el aviso de «Registros» cuenta registros, no filas).
    const lista = await cifrasDeLaLista(page)
    expect(lista.ot).toBeGreaterThanOrEqual(1)
    expect(lista.notas).toBeGreaterThanOrEqual(1)
    await esperarAvisos(page, lista)
    expect(errores).toEqual([])
  })

  test("a2 · el jefe abre la fila, asigna la OT y el aviso de Órdenes de trabajo baja", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, JEFE)
    const antes = await cifrasDeLaLista(page)
    await esperarAvisos(page, antes)

    await page.goto(COLA_DE_LA_PRUEBA)
    await page.getByRole("link", { name: `Asignar mecánico a ${datos.equipoA}` }).first().click()
    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/)
    await page.getByRole("button", { name: "Asignar", exact: true }).click()
    await selectRadixById(page, "ot-assign-mechanic", new RegExp(NOMBRE_MECANICO))
    await page.getByRole("dialog").getByRole("button", { name: /^(Asignar|Reasignar)$/ }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByTestId("ot-estado")).toHaveText("Asignada", { timeout: 30_000 })

    // La OT ya no está «por asignar»: sale de la cola del jefe y el aviso baja en uno (la acción invalida la caché del menú).
    await page.goto(COLA_DE_LA_PRUEBA)
    await expect(page.getByRole("link", { name: `Asignar mecánico a ${datos.equipoA}` })).toHaveCount(0)
    const despues = await cifrasDeLaLista(page)
    expect(despues.ot).toBe(antes.ot - 1)
    await esperarAvisos(page, despues)
    expect(errores).toEqual([])
  })

  test("b · en móvil la cola se lee en tarjetas y no tiene violaciones de accesibilidad", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await entrar(page, JEFE)
    await page.goto(COLA_DE_LA_PRUEBA)

    const tarjetas = page.getByRole("list", { name: "Pendientes operacionales" })
    await expect(tarjetas.getByRole("link", { name: `Resolver repuestos de ${datos.equipoA}` }).first()).toBeVisible()
    // Sin desborde horizontal: lo que falló en otras vistas de la cola fue el cálculo de layout, no una clase.
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(desborde, "la cola no debe desbordar en 390 px").toBeLessThanOrEqual(0)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(COLA)
    await expect(page.getByRole("heading", { level: 2, name: "Lista de pendientes" })).toBeVisible()
    const resultado = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).disableRules([...AXE_DISABLED_RULES]).analyze()
    expect(resultado.violations).toEqual([])
  })

  test("c · el administrador de contrato ve «Dar conformidad» y, al cerrarla, la fila desaparece", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, ADMIN_CONTRATO)
    await page.goto(COLA_DE_LA_PRUEBA)

    const conformidad = page.getByRole("link", { name: `Dar conformidad por ${datos.equipoA}` })
    await expect(conformidad.first()).toBeVisible()
    // Sólo lo suyo: ni por asignar ni las notas (esas las resuelve la jefatura primero).
    await expect(page.getByRole("link", { name: /^Asignar mecánico a / })).toHaveCount(0)
    await expect(page.getByRole("link", { name: /^Resolver repuestos de / })).toHaveCount(0)

    await conformidad.first().click()
    await expect(page).toHaveURL(/\/mantencion\/ot\/[^/]+$/)
    await expect(page.getByTestId("ot-estado")).toHaveText("Por conformidad", { timeout: 30_000 })
    await page.getByRole("button", { name: "Dar conformidad", exact: true }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Dar conformidad", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    await expect(page.getByTestId("ot-estado")).toHaveText("Cerrada", { timeout: 30_000 })

    await page.goto(COLA_DE_LA_PRUEBA)
    await expect(page.getByRole("link", { name: /^Dar conformidad por / })).toHaveCount(0)
    expect(errores).toEqual([])
  })

  test("d · el supervisor ve UNA fila de registros de su faena, con enlace a «Por revisar»", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, SUPERVISOR)
    await page.goto(COLA)
    await expect(page.getByRole("heading", { level: 2, name: "Lista de pendientes" })).toBeVisible()

    // Una sola fila de registros: la de su faena. No revisa el que firmó él, así que el conteo no lo incluye.
    const filas = page.getByRole("link", { name: /^Revisar \d+ registros? de mantención$/ })
    await expect(filas).toHaveCount(1)
    const enlace = filas.first()
    await expect(enlace).toHaveAttribute("href", `/mantencion/registros?revision=pendiente&estado=vigente&faena=${datos.faenaId}`)
    const sinFirmadosPorEl = Number(/\d+/.exec(await enlace.innerText())![0])
    expect(sinFirmadosPorEl).toBeGreaterThanOrEqual(1)
    // Lo suyo es revisar: nada de asignar, recibir ni dar la conformidad.
    expect((await titulosDeLaCola(page)).filter((titulo) => ES_OT.test(titulo) || ES_NOTA.test(titulo))).toEqual([])

    await enlace.click()
    await expect(page).toHaveURL(/\/mantencion\/registros\?.*revision=pendiente/)
    await expect(page.getByRole("navigation", { name: "Revisión de los registros" }).getByRole("link", { name: /^Por revisar/ })).toHaveAttribute("aria-current", "page")
    expect(errores).toEqual([])
  })

  test("e · el mecánico ve sus OT asignadas y no las de otro", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, MECANICO)
    await page.goto(COLA_DE_LA_PRUEBA)
    await expect(page.getByRole("heading", { level: 1, name: "Mis pendientes" })).toBeVisible()

    await expect(page.getByRole("link", { name: `Ingresar ${datos.equipoA} a taller` }).first()).toBeVisible()
    // La del otro mecánico es de otro equipo: no aparece.
    await expect(page.getByRole("link", { name: `Ingresar ${datos.equipoB} a taller` })).toHaveCount(0)
    // Y nada que no sea suyo: ni por asignar ni conformidad ni notas por resolver.
    await expect(page.getByRole("link", { name: /^(Asignar mecánico a |Dar conformidad por |Resolver repuestos de )/ })).toHaveCount(0)
    expect(errores).toEqual([])
  })

  test("f · quien no tiene permisos de Mantención no recibe filas ni avisos", async ({ page }) => {
    const errores = vigilarConsola(page)
    await entrar(page, SIN_MANTENCION)
    await page.goto(COLA)
    await expect(page.getByRole("heading", { level: 1, name: "Mis pendientes" })).toBeVisible()
    expect((await titulosDeLaCola(page)).filter((titulo) => ES_OT.test(titulo) || ES_NOTA.test(titulo) || REGISTROS.test(titulo))).toEqual([])

    // Los ítems de Mantención ni siquiera están en su menú (el aviso depende de poder abrir la pantalla).
    for (const href of ["/mantencion/ot", "/mantencion/notas-pedido", "/mantencion/registros"]) {
      await expect(page.getByRole("navigation", { name: "Navegación", exact: true }).locator(`a[href="${href}"]`)).toHaveCount(0)
    }
    expect(errores).toEqual([])
  })
})
