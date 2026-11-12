# Auditoría del módulo TI — seguimiento

**Fecha:** 2026-09-07
**Alcance:** `modules/ti/manifest.ts`, `db/schema/ti.ts`, `lib/validation/ti.ts`, los 19 archivos de `lib/services/ti/`, las 10 rutas de `app/(app)/ti/`, `app/api/ti/*` y el acta imprimible `app/(print)/ti/actas/`.
**Naturaleza:** auditoría de **seguimiento** sobre `qa/reports/auditoria-ti-2026-09-03.md`. Los 15 hallazgos TI-01…TI-15 de esa auditoría se verificaron **cerrados en código**. Este informe cubre lo que quedó fuera de ese alcance, lo que quedó a medias y lo introducido por el refactor `9917fb5f refactor(ui): unificar estados y vocabulario visible`.

## Metodología y evidencia

- Lectura estática completa del módulo (schema, validación, servicios, actions, páginas, APIs, ruta de impresión) y contraste contra las reglas de `AGENTS.md` (layout, densidad A1–A6, búsqueda, patrón de scroll, formularios, exportación).
- Contraste de cada hallazgo contra los helpers canónicos de la plataforma (`lib/auth/rbac.ts`, `lib/services/notification-targeting.ts`, `lib/action-error.ts`, `components/ui/*`) para distinguir defecto propio de TI de convención del repositorio.
- `npx tsc --noEmit`: **sin errores**.
- `vitest run` sobre `ti-actions`, `ti-validation`, `ti-chile-time`, `civil-dates`: **25/25 OK**.
- `vitest run --config vitest.pglite.config.ts` sobre los 6 archivos TI: **71/71 OK**.
- Verificación de comportamiento de dependencias donde el hallazgo depende de ellas: expansión de arrays en el tag `sql` de Drizzle (`node_modules/drizzle-orm/sql/sql.cjs:134`) y validación de nombres de hoja de ExcelJS (`node_modules/exceljs/lib/doc/worksheet.js:142-170`).

### Advertencias de automatización y brechas de cobertura

- **No se ejecutó verificación en navegador.** `npm run audit` / `audit:full` siguen sin existir en `package.json`, igual que constató la auditoría del 2026-09-03. No hay `qa/reports/latest.md` producido por crawler. Todo lo clasificado aquí como PRODUCT BUG se sostiene en lectura de código y en el comportamiento verificado de las dependencias, **no** en reproducción autenticada.
- **Los tests de integración TI no corren en el pipeline por defecto.** Los 6 archivos `ti-*-pglite.test.ts` están en el `exclude` de `vitest.config.ts` y solo corren con `npm run test:pglite`. Verificar que CI invoque ese script.
- Sin cobertura determinística para: asignación de tickets, exportaciones `inventario_faena` / `equipos_trabajador`, entrega de alertas del cron, y notas de tareas de checklist.

---

## A. PRODUCT BUG — comportamiento incorrecto confirmado

### TI-16 · P1 · Las alertas diarias TI no llegan a nadie

`lib/services/ti/alerts.ts:160-168` resuelve los destinatarios con SQL propio contra **solo** `user_permissions`:

```sql
EXISTS (SELECT 1 FROM user_permissions up
        JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = users.id AND p.name = 'ti:view')
```

Es el **único lugar del repositorio** que resuelve permisos así. El resolvedor canónico `lib/auth/rbac.ts:90-113` y el helper de destinatarios `getUserIdsWithPermission()` (`lib/services/notification-targeting.ts:14-61`) unen **grants por rol + grants directos**. Y `ti:view` se otorga exclusivamente por rol: `modules/ti/manifest.ts:47-56` lo concede a `tecnico_ti`, `jefa_chome` y `subgerente_operaciones`, y `lib/auth/system-rbac.ts:63-85` materializa esos `defaultGrants` en `role_permissions`, nunca en `user_permissions`.

**Escenario de falla:** en una base sembrada con `npm run db:seed`, ningún usuario tiene fila en `user_permissions` para `ti:view`. `recipients` sale vacío, el bucle de `runTiAlerts` no itera, la función retorna `{ sent: 0, skipped: 0 }` y `app/api/cron/ti-alerts/route.ts` reporta éxito. Las cuatro alertas (garantías por vencer, renovación de licencias, reparaciones demoradas, tickets sin actualización) **se descartan en silencio**.

`lib/__tests__/ti-alerts-pglite.test.ts:88-95` enmascara el defecto: inserta un `userPermissions` directo (`p-ti-view-alertas`), es decir ejercita justamente el único camino que no ocurre en producción.

**Recomendación:** reemplazar el SQL por `getUserIdsWithPermission("ti:view")` y cambiar el test para otorgar el permiso vía rol.

### TI-17 · P1 · No existe forma de asignar un ticket a un técnico

Mitad no resuelta de TI-08. Esa auditoría recomendó «separar asignación de transición; preservar el asignado salvo que se envíe un cambio explícito **y agregar selector/acción de asignación**». Se hizo lo primero, no lo segundo.

`assigneeUserId` **no tiene ningún camino de escritura**: no está en `itTicketTransitionSchema` (`lib/validation/ti.ts:179-184`), `transitionTicketAction` no lo lee del `FormData` (`app/(app)/ti/tickets/actions.ts:157-162`), y en toda `app/(app)/ti/` solo aparece como campo de tipo de solo lectura. `lib/services/ti/tickets.ts:142` hace `input.assigneeUserId ?? ticket.assigneeUserId`, y el input siempre llega `undefined`.

**Consecuencias:** `it_tickets.assignee_user_id` es permanentemente NULL; el estado `asignado` (`IT_TICKET_STATUS_META.asignado`) no significa nada porque nadie queda asignado; la ficha muestra «Técnico: —» de forma perpetua (`ticket-detail.tsx:153`); el índice `it_tickets_assignee_idx` y el filtro `assigneeUserId` de `listTickets` son código muerto; y el permiso `ti:manage_tickets`, descrito en el manifiesto como «**Asignar**, transicionar y resolver tickets TI», no puede cumplir su primer verbo.

### TI-18 · P2 · Los contadores de las pastillas de estado de tickets son incorrectos

`app/(app)/ti/tickets/page.tsx:52-55` calcula `ticketsByStatus` recorriendo `rows`, que **ya viene filtrado** por `sp.estado` (línea 40). Las pastillas se pintan con esos contadores (línea 86).

**Escenario de falla:** con 40 tickets (10 nuevos, 30 en progreso), en `/ti/tickets` las pastillas muestran «Nuevos (10) En progreso (30)». Al hacer clic en «Nuevos», `rows` trae solo los 10 nuevos: la pastilla muestra «Nuevos (10)» y **todas las demás pierden su número**. El contador solo es correcto en la vista sin filtro, que es justo donde menos aporta.

### TI-19 · P2 · Marcar una tarea de checklist borra su nota

`lib/services/ti/access.ts:268` escribe `notes: input.notes?.trim() || null` sin distinguir «sin cambio» de «borrar», y `toggleChecklistTaskAction` (`app/(app)/ti/accesos/actions.ts:128`) pasa `formData.get("notes")` crudo, que es `null` cuando el campo no viaja.

Es exactamente la clase de bug que TI-13 corrigió para accesos: `upsertSystemAccess` sí usa el patrón correcto (`access.ts:111`, `input.notes == null ? existing.notes : …`) y `upsertSystemAccessAction` envía `undefined` cuando está vacío (`actions.ts:78`). La corrección no se propagó al camino de checklists.

**Escenario de falla:** un técnico anota en «Recuperar notebook» → «pendiente, el trabajador está en faena hasta el viernes». Otro marca la tarea desde una vista donde el textarea de nota no viaja: la nota se pierde sin registro (`toggleChecklistTask` tampoco hace `recordAudit`).

### TI-20 · P2 · Las tareas de checklist se muestran en orden alfabético, no en su secuencia

`lib/services/ti/access.ts:340` ordena `getChecklistTasks` por `asc(itChecklistTasks.name)`, y `it_checklist_tasks` no tiene columna de posición (`db/schema/ti.ts:302-315`). Las plantillas de `constants.ts:119-140` están escritas como **secuencia operativa**, y esa secuencia se destruye:

`ONBOARDING_CHECKLIST_TEMPLATE` se define como *Crear correo corporativo → Crear accesos → Entregar notebook → Entregar teléfono → Asignar licencias → Configurar aplicaciones → Entregar accesorios*, pero se renderiza *Asignar licencias, Configurar aplicaciones, Crear accesos, Crear correo, Entregar accesorios, Entregar notebook, Entregar teléfono*. El alta de un trabajador se lee empezando por asignar licencias antes de crear la cuenta de correo.

**Recomendación:** agregar `position integer` a `it_checklist_tasks`, poblarla desde el índice de la plantilla al instanciar y ordenar por ella.

### TI-21 · P2 · Dos exportaciones Excel fallan con datos reales

`app/(app)/ti/reportes/actions.ts:121` y `:132` crean una hoja por faena / por trabajador con `name.slice(0, 30)` como nombre de hoja, sin sanear. ExcelJS lanza (`node_modules/exceljs/lib/doc/worksheet.js:156,170`):

- `Worksheet name … cannot include any of the following characters: * ? : \ / [ ]` → una faena llamada `Planta Norte / Sur` rompe la exportación.
- `Worksheet name already exists: …` → dos trabajadores cuyos nombres coinciden en los primeros 30 caracteres rompen la exportación. `María Fernanda González Rodríguez` ya excede los 30; dos hermanos o dos homónimos parciales colisionan.

El `catch` de la línea 266 lo convierte en un genérico «Error al generar el reporte», sin pista de la causa.

Además, `equipos_trabajador` genera **una hoja por trabajador**: con 300 trabajadores produce un libro de 300 hojas, inmanejable. Debería ser una hoja agrupada por trabajador.

### TI-22 · P3 · La tarjeta de reporte se habilita con un activo inválido

`app/(app)/ti/reportes/report-card.tsx:33-48`: el `Select` usa el centinela `"_none"` como valor del placeholder y `onValueChange={setAssetId}` lo guarda tal cual. Si el usuario elige un activo y luego vuelve a «Selecciona un activo», `assetId === "_none"`, la guarda `needsAsset && !assetId` deja de bloquear, el `ExportButton` se habilita y se llama `exportTiReport("historial_activo", "_none")` → «Activo no encontrado».

El módulo ya tiene el idioma correcto para esto: `activos/asset-filters.tsx:67` mapea el centinela `ALL` de vuelta a vacío.

### TI-23 · P3 · Dos de las cuatro alertas se emiten una sola vez en la vida

El encabezado de `lib/services/ti/alerts.ts:12-19` afirma que las alertas van «deduplicadas por día (dedupeKey)». Es incorrecto: `createNotification` retorna temprano ante cualquier fila previa con el mismo `(userId, dedupeKey)` (`lib/services/notification-create.ts:37-47`) y el índice `notifications_user_dedupe_unique` es permanente (`db/schema/audit.ts:101`). La deduplicación es **para siempre**, no diaria.

Garantías (`ti:warranty:{id}:{fecha}`) y licencias (`ti:license:{id}:{fecha}`) llevan la fecha en la clave, así que se comportan bien. Pero `ti:repair:{assetId}` (línea 116) y `ti:ticket:{ticketId}` (línea 137) **no llevan componente temporal**: un activo que vuelve a quedar demorado en reparación un año después, o un ticket que se toca y vuelve a quedar estancado, ya no vuelven a alertar nunca.

El resto de la plataforma es consistente en lo contrario: `prevention-document-ack-reminders.ts:97` usa `:${today}`, `feedback-sla-reminders.ts:50` usa `:${stage}:${day}`, `prevention-cphs-reminders.ts:161` usa `:${today.slice(0,7)}`.

---

## B. FUNCTIONAL FINDING / INCONSISTENCY

### TI-24 · P2 · Quien solo puede crear tickets no puede volver a verlos

`app/(app)/ti/tickets/page.tsx:39` solo ejecuta `listTickets` si `can(session, "ti:view")`. Los roles a los que el manifiesto otorga **únicamente** `ti:create_ticket` (`admin_contrato`, `jefe_terreno`, `supervisor_terreno`) crean el ticket y reciben un `EmptyState` (líneas 93-98): no pueden ver su estado, su avance ni su resolución, y `commentTicketAction` les permite comentar un ticket que no pueden abrir.

`listTickets` ya soporta `requesterUserId` (`tickets.ts:229`) — el filtro exacto que resolvería esto — y está sin usar. Es la persona descrita en el comentario de `createTicket` («los trabajadores de faena sin cuenta son representados por un usuario con cuenta») la que queda ciega.

### TI-25 · P2 · El KPI «Activos» del dashboard no coincide con el inventario al que enlaza

`getTiDashboardCounts` calcula `total` sobre `assetWhere`, que solo excluye borrados lógicos (`lib/services/ti/queries.ts:224,228-234`). `listAssets` en cambio excluye por defecto `dado_de_baja`, `perdido` y `robado` (`assets.ts:311-313`).

El tile «Activos» (`app/(app)/ti/page.tsx:74`) enlaza a `/ti/activos`. Con 120 activos de los cuales 12 están de baja, el tile dice **120** y la tabla lista **108**. `AGENTS.md` (A1, excepción del tablero) exige que un tile lleve a *su* subconjunto.

Lo mismo afecta los conteos de garantías (`queries.ts:244-248`), que incluyen activos ya dados de baja — mientras `collectTiAlerts` sí los excluye (`alerts.ts:47`) y la exportación `garantias` los incluye pero al menos muestra una columna Estado. Los tres consumidores de la misma pregunta responden distinto.

`licensesRenewing14` (`queries.ts:250-252`) no aplica alcance de faena alguno, a diferencia de `listLicenses`, que sí lo hace.

### TI-26 · P2 · «Préstamo» está modelado dos veces y de forma incoherente

Hay dos representaciones desconectadas del mismo concepto:

1. `it_asset_assignments.kind = 'loan'` — el sheet de entrega ofrece los 4 `IT_ASSIGNMENT_KINDS` en su selector «Tipo» (`assignment-sheet.tsx:215-226`), pero `createAssignment` escribe **siempre** `status: "asignado"` (`assignments.ts:102`), sin mirar `kind`. Elegir «Préstamo» o «Salida a reparación» produce un activo que se muestra «Asignado».
2. `it_assets.status = 'en_prestamo'` — es un estado manual (`MANUAL_ASSET_STATUSES`, `lib/validation/ti.ts:45`), y `changeAssetStatus` exige que **no** haya asignación abierta para fijarlo (`assets.ts:252-258`). O sea: `en_prestamo` solo existe sin acta de custodia.

Corolario: `ASSIGNABLE_STATUSES` no incluye `en_prestamo` (`assignments.ts:27`), de modo que un activo en préstamo nunca puede tener asignación, y por tanto la rama `asset.status !== "asignado" && asset.status !== "en_prestamo"` de `returnAssignment` (`assignments.ts:155`) es **código inalcanzable**.

**Recomendación:** decidir una sola semántica. Si el préstamo es custodia, que `kind` derive el estado (`loan → en_prestamo`, `repair_exit → en_reparacion`) y eliminar `en_prestamo` de los estados manuales. Si no lo es, quitar `loan` y `repair_exit` del selector de entrega.

### TI-27 · P2 · La página de asignaciones expone la nómina completa a un rol acotado

`app/(app)/ti/asignaciones/page.tsx:37-40` consulta trabajadores y faenas **sin alcance**:

```ts
db.select(...).from(workers).where(eq(workers.isActive, true))
db.select(...).from(worksites).where(eq(worksites.isActive, true))
```

Las dos páginas hermanas sí lo aplican: `activos/page.tsx:58-61` usa `workerScope`/`worksiteScope` y `tickets/page.tsx:45-48` también. Aquí los desplegables de «Nueva entrega» reciben todos los trabajadores y faenas de la empresa.

No es escalada de privilegio — `createAssignment` revalida con `assertTiWorksiteAccess` y con `worker.worksiteId !== input.worksiteId` — pero sí es divulgación de la nómina y una UX rota: el usuario elige un trabajador y recibe «No tienes acceso a esta faena».

### TI-28 · P3 · Un rol acotado puede editar y desactivar una licencia global

`createLicense` exige alcance global explícitamente: `if (worksiteIds !== "all") throw` (`licenses.ts:30-32`). `updateLicense` en cambio solo pide que la licencia **tenga alguna asignación en el alcance del usuario** (`assertLicenseInScope`, `licenses.ts:286-303`). Con una sola asignación en su faena, un rol acotado puede cambiar `name`, `cost`, `purchasedQuantity`, `periodicity`, `renewalDate` e `isActive` de una licencia corporativa.

Hoy el riesgo es teórico —`tecnico_ti` está en `GLOBAL_ROLES` (`lib/auth/scope.ts:17`) y ningún rol acotado recibe `ti:manage_licenses`— pero la asimetría entre crear y editar es una trampa para el próximo rol que se agregue.

### TI-29 · P3 · Colisiones de código y serie de activos dan un error opaco

`it_assets.code` y `it_assets.serial_number` tienen índice único **total**, no parcial (`db/schema/ti.ts:24,26`), mientras la comprobación en aplicación filtra por `isNull(deletedAt)` (`assets.ts:73-75`). Y para `serialNumber` no hay comprobación alguna, ni al crear ni al actualizar.

**Escenario de falla:** se elimina lógicamente `TI-NB-0042` y se intenta registrar un reemplazo con el mismo código. La comprobación de aplicación no lo ve, Postgres rechaza con 23505, y `safeActionMessage` —correctamente, para no filtrar el SQL— devuelve el genérico «Error al crear el activo». El usuario acaba de borrar ese activo y no tiene forma de saber que el código sigue tomado. Igual para dos activos con la misma serie.

**Recomendación:** comprobar duplicados incluyendo borrados lógicos y devolver un mensaje explícito para ambos campos.

### TI-30 · P3 · Otras asimetrías de validación en servicios

| Punto | Detalle |
|---|---|
| `assets.ts:137-138` | `updateAsset` no verifica `assetType.isActive`, mientras `createAsset` sí lo rechaza (`:71`). Se puede migrar un activo a un tipo desactivado. |
| `access.ts:91-146` | `upsertSystemAccess` no valida que el sistema exista ni que esté activo: un `systemId` inexistente cae en error de FK crudo, y se puede otorgar acceso sobre un sistema desactivado. |
| `access.ts:106-113` | Reactivar un acceso desde `baja` limpia `revokedAt` (correcto, TI-13) pero conserva el `grantedAt` original: la fecha de otorgamiento vigente queda falseada. |
| `access.ts:218-245` | `createChecklist` no impide checklists abiertos duplicados por trabajador+tipo, y no hace `recordAudit` (único mutador del módulo sin auditoría). |
| `licenses.ts:112-181` | `assignLicense` no impide asignar la misma licencia dos veces al mismo trabajador; tampoco hay índice único. Consume dos cupos. |
| `retirements.ts:207-286` | Nada exige que `responsibleUserId` y `authorizedByUserId` sean distintos, y el sheet ofrece la misma lista completa de usuarios en ambos selectores (`retirement-sheet.tsx:96-118`). El doble control que sugiere el modelo no se aplica. |
| `assignments.ts:257-259` | `transferAssignment` bloquea la fila del activo pero no valida su estado, a diferencia de `returnAssignment` (`:155`). |
| `maintenance.ts:37-41` | `createMaintenance` permite registrar mantenciones sobre un activo `dado_de_baja`, mientras `assignLicense` sí bloquea activos retirados (`licenses.ts:135`). |

### TI-31 · P3 · `retirementTargetStatus` está duplicada, y ambas copias tienen test

Idéntica en `lib/validation/ti.ts:158-160` y en `lib/services/ti/retirements.ts:203-205`. Ninguna importa la otra. La copia de servicios es la que se usa en producción (`:231`); la de validación **no tiene consumidor**. Peor: cada copia tiene su propio test (`ti-validation.test.ts:77-79` y `ti-maintenance-retirement-pglite.test.ts:177-179`), de modo que la suite verde no detectaría que divergen. Contraviene «Reuse Before Creating» de `AGENTS.md`.

### TI-32 · P3 · La UI de transición ofrece estados que el servidor rechaza

`ticket-detail.tsx:172` puebla el `Select` con los 8 `IT_TICKET_STATUSES`, ignorando el grafo `ALLOWED_TRANSITIONS` que ya existe en el servicio (`tickets.ts:109-118`). Desde `resuelto`, la única transición válida es `cerrado` o `en_progreso`, pero el desplegable ofrece también `nuevo`, `asignado`, `en_diagnostico`, `esperando_usuario` y `esperando_proveedor`; el usuario escribe el motivo obligatorio, envía, y recibe «No se puede pasar de 'resuelto' a 'nuevo'». El estado actual también es seleccionable y siempre falla.

Relacionado: transicionar a `asignado` no exige asignado (ver TI-17), y `resuelto` no exige resolución — `itTicketTransitionSchema.resolution` es opcional (`lib/validation/ti.ts:183`) y el campo no está marcado `required` (`ticket-detail.tsx:182`), de modo que un ticket puede cerrarse sin dejar constancia de qué se hizo.

### TI-33 · P3 · Desactivar un sistema de accesos oculta accesos vigentes sin revocarlos

`accesos/page.tsx:95` pasa a la matriz solo `systems.filter(s => s.isActive)`. `toggleAccessSystem` (`access.ts:46-68`) no advierte ni bloquea cuando el sistema tiene accesos `activo`, y el botón «Desactivar» no pide confirmación (`access-systems-panel.tsx:69-76`), pese a que el dato para advertir está a su lado: la insignia `{system.accessCount} activos`.

Resultado: N accesos siguen `activo` en `it_system_access` pero desaparecen de la matriz. En una baja de trabajador nadie los ve para revocarlos. `AGENTS.md` (checklist de UI) exige confirmación en acciones destructivas.

---

## C. UX FINDING

### TI-34 · P2 · 23 campos de texto largo usan `<Input>` de una línea; `Textarea` no se usa en todo el módulo

`components/ui/textarea.tsx` existe y se usa en **103 archivos** de `app/(app)`. En `app/(app)/ti/` hay **cero** usos. Los 23 campos afectados incluyen:

| Campo | Ubicación | maxLength |
|---|---|---:|
| `description` (ticket nuevo) | `tickets/ticket-sheet.tsx:69` | 2000 |
| `body` (comentario) | `tickets/[id]/ticket-detail.tsx:124` | 2000 |
| `resolution` | `tickets/[id]/ticket-detail.tsx:183` | 1000 |
| `workDone` | `mantenciones/maintenance-sheet.tsx:124` | 1000 |
| `observations`, `diagnosis`, `reportedIssue`, `partsUsed`, `notes`, `returnObservations`, `newObservations`, `reason`, `destination` | activos, asignaciones, bajas, licencias, accesos, garantías | 200–500 |

Describir una falla en 2000 caracteres dentro de un campo de una línea es inviable en la práctica: el usuario no ve lo que escribió. Es además la queja funcional más probable de los primeros usuarios de la mesa de ayuda.

### TI-35 · P2 · Los filtros de pastilla recargan la página completa

`AGENTS.md` (patrón de navegación y scroll) exige `router.replace(url, { scroll: false })` o `<Link scroll={false}>` para cambios de filtro, y su propia tabla de archivos corregidos ya incluye `ti/activos/asset-filters.tsx`. Quedaron sin migrar tres `<a href>` de navegación interna:

- `tickets/page.tsx:77-79` — las 7 pastillas de estado: cada clic es una recarga completa, pierde scroll y estado de cliente.
- `garantias/page.tsx:56-58` — las 6 pastillas de ventana de garantía, igual.
- `mantenciones/page.tsx:69` — enlace al activo desde el ranking de costos; debería ser `<Link>`.

`activos/asset-filters.tsx:70` sí hace lo correcto, con lo que el módulo se comporta de dos maneras distintas ante la misma acción.

### TI-36 · P2 · El dashboard TI repite cinco cifras en dos controles (regla A5)

`AGENTS.md` A5: «Una dimensión = una representación interactiva. No repitas la misma cifra en dos controles.» En `app/(app)/ti/page.tsx` cada una de estas cifras aparece dos veces:

| Cifra | Primera aparición | Segunda aparición |
|---|---|---|
| `activeAssignments` | tile «En custodia» (`:81`) | `SummaryBar` «Asignaciones activas» (`:49`) |
| `maintenanceCostYear` | detalle del tile «En reparación» (`:90`) | `SummaryBar` «Gasto reparación» (`:54`) |
| `warrantiesExpiring90` | detalle del tile «Garantías» (`:98`) | `SummaryBar` «Garantías a 90 días» (`:52`) |
| `openTickets` / `criticalTickets` | `SummaryBar` (`:50-51`) | tarjeta «Mesa de ayuda» (`:132-134`) |
| `licensesRenewing14` | `SummaryBar` (`:53`) | tarjeta «Licencias y servicios» (`:143-145`) |

Los 4 tiles de KPI sí respetan A1, y `MaintenanceTrend` respeta A5b con eje doble y comentario que cita la regla — el problema es solo la duplicación.

### TI-37 · P3 · Filtro activo invisible en tickets

El dashboard enlaza a `/ti/tickets?prioridad=critica` (`page.tsx:51`). `listTickets` aplica el filtro, pero la página no tiene control visible de prioridad ni categoría, y la pastilla resaltada se calcula solo con `sp.estado` (`tickets/page.tsx:81`): al llegar por ese enlace, **«Todos» aparece seleccionado** mientras la lista muestra únicamente los críticos. El usuario no tiene indicio de que hay un filtro puesto.

Relacionado: las pastillas cubren 6 de los 8 estados. `en_diagnostico` y `esperando_proveedor` no tienen pastilla y solo se alcanzan por «Todos», aunque `IT_TICKET_STATUS_META` los define y el grafo de transiciones los usa.

### TI-38 · P3 · La pestaña «Documentos» del activo es un callejón sin salida

`activos/[id]/asset-documents.tsx:23` recibe y descarta sus dos props funcionales: `{ assetId: _assetId, canManage: _canManage }`, con guion bajo para silenciar el linter. No hay control de carga en ninguna parte del módulo y **no existe `POST /api/ti/attachments`** — solo el `GET` (bien endurecido contra IDOR, `app/api/ti/attachments/[id]/route.ts`).

El estado vacío promete «Facturas, órdenes de compra y otros documentos asociados al activo aparecerán acá», pero nada dentro de TI puede ponerlos ahí, y ese `EmptyState` no tiene CTA, contra la regla A4 («qué significa + qué hacer + CTA real»).

### TI-39 · P3 · Los filtros de accesos se comportan distinto al resto del módulo

`accesos/page.tsx:70-89` usa `<form method="get">` con botón «Aplicar»: navegación completa y filtros que no se aplican hasta pulsar. `activos/asset-filters.tsx` aplica al instante con `router.replace` + `scroll: false`. Dos gramáticas de filtrado en el mismo módulo.

(La entrada de búsqueda propia de `/ti/accesos` **sí es correcta**: la ruta está registrada en `ROUTES_WITH_OWN_SEARCH`, `components/layout/top-bar.tsx:26`, de modo que el TopBar oculta la suya. No hay búsqueda duplicada.)

### TI-40 · P3 · Componente de filtro importado desde otro módulo

`accesos/page.tsx:14`: `import { FilterSelect } from "../../combustibles/filter-select"`. La página de accesos de TI alcanza dentro del módulo de combustibles por ruta relativa. Y TI ya define su propio `SelectFilter` local (`activos/asset-filters.tsx:38-56`): dos abstracciones equivalentes, una prestada de un módulo vecino, ninguna en `components/ui/`. Contraviene «Reuse Before Creating» y «Fix Shared UI Problems at the Correct Layer».

### TI-41 · P3 · Falta el filtro que responde la pregunta que el módulo plantea

El gráfico «Antigüedad del parque» destaca el tramo «5+ años» y el ranking de mantenciones dice «Los primeros de la lista son candidatos a reemplazo»: la pregunta del módulo es *qué reemplazar*. Pero el filtro de antigüedad del inventario solo ofrece «Hasta 3 / 5 / 10 años» (`asset-filters.tsx:28-32`), es decir equipos **más nuevos** que N. No hay forma de listar los de más de 5 años. Las barras del gráfico tampoco son enlaces a su subconjunto.

**Recomendación:** agregar un filtro `antiguedadMin` (`purchaseDate <= today - N years`) y hacer las barras navegables.

---

## D. IMPROVEMENT OPPORTUNITY

- **N+1 en la ficha de activo** — `activos/[id]/page.tsx:74-80` ejecuta `getAssignmentPhotos` + `getAssignmentAccessories` por cada asignación: 2N consultas. Resolver con dos consultas `inArray` y agrupar en memoria.
- **N+1 y ausencia de paginación en accesos** — `accesos/page.tsx:55-60` consulta las tareas de cada checklist (`listChecklists` no tiene límite), y `listWorkersWithAccess` carga **todos** los trabajadores activos filtrando la búsqueda en JavaScript (`access.ts:213`). La página degrada linealmente con la plantilla.
- **`runTiAlerts` hace alertas × destinatarios inserciones secuenciales** (`alerts.ts:172-193`), y cada `createNotification` además consulta el usuario y envía correo. 200 alertas × 20 destinatarios = 4000 ciclos secuenciales. Considerar inserción por lotes.
- **La página de reportes envía la lista completa de activos a las 9 tarjetas** (`reportes/page.tsx:56`), aunque solo `historial_activo` la usa. Pasarla únicamente a esa tarjeta.
- **Código muerto** — `getTicketsByCategory` y `getTicketsByMonth` (`queries.ts:377-400`) no tienen ningún consumidor, ni en la app ni en tests; `getTicketsByMonth` además promete «últimos 12 meses» en su docstring y **no lleva filtro de fecha**. También sin consumidor: `getActiveAssignmentForAsset` (`assignments.ts:468`) y `listSuppliersWithLinks` (`supplier-links.ts:206`). Síntoma de fondo: el dashboard tiene 5 gráficos de activos y **ninguno de tickets**, teniendo las agregaciones ya escritas.
- **La mesa de ayuda no notifica nada** — ni al crear, ni al asignar, ni al resolver un ticket, pese a que la plataforma tiene un servicio de notificaciones maduro. El único aviso relacionado con tickets es la alerta de estancamiento del cron (que hoy no llega, TI-16).
- **Mantención y estado del activo están desconectados** — registrar una reparación no mueve el activo a `en_reparacion`; hay que cambiarlo aparte. Además la alerta de «reparación demorada» usa `itAssets.updatedAt` como proxy del tiempo en reparación (`alerts.ts:105`), de modo que cualquier edición del activo reinicia el contador.
- **Sin corrección de errores de captura** — no existe borrado ni anulación de una mantención mal ingresada, ni reversión de una baja equivocada (`retireAsset` es terminal). Para un módulo con auditoría append-only, conviene una anulación explícita y trazable antes que ninguna salida.
- **Búsquedas ILIKE sin escapar** — `assets.ts:330`, `tickets.ts:232`, `maintenance.ts:133` interpolan el término en `%…%` sin escapar `%` ni `_`. No es inyección (son parámetros), pero un término con `%` devuelve resultados desconcertantes.
- **`app/api/ti/photos/route.ts:87` devuelve `error.message` al cliente**, sin pasar por `safeActionMessage`. Si el error viene del driver, el mensaje es `"Failed query: <SQL>…"` — exactamente el incidente que documenta `lib/action-error.ts:4-17`. Es una convención extendida en el repositorio (15+ rutas hacen lo mismo), así que corresponde arreglarlo de forma transversal, no solo en TI.

---

## Lo que está bien y conviene no romper

- **Autorización y aislamiento por faena.** Las 8 `actions.ts` verifican permiso antes de tocar datos y propagan `serviceWorksiteScope(session)`; los servicios revalidan el objetivo. Las correcciones TI-01…TI-04 se sostienen.
- **Las dos rutas de archivos son ejemplares.** `photos/[id]` y `attachments/[id]` verifican existencia en BD, tipo de entidad, resuelven la entidad propietaria y su faena antes de leer disco, y niegan con 404 en lugar de 403 para no confirmar existencia. Las cargas pendientes no son descargables.
- **Invariantes en el schema.** `uniqueIndex … where returnedAt IS NULL` garantiza una sola custodia abierta por activo a nivel de base, no solo de aplicación; los `check` cubren todos los enums; el borrado lógico preserva historial.
- **Transaccionalidad y trazabilidad.** Cada mutación corre en `db.transaction` con `for("update")` sobre la fila objetivo, y `appendAssetHistory` + `recordAudit` van **dentro** de la misma transacción, con el criterio explícito de que «si la mutación se revierte, la historia no queda mintiendo».
- **Fechas civiles.** `civil-dates.ts` resolvió TI-11 correctamente y se usa de forma consistente en alertas, garantías y reportes; el módulo usa `DatePicker`/`DateTimePicker` del design system y no aparece un solo `toLocaleDateString` ni `<input type="date">`.
- **Evidencia fotográfica.** El diseño de dos fases (pendiente → anclada en la transacción del acta) con limpieza de huérfanas es sólido, y el anclaje exige que la foto esté pendiente, sea de la etapa correcta y pertenezca al mismo técnico.
- **Integración con la shell.** `PageHeader` + `PageContainer` + `DataTable` con `searchKeys` en las 5 tablas, sin `<h1>` propios ni búsquedas duplicadas.
- **Cobertura de pruebas.** 96 pruebas TI verdes (25 unitarias + 71 de integración con pglite) más un smoke E2E.

---

## Correcciones aplicadas (2026-09-07)

Se implementaron 20 de los 26 hallazgos. Evidencia posterior a los cambios:

- `npx tsc --noEmit`: **sin errores**.
- `npx eslint .`: **0 errores** (1 warning preexistente en `.tmp/`).
- `vitest run --config vitest.non-pglite.config.ts`: **6430 pruebas OK**, 625 archivos.
- `vitest run --config vitest.pglite.config.ts`: **1365 pruebas OK**, 114 archivos.
- `npm run db:generate` reporta *"No schema changes"*; el `_journal.json` queda estrictamente creciente (no se editó a mano).
- Backfill de la migración 0258 verificado sobre PGlite: reordena las filas históricas según la plantilla y es idempotente.

### Cerrados

| ID | Qué se hizo |
|---|---|
| TI-16 | `runTiAlerts` usa `getUserIdsWithPermission("ti:view")` en vez de su SQL propio contra `user_permissions`. El test ahora concede el permiso **por rol** (`role_permissions` + `user_roles`), que es el camino real de producción. |
| TI-17 | Asignación de tickets implementada: `assigneeUserId` en `itTicketTransitionSchema`, propagado por la action, validado en el servicio (usuario existente y activo) y con selector "Técnico responsable" en la ficha. Pasar a `asignado` **exige** técnico. Centinela `IT_TICKET_UNASSIGN` para desasignar. |
| TI-18 | Nueva `countTicketsByStatus()`, que ignora el filtro de estado y respeta el resto. Las pastillas muestran los totales reales de los 8 estados. |
| TI-19 | `toggleChecklistTask` distingue "sin cambio" (`null`/ausente → conserva) de "borrar" (`""` → null), igual que `upsertSystemAccess`. Las notas de tarea además ahora se muestran en el panel. |
| TI-20 | Columna `position` en `it_checklist_tasks` (migración 0258 + índice + backfill idempotente por nombre de plantilla). `getChecklistTasks` ordena por `position`. |
| TI-21 | `safeWorksheetName()` en el builder Excel **compartido**: sanea caracteres reservados, nombre vacío, `History`, >31 caracteres y desambigua duplicados. `equipos_trabajador` pasó de una hoja por persona a una hoja ordenada. |
| TI-22 | El centinela `_none` del selector de activo vuelve a `""`, así el botón de exportar no se habilita con un id inválido. |
| TI-23 | `dedupeKey` con componente temporal: mes para reparaciones demoradas, día para tickets estancados. Docstring corregido (la deduplicación es permanente, no diaria). |
| TI-24 | Quien solo tiene `ti:create_ticket` ve y abre **sus** tickets (`requesterUserId`), en lista y en detalle. |
| TI-25 | `totalAssets`, garantías y los gráficos de composición (tipo, faena, antigüedad) excluyen estados terminales, igual que `listAssets`. El pie de estados los conserva a propósito. `licensesRenewing14` se acota con `licenseScopeCondition`. |
| TI-27 | Trabajadores y faenas de `/ti/asignaciones` van acotados por `workerScope`/`worksiteScope`. |
| TI-28 | `updateLicense` exige alcance global (`assertTiGlobalAccess`), simétrico con `createLicense`. Se eliminó `assertLicenseInScope`, ya sin consumidores. |
| TI-29 | `assertUniqueIdentifiers()` valida código **y** número de serie contra todos los activos, incluidos los eliminados lógicamente, con mensaje explícito para cada caso. |
| TI-30 | `updateAsset` rechaza mover a un tipo inactivo; `upsertSystemAccess` valida el sistema y renueva `grantedAt` al reactivar; `createChecklist` impide duplicados abiertos y audita; `assignLicense` impide doble cupo por trabajador/equipo; `retireAsset` valida firmantes. |
| TI-31 | `retirementTargetStatus` vive solo en `lib/services/ti/constants.ts` (vocabulario puro, sin `@/db`); servicio y test la importan de ahí. |
| TI-32 | El selector de estado ofrece solo transiciones alcanzables (`IT_TICKET_TRANSITIONS` movido a validación, compartido con el servicio). `resuelto` exige resolución. |
| TI-33 | Desactivar un sistema de accesos pasa por `ConfirmDialog`, advirtiendo cuántos accesos siguen activos sin revocar. |
| TI-34 | 23 campos de texto largo migrados de `<Input>` a `Textarea`. |
| TI-35 | Pastillas de tickets y garantías con `<Link scroll={false}>`; enlace al activo en mantenciones con `<Link>`. Se renombró la variable `window` que sombreaba el global. |
| TI-36 | La tira de resumen ya no repite ninguna cifra de los tiles; las tarjetas de mesa de ayuda y licencias describen su función en vez de duplicar contadores. |
| TI-37 | Filtros de prioridad y categoría visibles con chips removibles; las 8 pastillas de estado presentes. |
| TI-38 | El estado vacío de documentos dice de dónde llegan y que aún no se puede adjuntar desde la ficha, en vez de prometer una carga inexistente. |
| TI-39 | Filtros de accesos con aplicación instantánea (`router.replace` + `scroll: false`) y búsqueda con debounce, en lugar del `<form method="get">` con botón "Aplicar". |
| TI-40 | Se eliminó el import cruzado a `combustibles/filter-select`; `/ti/accesos` usa su propio `AccessFilters`. |
| TI-41 | Filtro `antiguedad_min` ("N años o más") en el inventario y enlace desde el gráfico de antigüedad al tramo de renovación. |

### Regresiones añadidas

- Asignación, reasignación y desasignación de tickets; rechazo de `asignado` sin técnico y de técnico inexistente.
- `countTicketsByStatus` ignora el filtro de estado y respeta prioridad.
- Colisión de código y serie contra activos eliminados y entre activos vigentes.
- Doble control de la baja (misma persona y firmante inexistente), verificando que el activo no se toca.
- Notas de tarea de checklist: se conservan al marcar, se borran solo con `""`.
- Checklist duplicado abierto por trabajador y tipo.
- Orden de las tareas según la plantilla (no alfabético).
- Saneamiento y desambiguación de nombres de hoja Excel, y `safeWorksheetName` unitario.
- `resuelto` exige resolución; las demás transiciones no.

### Cambios de comportamiento a comunicar

1. **Dar de baja exige dos personas distintas.** Responsable y autorizante ya no pueden coincidir. Cinco pruebas existentes usaban el mismo usuario y se actualizaron.
2. **Resolver un ticket exige escribir la resolución** (mínimo 3 caracteres).
3. **Dejar un ticket en `asignado` exige elegir técnico.**
4. **Editar o desactivar una licencia requiere alcance TI global**, como ya ocurría al crearla.
5. **El KPI "Activos" del tablero bajará**: ya no cuenta bajas, pérdidas ni robos. Es el número que muestra el inventario.
6. **`equipos_trabajador` cambia de forma**: una hoja ordenada por trabajador en vez de una hoja por persona.

## Cierre del plan de implementación (2026-09-07, fase 2)

Se implementó `crea-un-plan-de-optimized-glacier.md` completo (8 bloques), cerrando toda la sección "Pendiente" de la fase 1 salvo lo documentado como fuera de alcance más abajo.

- `npx tsc --noEmit`: **sin errores**.
- `npx eslint .`: **0 errores** (1 warning preexistente en `.tmp/`, ajeno a este trabajo).
- `vitest run --config vitest.non-pglite.config.ts`: **6452 pruebas OK**, 626 archivos.
- `vitest run --config vitest.pglite.config.ts`: **1398 pruebas OK**, 115 archivos.
- `npm run db:generate` reporta *"No schema changes"* tras aplicar la migración nueva; `_journal.json` queda estrictamente creciente.
- **Sin verificación en navegador** (mismo límite que la fase 1): notificaciones de tickets, carga de adjuntos, anulación de mantención y reversión de baja quedan verificadas por tests de servicio/acción, no por interacción real.

### Cerrados

| Bloque | Qué se hizo |
|---|---|
| 1 | `escapeLikePattern()` en `lib/utils.ts`, aplicado a los 4 call sites ILIKE de TI. `FilterSelect` movido a `components/ui/filter-select.tsx`; 7 archivos de combustibles actualizados. |
| 2 | N+1 resueltos: `getAssignmentsPhotos`/`getAssignmentsAccessories` (ficha de activo) y `getChecklistsTasks` (`/ti/accesos`), todos con `inArray` + `Map`. |
| 3 (TI-26) | Resuelto con la opción (a): `assignmentTargetStatus(kind)` deriva el estado desde el tipo de entrega (`loan→en_prestamo`, `repair_exit→en_reparacion`). `en_prestamo` sale de `MANUAL_ASSET_STATUSES`; `returnAssignment` acepta la devolución desde ambos estados derivados. |
| 4 | Barrido de `error.message` crudo en las 20 rutas de API del repo (no solo TI), todas envueltas con `safeActionMessage`; 4 rutas que derivan el status HTTP de una regex mantienen esa lógica sobre el mensaje crudo y solo envuelven el campo `error` de la respuesta. |
| 5 | Notificaciones de mesa de ayuda: creado, asignado (con guardia anti-spam contra el `<Select>` que reenvía el asignado actual en cada transición) y resuelto. `createTicket`/`transitionTicket` devuelven el payload necesario para decidir sin releer tras el commit. |
| 6 | `POST /api/ti/attachments` (route handler, no server action, por el límite de 21MB de `bodySizeLimit`). Lista blanca `TI_UPLOADABLE_ENTITY_TYPES = ["it_asset"]`; reutiliza `MimeType.DOCUMENT_LIBRARY`. Sin borrado (append-only, decisión consciente). |
| 7 | `voidMaintenance`: anula con motivo (≥10 caracteres), excluye la fila de todos los agregados de costo (incluido un bug real de agregado en cliente en `asset-maintenance.tsx`), la deja visible con badge en las listas. |
| 8 | `reverseRetirement`: revierte una baja (estado + custodia), reabriendo la asignación que cerró cuando corresponde. `retirementReverseBlocker()` centraliza 7 condiciones de consistencia (baja ya revertida, activo eliminado, baja histórica sin `previousStatus`, estado ya sobrescrito, baja posterior, movimiento posterior, asignación abierta), compartidas entre el guard del servicio y el `canReverse`/`reverseBlockedReason` de `listRetirements`. Permiso propio `ti:reverse_retirement` (doble control: no se concede a `tecnico_ti`). |

### Regresiones añadidas

- `assignmentTargetStatus`: préstamo y salida a reparación mueven el activo al estado correcto; la devolución lo regresa.
- Notificaciones de tickets: sin autonotificación al crear/asignar/resolver; sin spam cuando una transición no cambia el asignado.
- Adjuntos TI: inserta attachment + historial + auditoría; rechaza faena fuera de alcance, activo eliminado y `entityType` no permitido.
- Anulación de mantención: excluida de `maintenanceCostByAsset`/`getMaintenanceCostByMonth`; rechazo de motivo corto, doble anulación y edición tras anular.
- Reversión de baja: 13 escenarios en `ti-maintenance-retirement-pglite.test.ts` (simple, pérdida con reapertura de asignación, rechazo por devolución física real posterior, doble reversión, motivo corto, estado sobrescrito, baja posterior, activo eliminado, baja histórica sin `previousStatus`, scope de faena, entrada de historial, ciclo baja→revertir→baja de nuevo, `canReverse` en `listRetirements`) más 11 casos puros de `retirementReverseBlocker` en `retirement-reversal.test.ts`.

### Cambios de comportamiento a comunicar

7. **Un préstamo (`loan`) o salida a reparación (`repair_exit`) ahora mueve el activo a `en_prestamo`/`en_reparacion` automáticamente.** Antes quedaba en `asignado` y `en_prestamo` era un estado manual muerto.
8. **Anular una mantención y revertir una baja son nuevas acciones irreversibles-pero-corregibles**: no se borra el registro original, queda marcado como anulado/revertido con motivo y responsable.
9. **Revertir una baja es un permiso nuevo y separado** (`ti:reverse_retirement`), otorgado solo a `jefa_chome`/`administrador` — quien registra una baja no puede revertirla solo, por diseño (doble control).
10. **Nuevas notificaciones de tickets** (creado, asignado, resuelto) le llegarán a quienes tengan `ti:manage_tickets` en la faena, al técnico asignado y al solicitante, respectivamente.

## Revisión del changeset completo (2026-09-07, fase 3)

Antes de commitear se auditó el diff entero con seis revisiones paralelas independientes (una por bloque, más una de los 20 arreglos de la fase 1). No apareció ningún defecto crítico ni de corrección transaccional: el orden de locks, los predicados de reversión, la exhaustividad de la exclusión de mantenciones anuladas, el barrido de `error.message` (20 archivos / 22 call sites, con los 4 status derivados de regex intactos) y la seguridad de la carga de adjuntos se verificaron correctos uno por uno.

Sí aparecieron —y se corrigieron— estos defectos reales:

| Dónde | Qué estaba mal |
|---|---|
| `lib/reports/export-module/excel-builder.ts` | **Dos huecos que abortan una exportación completa.** (a) La desambiguación de nombres de hoja comparaba distinguiendo mayúsculas, pero ExcelJS compara con `toLowerCase()`: dos faenas "Faena Norte"/"FAENA NORTE" pasaban como distintas y `addWorksheet` lanzaba. (b) El recorte de comillas simples corría antes del `trim()` y del corte a 31 caracteres, así que un `"/'Faena A"` o un nombre de 32 caracteres con comilla en la posición 31 terminaban empezando/terminando en comilla —que Excel rechaza—. Ambos con regresión nueva. |
| `app/(app)/ti/tickets/[id]/ticket-detail.tsx` | El selector de estado no se resincronizaba con el servidor y, como el grafo no tiene auto-transiciones, tras cada cambio quedaba con un valor que ya no está en la lista: el trigger se veía en blanco y el envío siguiente no mandaba `status`. El de asignado era peor: su valor viaja en cada envío, así que uno obsoleto reasignaba el ticket al técnico anterior. Ahora ambos sincronizan durante el render, como `components/ui/filter-search-input.tsx`. |
| `lib/services/ti/supplier-links.ts` + `lib/services/ti/constants.ts` | El tile "Garantías por vencer" excluía estados terminales y el listado al que enlaza, no: el tile mostraba 0 y la lista una fila. De paso se centralizó `IT_RETIRED_STATUSES`/`isRetiredStatus` (el triple estaba repetido literal en siete lugares y ya había divergido justo acá). |
| `app/(app)/ti/mantenciones/maintenance-table.tsx`, `app/(app)/ti/bajas/retirement-table.tsx`, `app/(app)/ti/activos/[id]/asset-history.tsx` | Las tarjetas móviles no marcaban lo anulado/revertido, así que en teléfono —la única lectura disponible— una mantención anulada se leía con su costo como real y una baja revertida como vigente. El panel "Bajas registradas" de la ficha además contradecía a su propia línea de tiempo, mostrando en caja roja bajas ya revertidas. |
| `app/(app)/ti/accesos/access-filters.tsx` | El efecto de sincronización pisaba lo que el usuario seguía escribiendo (y le saltaba el caret), y el debounce reconstruía la query con valores capturados, borrando la faena recién elegida si vencía en medio de la navegación. |
| `lib/services/ti/access.ts` | "Un checklist abierto por trabajador y tipo" era check-then-insert sin lock ni índice único: un doble clic insertaba dos. Ahora la fila del trabajador se bloquea con `FOR UPDATE`. |
| `app/(app)/ti/tickets/actions.ts` + `lib/services/ti/tickets.ts` | Asimetría de TI-24: quien solo tiene `ti:create_ticket` no puede listar ni abrir tickets ajenos, pero por llamada directa sí podía comentarlos. Ahora comenta solo los suyos. |
| `app/api/ti/attachments/route.ts`, `lib/services/ti/attachments.ts`, `asset-documents.tsx` | La escritura en disco quedaba fuera del `try` (un disco lleno devolvía un 500 opaco en vez del 400 que la UI sabe mostrar); el borrado del archivo huérfano se descartaba en silencio pese a que no hay borrado de adjuntos; la lectura del activo no tomaba `FOR UPDATE` como el resto de los escritores; el input de archivo quedaba sin nombre accesible (`Field` sin `htmlFor`); y no había guarda de tamaño en cliente, así que en faena se subían 40 MB para recibir un 400. |
| `app/(app)/ti/activos/[id]/page.tsx` | El botón "Anular"/"Editar" mantención se mostraba con `ti:manage_assets`, pero la action exige `ti:manage_maintenance`: un rol con el primero y no el segundo llegaba a escribir el motivo para recibir "Sin permisos". |
| `app/(app)/ti/tickets/page.tsx` | Dos estados vacíos apilados (`DataTable` ya pinta el suyo). |
| Cuatro tests | Pasaban por la razón equivocada: el de regresión del spam de notificaciones usaba como asignado al propio actor (así que también habría pasado con la implementación defectuosa que motiva todo el bloque 5); el de transferencia no mandaba `newKind`, con lo que no distinguía el código nuevo del viejo; la aserción del costo mensual se volvía vacua al salir la fecha fija de la ventana de 12 meses; y el de checklist duplicado dependía del test anterior. Además se cubrió el predicado `hasLaterMovement`, el único de la reversión sin camino positivo probado. |

Evidencia tras las correcciones:

- `npx tsc --noEmit`: **sin errores**.
- `npx eslint .`: **0 errores** (1 warning preexistente en `.tmp/`, ajeno a este trabajo).
- `vitest run --config vitest.non-pglite.config.ts`: **6461 pruebas OK**, 628 archivos.
- `vitest run --config vitest.pglite.config.ts`: **1401 pruebas OK**, 115 archivos.

Sigue sin haber verificación en navegador: los arreglos de UI de esta fase (tarjetas móviles, panel de bajas de la ficha, selectores del ticket, filtros de accesos, formulario de adjuntos) están verificados por typecheck, lint y pruebas de servicio/acción, **no** por interacción real.

## Pendiente

Todo lo que sigue quedó **fuera del alcance** del plan de cierre (no fue parte de las 4 capacidades funcionales ni de los 2 focos de rendimiento que el usuario aprobó) y sigue documentado para un seguimiento futuro.

### Funcionalidad ausente (no defecto)

- **Gráficos de tickets en el tablero.** `getTicketsByCategory` y `getTicketsByMonth` siguen sin consumidor (y `getTicketsByMonth` promete «últimos 12 meses» sin filtro de fecha: hay que agregarlo antes de cablearla). También sin consumidor: `getActiveAssignmentForAsset`, `listSuppliersWithLinks`.
- **Mantención desconectada del estado del activo.** Registrar una reparación no mueve el activo a `en_reparacion` (ese estado hoy solo lo alcanza una salida `repair_exit`, sección 3). Además la alerta de reparación demorada usa `itAssets.updatedAt` como proxy del tiempo en taller, así que cualquier edición del activo reinicia el contador.
- **Notificar al solicitante en `esperando_usuario`** (el estado donde debe actuar) — candidato natural de seguimiento a las notificaciones de tickets del bloque 5, no pedido en este plan.

### Rendimiento

- **`listWorkersWithAccess` sin paginación** en `/ti/accesos`: carga todos los trabajadores activos y filtra la búsqueda en JavaScript. Degrada linealmente con la plantilla (el N+1 de tareas por checklist de esa misma página sí se resolvió en el bloque 2).
- **`runTiAlerts` hace alertas × destinatarios inserciones secuenciales**, y cada `createNotification` consulta el usuario y envía correo. Considerar inserción por lotes.
- **La página de reportes envía la lista completa de activos a las 9 tarjetas**, aunque solo `historial_activo` la usa.

### Deuda detectada en la revisión del changeset (decidido no corregir ahora)

- **Las 3 funciones batch del bloque 2 no tienen test propio.** Su equivalencia con las versiones singulares se verificó campo por campo (proyección, joins, filtros, `ORDER BY`), pero un error de agrupación en el `Map` se vería como "asignación sin fotos", en silencio.
- **`changeAssetStatus` conserva una rama para `en_prestamo`** que el enum de Zod vuelve inalcanzable desde su único llamador. Queda como defensa si aparece otro llamador; el plan pedía rechazarlo directamente.
- **El KPI "asignados" del tablero no cuenta préstamos** (`status = 'asignado'` a secas), así que discrepa de "En custodia", que cuenta actas abiertas. Es consecuencia buscada del bloque 3; si molesta, la salida es un tile propio de "En préstamo", no cambiar el conteo.
- **El contador de la pestaña "Mantenciones" de la ficha incluye las anuladas.** Es coherente con las filas que la lista sí muestra (y el KPI de adentro ya informa solo las vigentes), pero discrepa a primera vista.
- **Una mantención de un activo eliminado lógicamente no se puede anular** (`voidMaintenance` exige activo vigente) y sigue sumando en el panel de proveedores, que nunca filtró `deletedAt`. Preexistente.
- **`notifyManyUser` no filtra usuarios inactivos** cuando el destinatario viene nominado (no por permiso): resolver el ticket de alguien ya desvinculado le manda correo. Defecto del servicio de notificaciones, no de TI, pero este es el primer flujo TI que notifica a un usuario nominado.
- **`renderTemplate` pasa el asunto del correo por `escapeHtml`**, así que un título con `&` o comillas llega como `&amp;`/`&quot;`. Afecta a todo el repo por igual; TI es el primero que mete texto libre del usuario en el título.
- **Los adjuntos no tienen cuota, rate limit ni borrado.** Un usuario con el permiso puede subir archivos de 25 MB sin tope y no hay forma de recuperar el espacio desde la aplicación. Mismo perfil que `api/ti/photos`.
- **`lib/__tests__/server-action-error-boundaries.test.ts` no cubre `app/api/**/route.ts`**, así que nada impide que una ruta nueva reintroduzca el `error.message` crudo que el bloque 4 barrió. Extenderlo exige una lista de las 5 excepciones intencionales.
- **El asignado de un ticket se valida por existencia y actividad, no por tener `ti:manage_tickets`.** Requiere ya tener el permiso para explotarlo y la UI solo ofrece candidatos válidos.
- **Desfase de un día entre el tramo "5+ años" del gráfico (`> 1825 días`) y el filtro `antiguedad_min=5`** (`5 * interval '1 year'`) cuando la ventana contiene dos bisiestos.
- **TI-23 (componente temporal del `dedupeKey`) quedó sin regresión**: el test solo afirma que las claves de alertas distintas difieren, lo que ya se cumplía antes.

### Consistencia de plataforma (deuda documentada, no corregida)

- **Búsquedas ILIKE sin escapar en 13 archivos fuera de TI.** El helper `escapeLikePattern()` (bloque 1) quedó disponible en `lib/utils.ts`, pero solo se aplicó a los 4 call sites de TI — adoptarlo en el resto es una limpieza aparte, no un bug nuevo.
- **`FilterSelect` y `OptionSelect` casi idénticos.** `FilterSelect` ya vive en `components/ui/` (bloque 1), pero fusionarlo con `OptionSelect` exige reescribir 27 usos — sigue fuera de alcance.

### Brechas de verificación que siguen abiertas

- **No hubo verificación autenticada en navegador** para ningún bloque de este plan ni de la fase 1. `npm run audit` / `audit:full` siguen sin existir en `package.json`.
- **Los tests de integración TI no corren en el pipeline por defecto.** Los 8 archivos `ti-*-pglite.test.ts` están en el `exclude` de `vitest.config.ts` y solo corren con `npm run test:pglite`. Confirmar que CI invoque ese script.
- **Sin cobertura E2E** de los flujos nuevos: `e2e/ti-modulo.spec.ts` sigue siendo un smoke de dashboard, activo, ticket y exportación — no cubre adjuntos, notificaciones, anulación ni reversión.
- **La migración nueva de este plan (bloques 7+8) no se ha aplicado a producción**, solo verificada contra PGlite y la base de desarrollo local. Ejecutar `db:migrate` (nunca `db:push`).
