# TODO — retiro del espejo `pdtp_action_plan` (D11)

## Alcance activo

- [ ] No tocar el resto del PDTP: programas, actividades, calendario,
      ejecuciones, obligaciones, checklists y acreditación quedan igual.
- [ ] La pantalla no cambia: mismas columnas, botones y vocabulario español.
- [ ] No sobrescribir el plan DTE/Chipax ni los cambios ajenos al alcance.

### Fase 0 — Cola sin duplicados ✅

- [x] **Hallazgo que cambió el paso:** `jefe_terreno`, `admin_contrato` y
      `supervisor_terreno` tienen `prevention:pdtp:view` y
      `prevention:pdtp:action:manage` pero **no** `prevention:capa:view`
      (`modules/prevention/manifest.ts:435-468` vs `:593-605`). Apagar la fuente
      les habría borrado el trabajo. Se **unificó** en vez de borrar.
- [x] Helper `capaQueueSource()`: las dos ramas leen `prevention_capa_actions` y
      se reparten el universo por `source_type`, cada una con su módulo y su
      pantalla. Ninguna acción aparece dos veces y nadie pierde trabajo.
- [x] Mismo reparto en `getOperationalWorkCount` (el badge contaba 2).
- [x] Retirado el `sourceType` `pdtp_action` de la cola: no lo consumía nada más.
- [x] Efecto adelantado de la Fase 2: la cola ya lee el estado real de CAPA, así
      que el daño #1 (espejo congelado) deja de ser observable ahí.
- [x] Regresión `operational-work-queue-capa-duplicada.test.ts` (7 casos):
      RED 4/5 contra HEAD → GREEN. Incluye el caso del espejo congelado.
- [x] Registrado en `tests/pglite-files.ts` (corría en el proyecto equivocado).
- [x] Borrada la NOTA (D11) del código, que dejó de describir la realidad.
- [x] `typecheck` 0 errores · `eslint` limpio · suites de cola, CAPA y PDTP
      en verde (`work-queue`, `operational-*`, `prevention-capa-*`,
      `pdtp-checklist-action-plan`, `pdtp-action-open`, `prevention-pdtp`).

### Fase 1 — Preservar la procedencia en CAPA ✅

- [x] `generateActionPlanFromChecklist` pasa `legacySnapshot: { seccionId, itemId }`.
- [x] `createActionPlanItem` sigue la misma regla: sólo hay procedencia si la
      acción nació de un ítem; una manual no inventa una.
- [x] `origen` **no** se persiste: es derivable (`checklist_item` ⟺ hay
      `seccionId`). Materializarlo sería un tercer sitio donde el mismo hecho
      puede desincronizarse.
- [x] `scripts/backfill-capa-checklist-provenance.ts` + `npm run capa:backfill-provenance`,
      con `CAPA_BACKFILL_DRY_RUN`. Idempotente; no pisa un `legacy_snapshot`
      existente: reporta el conflicto y lo deja intacto.
- [x] Dos casos nuevos en `pdtp-checklist-action-plan.test.ts` (RED → GREEN);
      suite completa 30/30, `eslint` limpio, typecheck sin errores propios.
- [x] A12 cerrado en el documento de diseño, con la tabla de los cuatro campos
      y dónde queda cada uno.
- [x] ~~Correr el backfill contra la base real~~ — descartado: los espejos
      estaban vacíos y el script se borró. Ver "Sin andamiaje de migración".

### Fases 2 y 3 — Reapuntar lecturas y escrituras a CAPA ✅

> **Fusionadas.** El plan las separaba, pero no son desplegables por separado:
> al pasar la identidad de la acción del id del espejo (`{exec}-ap-NNN`) al id
> de la CAPA, las escrituras dejan de encontrar lo que las lecturas devuelven.

- [x] `lib/services/pdtp/capa-view.ts`: única frontera entre los dos
      vocabularios (`CAPA_A_PDTP_ESTADO`, `CAPA_A_PDTP_PRIORIDAD`,
      `capaToPdtpAction`) más las siete consultas.
- [x] `n` derivado del orden de creación dentro de la ejecución.
- [x] Lecturas: `listActionPlanItems`, `listActionsByProgram`,
      `countActionsByExecution`, `getActionPlanClosureRate`, `listVencidas`,
      `listFollowups`, `assertPdtpActionPlanItemAccess`, tasa de cierre del
      programa (`compliance.ts`), acciones por atender (`prevention-attention.ts`).
- [x] Escrituras: `generateActionPlanFromChecklist`, `createActionPlanItem`,
      `updateActionPlanItem`, `deleteActionPlanItem`, `verifyActionPlanItem`,
      `reopenActionPlanItem`, `addFollowup` — todas sólo contra CAPA.
- [x] Retiradas las seis guardas de "requiere conciliación" y el
      `loadPdtpCapa` único que las reemplaza.
- [x] Deduplicación del generador por `legacy_snapshot`, no por el espejo.
- [x] **`prioridad` sin traducir** en `prevention-attention.ts` habría impreso
      "Acción high" en pantalla en español. Corregido con `capaPrioridad`.
- [x] `verifyActionPlanItem` y `reopenActionPlanItem` ya no escriben un followup
      propio: la transición CAPA es la misma entrada y se duplicaba.

### Fase 4 — Retiro del esquema ✅

- [x] Migración `0161_productive_captain_flint.sql`:
      `DROP TABLE pdtp_action_plan, pdtp_action_plan_followups CASCADE`.
- [x] Tablas, relaciones y tipos retirados de `db/schema/prevention/pdtp.ts`.
- [x] `pdtpActionPlanItemId` / `pdtpActionPlanFollowupId` y sus reexports fuera.
- [x] Seed de capturas reapuntado (apuntaba a una CAPA `manual` ajena a la
      ejecución — ya estaba inconsistente).
- [x] Fixtures de `prevention-pdtp`, `pdtp-coverage-r2` y la regresión de la
      cola reescritos contra CAPA.
- [x] Backfill pasado a SQL crudo con guarda `to_regclass`: la tabla ya no está
      en el esquema Drizzle pero sigue en la base hasta aplicar la migración.
- [x] `db:verify-migrations` ok · `drizzle-kit generate` sin drift.

### Verificación final ✅

- [x] `npx tsc --noEmit`: 0 errores.
- [x] `eslint` limpio en los 11 archivos tocados.
- [x] `npm run test:fast`: 4014 pasan. Los 4 archivos que fallan
      (`dte-portal/health`, `dte-portal/sync`, `preflight-dte-single-link`)
      son del trabajo DTE/Chipax en vuelo, no importan nada de prevención.
- [x] PGlite: `prevention-pdtp` (60), `pdtp-checklist-action-plan` (30),
      `pdtp-coverage-r2`, `prevention-capa-list`, `pdtp-action-open`,
      `work-queue`, regresión de la cola (7).

### Sin andamiaje de migración ✅

Los tres espejos estaban **vacíos** (0 filas en `pdtp_action_plan`,
`sst_action_plan` y `ppa_corrective_actions`), y de las 60 CAPA existentes
ninguna usa `source_item_id`, `source_ref` ni queda sin conciliar. El módulo
nunca se usó más allá de crear el programa: no hay ejecuciones.

- [x] Borrado `scripts/backfill-capa-checklist-provenance.ts` y su comando npm:
      no había nada que migrar.
- [x] **Sin orden de despliegue.** `0161` y `0165` son DDL sobre tablas vacías;
      se aplican con el resto sin paso previo.
- [x] Renombradas las dos columnas cuyo nombre mentía (migración `0167`):
      `source_legacy_action_id` → `source_item_id` (lo usa
      `prevention-risk-legal.ts` para el id de aplicabilidad) y
      `legacy_snapshot` → `source_ref` (procedencia dentro de la fuente).
      El índice `prevention_capa_legacy_source_unique` pasa a
      `prevention_capa_source_item_unique`.
- [x] `legacyCapaAccess` → `capaAccess`, como en los otros dos módulos.
- [x] `reconciliation_status` **se queda**: no es migración, es el filtro
      "sin conciliar" de la lista y el `blocked` de la cola.

### Pendiente

- [x] **Producción verificada en sólo lectura (2026-08-14).** Los cuatro espejos
      en 0 filas, `prevention_capa_actions` en **0**, y las fuentes: 1 programa
      PDTP, 0 ejecuciones, 0 evaluaciones SST, 1 PPA. No hay ni una acción
      correctiva registrada en el sistema: las migraciones no pueden perder nada.
- [x] **E2E en verde (2026-08-14): 34 pruebas, 0 fallas**, corridas en serie.
      `pdtp-actions-plan`, `prevencion-capa-lifecycle`, `pdtp-flow`,
      `pdtp-cobertura`, `pdtp-obligaciones`, `pdtp-lifecycle-approvals`,
      `pendientes-queue`, `ppa-flow`, `sst-pdf`, `tae-ppa-coexistence`,
      `prevencion-inspecciones`. Incluye el caso clave *"marcar un ítem 'No
      cumple' genera automáticamente una acción correctiva"* y los cuatro de
      revisión del PPA, que recorren el camino reescrito de punta a punta.
      `npm run build` completo también pasa.

### Arreglos ajenos (autorizados 2026-08-14)

**E2E no arrancaban.** `e2e/setup-db.ts` sembraba dos DTE apuntando al mismo
`oc-invoice-e2e` —a propósito, era el fixture de "discrepancia"— y el índice
único `dte_documents_purchase_invoice_single_unique` de la migración `0159` lo
prohíbe. El sembrado fallaba y **el servidor de pruebas no levantaba**, lo que
bloqueaba todos los E2E del repo, no sólo los de prevención.

- [x] Manda el índice, que es la decisión de diseño del trabajo DTE ("la factura
      de OC admite un solo DTE"). Se movió el fixture: `dte-e2e-discrepancia`
      pasa a `oc-invoice-no-lines-e2e` ($3.566) con montos recalculados
      ($4.066 = neto 3.417 + IVA 649) para conservar los **$500** de diferencia
      que asegura `export-volume.spec.ts`. La factura elegida no la referenciaba
      ninguna prueba.
- [x] `export-volume.spec.ts` 11/11 en verde, incluido el caso de la
      discrepancia real y el del DTE huérfano.

**Los 4 tests "rotos" no lo estaban.** `dte-portal/health`, `dte-portal/sync` y
`preflight-dte-single-link` fallaban sólo en la suite completa y pasan solos:
era contención de CPU con el otro proceso. Con el checkout libre,
`test:fast` pasa **4069/4069**.

- [x] Limpiados 3 avisos de lint residuales (`and`/`ne` sin uso en
      `prevencion/[id]/page.tsx`, `upsertReturning` en `sst-service-full`).

### Fase 5 — Los otros dos espejos ✅

- [x] **Prerequisito resuelto:** `ppa_status_history` **no** es un espejo y se
      queda. Registra las transiciones del propio PPA (`detenido` →
      `en_correccion` → …), no las de la acción; su `capa_action_id` sólo apunta
      a la acción vigente en ese momento.
- [x] `lib/services/sst-module/capa-view.ts` + `ppa-module/capa-view.ts`.
- [x] SST: `saveActionPlanItem` y `deleteActionPlanItem` sólo contra CAPA;
      lecturas del acta y de la impresión reapuntadas.
- [x] **`n` del acta SST no se deriva**: es la fila que el evaluador edita (el
      upsert es por `(evaluationId, n)`), así que va al `legacy_snapshot` con el
      índice parcial `prevention_capa_sst_evaluation_n_unique`, que reemplaza a
      `sst_action_plan_evaluation_n_unique`.
- [x] **Bug preexistente corregido:** `deleteEvaluation` borraba la fila espejo
      y dejaba la CAPA abierta apuntando a una evaluación inexistente — trabajo
      fantasma en `/pendientes`. Ahora la cancela con motivo.
- [x] PPA: alta, `loadLinkedCapa`, las tres actualizaciones de estado, la ficha
      y el export leen y escriben sólo CAPA.
- [x] Migración `0165_unique_epoch.sql`: `DROP TABLE sst_action_plan,
      ppa_corrective_actions CASCADE` + el índice nuevo.
- [x] Tablas, relaciones y tipos fuera de `db/schema/sst.ts` y `db/schema/ppa.ts`;
      tipos de UI reapuntados a `SstActionPlanItemView`.
- [x] Seeds y fixtures reescritos: `capture-all-routes`, `sst-delete-evaluation`,
      `sst-integrity-constraints`, `sst-service`, `sst-service-full`,
      `prevention-capa-postgres`, `prevention-ppa-workflow-persistence`,
      `ppa-stats`, `review-service`.
- [x] `test:fast` 4046 pasan · PGlite de prevención en verde · `eslint` limpio ·
      typecheck sin errores propios.

> ⚠️ **La migración `0165` fue borrada una vez por el otro proceso** al correr
> `drizzle-kit generate` en este mismo checkout. Está rehecha y verificada, pero
> conviene comprobar que sigue ahí antes de commitear:
> `npm run db:verify-migrations` debe decir `through 0165_unique_epoch`.

---

# TODO de cierre — endurecimiento DTE, FacturaEnLínea y Chipax

## Alcance activo

- [x] Mantener cambios ajenos al alcance sin sobrescribirlos.
- [x] No desplegar producción ni ejecutar smoke autenticado real.

### Fase 1 — sincronización y cursores

- [x] Cursor durable para `chipax/sales_invoices` y `chipax/bank_transactions`.
- [x] Reanudación tras interrupción, páginas 51+/63+ e idempotencia.
- [x] Conflictos de cartola terminan `partial` y tienen copy diferenciado.
- [x] Validación runtime de respuestas, límites de página y 429/401 acotados.

### Fase 2 — integridad y conciliación DTE

- [x] Ambigüedad tipo 33/34 y guarda de factura antes de vincular.
- [x] Preflight de vínculos duales y duplicados por factura.
- [x] Reparación report-only / `--apply --mapping`, locks, vigencia y auditoría.
- [x] Índice único parcial generado por Drizzle.
- [x] `reconciliation_status` y `reconciliation_error` con health degradado/crítico.
- [x] Actualizar razón social/fecha junto con `rawHash`.

### Fase 3 — proveedores y almacenamiento

- [x] Límite XML/cache de 10 MiB, stream, caché CAS y limpieza temporal.
- [x] Snapshot único de `FacturaEnLineaProvider`, password sin trim y delay 0.
- [x] Conflicto tipado de referencias externas y procedencia de vencimientos.

### Fase 4 — cron, health y UI

- [x] `/api/cron/chipax-sync` con correlación y tres alcances.
- [x] Runner Node, Compose, horario `America/Santiago`, timeout 10 min.
- [x] Health Chipax por alcance y TTL 24 h; conciliación separada.
- [x] UI distingue automatización, ventas, cartolas, ingesta, conciliación y stale.

### Fase 5 — documentación

- [x] Actualizar `.env.example` y documentos de facturación.
- [x] Documentar 429, cursores, reparación DTE, XML, health y rollback.
- [x] Eliminar instrucción residual de rotar contraseña del portal.

### Verificación final

- [x] Tests focalizados (152/152) y PGlite (635/635).
- [x] `npm run test:fast` y suite completa disponible.
- [x] `npm run typecheck` y `npm run lint`.
- [x] `npm run db:verify-migrations` y `npm run db:generate` sin cambios.
- [x] Compose, runner, YAML y shell verificados.
- [x] Reportar explícitamente lo no probado en producción.

---

# TODO histórico — GDI integrada a Adquisiciones

## Cerrado en implementación

- [x] Auditar Solicitudes, Aprobaciones, Compras, Recepciones, Bodega y GDI.
- [x] Confirmar existencia de histórico: 5 guías y 9 líneas en la base local.
- [x] Relacionar GDI con OC, recepción, línea de OC y línea de recepción; FK opcionales para histórico.
- [x] Agregar cotejo por línea, cantidad recibida en faena, diferencia y motivo.
- [x] Agregar estados de Solicitud para recepción parcial/completa en oficina.
- [x] Preparar automáticamente una GDI borrador desde la recepción en oficina.
- [x] Omitir servicios y compras cuyo destino final es Oficina CHOME.
- [x] Registrar entrada de stock en Oficina CHOME con referencia a la recepción.
- [x] Registrar salida/entrada de traslado al confirmar despacho, con bloqueo de líneas de OC.
- [x] Impedir cantidades despachadas superiores a lo recibido en oficina.
- [x] Implementar cotejo completo/parcial sin duplicar stock.
- [x] Registrar diferencias en `receipt_items` y en las líneas de GDI.
- [x] Integrar GDI a Recepciones, OC/Solicitud mediante expediente documental.
- [x] Retirar la navegación y el alta manual operativa desde Bodega; conservar historial y detalle.
- [x] Mantener correlativo, PDF, auditoría, permisos y movimientos históricos.
- [x] Generar migración nueva `0151` sin editar migraciones anteriores.

## Pendiente de cierre técnico

- [x] Corregir/actualizar las pruebas de recepción que aún esperaban el comportamiento antiguo de oficina sin stock/GDI.
- [x] Agregar pruebas de GDI automática para bien físico, servicio y destino oficina.
- [x] Agregar pruebas de recepción parcial proveedor y varias recepciones sobre una OC.
- [x] Agregar pruebas de despacho parcial, segunda GDI desde el saldo y concurrencia.
- [x] Agregar pruebas de cotejo exacto, parcial, diferencias, motivos y estados derivados.
- [x] Agregar pruebas de no duplicación de movimientos y de anulación.
- [x] Agregar pruebas de permisos y conservar/consultar las 5 guías históricas.
- [x] Actualizar E2E y accesibilidad para el flujo desde Recepciones, no desde alta independiente.
- [x] Revisar enlaces históricos sin FK de OC/recepción y ofrecerlos desde el expediente disponible.
- [x] Verificar que el PDF final muestre OC, solicitud, recepción, despacho y cotejo.
- [x] Ejecutar migración local controlada y comprobar `db:generate` sin cambios pendientes.
- [x] Ejecutar tests focalizados y suite rápida.
- [x] Ejecutar lint, `tsc --noEmit`, React Doctor y build de producción.
- [x] Ejecutar browser/E2E sobre base desechable con guardas explícitas.
- [x] Revisar diff final; se preservaron los cambios concurrentes ajenos y no se revirtieron.

## Criterio de salida

- [x] No queda una acción que obligue a entrar a Bodega para iniciar el despacho.
- [x] Toda GDI nueva tiene origen Oficina CHOME y una única faena.
- [x] Ningún servicio ni compra final de oficina genera GDI.
- [x] No existe sobre-despacho ni duplicación de movimientos.
- [x] Solicitud, OC, Recepción y GDI muestran el mismo estado real.
- [x] Las guías históricas siguen visibles y no se eliminan datos.
