# Plan de implementación y mejora — Módulo de Prevención

## Contexto

La auditoría del 2026-09-05 ([AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md](AUDITORIA_PREVENCION_RESPONSABLES_2026-09-05.md))
respondió la pregunta de fondo: de las **81 actividades activas** de `pdtp-2026-v1`, sólo **60 puede
ejecutarlas su responsable** por la vía que las acredita. Las otras **21 sólo pueden marcarse a mano en
la planilla**, con evidencia autodeclarada en vez del registro del módulo — que para un programa que se
firma y se audita es la diferencia entre "hay una inspección firmada" y "alguien escribió que la hizo".

Además aparecieron cinco defectos que ningún test cubre, y el programa **se va a activar en las próximas
semanas**, lo que vuelve urgentes dos de ellos: cerrar una campaña o aprobar una plantilla de inspección
en el orden equivocado rompe cosas hoy.

**Resultado buscado:** que las 81 actividades tengan una vía real para su responsable, que la compuerta
81/81 diga la verdad sobre las que no la tienen, y que el programa se pueda activar sin que el primer
acto operacional se pierda o falle.

**Decisiones tomadas** (usuario, 2026-09-05): alcance completo incluyendo lo operativo; para las 21, el
criterio por defecto es **otorgar el permiso al responsable** donde no haya segregación real; la
activación es inminente.

---

## Restricciones globales

- **Los grants RBAC viven en `defaultGrants` de los manifests, no en migraciones.** `ensureSystemRbac`
  ([lib/auth/bootstrap.ts:61](lib/auth/bootstrap.ts#L61)) **borra y reconstruye** todos los
  `role_permissions` de los 15 roles del sistema. Un permiso otorgado desde `/admin/roles` a un rol del
  sistema se pierde en el siguiente `sync-rbac`, y el deploy lo corre solo
  ([scripts/deploy-prod.sh:417](scripts/deploy-prod.sh#L417)). **Todo grant de este plan va al manifest.**
- No hace falta re-login: el callback `jwt` relee el RBAC de la base en cada request
  ([lib/auth/auth.ts:134](lib/auth/auth.ts#L134)).
- El permiso no basta: el alcance por faena es ortogonal. `supervisor_terreno` es `isGlobal: false`
  ([lib/auth/system-rbac.ts:29](lib/auth/system-rbac.ts#L29)), así que sin filas en `worksite_users` su
  `resolveWorksiteScope` devuelve `mode: "none"` y todo falla igual. Ver Fase 4.
- `prevention-rbac.test.ts` tiene aserciones `toEqual` de lista cerrada para algunos permisos. De los
  que toca este plan, **sólo `prevention:training:deliver`** ([:333](lib/__tests__/prevention-rbac.test.ts#L333))
  es cerrada: hay que actualizarla en el mismo commit. Las invariantes `not.toContain` de segregación
  (inspecciones, permisos de trabajo, capacitación) **no se tocan** — ninguna propuesta las viola.
- Agregar un permiso **nuevo** exige tres lugares del manifest (`permissions`, `permissionMeta` con id
  corto único, `defaultGrants`) más la lista `expected` de
  [prevention-rbac.test.ts:6-108](lib/__tests__/prevention-rbac.test.ts#L6).
- No se modifica el contenido del programa (`pdtp_activities`): cambiar responsables declarados obligaría
  a reaprobar el programa, y la decisión fue no hacerlo.

---

## Fase 0 · Bloqueadores de la activación

Van primero porque la activación es inminente y los tres fallan **el día que el programa se active**, no antes.

### Tarea 1 · Campañas: usar la capa durable de cumplimiento

**Archivos:** `lib/services/prevention-campaigns.ts` · Test: `lib/__tests__/` (nuevo o en el suite de campañas)

`closeCampaign` ([prevention-campaigns.ts:199](lib/services/prevention-campaigns.ts#L199)) es el **único**
llamador que quedó con `try { accreditPdtpFromEvent(…) } catch { logger.error }` — el patrón que
`recordPdtpFulfillmentEvent` vino a eliminar ([fulfillment.ts:8](lib/services/pdtp/fulfillment.ts#L8)).
Con el programa en `draft`, `accreditPdtpFromEvent` lanza
([accreditation.ts:234](lib/services/pdtp/accreditation.ts#L234)) y el hecho desaparece sin evento
`pending` que `reconcilePdtpFulfillmentEvents` pueda reprocesar. Hay **35 campañas** cargadas (N°85–89 ×
7 faenas), todas en `draft`: aún no se perdió nada, y la primera que se cierre antes de tiempo sí.

- [ ] **Paso 1.** Test que falla: cerrar una campaña con `pdtpActivityNumbers` sin programa activo debe
      dejar una fila en `pdtp_fulfillment_events` con `status: "pending"`. Seguir el montaje PGlite de
      `lib/__tests__/pdtp-fulfillment.test.ts`.
- [ ] **Paso 2.** Reemplazar la llamada por `recordPdtpFulfillmentEvent(input)`, importando de
      `@/lib/services/pdtp/fulfillment`. Conservar `pdtpAccredited` mirando el resultado. Quitar el
      `try/catch` (la función ya no lanza) y el import de `accreditPdtpFromEvent`.
- [ ] **Paso 3.** Verificar que `grep -rn "accreditPdtpFromEvent" lib/ app/ --include=*.ts | grep -v test`
      ya no devuelve llamadores fuera de `fulfillment.ts` y `pdtp-accreditation-connectors.ts`.

### Tarea 2 · Que aprobar una plantilla antes de activar no bloquee el cierre de inspecciones

**Archivos:** `lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts` · `lib/__tests__/pdtp-fulfillment.test.ts`

`onInspectionCompleted` tiene dos caminos: sin transacción usa `safeAccredit` (durable), **con**
transacción llama directo a `accreditPdtpFromEvent` y no atrapa
([pdtp-accreditation-connectors.ts:106](lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts#L106)).
Los tres llamadores reales pasan `tx` ([prevention-inspections.ts:1393](lib/services/prevention-inspections.ts#L1393),
[:1608](lib/services/prevention-inspections.ts#L1608), [:2000](lib/services/prevention-inspections.ts#L2000)).

Compartir la transacción es deliberado y correcto —"nunca puede quedar el run completado sin su
cumplimiento"—; el borde no declarado es **"no hay programa activo"**, que no es una inconsistencia sino
un estado normal previo a la activación. Hoy se traduce en que el run **no se puede cerrar** y el
operador ve `Sin programa PDTP activo para el evento inspeccion:<runId> en faena <id>.`

- [ ] **Paso 1.** Test que falla: con una plantilla que declara números PDTP y **sin** programa activo,
      `completeInspectionRun` debe cerrar el run y dejar un evento `pending`, no lanzar.
- [ ] **Paso 2.** En el camino transaccional, distinguir los dos errores. "Programa no activo" / "sin
      programa" → registrar el evento durable y seguir. `skippedNotFound` y `skippedOutOfPeriod` **siguen
      lanzando**: ésos sí son inconsistencias de configuración que deben frenar el cierre.
      La forma más limpia es que `resolvePdtpActiveProgramForEvent` devuelva un resultado tipado
      (`{ ok: false, reason: "no_active_program" }`) en vez de lanzar, y que ambos caminos lo traten
      igual — hoy ya devuelve `{ ok: false, … }` para "fuera de período"
      ([accreditation.ts:264](lib/services/pdtp/accreditation.ts#L264)), así que es extender un patrón
      existente, no inventar uno.
- [ ] **Paso 3.** Revisar los otros conectores que llaman con `client` por si comparten el borde.

### Tarea 3 · Aplicar la migración 0236 y dejar el registro veraz

**Sin código.** Operación de base, con una salvedad importante.

`bodega_dev` tiene 255 de 256 migraciones aplicadas. Falta `0236_typical_abomination.sql`, que saca a las
integraciones del índice de período de `pdtp_executions`. Con el índice viejo, dos eventos de integración
distintos en la misma actividad/faena/semana chocan y `accreditPdtpFromEvent` termina en
`throw new Error("La acreditación colisionó sin una ejecución idempotente recuperable.")` — el caso de la
**N°53 (charla diaria)** y de cualquier semana con dos inspecciones del mismo instrumento.

**Causa raíz** (confirmada en `node_modules/drizzle-orm/pg-core/dialect.js:56-69`): el migrador de Drizzle
usa **una sola marca de agua** — `MAX(created_at)` de `drizzle.__drizzle_migrations` — y compara con `<`
estricto contra el `when` del journal. El hash se calcula y **no se usa para decidir**. La 0236 entró al
journal con `when = 1788229972647`, ~41 h **anterior** a la 0237 que ya estaba aplicada: queda saltada
para siempre, sin error ni warning. El journal en disco está bien ordenado hoy —`verify-migration-chain`
pasa—; el hueco vive sólo en la fila que falta en la base.

- [ ] **Paso 1.** Diagnóstico en cada entorno: comparar los hashes de `drizzle.__drizzle_migrations`
      contra `sha256` de cada `.sql`. Confirmar si producción tiene el mismo hueco (es lo primero que hay
      que saber).
- [ ] **Paso 2.** Aplicar el DDL de 0236 a mano donde falte.
- [ ] **Paso 3.** Insertar la fila correspondiente en `drizzle.__drizzle_migrations` con el hash real y
      `created_at = 1788229972647`. Es seguro: la marca de agua es `MAX`, así que un valor menor no la
      mueve, y deja el registro veraz para el preflight de la Tarea 8.
- [ ] **Paso 4.** Verificar el predicado resultante:
      `WHERE obligation_id IS NULL AND origin <> 'integration'`.

---

## Fase 1 · Que la compuerta y el contrato digan la verdad

### Tarea 4 · Verificar el destino también en las `compuesta`

**Archivos:** `lib/services/pdtp/fulfillment.ts` · `lib/__tests__/pdtp-fulfillment.test.ts`

[fulfillment.ts:636](lib/services/pdtp/fulfillment.ts#L636) corre la verificación de permiso de destino
sólo `if (activity.mechanism === "enganche")`. Las cuatro `compuesta` —N°15, 18, 23, 52— apuntan a
`sst:close` y ningún responsable lo tiene, y no salen ni como aviso.

Es la misma exención mal heredada que ya se corrigió dos bloques más arriba: estaba razonada para el
chequeo de la **planilla** ("nadie la ejecuta") y se arrastró primero al de **cableado** —eso se arregló,
con el comentario que lo explica— y después al de **destino**, que es posterior y heredó la exención sin
que nadie la volviera a razonar.

- [ ] **Paso 1.** Test que falla: una `compuesta` cuyo destino declara un permiso que ningún responsable
      tiene debe salir como `destination_review`.
- [ ] **Paso 2.** `if (activity.mechanism === "enganche" || activity.mechanism === "compuesta")`, con un
      comentario que cierre el ciclo de las tres exenciones.
- [ ] **Paso 3.** Confirmar que la compuerta pasa de 12 a 16 hallazgos y que **ninguno bloquea** —
      `destination_review` informa, no frena ([lib/services/pdtp/lifecycle.ts:127](lib/services/pdtp/lifecycle.ts#L127)).

### Tarea 5 · Corregir el contrato de cumplimiento

**Archivos:** `lib/services/pdtp-adapters/fulfillment-contract-2026.ts` · `lib/services/pdtp/fulfillment.ts`

Tres entradas contradicen a otra fuente del propio repositorio. Importa porque este archivo es lo único
que permite responder "¿quién puede ejecutar esto?".

- [ ] **N°19.** El contrato la manda a `documentacion` / `docs:publish`. Pero acredita desde el acta de
      trabajador nuevo: `STARTER_FOLDER_ACTIVITY_NUMBER = 19` en
      [worker-onboarding-connector.ts](lib/services/pdtp-adapters/worker-onboarding-connector.ts), con
      nueve líneas explicando que "cierra junto con" la N°15, la N°18 y la N°23. → cambiar a
      `{ module: "sst", permission: "sst:close", href: (w) => \`/prevencion/nueva?faena=${w}\` }` y quitar
      `segregated`.
- [ ] **N°26.** El contrato declara `inspections:review` con nota de segregación.
      [inspection-wiring.ts:83](lib/prevention/inspection-wiring.ts#L83) declara `n: [25, 26]` en la misma
      plantilla y documenta la decisión del 2026-08-23 ("transcribirlo línea por línea ES revisarlo y
      firmarlo"), sin `reviewN` — confirmado: las 25 plantillas tienen
      `pdtp_review_activity_numbers` vacío. → cambiar a `inspections:execute` y quitar `segregated`.
      El JT ya lo tiene; con la Tarea 6 el Sup también.
- [ ] **N°28.** El contrato la manda a `inspecciones` / `review`; `inspection-wiring.ts` la deja fuera del
      catálogo con seis líneas de justificación y su mecanismo en base es `constancia`, así que
      `resolvePdtpFulfillmentTarget` nunca consulta la entrada. → borrarla.
- [ ] **Docstring.** `destinationPermissionFor`
      ([fulfillment.ts:432](lib/services/pdtp/fulfillment.ts#L432)) sigue diciendo que el contrato
      "todavía no se escribió". Se escribió y la función de al lado lo usa.
- [ ] **Test.** Extender `lib/__tests__/pdtp-fulfillment.test.ts` con un caso que fije el destino de la
      N°19, la N°26 y la ausencia de la N°28.

---

## Fase 2 · RBAC: cerrar 17 de las 21

Cada grant es una línea en `defaultGrants`. **Ninguno requiere migración.**

De las 21, **cuatro se quedan segregadas a propósito** y quedan documentadas como tales: **N°35** (publicar
la MIPER), **N°43** (publicar el procedimiento), **N°80** (publicar la matriz GRD) y **N°83** (aprobar el
plan de emergencia) — en las cuatro, quien redacta no firma, y el servicio lo impone además del RBAC.

### Tarea 6 · Grants

**Archivos:** `modules/sst/manifest.ts` · `modules/prevention/manifest.ts` · `lib/__tests__/prevention-rbac.test.ts`

| Rol | Permiso | Cierra | Nota |
|---|---|---|---|
| `prevencionista_faena` | `sst:close` | **15, 17, 18, 19, 23, 52** | El PRF ya crea el acta (`sst:create`) y no puede cerrarla. Sin lista cerrada en tests. |
| `jefe_terreno`, `supervisor_terreno` | `sst:view` | — | Visibilidad: son responsables de la N°15 y la N°52 y hoy no tienen ningún permiso `sst:*`. |
| `supervisor_terreno` | `prevention:inspections:view` + `:execute` | **24, 29, 34, 39, 40** | `execute` no tiene lista cerrada; sólo invariantes `not.toContain("jefe_mantencion")`, que no se tocan. |
| `jefe_terreno`, `supervisor_terreno` | `prevention:training:view` + `:deliver` | **38, 53** | ⚠️ `deliver` **sí** tiene `toEqual` cerrada ([:333](lib/__tests__/prevention-rbac.test.ts#L333)): actualizar en el mismo commit. La invariante que protege es "dictar ≠ aprobar contenido", que sigue intacta. |
| `jefe_terreno` | `prevention:incidents:investigate` | **68, 69** | |
| `supervisor_terreno` | `prevention:incidents:view` + `:report` + `:investigate` | **69, 73, 76** | |
| `admin_contrato` | `prevention:incidents:notify` | **72** | Es el responsable de emitir la DIAT. |
| `prevencionista_faena` | `prevention:docs:distribute` | **36** | Difundir la MIPER es asignar destinatarios, no publicar. |
| `admin_contrato` | `prevention:docs:view` | — | Visibilidad de la N°43, que sigue segregada. |
| `jefe_mantencion` | `prevention:emergency:view` | — | Visibilidad de la N°83/84; Emergencias no le aparece en el menú. |
| `prevencionista_faena` | `prevention:indicadores:close` | **7** | **Requiere decisión** — ver abajo. |

- [ ] **Paso 1.** Editar los dos manifests. `view` no es implícito: el `nav` exige el `*:view` propio
      ([modules/prevention/manifest.ts:375](modules/prevention/manifest.ts#L375) y siguientes), así que
      cada `execute`/`deliver`/`investigate` va acompañado de su `view`.
- [ ] **Paso 2.** Actualizar la lista `toEqual` de `prevention:training:deliver`.
- [ ] **Paso 3.** `npm run db:sync-rbac` en dev. En producción no hace falta nada: el deploy lo corre.
- [ ] **Paso 4.** Correr el suite completo — el grant de `inspections:execute` amplía además el
      **destinatario de notificaciones** ([prevention-inspections.ts:2793](lib/services/prevention-inspections.ts#L2793),
      [prevention-inspection-scheduler.ts:211](lib/services/prevention-inspection-scheduler.ts#L211)), que
      es lo que cubre `notification-permission-targeting.test.ts`.

**Decisión pendiente — N°7.** `prevention:indicadores:close` no sólo cierra el período: su descripción es
"cerrar períodos **y corregir indicadores cerrados**". Otorgarlo al PRF le da la capacidad de corregir un
período firmado en su faena. El alcance por faena lo acota, pero es un permiso de control. Alternativa si
se prefiere no otorgarlo: partirlo en `indicadores:close` e `indicadores:amend`, y dar sólo el primero.
**Recomiendo otorgarlo tal cual** y revisarlo si aparece un hallazgo de auditoría — partir el permiso es
trabajo real y el riesgo está acotado por faena y por bitácora.

### Tarea 7 · Separar la difusión del cierre de un incidente (N°71, 75, 77)

**Archivos:** `modules/prevention/manifest.ts` · `lib/services/prevention-incidents.ts` · `lib/__tests__/prevention-rbac.test.ts`

`confirmIncidentDiffusion` exige `prevention:incidents:close`
([prevention-incidents.ts:1762](lib/services/prevention-incidents.ts#L1762)), que sólo tienen
`administrador` y `jefa_chome`. Confirmar que se difundió el incidente en el turno **no es** cerrar el
incidente: son dos actos con dueños distintos, y conflarlos es lo que deja tres actividades del RE-20 sin
vía para su responsable.

- [ ] **Paso 1.** Permiso nuevo `prevention:incidents:diffuse` — tres lugares del manifest
      (`permissions`, `permissionMeta` con id corto único, `defaultGrants`) más la lista `expected` de
      [prevention-rbac.test.ts:6-108](lib/__tests__/prevention-rbac.test.ts#L6).
- [ ] **Paso 2.** Grants: `jefe_terreno` (N°71, 75), `prevencionista_faena` (N°75, 77), `prevencionista`,
      `administrador`.
- [ ] **Paso 3.** Cambiar el `requireAccess` de `confirmIncidentDiffusion` al permiso nuevo. Dejar
      `incidents:close` para la transición de estado a `closed`
      ([prevention-incidents.ts:377](lib/services/prevention-incidents.ts#L377),
      [actions.ts:256](app/(app)/prevencion/incidentes/actions.ts#L256)) — ése no cambia.
- [ ] **Paso 4.** Actualizar el contrato: N°71, 75 y 77 pasan a `prevention:incidents:diffuse`.
- [ ] **Paso 5.** Test de segregación: quien difunde no cierra.

### Tarea 8 · Preflight permanente de responsables

**Archivos:** `scripts/preflight-pdtp-responsables.ts` (nuevo) · `scripts/preflight-pdtp-responsables.test.ts` · `package.json`

La tabla 60/21/0 de la auditoría se calculó con un script ad hoc. Debe ser reproducible, o la próxima vez
hay que auditar actividad por actividad otra vez.

- [ ] Seguir el patrón de [scripts/preflight-pdtp-accreditation-wiring.ts](scripts/preflight-pdtp-accreditation-wiring.ts):
      función pura `assertX(report)` + `inspectX()` + `main()` que imprime JSON, guard de invocación
      directa, tolerancia a base nueva (`42P01` → `{ ok: true, skipped: true }`), **diagnóstico y no
      compuerta** (`exit 0`).
- [ ] Cruzar `pdtp_activities` × `pdtp_responsible_catalog` (respetando `operated_by_role_name`) ×
      `role_permissions`, contra `PDTP_2026_ENGANCHE_DESTINATIONS`. Reportar por actividad: `ok`,
      `solo_manual`, `segregada`. Y por rol: declarado en N, puede ejecutar M.
- [ ] Añadirlo a `apply-pdtp-data.sh` **y** a `deploy-prod.sh` — hay un test de paridad entre las dos
      listas ([pdtp-data-steps-parity.test.ts:49](lib/__tests__/pdtp-data-steps-parity.test.ts#L49)) que
      falla si divergen.

---

## Fase 3 · Prevención de recurrencia

### Tarea 9 · Preflight de migraciones contra la base

**Archivos:** `scripts/migration-preflight.mjs` (extender) · `scripts/migration-preflight.test.ts`

Ninguna herramienta actual detecta una migración saltada. `verify-migration-chain.mjs` lo dice él mismo
—*"This does not inspect the database"*— y además **no está en la cadena de `db:migrate`**;
`migration-preflight.mjs` sí se conecta pero mira **datos**, no el estado del migrador. Con la marca de
agua única de Drizzle (Tarea 3), esto puede repetirse en cualquier merge de ramas paralelas.

- [ ] **Paso 1.** Agregar a `migration-preflight.mjs` una comprobación: leer
      `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`, calcular `sha256`
      del contenido crudo de cada `.sql` (es el mismo hash que usa el migrador,
      `node_modules/drizzle-orm/migrator.js:23`) y verificar que lo aplicado sea un **prefijo completo**
      del journal, sin huecos.
- [ ] **Paso 2.** Es **compuerta**, no diagnóstico: `MIGRATION_PREFLIGHT_BLOCKED` con la lista de tags
      faltantes, siguiendo el estilo del archivo. Va antes de `migrate.mjs`, que ya lo llama.
- [ ] **Paso 3.** Tolerar base nueva (`to_regclass('drizzle.__drizzle_migrations')` nulo → skip).
- [ ] **Paso 4.** Test de la función pura de aserción, sin base, como los demás casos del archivo.

### Tarea 10 · La cola de pendientes contra el contrato

**Archivos:** `lib/services/operational-work-queue.ts` · `lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts` · `lib/__tests__/navigation-targets-exist.test.ts`

[operational-work-queue.ts:790](lib/services/operational-work-queue.ts#L790) mantiene un `CASE` en SQL que
sólo distingue `constancia` del resto y manda todo lo demás a la planilla, mientras
`resolvePdtpFulfillmentTarget` manda la N°24 a Inspecciones, la N°53 a Capacitación y la N°83 a
Emergencias. Su propio comentario dice *"Si cambia uno, cambia el otro"* — y uno cambió cuando se escribió
el contrato. El responsable que abre `/pendientes` con la N°24 encima aterriza en la planilla.

Va al final a propósito: es la tarea más invasiva y la que menos riesgo corre si se posterga.

- [ ] **Paso 1.** Agregar `mechanism` y `activity_n` al contrato de columnas del `UNION ALL`. Las ~20
      ramas restantes llevan `NULL::text` / `NULL::int` — el patrón ya existe con
      `emptyAssignee = sql\`NULL::text\`` ([:547](lib/services/operational-work-queue.ts#L547)). Propagar
      por el CTE `enriched` ([:1226](lib/services/operational-work-queue.ts#L1226)), el
      `jsonb_build_object` ([:1254](lib/services/operational-work-queue.ts#L1254)) y el `SELECT … WHERE false`
      de [:1071](lib/services/operational-work-queue.ts#L1071).
      *No parsear `code`*: `CONCAT('N°', n)` es presentación y acoplarla al enrutamiento es el mismo error
      en otra capa.
- [ ] **Paso 2.** `module` de la unión **sigue siendo `'pdtp'`** — `queueScopeFilterSql`
      ([:1160](lib/services/operational-work-queue.ts#L1160)) y los chips se calculan en SQL sobre esa
      columna. No usar `destination.module` ahí.
- [ ] **Paso 3.** Resolver en TS en `getOperationalWorkQueuePage`
      ([:1267](lib/services/operational-work-queue.ts#L1267)), justo después de `parseJsonColumn`, que ya
      devuelve `OperationalWorkItem[]` tipado: un `.map()` que para `sourceType === "pdtp_activity"`
      llame a `resolvePdtpFulfillmentTarget({ mechanism, n }, worksiteId)` y sobrescriba `href`/`ctaLabel`.
      Importar de `fulfillment.ts`, no del contrato: la lógica de degradación a la planilla es justo lo
      que no hay que duplicar. Cubre también la ruta de `probeOperationalSourceBranches`.
- [ ] **Paso 4.** El test actual ([:208-216](lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts#L208))
      **seguirá verde sin probar nada nuevo**: su actividad de enganche usa `n = 2`, que no está en el
      mapa, así que cae al fallback. Sembrar una con `n = 10` y afirmar
      `/prevencion/inspecciones` + `"Ir a cumplirla"`.
- [ ] **Paso 5.** ⚠️ [navigation-targets-exist.test.ts:62-70](lib/__tests__/navigation-targets-exist.test.ts#L62)
      **lee el texto fuente** y exige el literal `WHEN 'constancia' THEN CONCAT('…'`. Se rompe al quitar el
      `CASE`. Reescribirlo para recorrer `PDTP_2026_ENGANCHE_DESTINATIONS` completo y comprobar que cada
      `href(worksiteId)` existe en el App Router — cubre más de lo que cubría antes.

### Tarea 11 · Segregación de publicación (decisión, opcional)

MIPER, matriz GRD y requisitos legales exigen `approved ≠ creador/revisor`
([prevention-cgrd.ts:481](lib/services/prevention-cgrd.ts#L481),
[prevention-risk-legal.ts:498](lib/services/prevention-risk-legal.ts#L498),
[:840](lib/services/prevention-risk-legal.ts#L840)) pero **ninguno** exige `published ≠ approved`, y
`*:approve` y `*:publish` los tiene el mismo par de roles (`administrador`, `jefa_chome`). El contrato
promete de la N°80 *"cuatro permisos y cuatro personas"*: son cuatro permisos y como máximo tres personas.
En requisitos legales es peor — `approved` y `published` comparten el **mismo** permiso
([prevention-risk-legal.ts:829](lib/services/prevention-risk-legal.ts#L829)).

- [ ] **O bien** agregar el chequeo `publishedByUserId ≠ approvedByUserId` en los tres servicios y un rol
      publicador aparte, **o bien** corregir el texto que promete cuatro firmas. Lo que no puede quedar es
      la promesa escrita sin la evidencia detrás: es documentación oponible ante fiscalizador.

---

## Fase 4 · Operativo (no es código)

En este orden. El orden importa: **activar antes de aprobar plantillas**, o se cae en la Tarea 2.

- [ ] **1.** Verificar en producción si el hueco de migraciones existe (Tarea 3, paso 1). Antes que nada.
- [ ] **2.** Desplegar las Fases 0–2. `sync-rbac` corre solo en el deploy.
- [ ] **3.** **Asignar faenas** en `worksite_users` a los usuarios de `supervisor_terreno`, `jefe_terreno`,
      `admin_contrato` y `jefe_mantencion`. Sin esto, `resolveWorksiteScope` devuelve `mode: "none"` y los
      grants de la Fase 2 no sirven de nada. UI: `/admin/usuarios`.
- [ ] **4.** **Resolver el rol fantasma `supervisor_faena`.** Existe en base con dos permisos y un usuario
      asignado, y **no está en [system-rbac.ts](lib/auth/system-rbac.ts)** (15 roles definidos, 16 en
      base). El catálogo mapea `sup` → `supervisor_terreno`. Si en producción hay supervisores sobre el rol
      legado, no verán ninguna de sus 15 actividades. Decidir: migrar los usuarios a `supervisor_terreno`
      y retirar el rol, o incorporarlo formalmente.
- [ ] **5.** Contrastar en producción que los roles responsables tengan personas reales. En `bodega_dev`,
      `supervisor_terreno`, `gerente_legal_rrhh` y `subgerente_operaciones` tienen **cero** usuarios reales.
- [ ] **6.** **Activar `pdtp-2026-v1`** desde el mes en curso.
- [ ] **7.** Aprobar las **13 plantillas de inspección** en borrador. Después de activar (Tarea 2 lo hace
      tolerante, pero el orden correcto sigue siendo éste).
- [ ] **8.** Aprobar los **7 planes de emergencia** — están cargados y en `draft`. Los desbloquea
      `prevencionista` o `jefa_chome`; ninguno de los tres responsables declarados de la N°83 tiene
      `emergency:approve`, y sin plan aprobado la N°84 tampoco puede programar simulacros
      ([prevention-emergency.ts:539](lib/services/prevention-emergency.ts#L539)).
- [ ] **9.** Correr `npm run pdtp:reconcile-fulfillment-events` por si quedaron eventos `pending`.
- [ ] **10.** Re-correr el preflight de la Tarea 8 y confirmar el nuevo reparto (esperado: 77 ok, 4
      segregadas, 0 sin vía).

---

## Verificación

**Por tarea**, antes de avanzar:

```bash
npx tsc --noEmit
npx eslint "app/(app)/prevencion/**/*.{ts,tsx}" "lib/services/pdtp/**/*.ts" \
  "lib/services/pdtp-adapters/**/*.ts" "lib/services/prevention-*.ts"
```

**Suites** (línea base actual: **1.964 en verde**, 719 + 1.245, cero fallos):

```bash
npx vitest run --config vitest.non-pglite.config.ts lib/__tests__/pdtp lib/__tests__/prevention \
  lib/__tests__/prevencion lib/services/pdtp
npx vitest run --config vitest.pglite.config.ts        # ~9 min
```

Tests que **este plan rompe a propósito** y hay que actualizar en el mismo commit:
`prevention-rbac.test.ts` (lista `toEqual` de `training:deliver`, lista `expected` si se agrega
`incidents:diffuse`), `navigation-targets-exist.test.ts` (Tarea 10),
`operational-work-queue-pdtp-activity-source.test.ts` (Tarea 10).

**End to end** de la pregunta que originó todo:

```bash
npx tsx --env-file=.env.local scripts/preflight-pdtp-responsables.ts   # tras la Tarea 8
```

Debe reportar **0 actividades sin vía** y **4 segregadas** (N°35, 43, 80, 83), con el detalle por rol.

**Manual, tras la Fase 2** — con una cuenta de `supervisor_terreno` con faena asignada: que
`/prevencion/inspecciones` aparezca en el menú, que se pueda ejecutar una inspección de contenedores
(N°29), y que la actividad salga de `/pendientes` al cerrarla. Es la prueba de que el permiso, el alcance
y la acreditación funcionan juntos.

**E2E existentes** que cubren estos caminos: `e2e/prevencion-inspecciones-roles-permisos.spec.ts`,
`e2e/prevencion-inspecciones-flujo-integral.spec.ts`, `e2e/prevencion-incidentes-re20.spec.ts`,
`e2e/prevencion-emergencias-simulacros.spec.ts`.

**Al terminar:** copiar este plan a `docs/superpowers/plans/2026-09-05-prevencion-responsables.md`, que
es donde vive la serie.
