# Auditoría de código · módulo de mantención (`/mantencion`, `/m/mantencion`, OT)

**Fecha:** 2026-11-04 · **Alcance:** revisión estática de `lib/mantencion`, `lib/services/mantencion`, `db/schema/mantencion-*`, migraciones 0361–0370, rutas `app/(app)/mantencion/**`, `app/(mecanico)/m/mantencion/**`, `app/api/mantencion/**`, `components/mantencion/**` y `public/mant-sw.js`.

**Método:** lectura de código y trazado de los flujos reales (escritura → validación → lectura derivada). **No se ejecutó la aplicación ni las suites** en esta pasada: los hallazgos son reproducibles por lectura, pero no se adjunta evidencia de navegador. No se proponen funciones nuevas; todo lo listado es comportamiento actual que falla, se contradice o pierde datos.

---

## 1. Resumen ejecutivo

Los seis defectos de mayor impacto hoy:

1. **Un mecánico puede firmar trabajo a nombre del mecánico asignado a una OT** y hacer avanzar esa OT sin que el asignado haya trabajado (`records-create.ts:146-151`).
2. **La app queda «Sin señal» para siempre tras una sola falla de red** y deja de refrescar catálogo e historial hasta que se recarga la página (`lib/mantencion/client/signal.ts:42-58`).
3. **La tarjeta de taller no permite operar la OT** —el botón de taller ya está oculto por un heurístico de folio, pero la app no puede abrir la OT— y el servidor responde «Ese registro no existe» si un cliente antiguo o una llamada directa envía el id de la OT (`fleet.ts:156`, `workshop-updates.ts:50-72`, `home-lists.tsx:39-51`).
4. **El panel subcuenta «Días fuera de servicio»**: todo equipo en taller por una OT suma 0 días, aunque la misma pantalla lo muestre como «En taller» (`panel.ts:130-146` vs. `154-170`).
5. **Anular un registro puede dejar una OT cerrada sin trabajo vigente que la respalde**, sin evento ni marca en la OT (`record-lifecycle.ts:54-88` vs. `work-orders/core.ts:222-240`).
6. **Un mecánico de la faena puede cerrar el taller de correctivas ajenas** que no puede ni leer (`workshop-updates.ts:74-78` contra `access.ts:43-49`).

---

## 2. Seguridad y autorización

### 2.1 ALTA · Suplantación del ejecutor en el enlace registro ↔ OT

**Dónde:** `lib/services/mantencion/records-create.ts:146-151`

```ts
const mayWork = manages || ot.assignedToUserId === author.userId
  || (namedExecutor !== null && namedExecutor === ot.assignedToUserId)
```

La tercera cláusula sólo es alcanzable cuando el autor **no** es el asignado; existe únicamente para dejar que otro mecánico firme atribuyendo el trabajo al asignado. `executor.kind: "otro_mecanico"` sólo valida que el usuario exista y tenga la app (`records-create-validate-corrective.ts:135-137`); no hay consentimiento del nombrado.

**Escenario:** el mecánico B conoce el id de la OT de A (tablet compartida, URL, PDF o captura) y envía `POST /api/mantencion/sync/registros` con `kind: "C"`, el equipo de la OT, `workOrderId` de A y `executor: { kind: "otro_mecanico", userId: A }`. Resultado: el registro queda con `registeredBy = B` y `executorUserId = A`; `finishWorkOrder` acepta la OT por tener «al menos un registro vigente enlazado» (`transitions.ts:309-318`) y el PDF de la OT se imprime con A como ejecutor. La vía web equivalente sí está cerrada (`web-record.ts:132` usa `canRegisterWorkOrderRecord`): el hueco es sólo el camino del teléfono.

**Corrección mínima:** eliminar la cláusula `namedExecutor === ot.assignedToUserId`; el enlace debe exigir `ot.assignedToUserId === author.userId` o `manage`.

### 2.2 ALTA/MEDIA · «Sigue en taller» / «Ya salió» escribe fuera del alcance de lectura

**Dónde:** `lib/services/mantencion/workshop-updates.ts:74-78`

```ts
const mayUpdate = viewer.isGlobal
  || viewer.worksiteIds.includes(record.worksiteId) // ← no exige mant:records:view_worksite
  || record.registeredBy === viewer.userId
  || record.executorUserId === viewer.userId
```

El rol `mecanico` es `isGlobal: false`, tiene faenas asignadas y **sólo** `mant:records:view_own`. `recordVisibility()` (`access.ts:43-49`) ignora `worksiteIds` cuando no hay `view_worksite`, así que no puede leer esos registros; para escribir, en cambio, la rama de faena se los abre.

**Escenario:** `GET /api/mantencion/sync/historial` entrega los ids de todos los registros vigentes de la empresa (ver 2.3). El mecánico toma un id de su faena y hace `POST /api/mantencion/sync/taller` con `{ kind: "salio", recordId, exitDate }`. El equipo desaparece de «En taller ahora», de `daysStopped` del panel y del Excel; la novedad queda auditada a su nombre. También puede insertar notas en el detalle y en la hoja «Actualizaciones de taller».

**Corrección mínima:** condicionar la rama de faena a `hasMantPermission(viewer, "mant:records:view_worksite")` o reutilizar `canSeeRecord(recordVisibility(viewer), record)`.

### 2.3 MEDIA · El canal móvil no aplica los permisos de lectura que sí aplica la web

**Dónde:** `lib/services/mantencion/app-history.ts:90` (`loadAppHistory(_viewer)`, viewer sin usar) y `lib/services/mantencion/photos.ts:198-209` (`loadSyncPhotoFile` no recibe viewer).

El historial y las fotos de **toda la empresa** (todas las faenas y autores) se entregan a cualquier portador de una credencial con `mant:app:use`, incluyendo notas, descripción de reparaciones, repuestos, horas, ejecutor y los bytes de cada foto. Está documentado como decisión deliberada en el comentario de `app-history.ts:19-23` («lectura abierta a toda la app»), pero deja `mant:records:view_own` y `view_worksite` sin efecto en el canal móvil. Combinado con 2.2, el historial es además la fuente de ids para escribir fuera de alcance. **No es una fuga accidental, pero es una inconsistencia de autorización**: o se acepta que el permiso de lectura no rige en móvil (y se cambia el modelo), o el historial debe proyectarse con `recordVisibilitySql`.

### 2.4 MEDIA/LATENTE · `mant:equipment:manage` se interpreta como «todas las faenas»

**Dónde:** `lib/services/mantencion/access.ts:77-81`, `equipment.ts:264-322`, `schedule-assign.ts:74-101`.

`equipmentScope()` devuelve `"all"` si el usuario tiene `mant:equipment:manage`. Las escrituras de equipos (editar, dar de baja, reactivar, asignar pauta) toman el id y no comparan la faena del equipo con `viewer.worksiteIds`. Hoy no es explotable con los grants por defecto (sólo `jefe_mantencion`, que es global), pero en cuanto se delegue «encargado de equipos de su faena» sin `view_all`, ese rol verá y exportará toda la flota y podrá editar equipos de otras faenas por id. Es un IDOR listo para aparecer.

### 2.5 BAJA · Revocación de dispositivos sin alcance

**Dónde:** `lib/services/mantencion/device-credentials.ts:131-154` y `:161-187`; `app/(app)/mantencion/dispositivos/actions.ts`.

La lista muestra nombre, correo, `deviceId` y último uso de **todos** los usuarios, y `revokeDeviceCredential` revoca por id sin comprobar faena ni pertenencia. Un `mant:devices:manage` delegado a otra jefatura puede dejar sin sincronizar a cualquier mecánico de la planta. La acción además usa `operationPathname: "/mantencion/equipos"` (página equivocada) — sólo cosmético.

### 2.6 BAJA · El mecánico asignado no puede descargar ni imprimir su OT

**Dónde:** `app/(app)/mantencion/ot/[id]/page.tsx:23` admite `mant:ot:execute`; `app/api/mantencion/ot/[id]/pdf/route.ts:27` y `app/(print)/mantencion/ot/[id]/print/page.tsx:23` exigen `mant:ot:view_worksite|view_all`. El botón «Descargar PDF» se pinta siempre (`components/mantencion/jefatura/ot/ot-actions.tsx:202-206`).

El rol `mecanico` tiene `mant:ot:execute` y no `mant:ot:view_*` (`modules/mantencion-equipos/manifest.ts:154`), así que ve la OT, ve el botón y recibe 403 / `redirect("/forbidden")`. Falla cerrado, pero es un permiso incoherente.

---

## 3. Integridad de datos

### 3.1 ALTA · Carrera que re-ancla una foto a otro registro

**Dónde:** `lib/services/mantencion/records-create.ts:266-267` + `records-create-validate.ts:114-125`.

La validación exige `recordId === null` (o el mismo registro), pero corre dentro del bloqueo del perfil del equipo. Dos registros de **equipos distintos** no se serializan (bloquean perfiles distintos), ambos ven la foto nula y ambos ejecutan:

```ts
await tx.update(mantRecordPhotos).set({ recordId: input.id, sortOrder: index })
  .where(eq(mantRecordPhotos.id, photo.id)) // sin AND record_id IS NULL
```

La última transacción gana: la foto del equipo A aparece en el registro del equipo B y el otro registro queda sin la evidencia que su bitácora declara (`photos: N`). La base no lo detecta: no hay único por `(record_id, kind)` ni por `(record_id, sort_order)`. Requiere un cliente que reutilice un `photoId` (bug de la app o petición manual), pero el arreglo es de una línea: `and(eq(id), isNull(recordId))` + fallar si no actualiza filas.

### 3.2 ALTA · Anular un registro deja una OT cerrada sin trabajo vigente

**Dónde:** `lib/services/mantencion/record-lifecycle.ts:54-88` frente a `work-orders/core.ts:222-240` y `transitions.ts:309-318`.

`voidRecord` no mira `work_order_id`. La invariante del lado OT exige un registro vigente firmado después de la última devolución para terminar. Si la jefatura anula la única correctiva de una OT ya `cerrada`, la OT queda cerrada sin ningún registro vigente que la respalde: `linkedRecordState` devuelve `linked: false`, el talonario imprime el registro marcado `voided`, la hoja de vida declara una reparación que ya no existe y no se escribe ningún evento en `mant_work_order_events`. La conformidad y la CAPA acreditada siguen vigentes sobre una premisa destruida.

### 3.3 MEDIA · `client_op_id` es único global y el replay no valida la OT

**Dónde:** `db/schema/mantencion-work-orders.ts:209`, `work-orders/sync-ops.ts:48-70` y `work-orders/core.ts:114-125`.

`findAppliedOp` / el chequeo de `runLocked` buscan por `client_op_id` **sin filtrar por `work_order_id`**; `appliedOutcome` devuelve 200 con el `workOrderId` y el `status` de la OT del evento encontrado. Si el teléfono reutiliza un id entre dos OT, la segunda operación se reporta como «aplicada» sin escribir nada y la app la borra de la cola: trabajo perdido en silencio. Además `markWorkOrderItems` no escribe evento cuando no hay marcas ni ítems nuevos (`transitions.ts:280`), así que esa operación nunca recibe `client_op_id` y el teléfono la reenvía indefinidamente.

### 3.4 MEDIA · Fotos huérfanas al fallar la mitad del formulario web

**Dónde:** `lib/services/mantencion/web-record.ts:144-154`.

Las fotos se guardan una a una, cada `savePhoto` con su propio insert, sin transacción. Si la foto #2 falla (tipo, magic bytes, tamaño), la #1 ya quedó en `mant_record_photos` con `record_id = NULL` y su archivo en disco. El formulario se reenvía con ids nuevos, así que esas filas no se reclaman nunca. El comentario de la línea 125 dice que el permiso se mira antes justo para no dejar huérfanos, pero el fallo a mitad del bucle queda fuera de esa protección. No hay recolector servidor para `mant_record_photos` (sí existe para otra evidencia, p. ej. `pdtp/evidence-gc.ts`): `storage/mantencion` sólo crece.

### 3.5 MEDIA · La composición de fotos no está garantizada por la base

**Dónde:** `db/schema/mantencion-records.ts` (`mantRecordPhotos`) + `records-create-validate.ts:96-112`.

La regla 8 (preventiva = exactamente 1 `filtros` + 1 `sticker`; correctiva = 1..3 `correctiva`) sólo vive en el servicio. No hay único por `(record_id, kind)` ni check de cantidad: una vía que no pase por `checkPhotoComposition` (importación, corrección manual, bug de la app) puede dejar un registro firmado con dos filtros y sin sticker, y nada lo delata después.

### 3.6 MEDIA · La emisión de credencial no es idempotente bajo concurrencia

**Dónde:** `lib/services/mantencion/device-credentials.ts:62-90`.

`UPDATE ... revocado` + `INSERT` en la misma transacción, con el índice parcial único `mant_device_credentials_live_unique` como red. Dos peticiones simultáneas para el mismo `(userId, deviceId)`: la segunda no ve la fila no confirmada, su `UPDATE` no revoca nada y su `INSERT` choca al confirmar la primera. No hay catch: responde 500 en un endpoint cuyo contrato es «emitir/reemplazar». El patrón correcto ya existe en el repo (`photos.savePhoto`: `onConflictDoNothing().returning()` + relectura).

### 3.7 BAJA · Errores únicos mal atribuidos y reintentos infinitos por 500

- `records-create.ts:89-96`: cualquier violación única de la transacción se interpreta como «otro envío del mismo id»; si vino de `mant_records_folio_unique` o `mant_record_items_key_unique`, `findExisting(input.id)` es `null`, se relanza y el endpoint responde 500: el teléfono reintenta con backoff para siempre.
- `equipment.ts:31-34, 144, 294`: `uniqueFailure()` traduce **toda** violación única a «Esa patente ya está en otro equipo.». Dos «incorporar» simultáneos del mismo vehículo chocan en la PK de `mant_equipment_profiles` y el usuario recibe un error sobre un campo que no tiene nada que ver.
- `mant_record_parts.job_id` no garantiza que el repuesto cuelgue de un trabajo del mismo registro (FK simple; `groupJobs` lo esconde bajo el primer trabajo).
- `voidRecord` limpia `pdf_storage_key` y `pdf_generated_at` pero no borra `${recordId}-1.pdf`; la siguiente descarga genera `${recordId}-2.pdf` y el PDF entregado antes de anular queda para siempre sin fila que lo nombre.

---

## 4. App del mecánico (offline, cola y tablet compartida)

### 4.1 ALTA · La app se queda «Sin señal» para siempre tras una sola falla

**Dónde:** `lib/mantencion/client/signal.ts:42-47` y `:50-58`; `components/mantencion/app/use-mant-runtime.ts:49`; `home-screen.tsx:177`.

```ts
export function reportReachable(reachable: boolean) {
  const next = !reachable
  if (next === unreachable) return
  unreachable = next            // se prende con UNA falla
}
```

Nada limpia `unreachable` cuando vuelve la red: el evento `online` sólo lo limpia si `navigator.onLine` pasó a `false`, y en el caso típico (wifi sin salida / servidor que no responde) el navegador **nunca** dispara `online` porque siempre estuvo en línea. Los caminos que podrían limpiarlo exigen `isOnline()`:

- `use-mant-runtime.ts:49` → `if (isOnline()) { refreshCatalog(); refreshHistory() }`: con `unreachable = true` el refresco automático no corre nunca.
- El único botón manual («Actualizar») está dentro de `{online ? ... : null}` (`home-screen.tsx:177`): desaparece justo cuando haría falta.
- `history-sync.ts:136` → `if (!isOnline()) return null`: las fotos del historial se ven «sin conexión» con señal.
- `flow-screen.tsx:114` firma con `offlineSince: getOfflineSince()`: todos los registros firmados desde ese momento viajan con una hora de aislamiento inventada, que es exactamente el dato que jefatura usa para distinguir sello de recepción.

La única salida es recargar la página. Una sola falla transitoria con la cola vacía basta.

### 4.2 MEDIA · La tarjeta de taller no permite operar la OT y el servidor no reconoce su id

**Dónde:** `fleet.ts:150-161` (para la OT, `recordId: row.id`), `home-lists.tsx:39-51`, `fleet-view.ts:156-166`, `workshop-updates.ts:50-51,72`, `home-model.ts:69-71`.

**Corrección del 2026-11-04:** la versión inicial de este informe decía que la app ofrecía siempre «Actualizar estado» y que el envío fallaba. No es así: `home-lists.tsx:39-51` detecta `folio?.startsWith("OT-")` y **oculta** el botón, mostrando sólo el folio. El defecto real es más acotado y sigue siendo relevante:

- El catálogo pone el id de la **OT** en `workshop.recordId` y no expone un `workOrderId` explícito; la app no tiene forma de abrir la OT desde esa tarjeta, así que el mecánico ve el equipo en taller pero **no puede operarlo** desde ahí (debe ir a «Mis OT»).
- Si un cliente viejo (PWA con caché anterior) o una llamada directa envía `{ recordId: <id de OT> }` a `/sync/taller`, el servidor busca en `mant_records`, no encuentra fila y responde 422 «Ese registro no existe». El ítem queda `rejected` y no se muestra: `rejectedRecords()` sólo devuelve ítems `type === "record"` y `workshopEntries` filtra `status !== "rejected"`, así que la novedad desaparece sin aviso.
- El heurístico por prefijo de folio es frágil: cualquier cambio futuro de folio rompería la única protección.

**Corrección aplicada en el plan:** agregar `workOrderId` al contrato del catálogo (`CATALOG_FORMAT` 4), reemplazar el heurístico por el campo explícito con respaldo por folio, y agregar «Abrir la OT» en la tarjeta, reutilizando el `OtSheet` existente (ingreso, ítems, fecha, registrar trabajo, terminar). El servidor debe responder con un mensaje claro si recibe un id de OT en `/sync/taller`.

### 4.3 ALTA · Un registro rechazado bloquea para siempre su actualización de taller

**Dónde:** `lib/mantencion/client/queue-order.ts:26-28`.

```ts
if (item.type === "workshop") {
  return queue.some((other) => other.type === "record"
    && other.id === item.payload.recordId && other.status !== "sent") // incluye "rejected"
}
```

El comentario del módulo dice «una dependencia RECHAZADA no bloquea» y para `ot`/`record` se usa `alive()` (que excluye `rejected`). El caso `workshop` quedó con `!== "sent"`.

**Escenario:** sin señal se firma una correctiva con «queda en taller»; el equipo aparece en taller porque `localRecords` incluye pendientes; el mecánico registra «Sigue en taller»; vuelve la señal y el registro es rechazado (fecha futura, equipo dado de baja). La actualización de taller queda `pending` para siempre: nunca se envía, nunca se rechaza, nunca se descarta. Infla el contador de pendientes, dispara el aviso de «más de 24 h» y provoca una pasada de sincronización cada 60 s (`sync-engine.ts:214-221`).

### 4.4 ALTA · Se pisa un borrador en curso sin preguntar

**Dónde:** `components/mantencion/app/mant-app.tsx:88-92` y `:143`; `home-screen.tsx:103-110`; `flow-screen.tsx:53-56`; `lib/mantencion/client/drafts.ts:33-36`.

Hay un solo borrador por cuenta y tipo (`draftKey = userId:kind`). El flujo se autoguarda a los 400 ms del primer render. `HomeScreen.start()` sólo avisa si ya hay un borrador de ese tipo **de otro equipo u otra OT**:

```ts
const existing = drafts.find(d => d.kind === kind && draftHasContent(d)
  && (d.vehicleId !== vehicleId || d.workOrderId !== workOrderId))
```

Si el borrador existente es del **mismo equipo y sin OT**, `existing` es `undefined` y se arranca de cero: el autoguardado reemplaza el anterior. Tampoco consultan nada `DoneScreen.onStartOther` (va directo a `startFlow`, `mant-app.tsx:143`), `fixRejected` ni el enlace `?corregir=`. **Escenario:** preventiva a medias de KA-140 (20 ítems y foto de filtros), el mecánico firma otra correctiva y en la pantalla de éxito toca «Registrar preventiva en KA-140»: el borrador se borra sin diálogo y sus fotos quedan huérfanas hasta la limpieza de 3 días.

### 4.5 MEDIA · `missing_photos` se reintenta para siempre aunque la causa sea permanente

**Dónde:** `lib/mantencion/client/sync-engine.ts:122-127`.

La causa más común de `missing_photos` es permanente: `records-create-validate.ts:114-119` lo devuelve cuando `row.uploadedBy !== author.userId` o cuando `row.recordId !== null && row.recordId !== input.id`. En ese caso `resetUploaded` borra el flag, el re-PUT responde 200 `duplicate` sin cambiar nada y el re-POST vuelve a dar 409 `missing_photos`; el motor hace `markRetry` para siempre (cada 15 min por el tope de backoff). El registro nunca llega ni aparece como rechazado para corregirlo, y las fotos quedan pinneadas en IndexedDB.

### 4.6 MEDIA · Un rechazo que el mecánico no puede corregir no tiene salida

**Dónde:** `components/mantencion/app/home-lists.tsx:105-124`, `home-model.ts:69-71`, `queue.ts:118-125`.

`RejectedSection` sólo ofrece «Corregir y reenviar». `fixRejected` exige que el equipo siga en el catálogo del teléfono (`mant-app.tsx:119-123`). Rechazos como «El equipo está dado de baja», «Esa versión de la pauta ya no está disponible» o «Ese identificador ya pertenece a otra persona» son irreparables desde la app y no hay botón para descartar un registro rechazado (sólo `discardRejectedOtOp` para OT). El banner «Por corregir» es permanente y sus `photoIds` se conservan para siempre en `referencedPhotoIds`, lo que empuja al `StorageFullError` que bloquea registros nuevos.

### 4.7 MEDIA · El service worker conserva el shell autenticado tras cerrar sesión

**Dónde:** `public/mant-sw.js:33-43,77-101`; `lib/mantencion/client/session.ts:15-27`; `bootstrap.ts:59-61,87-97`.

`storeShell()` guarda el HTML de `/m/mantencion` de la sesión que cargó, y `appNavigation` lo re-cachea en cada navegación. `signOutToMantLogin()` cierra la sesión y recarga `/m/mantencion/entrar`, pero no toca `caches` ni `activeAccountId`. Sin señal, la navegación a `/m/mantencion` cae en el `catch` y devuelve el shell viejo; `bootstrap` con `fresh = false` no decide por la sesión y usa la cuenta activa, que sigue siendo la anterior. En una tablet compartida, quien cierra sesión para entregarla no impide que el siguiente abra la app offline con la cuenta y la cola del anterior. (El PIN se exige para *cambiar* de cuenta, no para abrir la cuenta activa; eso es D7, pero el shell cacheado extiende esa ventana más allá de la recarga que hacía `signOut`.) Además, un 5xx en `/m/mantencion/entrar` devuelve el shell de la app en vez de una pantalla de login/error.

### 4.8 MEDIA · `resetInterruptedSending()` corre sin el cerrojo entre pestañas y no reinicia los intentos

**Dónde:** `components/mantencion/app/use-mant-runtime.ts:31` y `queue.ts:153-158`.

El motor se protege con `navigator.locks("mant-sync")`, pero el barrido de arranque no. Con la app abierta en dos pestañas (o PWA + pestaña), B devuelve a `pending` un ítem que A está enviando. Para registros el servidor es idempotente; para `ot`/`workshop` el segundo envío compite y puede marcar `rejected` una operación que sí se estaba aplicando. Además no resetea `attempts`, así que cada cierre a media subida suma un intento y el backoff real empieza más alto sin que nada haya fallado.

### 4.9 BAJA · Mensajes engañosos en la app

- «Equipos al día.» cuando el refresco devolvió `needs_login` o `skipped`: `home-screen.tsx:177` sólo distingue `offline`/`error`. Con la credencial revocada el mecánico recibe una felicitación por un catálogo que no bajó.
- Un 403 de permisos se presenta como «Tu sesión venció»: `api.ts:37-41` agrupa 401 y 403 en `"auth"`, y `sync-engine.ts:78-81` marca `needs_login` ignorando el mensaje «Tu cuenta no tiene permiso para usar la app del mecánico». Entrar de nuevo vuelve a fallar en bucle.
- El paso «Trabajo» acepta una línea de repuesto con descripción y cantidad vacía/0 (`flow-validate.ts:121-123` exige sólo *alguna* línea > 0), pero al firmar se envían todas y Zod responde literalmente «Too small: expected number to be >0» en inglés, sin decir qué línea (`flow-record.ts:88-91` vs `contracts.ts:123-126`).

---

## 5. Panel, estado de equipos y pautas (jefatura)

### 5.1 ALTA · «Días fuera de servicio» ignora todo lo detenido por una OT

**Dónde:** `lib/services/mantencion/panel.ts:130,136-146` frente a `:154-170` y `fleet.ts:147-162`.

`cases` sale de `loadWorkshopCases`, que sólo lee `mant_record_correctives.in_workshop` de registros vigentes. Pero «Equipos en taller» sale de `fleet`, y `fleet.workshop` incluye los equipos detenidos por una OT en ejecución; además, en el flujo con OT la correctiva **no** marca `inWorkshop` (`lib/mantencion/client/flow-validate.ts:132` retorna si hay `workOrderId`).

**Escenario:** máquina en taller desde el 01-10 por una OT, sigue ahí el 28-10. Panel de 30 días: «Equipos en taller» = 1, «Días fuera de servicio» = 0 · En 0 equipos; y en la misma pantalla la fila de «Próximas mantenciones» de esa máquina muestra `workshopDays` = 27 (`panel.ts:216-218`, que sí usa `fleet.workshop`). El Excel (`export-panel.ts:44`) publica el mismo 0.

### 5.2 MEDIA · La tabla «En taller ahora» sale vacía para las OT

**Dónde:** `panel.ts:154-155,174-180` y `correctiveSummaries` (`:222-228`).

Para una OT, `row.workshop.recordId` es el id de la OT, pero `correctiveSummaries` consulta `mant_record_correctives.record_id`. Nunca hay fila: «Trabajo» y «Motivo de seguir en taller» quedan en blanco en el panel y en la hoja «En taller ahora» del Excel (`export-panel.ts:63-66`). La OT sí tiene `repairDescription`/`maintenance`; se busca en la tabla equivocada.

### 5.3 MEDIA · `stale` está hardcodeado en `false` para los equipos detenidos por OT

**Dónde:** `fleet.ts:150-161`.

```ts
workshopByVehicle.set(row.vehicleId, {
  inWorkshop: true,
  stale: false,                                   // ← nunca se enciende
  lastActivityDate: todayInChile(row.updatedAt),  // ← se calcula y se descarta
```

`WorkshopState.stale` está documentado como «sigue en taller y su última novedad tiene más de 2 días» (`status.ts:101-102`) y `equipment-list.ts:108` no distingue el origen del taller. Una OT en ejecución desde hace 30 días sin movimiento: `panel.workshop.stale` = 0, «Sin actualizar» = «No» en el Excel, `workshopStale: false` en la lista y la tabla. La alerta nunca se enciende para equipos tomados por una OT.

### 5.4 MEDIA/BAJA · Un equipo puede desaparecer de todas las pantallas si cambia el medidor de su tipo

**Dónde:** `schedules.ts:57-61` (conteo «N equipos») frente a `schedule-assign.ts:53` (candidatos con filtro de unidad) y `fleet.ts:166-167` (`if (!unit) continue`).

La unidad se deriva siempre de `fuel_equipment_types.default_meter_type`, un campo editable desde `/admin/flota-catalogos/tipos-equipo` (incluye `none`). Si se cambia el medidor de un tipo que ya tiene equipos en mantención:

- `/mantencion/pautas` sigue diciendo «3 equipos» (cuenta perfiles);
- `/mantencion/pautas/<id>/equipos` muestra 2 y no permite desasignar el tercero (no es candidato);
- `/mantencion/equipos`, el panel y el catálogo del teléfono no muestran el equipo en absoluto (ni como `sin_pauta` ni `sin_lecturas`);
- y al intentar registrar, `lockAndLoadVehicle` devuelve `null` → «Ese equipo no existe» (`records-create-context.ts:81-82`).

Tres pantallas del mismo módulo con totales distintos y ningún aviso.

### 5.5 BAJA · `fillMissingCells` cuenta ítems inactivos y anuncia «actividades nuevas» falsas

**Dónde:** `lib/services/mantencion/schedule-editor.ts:240-245,301-305`.

El select no filtra `isActive` (correcto para que un ítem restituido tenga celdas), pero `filled` se usa para el mensaje y para marcar la columna `needs_review`. Al restituir un intervalo, celdas de ítems que no se ven en la pauta cuentan como «actividad nueva heredó su valor»; el usuario revisa una columna que no cambió. No corrompe datos; el aviso es falso.

### 5.6 BAJA · La salida de taller depende del orden de las filas

**Dónde:** `lib/mantencion/status.ts:111` (`updates.find(kind === "salio")`) con llamadores sin `ORDER BY`: `fleet.ts:256-264` y `records-workshop.ts:41-51` (sólo `equipment-life.ts:115-121` ordena).

Un registro con dos filas `salio` (posible por corrección manual o importación; el envío normal lo bloquea en `workshop-updates.ts:84-87`, la tabla no) da `exitDate`/`daysStopped` distintos entre la ficha del equipo y el panel/detalle del mismo registro. Hoy es latente.

### 5.7 BAJA · El estado usa el reloj del teléfono para «sin actualizar»

**Dónde:** `workshop-updates.ts:104` guarda `createdAt: input.createdAt` sin cota (la OT sí usa `assertNotFuture`, `core.ts:52`). Una tablet adelantada inserta «Sigue en taller» con fecha futura: `workshopState` lo da por actualizado para siempre; una atrasada lo deja «sin actualizar» permanentemente. El documento firmado queda intacto, pero el indicador deja de ser confiable y no hay forma de corregirlo (no se edita ni borra una actualización).

### 5.8 BAJA · El cálculo de la próxima mantención ignora el intervalo firmado

**Dónde:** `lib/mantencion/status.ts:37-39` usa `suggestInterval(intervals, lastPreventive.reading).point + base`, pero no `lastPreventive.intervalValue`.

Como el registro guarda el intervalo realmente declarado y el servidor acepta uno manual con motivo (`records-create-validate.ts:150-156`), un caso como «preventiva de 10.000 km hecha a los 19.000» se redondea al punto 20.000 y la próxima queda en 30.000, saltándose la de 20.000. El test `status.test.ts:54-62` fija el comportamiento actual, así que hay que decidir si es la regla deseada o un sesgo de redondeo; hoy la cifra que se muestra no corresponde al intervalo que se firmó.

---

## 6. Lo que revisé y sí está correcto

Para no volver a auditarlo:

- **Folio:** `nextFolio` incrementa con `INSERT … ON CONFLICT DO UPDATE … RETURNING` dentro de la transacción del registro; la carrera de 20 folios está cubierta.
- **Doble envío del mismo registro:** `createRecord` revalida `findExisting` **después** de bloquear el equipo; el catch por PK existe como red.
- **Lecturas:** `loadVehicleHistory` corre dentro de la transacción y con el perfil bloqueado; la regla 2 no puede validarse dos veces contra el mismo estado.
- **Orden de bloqueo:** equipo → OT es consistente entre `createRecord`, `runLocked` y `checkWorkOrderLink`.
- **Transiciones de OT:** los `check` de la 0361/0369 cubren todos los caminos alcanzables de `OT_TRANSITIONS`; `void` no sale de `cerrada`; `reopen` sólo de `cerrada`.
- **Pautas publicadas:** `publishScheduleVersion` y las ediciones del editor corren con `FOR UPDATE` sobre `mant_schedules`; el estado de flota y el catálogo leen el snapshot vigente, no el borrador.
- **Fechas:** `daysBetween`/`addDays`/`weekStart` usan `Date.UTC` y `todayInChile()`; no encontré `toISOString().slice(0,10)` en un camino de estado.
- **Filtros y paginación:** `recordsWhere` sólo achica el alcance; hay desempate estable; la página se recorta igual en servicio, paginador y enlace al detalle.
- **Credenciales de dispositivo:** sólo se guarda SHA-256; expiración y revocación se filtran en la misma consulta; el RBAC se relee sin caché en cada sync; reemitir revoca la anterior en la misma transacción.
- **Rutas públicas de sync:** las 7 llaman `authenticateSyncRequest` como primera sentencia y no leen cookies; el proxy aplica mismo-origen a mutaciones `/api`.
- **IDOR en fotos/PDF/export/detalle web:** todos aplican alcance y devuelven el mismo 404 para «no existe» y «no es tuyo».
- **Migraciones:** journal 0361→0370 sin huecos y sin drift evidente entre esquema TS y SQL.
- **Historial de equipo:** `loadEquipmentWorkOrders` y la hoja de vida aplican alcance de registros y de OT; `linkHistoricalRecord` exige `view_all` + `equipment:manage`.
- **Idempotencia de fotos:** `savePhoto` usa `onConflictDoNothing().returning()` + relectura y el nombre incluye la huella.

---

## 7. Cobertura y límites de esta auditoría

- No se ejecutaron `typecheck`, `lint`, `test:fast`, `test:pglite`, `test:e2e` ni la aplicación: **es una revisión estática**. Varios hallazgos (2.1, 2.2, 3.1, 3.3) conviene confirmarlos con una prueba de integración o PGlite antes de corregir.
- El punto 4.2 fue corregido el 2026-11-04: la app ya oculta el botón de taller para OT; el plan reemplaza el heurístico por `workOrderId` y agrega «Abrir la OT».
- No se auditó el contenido de `scripts/seed-mantencion.ts` ni los datos reales del seed; los problemas de datos de `KA-71`/patentes descritos en `PLAN-modulo-mantencion.md` siguen siendo decisiones de negocio.
- No se revisaron visualmente las pantallas en navegador; los defectos de presentación quedan fuera de este informe.
- El punto 2.3 está documentado en el código como decisión deliberada. Se reporta como inconsistencia de autorización para que la decisión sea explícita, no como fuga accidental.

---

## 8. Estado de corrección (2026-11-05)

Se ejecutó el plan `mantencion-fixes-paralelo` en cinco carriles con archivos disjuntos. Todos los hallazgos de las secciones 2–5 quedan corregidos o explícitamente fuera de alcance; la excepción de historial móvil se mantiene por decisión de producto (D4).

### 8.1 Tareas resueltas

| Hallazgo | Cambio | Evidencia |
|---|---|---|
| 2.1 Suplantación del ejecutor en OT | `records-create.ts`: el enlace exige `manage` o ser el asignado; nombrar a otro como ejecutor ya no abre la OT. | `mantencion-seguridad-pglite.test.ts` (A1) |
| 2.2 Taller fuera del alcance | `workshop-updates.ts` usa `canSeeRecord(recordVisibility(viewer), record)`. | A2, 24/24 |
| 2.3 Historial móvil abierto (D4) | Se mantiene; nota de excepción y prueba que la fija. | A10 |
| 2.4 `equipment:manage` global | `equipmentScope` ya no deriva «todas» de manage; escrituras, importación y asignación validan faena. | A4, PGlite |
| 2.5 Dispositivos sin alcance | Lista y revocación filtran por faenas del actor; `operationPathname` corregido. | A5 |
| 2.6 PDF de OT para el mecánico | El botón «Descargar PDF» sólo se dibuja con `mant:ot:view_worksite|view_all`; no se amplió la impresión. | `ot-actions.test.tsx` |
| 3.1 Foto re-anclada | `UPDATE … WHERE id = ? AND (record_id IS NULL OR record_id = ?)` + `PhotoClaimError` → 409. | A7 |
| 3.2 Anular deja OT cerrada | `voidRecord` bloquea si la OT está en `trabajo_terminado`, `recepcionada` o `cerrada`; exige reabrirla. | `mantencion-integridad-pglite.test.ts` |
| 3.3 `client_op_id` global | Replay scoped a OT + acción; `items` sin cambios escribe un evento vacío con la clave. | B2 |
| 3.4 Fotos huérfanas web | Compensación de las fotos guardadas si una posterior falla. | B3 |
| 3.5 Composición de fotos | Migración 0371: únicos parciales `(record_id, kind)` para filtros/sticker y `(record_id, sort_order)`; check de `sort_order`. | `db/__tests__/mantencion-photo-constraints.test.ts` |
| 3.6 Credencial concurrente | `pg_advisory_xact_lock` por usuario/dispositivo; nunca 500. | A8 |
| 3.7 Errores únicos / PDF huérfano | Mapeo por restricción, 409 en conflictos no-PK, borrado de `${id}-1.pdf` al anular. | A9/B4 |
| 4.1 Señal atascada | Un éxito limpia `unreachable`/`offlineSince`; el refresco automático ya no está tras `isOnline()`; «Actualizar» visible. | `signal.test.ts`, `mant-app.test.tsx` |
| 4.2 Tarjeta de taller / OT | Contrato `workOrderId`, `CATALOG_FORMAT` 4 y «Abrir la OT» reutilizando `OtSheet`; el servidor responde claro si recibe un id de OT. | `fleet-home.test.ts`, `home-lists.test.tsx`, `mant-app.test.tsx` |
| 4.3 Registro rechazado bloquea taller | `waitsForDependency` usa `alive()`; al rechazar un registro se descarta su novedad de taller. | `queue-sync.test.ts` |
| 4.4 Borrador pisado | La guardia pregunta por cualquier borrador del mismo tipo, incluidos mismo equipo, `DoneScreen` y `?corregir=`. | `mant-app.test.tsx` |
| 4.5 `missing_photos` infinito | Segunda respuesta seguida → `rejected`, no `pending`. | C5 |
| 4.6 Rechazo sin salida | «Descartar» con confirmación y liberación de fotos. | `home-lists.test.tsx` |
| 4.7 Shell tras cerrar sesión | `clearShellCache()` en `signOutToMantLogin`; el login nunca recibe el shell guardado. | `session.test.ts` |
| 4.8 Barrido sin cerrojo | `resetInterruptedSending` usa `navigator.locks("mant-sync")` y resetea intentos. | C8 |
| 4.9 Mensajes | Toast por `RefreshOutcome`, 403 separado de sesión vencida, cantidades de repuestos en español. | `flow.test.ts`, `mant-app.test.tsx` |
| 5.1 Días fuera de servicio OT | `panel.ts` suma el tramo abierto de `fleet.workshop` (OT incluida) + tramos cerrados, sin doble conteo. | `mantencion-panel-pglite.test.ts` |
| 5.2 «En taller ahora» OT | `workOrderSummaries` trae trabajo/motivo de `mant_work_orders`. | D2 |
| 5.3 `stale` de OT | Se calcula con `updatedAt` y `WORKSHOP_UPDATE_DAYS`. | D3 |
| 5.4 Medidor cambiado | Conteo de pautas con el filtro de candidatos; cambio de medidor bloqueado si hay equipos en mantención. | D4 |
| 5.5 Mensaje `fillMissingCells` | Sólo cuentan ítems activos para el aviso; se siguen creando celdas de inactivos para restituirlos. | D5 |
| 5.6 Salida de taller determinista | `workshopState` ordena por `createdDate`; consultas con `ORDER BY createdAt`. | D6 |
| 5.7 Reloj del teléfono | `createdAt` acotado a 5 min de futuro y no anterior al ingreso. | A11 |
| 5.8 Intervalo firmado | Fuera de alcance: regla de negocio pendiente (ver §8.3). | — |

### 8.2 Verificación ejecutada

- `npm run typecheck` → **0 errores** (con `NODE_ENV=test`).
- `npm run lint` → **0 errores**, 1 warning preexistente en `lib/mantencion/client/ot-model.ts:98`.
- `npm run check:secrets` → verde.
- `npm run test:pglite` → **343 archivos, 4.351 pruebas, 0 fallos** (1 skip), incluida la prueba nueva del id de OT.
- `npm run test:fast` → **18.446 pruebas verdes, 0 fallos**. Además de las pruebas del módulo, se corrigieron los cuatro fallos ajenos que arrastraba el entorno: `pdtp-re36-workbook` (lock huérfano de LibreOffice), `deploy-workflow` (variable `$image` del script), `providers.test` (flag de Chipax del shell) y `dte-portal/settings` (correo de importador del shell). También se eliminó el warning de `ot-model.ts` (`_operatorDriverId`).
- `npm run test:e2e --` specs de mantención (`1-app`, `2-jefatura`, `3a-equipos`, `3b-pautas`, `4-permisos`, `5-ot`) → **57 pruebas verdes** en Chromium (44 de la primera corrida + 13 de la repetición de jefatura tras corregir el fixture de fotos). Sin fallos de producto.
- `npm run db:verify-migrations` → **372 entradas verificadas** hasta `0371_lean_princess_powerful`; `db:generate` no reporta cambios pendientes. `git diff --check` sin observaciones.
- La suite E2E completa del repositorio y Safari/Android reales no se ejecutaron; la verificación de navegador es Chromium sobre las seis specs del módulo.

### 8.3 Límites y riesgos residuales

- **D4** (`mant:equipment:manage` restringido a faenas) cambia el alcance de un rol no global que hoy administre toda la flota. Antes de desplegar, revisar `user_roles`/`role_permissions` en producción; si existe, asignarle las faenas o un rol global según corresponda.
- **Migración 0371**: el bloque `DO` aborta con un mensaje claro si hay fotos duplicadas por `(record_id, kind)` o `(record_id, sort_order)` en la base destino. No se aplicó en producción; el pre-check sólo se ejecutó en PGlite (base vacía).
- **5.8** sigue pendiente de decisión de negocio: `equipmentStatus` usa el punto nominal de `suggestInterval` y no el `intervalValue` firmado. No se tocó para no cambiar la alerta de vencimiento sin una regla aprobada.
- **E2E** cubre Chromium y los flujos sembrados; no cubre Safari/Android reales, lector de pantalla ni la suite completa del repositorio.
- Los cambios quedan commiteados en `main`; no se desplegó ni se aplicó la migración en producción. No se ejecutó `db:seed`.
