# Plan de implementación: retiro del espejo `pdtp_action_plan` (D11)

> Plan activo solicitado el 2026-08-13. Ejecuta la decisión **D11** de
> `docs/superpowers/specs/2026-08-12-pdtp-actividades-accionables-design.md`
> ("CAPA guarda, PDTP muestra") y desbloquea la pregunta abierta **A12**.
> El plan de DTE/Chipax y el histórico de GDI se conservan más abajo.

## Diagnóstico

No hay dos motores de acciones correctivas. Hay uno —`prevention_capa_actions`—
y cuatro espejos sincronizados: `pdtp_action_plan`, `sst_action_plan`,
`ppa_corrective_actions` y los `capa_action_id` de inspecciones, CPHS,
emergencias, cambio y requisitos legales.

Toda escritura del PDTP pasa **primero** por CAPA y después copia:
`generateActionPlanFromChecklist` y `createActionPlanItem` llaman a
`createCapaActionWithClient`; `update`/`verify`/`reopen`/`delete` y `addFollowup`
llaman a `updateCapaActionWithClient` / `transitionCapaActionWithClient`. Las
seis rutas tienen la guarda *"La acción no tiene CAPA vinculada y requiere
conciliación"*: el PDTP ya **exige** la CAPA para funcionar.

### Los tres daños medidos

1. **La sincronización es unidireccional.** `lib/services/prevention-capa.ts` no
   importa `pdtpActionPlan` en ninguna línea, pero
   `app/(app)/prevencion/capa/[id]/capa-controls.tsx` deja transicionar acciones
   de cualquier `sourceType`. Avanzar una acción PDTP desde la pantalla de CAPA
   deja `pdtp_action_plan.estado` congelado — y esa columna alimenta
   `getActionPlanClosureRate`, `countActionsByExecution`, `listVencidas` y la
   cola. **El % de cumplimiento del programa puede mostrar un número falso.**
2. **Duplicación en `/pendientes`.** Documentada en el propio código
   (`lib/services/operational-work-queue.ts:826`): quien tenga
   `prevention:pdtp:view` y `prevention:capa:view` ve cada acción dos veces.
3. **Estados que no mapean.** PDTP tiene 6, CAPA 7. `addFollowup` rechaza a mano
   todo lo que no sea `en_proceso`/`completado` (`followups.ts:104`).

### Por qué el motor único es CAPA y no PDTP

- `pdtp_action_plan.execution_id → pdtp_executions` es **ON DELETE CASCADE**, y
  de ahí a `pdtp_activities` y `pdtp_programs` con la misma cascada: borrar un
  programa anual borraría hallazgos reales. Hacia CAPA la FK es **RESTRICT**.
- CAPA admite 14 `sourceType`; PDTP es uno. Una acción nacida de una evaluación
  de trabajador o de un permiso de trabajo no tiene actividad del programa anual
  de la cual colgar.

## Objetivo y límites

Retirar `pdtp_action_plan` y `pdtp_action_plan_followups` dejando
`prevention_capa_actions` como único registro. **La pantalla no cambia**: el
panel de la ejecución y `/prevencion/pdtp/acciones` conservan columnas, botones
y vocabulario español; sólo cambia de dónde leen.

**Fuera de alcance del retiro:** el resto del PDTP (programas, actividades,
calendario, ejecuciones, obligaciones, checklists, acreditación) no se toca. El
alcance inicial se amplió expresamente en la Fase 5, ya ejecutada, para retirar
también `sst_action_plan` y `ppa_corrective_actions` mediante la migración 0165.

## Los espejos estaban vacíos

Medido en la base al terminar: **0 filas** en `pdtp_action_plan`,
`sst_action_plan` y `ppa_corrective_actions`; 60 CAPA existentes, ninguna con
`source_item_id`, `source_ref` ni estado sin conciliar. El módulo nunca se usó
más allá de crear el programa — no hay ejecuciones registradas.

Por eso **no hay backfill ni orden de despliegue**: las migraciones son DDL
sobre tablas vacías. El script de backfill que este plan describía se escribió,
se comprobó que no tenía nada que migrar, y se borró.

Y por eso se renombraron las dos columnas cuyo nombre mentía (migración `0167`):
`source_legacy_action_id` → `source_item_id` y `legacy_snapshot` → `source_ref`.
Ninguna guardó nunca datos heredados; la primera la escribe
`prevention-risk-legal.ts` con el id de aplicabilidad y la segunda es hoy el
único lugar donde vive la procedencia dentro de la fuente.

## Decisiones

- **A12 resuelto.** `dano_potencial` y `normativa_legal` ya son columnas de
  `prevention_capa_actions` (migraciones 0157/0158). De los cuatro campos del
  espejo quedan `origen` y `seccion_id`/`item_id`, y **no necesitan columnas
  nuevas**: `origen` es derivable (`checklist_item` ⟺ `seccion_id IS NOT NULL`) y
  la procedencia va al `source_ref` jsonb.
- **La numeración `n` se deriva en lectura** con
  `ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY created_at)`. No se
  materializa: al desaparecer la tabla deja de tener dueño. Alternativa
  descartada: mostrar `prevention_capa_actions.code` — es mejor dato pero cambia
  la pantalla, y este plan promete que no cambia.
- **Los IDs de acción pasan a ser el `capa_action_id`**, no
  `{executionId}-ap-NNN`. No hay URL persistente con ese id (la acción se
  gestiona dentro del panel de la ejecución), así que la ruptura es interna.
- **El orden es lecturas antes que escrituras.** Reapuntar las lecturas (Fase 2)
  mata el daño #1 antes de tocar ninguna escritura, así que ninguna fase
  intermedia deja el sistema peor que hoy.
- **No se hace la sincronización bidireccional** como parche interino. Sería
  código nuevo que la Fase 4 borra.

## Fases y entregables

### Fase 0 — Cola sin duplicados · **hecha**

> **Corrección sobre lo planificado.** El plan decía "eliminar la fuente
> `pdtp_action`". Al implementarlo apareció que `jefe_terreno`,
> `admin_contrato` y `supervisor_terreno` tienen `prevention:pdtp:view` y
> `prevention:pdtp:action:manage` pero **no** `prevention:capa:view`
> (`modules/prevention/manifest.ts:435-468` vs `:593-605`) — son justamente
> quienes gestionan la acción. Borrar la fuente les habría quitado el trabajo de
> la cola. **Se unificó en vez de borrar.**

Helper `capaQueueSource()`: las dos ramas leen `prevention_capa_actions` y se
reparten el universo por `source_type` —la rama `pdtp` toma
`source_type = 'pdtp'`, la rama `capa` toma el complemento cuando el usuario ve
las dos—, cada una con su `module` y su `href`. Una fila por acción, en el
módulo de su origen, hacia una pantalla cuyo permiso la persona tiene.

Mismo reparto en `getOperationalWorkCount`. Retirado el `sourceType`
`pdtp_action`, que no consumía nadie más. Sin esquema, sin migración.

**Efecto no planificado:** como ambas ramas ya leen CAPA, el daño #1 (el espejo
congelado) deja de ser observable en la cola sin esperar la Fase 2.

### Fase 1 — Preservar la procedencia en CAPA

`generateActionPlanFromChecklist` pasa `legacySnapshot: { seccionId, itemId }` a
`createCapaActionWithClient`. Script de backfill que copia
`seccion_id`/`item_id` de las filas existentes de `pdtp_action_plan` al
`legacy_snapshot` de su CAPA. Idempotente, re-ejecutable.

> **Corrección: las Fases 2 y 3 se fusionaron.** No son desplegables por
> separado. Al reapuntar las lecturas, la identidad de la acción pasa del id del
> espejo (`{executionId}-ap-NNN`) al id de la CAPA — y entonces las escrituras,
> que siguen buscando en `pdtp_action_plan`, no encuentran lo que las lecturas
> devolvieron. Se hicieron juntas, con las suites verdes al final.

> **Cambio visible que sí ocurrió.** El plan prometía que la pantalla no
> cambiaba. Se cumple en columnas, botones y vocabulario, con una excepción: la
> **bitácora de una acción es más granular**. Sale de
> `prevention_capa_transitions`, que registra cada hecho por separado —la
> evidencia, la nota y cada salto de estado— donde el espejo colapsaba todo en
> una fila por acción del usuario. Un "completar con foto y observación" pasa de
> 1 entrada a 3. Es el registro auditado real y en el expediente del auditor es
> una mejora, pero es un cambio y hay que avisarlo.

### Fase 2 — Reapuntar las lecturas a CAPA

Todas contra `sourceType = 'pdtp' AND sourceId = <executionId>`:

| Función | Archivo |
|---|---|
| `listActionPlanItems` | `lib/services/pdtp/action-plan.ts:303` |
| `listActionsByProgram` | `:456` |
| `countActionsByExecution` | `:509` |
| `getActionPlanClosureRate` | `:531` |
| `listVencidas` | `lib/services/pdtp/followups.ts:140` |
| `listFollowups` | `:133` → `prevention_capa_followups` + `_transitions` |
| `assertPdtpActionPlanItemAccess` | `lib/services/pdtp/helpers.ts:101` → `preventionCapaActions.worksiteId` directo |
| tasa de cierre del programa | `lib/services/pdtp/compliance.ts:344` |
| acciones que requieren atención | `lib/services/prevention-attention.ts:32-38` |

Cada una devuelve la **misma forma** que hoy (`estado`, `plazo`, `prioridad`,
`hallazgo`, `accion`, `responsable`, `n`, `vencida`) mediante un traductor único
`capaToPdtpAction()`. Las vistas (`execution-action-plan-panel.tsx`,
`acciones-table.tsx`) no se tocan.

Aquí muere el daño #1: los indicadores dejan de poder mentir.

### Fase 3 — Reapuntar las escrituras

`action-plan.ts` y `followups.ts` dejan de insertar y actualizar el espejo:
sólo traducen (`estado ↔ status`, `plazo ↔ targetDate`, `prioridad ↔ priority`)
y delegan en `prevention-capa.ts`. Se van ~350 de ~800 líneas, junto con
`legacyCapaAccess`/`capaAccess` (los dos bypasses de RBAC que sólo existían para
que el espejo pudiera escribir) y las seis guardas de "requiere conciliación".

### Fase 4 — Retiro del esquema

Migración: `DROP TABLE pdtp_action_plan_followups, pdtp_action_plan`. Se retiran
las tablas y relaciones de `db/schema/prevention/pdtp.ts:567-609` y `:675-688`,
`pdtpActionPlanItemId`/`pdtpActionPlanFollowupId` de `checklist-domain.ts:116` y
los reexports de `lib/services/pdtp/index.ts:147-156`.

### Fase 5 — Mismo retiro para los otros dos espejos · **hecha**

`sst_action_plan` y `ppa_corrective_actions` eran el mismo patrón copiado y se
retiraron con la migración `0165_unique_epoch.sql`.

**El prerequisito quedó descartado.** `ppa_status_history` **no** es un espejo:
registra las transiciones del propio PPA (`detenido` → `en_correccion` → …), no
las de la acción correctiva. Su `capa_action_id` sólo apunta a la acción vigente
en ese momento. Se queda tal cual.

**Diferencia real con el PDTP.** En el acta SST el `n` **no** es numeración
derivable: es la fila que el evaluador edita, y `saveActionPlanItem` hace upsert
por `(evaluationId, n)`. Así que se persiste en el `legacy_snapshot` y la
unicidad se conserva con el índice parcial
`prevention_capa_sst_evaluation_n_unique`, que reemplaza al
`sst_action_plan_evaluation_n_unique` que se fue con la tabla.

**Bug preexistente que salió al reapuntar.** `deleteEvaluation` borraba la fila
espejo y dejaba la CAPA abierta apuntando a una evaluación inexistente — trabajo
fantasma en `/pendientes` para siempre. Ahora la cancela con motivo.

## Verificación por fase

RED → GREEN → REFACTOR. Prueba de regresión que falla contra HEAD antes de
implementar. Por fase:

- **Fase 0** — una acción PDTP aparece **exactamente una vez** en `/pendientes`
  para un usuario con `prevention:pdtp:view` + `prevention:capa:view`.
- **Fase 1** — backfill idempotente: dos corridas dejan el mismo
  `legacy_snapshot`; ninguna CAPA con origen `checklist_item` queda sin
  `seccionId`/`itemId`.
- **Fase 2** — la prueba que hoy no existe y destapa el daño #1: transicionar
  una acción PDTP desde la pantalla de CAPA y verificar que
  `getActionPlanClosureRate` y `countActionsByExecution` reflejan el cambio.
  Además, `listActionPlanItems` devuelve fila por fila lo mismo que la tabla
  espejo antes del cambio (comparación de snapshot sobre datos de `seed-demo`).
- **Fase 3** — la batería existente pasa sin tocar sus aserciones:
  `pdtp-checklist-action-plan`, `pdtp-action-open`, `prevention-pdtp`,
  `pdtp-coverage-r2`, `worksite-deactivation-pdtp`.
- **Fase 4** — `npm run db:verify-migrations` y `npm run db:generate` sin
  cambios pendientes; e2e de PDTP en verde.

Transversal en cada fase: `npm run test:fast`, `npm run typecheck`,
`npm run lint`. E2E completos antes de Fase 4.

## Riesgos

- **Los e2e no se solapan** (ver memoria del proyecto): dos corridas simultáneas
  comparten servidor y BD y producen fallas fantasma. Correr en serie.
- **Fase 2 es la que rompe tests**; son cuatro archivos y sus aserciones siguen
  siendo válidas — si hay que reescribir una aserción, es señal de que el
  traductor cambió la forma y hay que corregir el traductor, no el test.
- **Los datos ya divergentes en producción**: antes de Fase 2 conviene medir
  cuántas filas de `pdtp_action_plan` tienen `estado` inconsistente con el
  `status` de su CAPA. Si son muchas, los indicadores **cambiarán** al reapuntar
  — es la corrección del bug, pero hay que avisarlo, no descubrirlo.

---

# Plan de implementación: endurecimiento DTE, FacturaEnLínea y Chipax

> Plan activo solicitado el 2026-08-13. El plan histórico de GDI se conserva más
> abajo para no perder decisiones previas.

## Objetivo y límites

Implementar en código, esquema, pruebas, observabilidad y documentación el
endurecimiento de DTE, FacturaEnLínea y Chipax. No se ejecuta despliegue
productivo ni smoke real contra proveedores en esta fase.

## Decisiones

- `BILLING_CHIPAX_ENABLED` indica disponibilidad del proveedor; la
  automatización se controla con `BILLING_CHIPAX_SYNC_ENABLED=false`.
- Chipax corre una vez al día a las 09:00 `America/Santiago`: ventas del mes
  actual y anterior, y cartolas del mes actual.
- Ventas y cartolas guardan cursores durables por proveedor, alcance y período;
  se limpian sólo al completar (`nextCursor = null`).
- La conciliación DTE tiene estado separado de la ingesta.
- La factura de OC admite un solo DTE mediante índice único parcial. El
  preflight bloquea duplicados históricos y la reparación exige mapping y
  auditoría explícitos.
- Chipax es sólo lectura; se respeta el límite de 60 solicitudes/minuto.
- XML y caché tienen límite de 10 MiB y limpieza transaccional.

## Fases y entregables

1. **Cursor y proveedor Chipax:** cursor durable para ventas/cartolas, páginas
   51+, reanudación idempotente, conflictos como `partial`, mensajes operativos,
   validación runtime, límite de página, reintento acotado de 429/401.
2. **Integridad y conciliación DTE:** candidatos ambiguos 33/34 no se vinculan,
   bloqueo/guarda de factura, preflight y reparación explícita, índice único,
   `reconciliation_status`/`reconciliation_error`, actualización de razón social
   y fecha cuando cambia el hash.
3. **Robustez FacturaEnLínea y almacenamiento:** snapshot único de credenciales,
   password sin `trim`, delay cero válido, referencias externas no reasignables,
   procedencia de vencimiento, XML acotado y cacheado con CAS.
4. **Automatización, health y UI:** `/api/cron/chipax-sync`, correlación común,
   runner/Compose a las 09:00 Chile, health por alcance con TTL 24h y
   conciliación DTE degradando/crítico, copy de conflictos y automatización por
   proveedor.
5. **Documentación y runbook:** `.env.example`, documentos de facturación,
   rollback, 429, cursores, reparación DTE, límite XML, health y Re-cifrado del
   keyring sin cambiar RUT, contraseña, CodEmp ni importer.

## Verificación por fase

Cada cambio sigue RED → GREEN → REFACTOR: prueba de regresión, implementación
mínima, pruebas focalizadas/PGlite, ESLint, TypeScript y verificación de
migraciones. Antes del cierre se ejecutan `test:fast`, `test:pglite`,
`typecheck`, `lint`, `db:verify-migrations`, `db:generate` sin cambios,
validaciones de Compose/runner/YAML/shell y la suite completa disponible.

## Runbook de rollout (sin ejecutar ahora)

Preflight → reporte y mapping de duplicados → reparación auditada → preflight
cero → `db:migrate` → imagen app/runner/Compose compatible → variables
enmascaradas → un cron → health autenticado → corrida manual Chipax → revisión
de filas/cursores/métricas/health → activar automatización → observar una
ventana. Ante fallo, desactivar sólo el flag de automatización.

---

# Plan histórico: GDI dentro de Adquisiciones

## Auditoría inicial

El flujo vivo es `/solicitudes` → `/aprobaciones` → `/compras` → `/recepcion`; la
trazabilidad transversal está en `lib/services/document-chain.ts` y las entregas
de EPP a trabajadores viven en `/entregas`, que no es el tramo Oficina → Faena.
Las OCs conservan `deliveryMode` (`via_oficina` o `directo_faena`) y contadores
`quantityOfficeReceived` / `quantityReceived` por ítem. `lib/services/receiving.ts`
ya bloquea la OC y los ítems, soporta recepciones parciales y actualiza los
estados de la OC.

La GDI existente se creó en la migración 0150. Usa `dispatch_guides` y
`dispatch_guide_items`, correlativo `GDI` vía `nextCodeTx`, estados `draft`,
`dispatched`, `received`, `cancelled`, permisos `warehouse:*_guide`, auditoría,
`status_history`, movimientos `egreso_traslado`/`ingreso_traslado` y un PDF en
`app/(print)/bodega/guias/[id]/print`. Su servicio limita el origen a la faena
configurada como Oficina CHOME y serializa el despacho con `FOR UPDATE`, pero es
independiente: no tiene FK a OC, recepción ni solicitud; permite crear líneas
desde el stock actual; mueve stock al despachar; y confirma recepción sin
cantidades cotejadas ni diferencias. La navegación independiente está en
`modules/warehouse/manifest.ts` (`/bodega/guias`).

No aparecen fixtures de inserción de `dispatch_guides` en el repositorio; las
guías históricas reales deben conservarse mediante columnas nuevas nullable y
rutas de detalle/PDF compatibles. No se elimina la tabla ni el correlativo.

## Decisiones de arquitectura

- Preparar GDI automáticamente desde la recepción en oficina, agrupando los
  ítems físicos por faena destino. No se genera para `directo_faena`, para una
  compra final en oficina ni para `products.isService`/líneas sin bien físico.
- Una recepción puede preparar varias guías y el mismo ítem de OC puede tener
  muchas líneas de GDI a través de varias guías. La disponibilidad se calcula
  como `office received - non-cancelled guide dispatched quantities`.
- La entrada de stock del bien catalogado ocurre una vez al recibirlo en
  oficina (`ingreso_oc`, referenciada a la recepción). El despacho hace la
  salida de oficina y entrada en faena (`dispatch_guide`); el cotejo no duplica
  movimientos.
- El cotejo guarda `quantityReceived`, diferencia y observación por línea.
  Una guía queda completa sólo cuando todas sus líneas fueron cotejadas; si hay
  diferencias queda parcial/con diferencia sin modificar retroactivamente lo
  despachado.
- Las GDI legacy quedan visibles por detalle, OC, Solicitud, Recepciones y
  trazabilidad. Se retira la navegación y el alta manual desde Bodega; las
  rutas legacy de detalle/PDF permanecen como compatibilidad.
- Los permisos actuales se reutilizan: recepción de oficina/faena para cada
  evento; `warehouse:create_guide` para preparar/editar; `warehouse:dispatch_guide`
  para confirmar salida; `warehouse:receive_guide` para cotejar; y
  `warehouse:cancel_guide` para anular.

## Fases y checkpoints

### Fase 1: datos y dominio

- Añadir relaciones OC/recepción/ítem a GDI y líneas de cotejo sin borrar datos.
- Centralizar estados y reglas de elegibilidad física.
- Generar una migración nueva con `db:generate`; nunca editar el journal.

### Fase 2: recepción y despacho transaccional

- Al confirmar recepción en oficina, registrar stock de bienes y preparar GDI
  idempotentemente por faena.
- Permitir seleccionar cantidades disponibles, múltiples guías y despachos
  parciales bajo lock transaccional.
- Confirmar cotejo completo/parcial con actor, timestamp y diferencia.

### Fase 3: interfaz y expediente

- Mostrar las dos etapas dentro de Recepciones y una cola por estado.
- Ofrecer la GDI heredada y sus acciones desde Recepciones, OC y Solicitud.
- Actualizar cadena documental, estados visibles y PDF.
- Retirar el ítem de navegación independiente de Bodega.

### Checkpoint final

- Tests unitarios/integración nuevos y existentes.
- Lint, `npx tsc --noEmit`, build de producción.
- Verificación de migración, PDF, permisos, cantidades, movimientos únicos y
  rutas históricas.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| Cambios no relacionados ya sucios en rollup/recepción/purchasing | Alto | No sobrescribirlos; revisar diffs y tocar sólo líneas necesarias |
| Guías históricas sin claves nuevas | Alto | FKs nullable y compatibilidad de lectura/PDF |
| Carrera entre dos despachos | Alto | Lock por ítem de OC en orden estable + guarda de cantidades y estado |
| Doble inventario al cotejar | Alto | Entrada oficina, traslado al despacho, cero movimiento al cotejo |
| Servicios confundidos con bienes | Medio | `products.isService` y presencia de `productId`, sin excepciones por nombre |
| Mixed OC de faenas | Alto | Agrupar/preparar una guía por `purchaseRequests.worksiteId`; nunca mezclar destinos |

## Trabajo pendiente explícito

- Verificar en el entorno conectado si existen filas históricas reales de GDI y
  hacer el backfill sólo cuando la relación pueda inferirse sin inventar datos.
- La compatibilidad de OCs históricas sin `requestItemId` no puede producir una
  GDI automática; se mantienen consultables y no se les inventa origen.
