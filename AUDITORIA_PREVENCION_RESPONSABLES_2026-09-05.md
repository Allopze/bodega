# Auditoría del módulo de Prevención: defectos, y quién puede ejecutar cada actividad

**Fecha:** 5 de septiembre de 2026

**Alcance:** el módulo completo de Prevención —PDTP, Inspecciones, Capacitación, Incidentes,
Emergencias, CGRD, MIPER, Higiene, Documentación, EPP, Campañas, Constancias— con foco en la
pregunta que originó el encargo: **¿cada actividad del programa tiene forma de ser ejecutada por su
responsable declarado?**

Continúa [AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md](AUDITORIA_PDTP_EJECUCION_ACREDITACION_2026-09-03.md),
que respondió "¿se puede ejecutar y acreditar?" sin mirar **quién**. Ésta agrega el tercer eje: el
permiso del acto que acredita, contra los roles del responsable.

**Verificación:** `tsc --noEmit` limpio, `eslint` limpio sobre todo el módulo, **1.964 tests en verde**
(719 non-pglite + 1.245 pglite, 0 fallos). Los hallazgos de abajo no son tests rotos: son rutas,
configuración y tres defectos que ningún test cubre hoy.

---

> **Nota del 5 de septiembre, tarde:** los defectos de las §2–§4 se corrigieron el mismo día y la
> respuesta pasó de **60/81 a 76/81**. Las secciones 1 a 6 conservan el diagnóstico como se levantó —es
> lo que hace legible el §7— y el **§7 dice qué quedó implementado y qué sigue abierto**.

## 1. La respuesta: 60 de 81

De las **81 actividades activas** de `pdtp-2026-v1`:

| | Actividades | Qué significa |
|---|---|---|
| ✅ **60** | — | Alguno de sus responsables tiene el permiso del **acto que acredita**: ejecuta en su módulo y el PDTP se entera solo. |
| ⚠️ **21** | 7, 15, 17, 18, 19, 23, 26, 35, 36, 38, 43, 52, 53, 68, 69, 71, 72, 75, 77, 80, 83 | Ningún responsable tiene ese permiso. **Sólo pueden marcarse a mano en la planilla**, con evidencia autodeclarada en vez del registro del módulo. |
| 🔴 **0** | — | Ninguna queda sin vía: todos los roles responsables tienen `prevention:pdtp:execute`, y `markPdtpExecution` no filtra por mecanismo ([executions.ts:16](lib/services/pdtp/executions.ts#L16)). |

La marca manual es la red, no la vía. Una actividad de `enganche` marcada a mano queda con
`origin = 'manual'` y sin el registro del módulo detrás: para un fiscalizador es la diferencia entre
"hay una inspección firmada" y "alguien escribió que la hizo".

### Por rol responsable

| Rol | Declarado en | Puede ejecutar | No puede |
|---|---|---|---|
| `prevencionista_faena` | 62 | 48 | 7, 15, 17, 18, 19, 23, 35, 36, 43, 52, 75, 77, 80, 83 |
| `admin_contrato` | 21 | 9 | 43, 52, 70, 72, 73, 74, 76, 79, 80, 81, 83, 87 |
| `jefe_terreno` | 21 | 10 | 15, 26, 38, 52, 53, 68, 69, 71, 73, 75, 76 |
| **`supervisor_terreno`** | **15** | **2** | 15, 24, 26, 29, 34, 38, 39, 40, 52, 53, 69, 73, 76 |
| `prevencionista` (JDPR) | 4 | 4 | — |
| `jefe_mantencion` | 3 | 1 | 83, 84 |
| `gerente_legal_rrhh` | 1 | 1 | — |

**El supervisor de terreno es el caso grave.** Tiene 7 permisos de Prevención —alcotest, constancias y
la planilla— y la planilla lo declara responsable de 15 actividades. No puede ejecutar inspecciones
(N°24, 29, 34, 39, 40), no puede registrar charlas (N°38, N°53 —la charla **diaria**), no puede tocar
incidentes (N°69, 73, 76) ni el acta de trabajador nuevo (N°15, 52). Peor que el permiso: sin
`prevention:inspections:view`, `training:view`, `incidents:view` ni `docs:view`, **esos módulos no le
aparecen en el menú** ([manifest.ts:371 en adelante](modules/prevention/manifest.ts#L371)).

Le sigue `jefe_mantencion`: responsable de la N°83 y la N°84 sin `prevention:emergency:view` —
Emergencias no existe en su navegación—, y `admin_contrato`, responsable de la N°43 (procedimientos de
trabajo seguro) sin `prevention:docs:view`.

### Los cuatro grupos de la brecha

**A — Segregación legítima (7 actividades: 19, 26, 35, 43, 80, 83, y la N°1/9/11 de gobernanza).**
Quien redacta no firma. `approveEmergencyPlan` rechaza que el aprobador sea el autor; la MIPER y la
matriz GRD exigen que aprobar esté segregado de crear y revisar. Está bien que el responsable no tenga
el permiso — pero ver §4, porque la segregación promete más de lo que cumple.

**B — El acta de trabajador nuevo: 4 actividades (N°15, 18, 23, 52) + la N°17.**
Las cinco acreditan al **cerrar** el acta ([worker-onboarding-connector.ts](lib/services/pdtp-adapters/worker-onboarding-connector.ts)),
y `sst:close` lo tienen sólo `prevencionista` y `administrador`
([manifest.ts:37](modules/sst/manifest.ts#L37)). El `prevencionista_faena` crea el acta y no puede
cerrarla; el supervisor y el jefe de terreno **no tienen ningún permiso `sst:*`**, ni siquiera
`sst:view`. El propio conector documenta que el Acta de Cierre va "firmada por supervisor y
prevencionista": el instrumento pide una firma que la plataforma no le deja dar a nadie con ese rol.

**C — Incidentes: 6 actividades (N°68, 69, 71, 72, 75, 77).**
Los trece pasos del RE-20 reparten cinco permisos distintos y los responsables declarados tienen dos.
El jefe de terreno reporta (N°66 ✅) pero no puede enviar el informe preliminar (N°68, exige
`investigate`) ni difundir el incidente en su turno (N°71, exige `close`). El administrador de
contrato es el responsable de emitir la DIAT (N°72) y no tiene `prevention:incidents:notify`. La N°77
—archivar el expediente— es del PRF y exige `close`, que sólo tienen `administrador` y `jefa_chome`.

**D — Actos que el responsable hace y otro cierra: N°7, 36, 38, 53.**
La N°7 es "envío de estadística de cada faena": el PRF carga los indicadores (`indicadores:manage` ✅)
pero acredita el **cierre de período**, que exige `indicadores:close` y no tiene. La N°38 y la N°53 son
las charlas de seguridad que da la línea de mando: `training:deliver` lo tienen el PRF y el JDPR, no
el Sup ni el JT.

### Emergencias: bloqueada por una firma que nadie del grupo puede dar

Los 7 planes de emergencia ya están cargados (eran 0 en el informe anterior) pero **los 7 están en
`draft`**. La N°83 acredita al aprobar el plan y la N°84 exige plan aprobado para siquiera programar
un simulacro ([prevention-emergency.ts:539](lib/services/prevention-emergency.ts#L539)). Los tres
responsables —PRF, administrador de contrato, jefe de mantención— no tienen `emergency:approve`. Las
dos actividades esperan a `prevencionista` o `jefa_chome`.

---

## 2. Defectos de código

### D1 · Campañas preventivas pierden la acreditación en silencio

[prevention-campaigns.ts:199](lib/services/prevention-campaigns.ts#L199) es el **único** llamador que
quedó con el patrón que la capa de cumplimiento vino a eliminar:

```ts
try { await accreditPdtpFromEvent({ … }) }
catch (err) { logger.error({ err, campaignId }, "…") }
```

Los otros cinco conectores pasan por `recordPdtpFulfillmentEvent`, que escribe un evento durable
**antes** de intentar acreditar y lo deja en `pending` para que
`reconcilePdtpFulfillmentEvents` lo reprocese ([fulfillment.ts:8](lib/services/pdtp/fulfillment.ts#L8)).
Campañas no. Con `pdtp-2026-v1` en `draft`, `accreditPdtpFromEvent` **lanza**
([accreditation.ts:234](lib/services/pdtp/accreditation.ts#L234)) y el hecho desaparece: hay **35
campañas cargadas** (5 × 7 faenas, N°85–89) y ninguna cerrada todavía, así que aún no se perdió nada —
pero la primera que se cierre antes de activar el programa se pierde sin evento que reprocesar.

**Arreglo:** cambiar la llamada por `recordPdtpFulfillmentEvent`. Es una línea.

### D2 · Aprobar una plantilla antes de activar el programa bloquea el cierre de inspecciones

`onInspectionCompleted` tiene dos caminos. Sin transacción usa `safeAccredit` (durable). **Con**
transacción llama directo a `accreditPdtpFromEvent` y no atrapa
([pdtp-accreditation-connectors.ts:106](lib/services/pdtp-adapters/pdtp-accreditation-connectors.ts#L106)),
y los tres llamadores reales pasan `tx`
([prevention-inspections.ts:1393](lib/services/prevention-inspections.ts#L1393),
[:1608](lib/services/prevention-inspections.ts#L1608),
[:2000](lib/services/prevention-inspections.ts#L2000)).

Es deliberado —"nunca puede quedar el run completado sin su cumplimiento"— pero tiene un borde que
nadie declaró: si la plantilla declara números PDTP y **no hay programa activo**, el `throw` de
`resolvePdtpActiveProgramForEvent` revierte la transacción entera y **la inspección no se puede
cerrar**. El operador ve `Sin programa PDTP activo para el evento inspeccion:<runId> en faena <id>.`

Hoy no ocurre porque las 13 plantillas con números están en `draft` y sólo una `approved` se puede
ejecutar. Ocurre **el día que se ejecute el paso 2 del informe anterior (aprobar las plantillas) antes
del paso 1 (activar el programa)** — que es un orden perfectamente posible, porque activar el programa
es una decisión y aprobar plantillas es un trámite.

**Arreglo:** o el orden queda escrito como precondición dura, o el camino transaccional tolera
"sin programa activo" como no-op registrando el evento durable, igual que el no transaccional.

### D3 · `bodega_dev` tiene una migración sin aplicar y ninguna herramienta lo detecta

De las 256 migraciones del repositorio, **255 están aplicadas**. La que falta es
`0236_typical_abomination.sql`, y no es cualquiera: es la que saca a las integraciones del índice de
período de `pdtp_executions`.

```
CREATE UNIQUE INDEX pdtp_executions_activity_scope_period_unique
  ON pdtp_executions (activity_id, worksite_id, year, month, week)
  WHERE obligation_id IS NULL                      ← lo que hay en bodega_dev
    AND origin <> 'integration'                    ← lo que agrega 0236
```

Verificado en transacciones revertidas: con el índice actual, dos eventos de integración distintos en
la misma actividad/faena/semana chocan —`duplicate key value violates unique constraint`— y
`accreditPdtpFromEvent` termina en `throw new Error("La acreditación colisionó sin una ejecución
idempotente recuperable.")`, porque su `onConflictDoNothing()` no lleva `target` y se traga el conflicto
del índice equivocado. Con el índice de 0236 las dos filas entran. Es exactamente el caso de la
**N°53 (charla diaria)** y de cualquier semana con dos inspecciones del mismo instrumento.

El código está bien; el entorno no. Lo preocupante es lo segundo:
`scripts/verify-migration-chain.mjs` lo dice él mismo —*"This does not inspect the database"*— y
`migration-preflight.mjs` tampoco lee `drizzle.__drizzle_migrations`. **Una migración saltada en
cualquier entorno pasa desapercibida hasta que rompe algo.**

**Arreglo:** aplicar 0236 en `bodega_dev`, y agregar al preflight una comparación de hashes aplicados
contra los archivos del artefacto. Son ~20 líneas y cubren todos los módulos, no sólo éste.

### D4 · La compuerta no verifica el destino de las `compuesta`

[fulfillment.ts:636](lib/services/pdtp/fulfillment.ts#L636) corre la verificación de permiso de destino
sólo `if (activity.mechanism === "enganche")`. Las cuatro `compuesta` —N°15, 18, 23, 52— apuntan a
`sst:close` en el contrato y **ningún responsable lo tiene**, y no salen ni como `destination_review`.

Es el mismo error que ya se corrigió una vez, dos bloques más arriba: la exención de `compuesta`
estaba razonada para el chequeo de la **planilla** ("nadie la ejecuta, se cumple cuando sus componentes
cierran") y se arrastró al chequeo de **cableado**, donde no aplicaba — eso se arregló y el comentario
lo explica. El chequeo de destino, que es posterior, heredó la exención sin que nadie la volviera a
razonar.

**Arreglo:** `if (activity.mechanism === "enganche" || activity.mechanism === "compuesta")`. La
compuerta pasaría de reportar 12 problemas a 16, y los 4 nuevos son reales.

### D5 · La cola de pendientes ignora el contrato de cumplimiento

`resolvePdtpFulfillmentTarget` consulta el contrato y manda cada actividad a su módulo:

| N° | `resolvePdtpFulfillmentTarget` | Cola de pendientes (SQL) |
|---|---|---|
| 24 | `/prevencion/inspecciones?faena=…` · "Ir a cumplirla" | `/prevencion/pdtp/actividades?…&vista=semana` · "Ver cómo se cumple" |
| 53 | `/prevencion/capacitacion?faena=…` | idem |
| 83 | `/prevencion/emergencias?faena=…` | idem |

[operational-work-queue.ts:790](lib/services/operational-work-queue.ts#L790) mantiene el `CASE` en SQL
que sólo distingue `constancia` del resto. Su propio comentario dice *"Espeja
resolvePdtpFulfillmentTarget […] Si cambia uno, cambia el otro"* — y uno cambió cuando se escribió
`fulfillment-contract-2026.ts`. El test
[operational-work-queue-pdtp-activity-source.test.ts:213](lib/__tests__/operational-work-queue-pdtp-activity-source.test.ts#L213)
fija el comportamiento viejo, así que la deriva no se ve.

Importa para la pregunta de este informe: el responsable que abre `/pendientes` con la N°24 encima
aterriza en la planilla, no en Inspecciones. La vía existe y la cola no lleva a ella.

**Arreglo:** materializar el contrato como tabla o `VALUES` para poder unirlo en SQL, o resolver el
`href` en TypeScript después del `UNION ALL`. Y corregir el test.

---

## 3. Inconsistencias del contrato de cumplimiento

`fulfillment-contract-2026.ts` es la pieza que hace posible responder la pregunta de este informe, y es
buena. Tiene tres entradas que contradicen a otra fuente del propio repositorio:

1. **N°26.** El contrato declara `prevention:inspections:review` con la nota *"Es la revisión y firma
   del report que otra persona ejecutó"*. Pero
   [inspection-wiring.ts:83](lib/prevention/inspection-wiring.ts#L83) declara `n: [25, 26]` en la misma
   plantilla y documenta la decisión del 2026-08-23: *"Transcribirlo línea por línea ES revisarlo y
   firmarlo, así que la n=26 acredita al declarar ejecutada y no en un segundo paso"* — sin `reviewN`,
   confirmado en `prevention_inspection_templates.pdtp_review_activity_numbers`, vacío en las 25 filas.
   Una de las dos está mal, y como la entrada lleva `segregated`, la compuerta ni siquiera mira.
   Si vale la decisión de agosto, el permiso correcto es `inspections:execute` — que el JT **sí** tiene,
   y la N°26 sale de la lista de 21.
2. **N°28.** El contrato la manda a inspecciones/`review`. `inspection-wiring.ts` la deja fuera del
   catálogo con seis líneas de justificación (*"es un acto semanal sobre el CONJUNTO recibido"*) y su
   mecanismo en base es `constancia`. La entrada es código muerto que sólo puede confundir.
3. **Docstring de `destinationPermissionFor`** ([fulfillment.ts:432](lib/services/pdtp/fulfillment.ts#L432))
   sigue diciendo que el mapa actividad → módulo *"es justamente el contrato anual que el plan pedía en
   `fulfillment-contract-2026.ts` y que todavía no se escribió"*. Se escribió, y la función de al lado
   lo usa.

---

> **Cerrado el mismo día.** Los tres flujos comparan ahora también el actor al publicar, y la JDPR entró
> al conjunto de firmantes con una excepción declarada (`prevention:sign_own_work`). Ver §7.

## 4. La segregación promete cuatro firmas y entrega tres

MIPER, matriz GRD y requisitos legales comparten el mismo flujo `draft → in_review → reviewed →
approved → published` y la misma regla:

```ts
if (data.toStatus === "approved" && (matrix.createdByUserId === access.userId
    || matrix.reviewedByUserId === access.userId)) throw new Error("La aprobación debe estar segregada…")
```

([prevention-cgrd.ts:481](lib/services/prevention-cgrd.ts#L481),
[prevention-risk-legal.ts:498](lib/services/prevention-risk-legal.ts#L498),
[:840](lib/services/prevention-risk-legal.ts#L840))

**Ninguno de los tres exige que quien publica sea distinto de quien aprobó.** Y en RBAC,
`*:approve` y `*:publish` los tienen exactamente los mismos dos roles:

| Permiso | Roles |
|---|---|
| `prevention:cgrd:matrix:approve` / `:publish` | `administrador`, `jefa_chome` |
| `prevention:risk:approve` / `:publish` | `administrador`, `jefa_chome` |
| `prevention:legal:approve_applicability` (aprobar **y** publicar) | `administrador`, `jefa_chome` |

El contrato dice de la N°80: *"cuatro permisos y cuatro personas"*. Son cuatro permisos y, como máximo,
tres personas — y con un solo usuario de `jefa_chome` en una faena, dos. En los requisitos legales es
peor: `approved` y `published` comparten el **mismo** permiso, así que ahí ni siquiera hay dos pasos.

No es urgente, pero es una promesa escrita que la evidencia no sostiene, y es evidencia oponible ante
fiscalizador. Decidir: o se agrega el chequeo `published ≠ approved` y un rol publicador aparte, o se
corrige el texto.

---

## 5. Higiene de RBAC

- **`supervisor_faena` es un rol fantasma.** Existe en base con `prevention:docs:view` y
  `prevention:pdtp:view`, tiene un usuario asignado, y **no está en
  [system-rbac.ts](lib/auth/system-rbac.ts#L29)** (15 roles definidos, 16 en base). El catálogo de
  responsables mapea `sup` → `supervisor_terreno`, que sí está definido. Si en producción hay
  supervisores de faena sobre el rol legado, no ven ninguna de sus 15 actividades. **Verificar en
  producción antes que nada.**
- **`supervisor_terreno`, `gerente_legal_rrhh` y `subgerente_operaciones` no tienen ningún usuario real
  en `bodega_dev`** (los únicos asignados son la cuenta del desarrollador). Los cinco
  `prevencionista_faena` sí son personas reales. No extrapolable a producción, pero conviene
  contrastarlo: un rol responsable sin gente detrás produce actividades sin dueño.
- Ningún permiso `prevention:*` quedó huérfano (sin rol): 0 de 123.

---

## 6. Lo que sí se cerró desde el 3 de septiembre

Vale registrarlo, porque cambia el orden de lo que queda:

| Del informe anterior | Estado |
|---|---|
| Paso 3 · cargar `sst_document_types` | ✅ 9 tipos, con `[43]` en PTS y `[36]` en MIPER-DIF |
| Paso 4 · plan de emergencia por faena | ✅ 7 planes cargados (falta aprobarlos — §1) |
| Paso 5 · sacar N°36/43/84 de `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` | ✅ hecho, con el criterio escrito |
| Paso 6 · extender la verificación de cableado a `compuesta` | ✅ hecho (falta la de **destino** — D4) |
| Paso 7 · decidir la N°16 | ✅ curso `PDTP-16` declara `[16]` |
| Paso 8 · generadores de obligación | ✅ N°11, 15, 17, 52 y 57 tienen generador; la N°16 no lo necesita (se mide por `coverage`, no por `closed_on_time`) |
| Paso 9 · cablear `onSafetyIndicatorPeriodReopened` (T54) | ✅ tres llamadores |
| **Paso 1 · activar `pdtp-2026-v1`** | ❌ sigue en `draft`. `pdtp_executions`, `pdtp_obligations` y `pdtp_fulfillment_events` en cero. |
| Paso 2 · aprobar las 13 plantillas en borrador | ❌ pendiente — y ver D2 sobre el orden |

---

## 7. Estado de la implementación (5 de septiembre, tarde)

Lo que sigue se implementó y verificó el mismo día. El plan completo está en
`docs/superpowers/plans/2026-09-05-prevencion-responsables.md`.

**La respuesta a la pregunta cambió: de 60/81 a 76/81.** El preflight —ahora permanente, ver abajo—
reporta **76 `ok`, 5 `segregada`, 0 `solo_manual`**. Las 21 que sólo podían marcarse a mano se cerraron:
17 con grants y correcciones de contrato, y 4 resultaron ser segregación legítima que ahora está
declarada como tal (más la N°77, que se sumó al reclasificarla).

| Rol | Antes | Ahora |
|---|---|---|
| `prevencionista_faena` | 48 de 62 | **57 de 62** |
| `admin_contrato` | 9 de 21 | **10 de 21** |
| `jefe_terreno` | 10 de 21 | **19 de 21** |
| `supervisor_terreno` | **2 de 15** | **13 de 15** |
| `jefe_mantencion` | 1 de 3 | 1 de 3 (las dos restantes son la N°83/84, segregadas) |

Lo que queda en la columna "no puede" de cada rol son actividades con co-responsable que sí puede, o
las cinco segregadas: **N°35** (publicar la MIPER), **N°43** (publicar el procedimiento), **N°77**
(cerrar el incidente), **N°80** (publicar la matriz GRD) y **N°83** (aprobar el plan de emergencia).

### Defectos corregidos

- **D1 · Campañas.** `closeCampaign` pasa por `recordPdtpFulfillmentEvent`. Ya no queda ningún llamador
  con el patrón `try { accreditar } catch { log }`. De paso, el mensaje al operador dejó de decir
  "acredita manualmente" cuando el hecho quedó en la cola de reconciliación — hacerlo producía una
  ejecución duplicada.
- **D2 · Orden de activación.** "No hay programa activo" dejó de ser un error genérico:
  `PdtpNoActiveProgramError` lo distingue, y el camino transaccional de inspecciones lo anota como
  evento `pending` **en la misma transacción** y cierra el run. Un número de actividad inexistente o una
  faena fuera del programa siguen revirtiendo el cierre: ésos sí son inconsistencias.
  El evento se escribe con la transacción y no con la conexión global, que era la trampa: sobre una
  sola conexión —PGlite en los tests— eso directamente cuelga.
- **D3 · Migración 0236.** Aplicada en `bodega_dev`, con su fila registrada en
  `drizzle.__drizzle_migrations`. **La causa raíz es peor que el síntoma:** el migrador de Drizzle usa
  una sola marca de agua (`MAX(created_at)`) con `<` estricto y **el hash no participa de la decisión**,
  así que una migración que entra con un `when` anterior al de otra ya aplicada queda saltada para
  siempre, en silencio. `migration-preflight.mjs` ahora lo detecta y **bloquea**; verificado contra la
  base real: reportó la 0236 antes de aplicarla y quedó en 256/256 después.
- **D4 · La compuerta y las `compuesta`.** El chequeo de destino corre también para `compuesta`. Es la
  tercera vez que había que razonar la misma exención, y ahora está escrito por qué no aplica acá.
- **D5 · La cola de pendientes.** El `CASE` de SQL dejó de decidir el destino: lo resuelve
  `resolvePdtpFulfillmentTarget` contra el contrato, con una consulta por página y sólo cuando hay
  filas del PDTP. El test que fijaba el comportamiento viejo usaba una actividad con `n=2` —que no está
  en el mapa— así que pasaba en verde sin probar nada; ahora usa una que sí está.

### Lo que apareció al arreglar

- **Dos rutas muertas en el contrato.** El test de navegación reescrito —que ahora recorre el contrato
  completo en vez de leer un literal SQL— encontró que la N°35 apuntaba a `/prevencion/riesgos` y la
  N°62 a `/prevencion/epp`, y **ninguna de las dos existe**. Nadie lo había notado porque la cola
  mandaba todo a la planilla y esos href no se usaban. Corregidas a `/prevencion/miper` y
  `/prevencion/epp-preventivo`.
- **La difusión de un incidente compartía permiso con cerrarlo.** `confirmIncidentDiffusion` exigía
  `incidents:close`, que sólo tienen `administrador` y `jefa_chome`: por eso la N°71, la N°75 y la N°77
  aparecían juntas en la lista. Son dos actos distintos, y ahora son dos permisos: la confirmación de
  difusión tiene el suyo (`prevention:incidents:diffuse`) y cerrar el incidente sigue siendo de
  jefatura. La N°77 —que sí acredita al cerrar— quedó declarada como segregada.
- **La regla de las dos personas en la difusión no se verificaba.** Se apoyaba sólo en la diferencia de
  permiso, así que quien tuviera los dos podía marcar y confirmar su propia difusión. Ahora se comprueba
  por actor, que es lo que la regla siempre quiso decir.
- **La promesa de "cuatro firmas".** Se corrigió el texto: el servicio impone tres (crear ≠ revisar ≠
  aprobar) y publicar no está segregado de aprobar en ninguno de los tres flujos. Cerrar esa brecha
  —chequeo por actor y un rol publicador aparte— **sigue abierto como decisión**, y no se tomó por
  cuenta propia: agregar un bloqueo duro a días de activar el programa es una decisión operativa.

### La verificación, ahora permanente

El cálculo de 76/5/0 dejó de ser un script ad hoc. Vive en
[lib/services/pdtp/responsible-execution.ts](lib/services/pdtp/responsible-execution.ts) —lógica pura,
siete tests sin base de datos— y lo consume el preflight que ya corría en cada despliegue
([preflight-pdtp-accreditation-wiring.ts](scripts/preflight-pdtp-accreditation-wiring.ts)). Se extendió
ése en vez de crear uno nuevo justamente por lo que su propio comentario advierte: dos lugares que
opinan sobre lo mismo se desincronizan, y el que avisa termina mintiendo.

### Segunda vuelta: las cinco segregadas y la firma de la JDPR

Las cinco no eran brechas —en todas el responsable hace el trabajo y otro firma—, pero **la firma no
llegaba**: los 7 planes de emergencia seguían en `draft` arrastrando la N°84, había cero matrices MIPER y
cero GRD, y nada avisaba. Los cuatro actos que faltaban los tenían sólo `jefa_chome` (2 usuarios) y
`administrador`; la **Jefa del Departamento de Prevención de Riesgos no estaba entre los firmantes**, al
revés de lo que el cargo supone.

**La JDPR firma los cuatro:** publicar la MIPER, aprobar y publicar documentos SST, publicar la matriz
GRD y cerrar incidentes. Es firmante y **no** responsable declarada: no se tocó `responsible_slugs`, así
que el programa no hay que reaprobarlo y el conteo sigue en **76 / 5 / 0**. Eso último es el resultado
correcto, no un fracaso: lo que cambió es que ahora hay tres roles capaces de firmar en vez de dos.

**El grant solo habría empeorado la evidencia, y por eso fue lo último.** La JDPR es un rol **autor**
—tiene `docs:manage`, `risk:edit` y `cgrd:matrix:edit`, que `jefa_chome` no tiene— y **publicar no tenía
control de actor en ninguno de los tres servicios**: lo único que impedía que el autor publicara su
propio documento era que el rol autor no tuviera el permiso de publicar. Darle publicar a la JDPR disuelve
esa garantía. Lo mismo en el RE-20: cuatro compuertas de cierre y ninguna miraba quién firma, con la JDPR
ya teniendo `incidents:investigate`.

Así que primero se agregó el control por actor y después el permiso:

- **Publicar ≠ aprobar** en MIPER, GRD y documentación. La cuarta firma se compara por usuario, como las
  tres anteriores. El contrato ya podía decir de la N°80 "cuatro firmas segregadas" sin mentir.
- **Cerrar ≠ completar la investigación** en el RE-20: quinta compuerta, y la única que mira personas.
- **La excepción, una sola y a la vista:** `prevention:sign_own_work`, otorgado sólo a `prevencionista`.
  La JDPR firma su propio trabajo porque responde por el contenido. No levanta las etapas intermedias
  —aprobar sigue exigiendo no haber creado ni revisado, también para ella— y **no alcanza al Programa de
  Trabajo Preventivo**, cuyo paso JDPR ya llevaba `not_elaborator`: nadie aprueba el programa que elaboró.

**El administrador de contrato**, corresponsable de la N°43 y la N°80, no podía hacer ni el paso de
autoría: le quedaban `docs:view` y `cgrd:view`. Ahora redacta el procedimiento y edita la matriz GRD;
firmar sigue siendo de otros.

### El hallazgo que no estaba en el encargo

**Ocho crons de Prevención existían como endpoints y no estaban agendados en ninguna parte** —ni en el
crontab de `docker-compose.yml`, ni en `scripts/cron-runner.mjs`, ni en un workflow—: `pdtp-weekly-reminders`,
`prevention-capa-reminders`, `prevention-cphs-alerts`, `prevention-document-ack-reminders`,
`prevention-incident-reminders`, `prevention-training-reminders`, `sst-weekly-alerts` y `pdtp-evidence-gc`.
Toda la maquinaria de recordatorios estaba escrita y **no corría**. Es el mismo episodio que CO-029/CO-039
documenta para los crons de Combustible.

Quedaron agendados en [`.github/workflows/prevention-daily-reminders.yml`](.github/workflows/prevention-daily-reminders.yml)
y no en el runner de crond, porque ése exige un contrato de respuesta (`outcome`, `code`) que los ocho
routes no emiten; `prevention-inspection-programs.yml` ya establecía el precedente de un cron de
Prevención en Actions.

Sobre esa base se agregó **la alerta de firma pendiente** (`runPdtpSignaturePendingReminders`), encadenada
al cron del PDTP bajo el mismo lock. Avisa a quien tiene que firmar —el permiso sale del paso siguiente,
tomado de los mismos mapas de transición del servicio— en tres escalones (7, 15 y 30 días) para no
convertirse en un correo diario que nadie abre. Mide **"días sin movimiento en ese estado"**, no "días
desde que se pidió la firma": ninguna de las cuatro tablas tiene `awaiting_signature_since`, y para los
planes de emergencia la aproximación es especialmente floja porque no existe un estado `in_review`. Sirve
para avisar y no exige migración; queda anotado como refinamiento.

Verificado contra `bodega_dev`: los 7 planes se detectan, y simulando la fecha a 10 días producen 7 avisos
a 4 firmantes, sin duplicar en la segunda corrida.

### Lo que queda, y no es código

1. **Verificar si producción tiene el mismo hueco de migraciones.** Es lo primero: el preflight nuevo lo
   dice en un comando.
2. **Asignar faenas en `worksite_users`** a los usuarios de `supervisor_terreno`, `jefe_terreno`,
   `admin_contrato` y `jefe_mantencion`. Sin esto los grants no sirven de nada: el alcance por faena es
   ortogonal al permiso y `supervisor_terreno` es `isGlobal: false`.
3. **Resolver `supervisor_faena`**, el rol que existe en base con un usuario y no en `system-rbac.ts`.
4. **Activar `pdtp-2026-v1`**, y recién después aprobar las 13 plantillas.
5. **Aprobar los 7 planes de emergencia.** Desbloquea la N°83 y la N°84, que espera detrás. Ya lo puede
   hacer la JDPR: `emergency:approve` no le faltaba, faltaba que alguien firmara.
6. **Crear y publicar la primera MIPER y la primera matriz GRD por faena** (N°35 y N°80), y el primer
   procedimiento de trabajo seguro (N°43). Hoy hay cero de las tres: no hay ni qué firmar.
7. **Configurar `PRODUCTION_APP_URL` y `CRON_SECRET`** como secretos del entorno `production` en GitHub,
   si no lo están ya para `prevention-inspection-programs.yml`. Sin eso el workflow nuevo falla en el
   primer disparo.

La segregación de publicación (§4) **quedó cerrada**: los tres flujos comparan actor, con la excepción
declarada de la jefatura técnica.

---

## 8. Qué hacer, en orden

| # | Acción | Cierra | Código |
|---|---|---|---|
| 1 | **Activar `pdtp-2026-v1`**, y recién después aprobar las 13 plantillas (D2) | las 81 | no |
| 2 | Aplicar la migración `0236` en `bodega_dev` y verificar cada entorno | D3 | no |
| 3 | Campañas → `recordPdtpFulfillmentEvent` | D1 | sí, 1 línea |
| 4 | Chequeo de destino también para `compuesta` | D4 | sí, 1 línea |
| 5 | Decidir la N°26: si vale la decisión de agosto, corregir el contrato a `inspections:execute` y quitar `segregated`; borrar la entrada de la N°28 | 2 del grupo de 21 | sí, menor |
| 6 | **Decisión de negocio, no de código:** para cada una de las 21, elegir entre (a) otorgar el permiso al responsable, (b) cambiar el responsable declarado en la planilla, o (c) aceptar la segregación y dejar constancia de que el cierre es de otro. Empezar por el `supervisor_terreno` (13 de 15) y por incidentes (6) | hasta 21 | depende |
| 7 | Preflight de migraciones que compare hashes aplicados contra el artefacto | D3, a futuro | sí |
| 8 | Cola de pendientes contra el contrato + corregir su test | D5 | sí |
| 9 | Segregación `published ≠ approved`, o corregir el texto que promete cuatro firmas | §4 | sí, menor |

Los pasos 1 y 6 son los únicos que mueven el número de verdad, y ninguno de los dos es código.

---

## 9. Alcance de la verificación

Todo se comprobó contra el código y contra `bodega_dev`. Las colisiones del índice de período (D3) se
demostraron con transacciones revertidas, en ambos sentidos: con el índice actual falla, con el de 0236
entra. El cruce responsable → rol → permiso se calculó leyendo `pdtp_responsible_catalog`,
`role_permissions` y `permissions` de la base, no del manifest —el manifest es la semilla, los grants
son lo que decide—, y respetando `operated_by_role_name` (D21). La disponibilidad de personas por rol
(§5) es de `bodega_dev` y **no** es extrapolable a producción; el resto de los hallazgos es de ruta y
configuración y sí lo es.
