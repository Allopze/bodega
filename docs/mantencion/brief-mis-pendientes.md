# Brief: Mantención en «Mis pendientes» y avisos del menú

Estado: **esperando las decisiones del §7.2** (2026-11-26). Es la fase 3 de `/impeccable shape` (sin código). La entrevista ya ocurrió: la decisión del 26-11 es «por responsable» (`qa/reports/mantencion-encontrabilidad-2026-11-26.md` §4.1 y §9.4). Lo que no pude verificar en el código va marcado «Supuesto».

## Resumen

- Mantención entra a la cola como un módulo más (`mantencion`): 7 tipos de fila, en 6 ramas con permiso propio, dentro del mismo `UNION ALL`. No hay pantalla ni componente nuevo.
- La decisión «por responsable» choca con los permisos de hoy en tres puntos: los registros (el supervisor no puede marcarlos revisados), las notas de pedido (las resuelven tres roles) y «Por recibir» (no estaba en la decisión). Recomiendo una regla de «quién está más cerca de la faena», con dirección declarada por tipo (§3.3).
- Los avisos del menú salen del mismo cálculo que la cola, no de uno paralelo. Van en Órdenes de trabajo, Registros firmados y Notas de pedido.
- Los pendientes de Mantención no tienen vencimiento natural, salvo la entrega estimada de las OT en taller. Ordenan por antigüedad.
- Hay que decidir 7 cosas antes de construir (§7.2). Dos tocan permisos reales en producción.

---

## 1. Trabajo y audiencia

**Trabajo.** Que quien tiene trabajo de Mantención lo vea al abrir la plataforma, sin entrar al Panel: en «Mis pendientes» (lista con enlace a la ficha) y como número en el menú.

**Hoy.**
- `lib/services/operational-work-queue.ts` junta solicitudes, OC, facturas, CAPA, inspecciones, MIPER, PDTP, PPA, CPHS y documentos SST. Nada de Mantención.
- Con 4 OT por asignar, 93 registros por revisar y 2 notas por resolver, el jefe ve «Mis pendientes 4»: cuatro recepciones de compras.
- El administrador de contrato no ve las OT que esperan su conformidad.
- Supervisor y mecánico ni siquiera tienen «Mis pendientes» en el menú: `modules/operations/manifest.ts:25-48` no les da `operations:view_work`.

**Quién llega.**

| Rol | Alcance | Situación | Debe ver |
|---|---|---|---|
| Jefe de mantención (`jefe_mantencion`) | Global: `lib/auth/system-rbac.ts:34`, `lib/auth/scope.ts:9-18` | Escritorio, al empezar el día. Viene a repartir. | OT por asignar; notas de pedido por resolver; lo que no tiene dueño más cerca |
| Supervisor de faena (`supervisor_mantencion`) | Sus faenas (`worksite_users`) | Escritorio, en la faena | Registros por revisar de su faena |
| Administrador de contrato (`admin_contrato`) | Sus faenas | Escritorio, en la faena | OT por conformidad; OT por recibir |
| Mecánico (`mecanico`) | Sus faenas, pero ejecuta OT de cualquier faena (`work-orders/access.ts:30-33`) | PC del taller, además de la app | Sus OT asignadas |
| Jefatura (`jefa_chome`) | Global, sólo lectura | — | Nada: no tiene ningún permiso de acción |
| Administrador (`administrador`) | Global, todos los permisos | Cuenta técnica | Sólo lo huérfano (§3.3) |

Modo de visita: tarea repetida y de revisión rápida («¿qué me toca?»), no exploración.

## 2. Resultado y prueba

**Éxito.**
- El jefe abre «Mis pendientes» y ve sus OT por asignar y sus notas de pedido, con faena, equipo y antigüedad, sin entrar al Panel.
- El administrador de contrato ve «Dar conformidad por KA-135» y llega a la ficha en un clic.
- El supervisor ve una sola fila por faena con el conteo de sus registros.
- El mecánico ve sus OT asignadas.
- Cada número del menú coincide con lo que la cola le muestra a esa persona.
- Ninguna fila promete algo que el servidor rechazaría.

**Prueba.**
- Propiedad: toda fila de Mantención que la cola entrega a una sesión es una acción que el servicio acepta (`canActOnWorkOrder`, `canManageNote`, `canActOnRecord` más el permiso). Es la regla PEND-001 de `lib/services/work-queue-eligibility.ts` aplicada a Mantención.
- Paridad: el total de «Mis pendientes» es la suma de las filas de la lista. El aviso de cada ítem sale del mismo predicado que sus filas.
- Navegador: con datos sembrados (memoria `auditar-con-datos`), cada rol del §1 ve lo suyo. Cuatro sesiones: `jefe.mant@`, `supervisor@`, `admin.contrato@`, `mecanico1@` (`e2e/fixtures/mantencion-setup.ts:34-40`).

**Verdad de Chome.** Faena y responsable siempre visibles (PRODUCT.md, principio 4). La fila dice dónde está el equipo, qué etapa es y, cuando llega por escalamiento, por qué le llegó a esa persona.

---

## 3. Dirección

### 3.1 Tesis

- **Estructura.** Una fuente nueva por tipo de pendiente, en `operationalSourceBranches` (`operational-work-queue.ts:620`). Cada una se abre sólo si la sesión tiene el permiso de la acción (patrón de `work-queue-eligibility.ts`). La proyección conserva su forma: `source_type`, `action_key`, prioridad, `source_due_at`, `href`.
- **Dos piezas nuevas, pequeñas.**
  1. Una función pura que resuelve «de quién es esta faena» (§3.3). Tiene una lectura previa a la base: los titulares de 4 permisos.
  2. Un solo cálculo, `getOperationalWorkCounts`, que devuelve el total de la cola y el desglose por fuente. Alimenta «Mis pendientes» y los tres avisos del menú. Reemplaza al `COUNT(*)` de `getOperationalWorkCount` (`:1825`); éste queda como envoltorio para sus pruebas.
- **Autoridad visual.** La existente: `work-queue-workbench.tsx` sin cambios de estructura. Mantención es una fila más, con la etiqueta de módulo «Mantención».
- **Consecuencia.** Sin migración y sin índices nuevos (se verifica con `EXPLAIN` en `bodega_dev`). Sí hay cambios de permisos por defecto (§3.3, §7.1).

### 3.2 Los pendientes

Una OT genera como máximo una fila por persona, porque cada estado tiene una sola acción. Etiquetas de estado: espejo de `OT_STATUS_LABELS` (`lib/mantencion/work-order-states.ts:38`), con una prueba de paridad como la de CAPA.

| # | Tipo | Etapa y detección | A quién le toca | `source_type` / `action_key` | Prioridad · vencimiento · antigüedad | Texto y destino | Deja de estar pendiente |
|---|---|---|---|---|---|---|---|
| 1 | **OT por asignar** | `mant_work_orders.status = 'solicitada'`. El CHECK `mant_work_orders_assignment_valid` garantiza `assigned_to_user_id IS NULL`. Misma regla que `countUnassignedWorkOrders` (`work-orders/query.ts:251`). | `mant:ot:manage` (sólo `jefe_mantencion`). Faena = imputación (`mant_work_orders.worksite_id`) o equipo hoy en ella. Dirección `local_first`. | `mant_work_order` / `assign` | `normal`. Sin vencimiento. Antigüedad: `created_at`. | «Asignar mecánico a KA-135». Código `OT-BIO-0007`. Subtítulo «Reparación», «Mantención» o «Reparación y mantención» (`repair`, `maintenance`). Estado «Por asignar». CTA «Asignar mecánico». `/mantencion/ot/{id}` | La OT sale de `solicitada` (se asigna o se anula) |
| 2 | **OT por recibir** (nueva, no estaba en la decisión) | `status = 'trabajo_terminado'`, con `JOIN fuel_vehicles` para la faena de HOY del equipo. | `mant:ot:receive` (`admin_contrato` y `jefe_mantencion`). Faena = la ACTUAL del equipo, como `WORKSITE_SCOPED` (`work-orders/access.ts:136`). `local_first`. | `mant_work_order` / `receive` | `normal`. Sin vencimiento. Antigüedad: `finished_at`. | «Recibir KA-135 del taller». Estado «Por recibir». CTA «Registrar recepción». Ficha de la OT | `recepcionada`, o rechazo (vuelve a `en_ejecucion`) |
| 3 | **OT por conformidad** | `status = 'recepcionada'`, faena actual del equipo. | `mant:ot:conform` (sólo `admin_contrato`). Faena actual. `local_first`: si la faena no tiene administrador de contrato, sólo `administrador` la ve (nadie más tiene el permiso). | `mant_work_order` / `conform` | `normal`. Sin vencimiento. Antigüedad: `received_recorded_at`. | «Dar conformidad por KA-135». Estado «Por conformidad». CTA «Dar conformidad». Ficha de la OT | `cerrada`, o rechazo a `en_ejecucion` |
| 4 | **Mi OT, por ingresar** | `status = 'asignada' AND assigned_to_user_id = :yo` | `mant:ot:execute` y ser el asignado. SIN filtro de faena (el mecánico puede tener una OT de otra faena). | `mant_work_order` / `start` | `normal`. Sin vencimiento. Antigüedad: `assigned_at`. | «Ingresar KA-135 a taller». Estado «Asignada». CTA «Ingresar a taller». Ficha de la OT | `en_ejecucion`, o reasignación o anulación |
| 5 | **Mi OT, en taller** | `status = 'en_ejecucion' AND assigned_to_user_id = :yo` | Igual que la 4. | `mant_work_order` / `work` | Vencimiento: `estimated_delivery_date` (ya es obligatoria desde `en_ejecucion`, CHECK `mant_work_orders_entry_valid`; es la misma noción que `estimateOverdue` en `work-orders/metrics.ts`). `high` si `rejection_count > 0`, con estado «Devuelta a taller». `blocked` si `partsPendingExistsSql` (`work-orders/parts-requests.ts:57`: «Esperando repuestos»). Antigüedad: `started_at`. | «Trabajar en KA-135». CTA «Registrar trabajo». Ficha de la OT | `trabajo_terminado` |
| 6 | **Nota de pedido por resolver** | `mant_parts_notes.status <> 'anulada'` y existe una línea con `resolution = 'pendiente'` (equivale a `enviada` + `en_gestion`; ver decisión 3 del §7.2). | `mant:np:manage` (jefe, supervisor, administrador de contrato). Faena de la nota o equipo hoy en ella (`parts-notes/access.ts:45`). Dirección `global_first`. | `mant_parts_note` / `resolve` | `high` si `equipment_stopped`, `normal` si no. Sin vencimiento. Antigüedad: `created_at`. | «Resolver repuestos de KA-135». Código `NP-2026-0004`. Subtítulo «OT OT-BIO-0007 · 2 por resolver · equipo detenido». Estado «Pendiente» o «En gestión» (los rótulos de las pestañas de la bandeja). CTA «Resolver nota». `/mantencion/notas-pedido/{id}` | Ninguna línea queda `pendiente` (la nota pasa a `cerrada`) o se anula |
| 7 | **Registros por revisar** | `mant_records.status = 'vigente' AND review = 'pendiente'`, `GROUP BY worksite_id`. Excluye los que firmó o ejecutó quien mira. UNA fila por faena (decisión 5 del §7.2). | `mant:records:review`. Faena DEL REGISTRO (`recordWorksiteVisibilitySql` de `mantencion/access.ts:92`, sin su parte «lo propio»). `local_first`. | `mant_records` / `review`. `source_id` = id de la faena. | `normal`. Sin vencimiento. Antigüedad: `MIN(received_at)`. | «Revisar 31 registros de mantención». Estado «Por revisar». CTA «Revisar registros». `/mantencion/registros?revision=pendiente&estado=vigente&faena={id}` (la lista trae la revisión en lote, `markRecordsReviewed`) | La faena llega a 0 pendientes: revisado y observado salen de `pendiente` |

Notas:
- Los textos usan el código del equipo de `equipment_snapshot->>'code'`. La búsqueda de la cola (`CONCAT_WS(... code, title ...)`, `:1594`) encuentra la fila por equipo o por folio.
- Cuando una fila llega por escalamiento, el subtítulo lo dice: «Sin supervisor en la faena», «Sin administrador de contrato en la faena» o «Nadie más puede resolverlo en esta faena». Así el jefe entiende por qué ve registros de Cholguán.
- Fuera de alcance, pero cercanos: la pestaña «Por conciliar» de Notas de pedido (también `mant:np:manage`) y los registros observados que el mecánico debe responder.

### 3.3 «Por responsable» contra los permisos de hoy

**Lo que dice el código.**

| Permiso | Quién lo tiene (`modules/mantencion-equipos/manifest.ts`) | Tipos |
|---|---|---|
| `mant:ot:manage` | `jefe_mantencion` (`:181`) | 1 |
| `mant:ot:receive` | `admin_contrato` (`:168`), `jefe_mantencion` (`:183`) | 2 |
| `mant:ot:conform` | `admin_contrato` (`:169`) | 3 |
| `mant:ot:execute` | `mecanico`, `supervisor_mantencion`, `jefe_mantencion` | 4 y 5, sólo si es el asignado |
| `mant:np:manage` | `supervisor_mantencion`, `jefe_mantencion`, `admin_contrato` (`:202-204`; D3 del ADR 0001) | 6 |
| `mant:records:review` | SÓLO `jefe_mantencion` (`:153`; `ESPECIFICACION.md` §6) | 7 |
| `mant:records:observe` | `supervisor_mantencion` (`:145`), `jefe_mantencion` | — |

**Los choques.**
1. **Registros.** La decisión dice supervisor, pero el supervisor sólo puede observar. Observar saca el registro de «pendiente» y lo deja «observado»; cerrarlo como «revisado» es de la jefatura (`record-lifecycle.ts:175` y `:207`). Si la cola le diera la fila sin el permiso, un registro correcto no tendría salida y su cola nunca llegaría a cero. Es exactamente lo que PEND-001 prohíbe.
2. **Notas de pedido.** La decisión dice jefe, pero tres roles tienen `np:manage`. Con sólo «el permiso», la misma nota aparecería en tres colas.
3. **OT por recibir.** Dos roles con permiso y ninguna decisión. Dejarla fuera abre un hueco: entre «el mecánico terminó» y «el administrador de contrato da la conformidad», nadie recibe un aviso en la cola.
4. **Administrador.** Tiene todos los permisos; sin regla vería todo en todas las faenas. Los avisos ya lo resolvieron con `holdersBeyondAdmin` (`parts-notes/notifications.ts:21`, `work-orders/notifications.ts:86`): el administrador sólo recibe si no queda nadie más.

**Opciones.**

- **A. Sólo el permiso, con alcance de faena.** Cada persona ve lo que su permiso le deja resolver.
  - A favor: no cambia permisos y sigue la regla PEND-001 al pie de la letra.
  - En contra:
    - El supervisor no ve registros (contradice la decisión).
    - El jefe ve los 93.
    - La misma nota llega a tres personas.
    - El administrador ve todo.

- **B. Permiso + «el más cercano a la faena», con dirección por tipo (recomendada).** Se ve la fila si se puede resolver Y se es el dueño. El dueño de cada faena se resuelve así:
  - `local_first`: dueños son los titulares activos del permiso con alcance de esa faena. Si no hay ninguno, suben a los titulares globales. Sólo si tampoco hay, al `administrador`. Es la regla de `managersOf`, con «el local primero».
  - `global_first`: lo mismo al revés. Los titulares globales primero. Los locales sólo si no hay ningún global.

  | Tipo | Dirección | Por qué |
  |---|---|---|
  | OT por asignar | `local_first` | Sólo la tiene el jefe, que es global. |
  | OT por recibir | `local_first` | Quien retira el equipo está en la faena. |
  | OT por conformidad | `local_first` | Sólo el administrador de contrato. |
  | Registros | `local_first` | El supervisor de la faena; el jefe donde no hay. |
  | Notas de pedido | `global_first` | Es la decisión («jefe»): stock y compra se resuelven en central. Supervisor y administrador de contrato las siguen viendo en su bandeja, no en la cola. |

  Pseudocódigo, puro y probable sin base de datos:
  ```
  holders(P) = usuarios activos con P; cada uno con { esAdmin, global, faenas[] }
  responsables = holders sin rol «administrador» (o con P por otro rol o permiso directo)
  locales = responsables no globales ; globales = responsables globales

  dueñoDe(viewer, P, dirección):
    viewer sólo-administrador → globales.length ? ninguna : faenas ∉ unión(faenas de locales)
    viewer global, local_first  → faenas ∉ unión(faenas de locales)
    viewer global, global_first → todas
    viewer local, local_first   → sus faenas
    viewer local, global_first  → globales.length ? ninguna : sus faenas
  ```
  - Costo: un cambio de permiso por defecto, `mant:records:review` al supervisor (§7.1), y la regla de no revisar lo propio.
  - Resultado esperado: el jefe conserva sus 4 OT y 2 notas, y ve registros sólo de las faenas sin supervisor, con la etiqueta «Sin supervisor en la faena». La especificación (§1) nombra a Francisco Amestica como supervisor de Biodiversa; no verifiqué cuántos supervisores hay en producción ni cómo se reparten los 93 registros. Eso se mide en `bodega_dev`, o con lectura de producción autorizada.

- **C. Ajustar los permisos hasta que cada tipo tenga un solo dueño y seguir el permiso estricto.** Dar `review` al supervisor y quitárselo al jefe; quitar `np:manage` al supervisor y al administrador de contrato; quitar `receive` al jefe.
  - A favor: la regla es la más simple de explicar.
  - En contra: cambia la autoridad real, reabre D3 del ADR, y deja al jefe sin poder de reemplazo cuando falta alguien. Prioridad 1–2 de AGENTS.md (integridad y autorización) sobre una mejora de visibilidad. No la recomiendo.

**Por qué B.** Respeta PEND-001 (se ve sólo lo resoluble), reproduce la decisión («jefe: OT y notas; supervisor: registros; administrador de contrato: conformidad; mecánico: lo suyo») sin nombrar roles en el código, deja un camino cuando falta el dueño (escalamiento al jefe, y al administrador si nadie más) y reutiliza el criterio de los avisos. El código habla de permisos, no de nombres de rol, así que un rol personalizado de `/admin/roles` funciona igual.

---

## 4. Alcance y límites

**Dentro.**
- Los 7 tipos de §3.2, en `/pendientes` y, sin trabajo extra, en el bloque «Hoy» del Inicio (consume la misma cola: `app/(app)/dashboard/dashboard-today.ts`).
- Avisos numéricos en los tres ítems del menú.
- Módulo `mantencion` en los filtros y en el reparto por módulo del Inicio.
- Cambios mínimos de permisos por defecto (§7.1).
- `revalidateOperationalViews` en las acciones de Mantención.

**Fuera.**
- Pantalla nueva o rediseño de `/pendientes`.
- Plazos o SLA (por ejemplo «conformidad en 3 días»): no existen en el modelo y no se inventan.
- Pestaña «Por conciliar», registros observados del mecánico, y cualquier cambio del Panel.
- Corregir el destino por defecto de «Órdenes de trabajo» para el administrador de contrato (hoy abre en «En taller»); es del paquete `/impeccable layout` del mismo reporte.
- La app del mecánico (`/m/mantencion`).

**Fidelidad.** Producción: todas las fuentes, con pruebas y verificación en navegador.

**Antimetas.**
- Copiar el Panel a la cola.
- Un componente de fila propio.
- Hardcodear nombres de rol en SQL.
- Mantener un recuento paralelo al de la cola (la causa de A-03, A-06 y `select_quotation`, documentada en `:1811-1824`).

---

## 5. Estados y rangos

**Rangos (reporte 2026-11-26, jefe).**
- 4 OT por asignar, 2 notas por resolver y 93 registros por revisar.
- Por rol, esperable (Supuesto, sin medir): jefe 5 a 15 filas; supervisor 1 fila (una faena); administrador de contrato 0 a 5; mecánico 0 a 3.
- Máximo de filas de registros para un jefe: una por faena activa (8 al 2026-11-25, según la memoria del proyecto). Con una fila por registro serían 93 y taparían todo lo demás.

**Estados.**
- *Vacío:* sin filas de Mantención no se ve nada especial. Si la persona no tiene ninguna fila, rige el `EmptyState` actual.
- *Cargando:* `loading.tsx` existente.
- *Error de una fuente:* `probeOperationalSourceBranches` aísla la falla por módulo y muestra el `Callout`. Hoy el texto usa el id del módulo («tareas de mantencion», sin acento y sin etiqueta). Conviene pasar la etiqueta `OPERATIONAL_MODULE_LABELS`.
- *Sin permiso:* una sesión sin `operations:view_work` va a `/forbidden`. Sin los permisos de acción, no recibe ninguna fila.
- *Sin faenas asignadas:* hoy `resolveWorksiteScope = none` corta la cola entera (`:1773`) y el conteo (`:1827`). Un mecánico sin faena pero con una OT asignada no vería nada. Se relaja el corte cuando la sesión tiene `mant:ot:execute` (§7.3).
- *Desborde:* los avisos topan en «99+» (`components/layout/nav-rows.tsx:11`). La lista pagina de a 50 por cursor.
- *Equipo trasladado:* la OT sigue al equipo. La faena que se muestra y la que da el alcance son las del §3.2. Con la OT imputada en una faena y el equipo en otra, los tipos 2 y 3 siguen a la faena actual.

---

## 6. Interacción y diseño

**Filas.** Sin cambios en `work-queue-workbench.tsx` (tabla desde `md`, tarjetas debajo). Lo nuevo:
- La etiqueta «Mantención» (`lib/work-queue.types.ts:29`, `lib/work-queue-labels.ts:8`).
- Agregar `mantencion` a `allowedModules` (`operational-work-queue.ts:1865`). Si no, `?module=mantencion` cae en «todos» y el gráfico por módulo del Inicio (`moduleWorkloadHref`, `dashboard/sections/shared.ts:71`) enlaza a un filtro que se ignora.
- Casi todas las filas no tienen fecha: el orden por defecto («vencimiento») las deja detrás de lo que sí tiene. Entre ellas ordena `created_at` ascendente: lo más antiguo primero. «En cola N días» ya se muestra.
- Las OT del mecánico en taller llevan fecha. El atraso se pinta con la escala existente.

**Avisos del menú.** El badge existente, `bg-signal-tint`, sin color nuevo.

| Ítem | Qué cuenta | Fuente |
|---|---|---|
| `/mantencion/ot` | Filas de OT de la persona: por asignar, por recibir, por conformidad, y sus OT asignadas o en taller | Fuentes 1 a 5 |
| `/mantencion/registros` | Cantidad de REGISTROS (no de filas): coincide con la pestaña «Por revisar» de esa pantalla | Fuente 7, desde el predicado por registro |
| `/mantencion/notas-pedido` | Notas por resolver | Fuente 6 |
| `/pendientes` (ya existe) | Total de filas de la cola | Todas |

- No llevan aviso el Panel, Equipos ni Configuración.
- El aviso aparece sólo si es mayor que 0 (comportamiento de `CountBadge`).
- El total de «Mis pendientes» cuenta filas (acciones); el de Registros cuenta registros. Por eso el predicado de la fuente 7 se escribe una vez (por registro) y la fila agregada es un `GROUP BY` sobre él.

**Costo en cada carga del shell.**
- Hoy `app/(app)/layout.tsx:117-126` hace un `COUNT(*)` sobre toda la unión, en `unstable_cache` de 30 s por usuario, con etiquetas por faena.
- Con este cambio se cambia ese `COUNT(*)` por un `GROUP BY source_type`. Lo devuelto es un objeto `{ total, ot, registros, notas }`, y la clave de caché cambia (por ejemplo `operational-work-count-v2`) para no leer una forma vieja. Cero consultas extra en el layout.
- Cada carga con caché fría suma: una consulta de titulares (4 permisos, decenas de filas) más las ramas de Mantención que esa sesión tiene. Jefe: 5 ramas (asignar, recibir, notas, registros, sus OT); supervisor: 2 (registros, sus OT); administrador de contrato: 2 (recibir, conformidad); mecánico: 1; cualquier otro: ninguna. La rama no se agrega sin su permiso, ni cuando la regla de dueño la deja en «ninguna faena» (por ejemplo, notas para el administrador de contrato). El rol `administrador` suma todas, pero sólo emite lo huérfano.
- Los índices existentes cubren los predicados: `mant_work_orders_status_idx`, `mant_work_orders_assigned_status_idx`, `mant_records_review_idx`, `mant_parts_notes_worksite_status_idx`.
- Criterio de aceptación: `EXPLAIN ANALYZE` y tiempo de `getOperationalWorkCounts` para jefe y administrador en `bodega_dev` (clon de prod más datos de prueba), antes y después. Si pasa de ~30 ms, revisar. No tengo una medición propia.
- Frescura: se acepta el TTL de 30 s (contrato P-01). Hoy ninguna acción de Mantención llama `revalidateOperationalViews` (`lib/services/operational-cache.ts`; sólo hacen `revalidatePath`, p. ej. `mantencion/ot/actions.ts:50`, `notas-pedido/actions.ts:47-50`, `registros/[id]/actions.ts:30-33`), así que asignar una OT dejaría el número viejo hasta 30 s. Hay que llamarla con la faena en las acciones de OT, de notas y de revisión de registros. Los cambios que entran por la sincronización del teléfono (`app/api/mantencion/*`) esperan al TTL, o invalidan sólo la etiqueta de la faena (`badgeCountsWorksiteTag`).

**Accesibilidad y responsivo.**
- Nada nuevo en la fila: foco, teclado y tarjetas móviles vienen del workbench.
- El badge lee «Órdenes de trabajo 4» sin decir qué es. Es un defecto que ya tienen los demás avisos; arreglarlo (texto `sr-only`) cambia el nombre accesible de todos y no es de este paquete.
- Los avisos nuevos cambian el nombre accesible de los enlaces («Órdenes de trabajo 4»). Al menos dos specs E2E los buscan por el nombre exacto y hay que ajustarlos (§7.4).

**Inicio.** La franja «Hoy» del Inicio toma las 5 filas más urgentes de la misma cola: el jefe verá OT de Mantención sin trabajo adicional. Es el efecto buscado, pero hay que revisar el orden «vencidas, críticas, fecha» con filas sin fecha (`pickTodayItems`).

---

## 7. Restricciones y decisiones abiertas

### 7.1 Paridad de autorización y navegación (AGENTS.md)

- **Ruta.** `/pendientes` exige `operations:view_work` (`pendientes/page.tsx:13`). El destino de cada fila conserva su guardia: `/mantencion/ot`, `/mantencion/notas-pedido`, `/mantencion/registros`.
- **Servidor.** Cada fuente nace con el permiso de su ACCIÓN, no con el de vista. Se agregan 6 fuentes a `WORK_QUEUE_ACTION_PERMISSIONS` (`work-queue-eligibility.ts`): `mant_ot_assign` (`mant:ot:manage`), `mant_ot_receive`, `mant_ot_conform`, `mant_ot_execute`, `mant_np` (`mant:np:manage`) y `mant_review` (`mant:records:review`). La prueba `work-queue-eligibility.test.ts` pide su permiso de sólo lectura por fuente (`SOLO_LECTURA`), que es de tipo `Record<WorkQueueSource, string>` y falla a propósito si falta alguno.
- **Menú.** `badge: "count"` en tres ítems de `modules/mantencion-equipos/manifest.ts` (`:82`, `:91`, `:98`). `lib/__tests__/sidebar-badge-parity.test.ts` lleva la lista de claves y hay que sumar las tres.
- **Permisos por defecto** (sólo si se aprueba, §7.2):
  - `mant:records:review` a `supervisor_mantencion`;
  - `operations:view_work` a `supervisor_mantencion` y `mecanico` (`modules/operations/manifest.ts`).

  Ambos permisos ya existen en producción (`p-mant-records-review`, `p-ops-view-work`): cambiar el manifiesto no basta. Cada uno va ADEMÁS en `GRANT_ADDITIONS` (`lib/auth/bootstrap.ts:52`) con clave nueva y fecha. La prueba `lib/__tests__/bootstrap.test.ts` exige que cada alta replique un default declarado. Se aplican con `ensureSystemRbac` (deploy / `db:sync-rbac`).
- **`modules/registry.ts` y `modules/permissions.ts`.** No cambian: no hay módulo ni permiso nuevo.
- **Paridad de la bandeja.** `lib/__tests__/operations-manifest-parity.test.ts` se extiende: ningún rol que reciba filas de Mantención puede quedar sin acceso a `/pendientes`.
- **Seed/E2E.** `e2e/setup-db.ts` y `e2e/fixtures/mantencion-setup.ts` siembran los roles desde los manifiestos; verificar que el mecánico y el supervisor E2E reciben `operations:view_work`.
- **Módulo apagado.** Si `mantencion_equipos` está apagado por interruptor, las filas llevarían a `/modulo-inactivo`. La cola no mira interruptores para ningún módulo; seguir igual (riesgo conocido).
- **Reutilizar.** `canActOnQueueSource`, el workbench, `workOrderVisibilitySql` (`work-orders/access.ts:68`) y `noteVisibilitySql` (`parts-notes/access.ts:40`) como referencia de alcance, `partsPendingExistsSql`, `viewerFromSession`, `userHasPermissionSql` (`mantencion/sync-app-users.ts:23`). La constante `ADMIN_ROLE = "administrador"` está duplicada en los dos `notifications.ts`; la ordenación nueva la comparte en vez de sumar una tercera copia.
- **Sin datos nuevos.** Todas las columnas existen: `db/schema/mantencion-work-orders.ts` (`status` `:48`, `assigned_to_user_id` `:52`, `estimated_delivery_date` `:68`, `finished_at` `:75`, `received_recorded_at` `:81`), `db/schema/mantencion-parts.ts` (`status` `:43`, `equipment_stopped` `:40`, `resolution` `:72`), `db/schema/mantencion-records.ts` (`review` `:58`, `status` `:57`, `received_at` `:52`).

### 7.2 Decisiones abiertas (el constructor no las inventa)

1. **Quién ve qué** (§3.3). A: sólo el permiso. B: permiso + el más cercano a la faena, con dirección por tipo (recomendada). C: ajustar permisos hasta un dueño por tipo.
2. **¿La supervisión puede marcar «revisado»?** Es lo que hace que B funcione para registros.
   - (a) Sí: `mant:records:review` por defecto al supervisor, en su faena, y se agrega la regla «no revisas lo que tú firmaste o ejecutaste» en `markRecordReviewed` y `markRecordsReviewed`. Hoy no existe ni para el jefe. Recomendada.
   - (b) No: el supervisor sigue sólo observando y la fila de registros es del jefe.
3. **Notas de pedido.** (i) Dirección: el jefe primero y el resto sólo si falta (recomendada), o todos los titulares. (ii) «Por resolver»: cualquier nota con una línea pendiente (recomendada; es lo que necesita atención), o sólo las `enviada` como hoy en el Panel (`parts-notes/query.ts:26`, `hoy-tab.tsx:130`). Si se elige lo primero, la cifra del Panel cambia o queda distinta a la de la cola.
4. **OT por recibir.** (a) Incluirla, con la faena primero y el jefe como respaldo (recomendada). (b) Dejarla fuera: sigue sólo visible en la lista de OT.
5. **Registros: ¿una fila por faena o una por registro?** Por faena (recomendada): el trabajo real es la revisión en lote; evita 93 filas casi idénticas; el aviso del menú igualmente cuenta registros. Por registro: más simple, pero tapa el resto de la cola.
6. **¿Mecánico y supervisor abren «Mis pendientes»?** Sí, `operations:view_work` por defecto (recomendada): hoy ni lo ven en el menú. No: el mecánico sigue con la lista de OT y la app, y su aviso del menú se calcula igual (el cargador corre para quien tenga permisos de Mantención).
7. **«Sus OT asignadas» del mecánico.** Las dos etapas (por ingresar y en taller), como en §3.2 (recomendada), o sólo las no ingresadas.

### 7.3 Riesgos

| Riesgo | Efecto | Mitigación |
|---|---|---|
| Se cambia un permiso real en producción (`mant:records:review`, `operations:view_work`) | La supervisión pasa a poder cerrar revisiones; un supervisor podría revisar lo propio | Decisión 2; regla de no revisar lo propio con prueba; `GRANT_ADDITIONS` con clave nueva |
| El ordenamiento depende de a quién se asigna a cada faena | Si el supervisor deja de estar activo, sus registros suben al jefe (es el comportamiento buscado) | Subtítulo que explica el escalamiento; prueba de «sin supervisor» |
| Cola y Panel muestran números distintos | El Panel dice 93 registros (todos); el jefe, 0 si cada faena tiene supervisor. La nota de pedido del Panel cuenta sólo `enviada` | Es esperable: el Panel es del alcance y la cola es de la persona. Se documenta en la prueba y se decide la cifra de notas (decisión 3) |
| `scope.mode = 'none'` corta la cola entera | Un mecánico sin faena asignada no ve su OT | Relajar el corte (`:1773`, `:1827`) si la sesión tiene `mant:ot:execute`. Revisa `operational-work-queue-*.test.ts` |
| El badge queda viejo hasta 30 s | Se asigna una OT y el número no baja | `revalidateOperationalViews(…, { worksiteId })` en las acciones; los cambios desde el teléfono esperan el TTL |
| Cambia la forma del dato en `unstable_cache` | Al desplegar, lectura de una forma vieja | Clave de caché nueva |
| La proyección es un `UNION ALL` de columnas fijas | Un tipo distinto en una rama tumba la unión entera | Pruebas PGlite; `probeOperationalSourceBranches` aísla la falla a Mantención |
| Otras suites afirman totales de la cola | Un fixture con muchos permisos podría recibir filas nuevas | Las tablas `mant_*` están vacías en esas suites, así que no suman filas. Verificar con el `test:pglite` completo. La suite nueva va aislada |
| Equipo trasladado con OT abierta | La faena mostrada y el alcance pueden diferir de la imputación | Seguir `WORKSITE_SCOPED` para recepción y conformidad; prueba de traslado |
| El Inicio cambia solo | El bloque «Hoy» y el gráfico por módulo suman Mantención | Revisar `e2e/dashboard*.spec.ts` y `densidad-kpi-filtros.spec.ts`; el módulo en `allowedModules` |
| Cuenta temporal vencida | Un titular expirado cuenta como responsable y deja huérfana la fila | Excluir `is_temporary AND valid_until < now()` al cargar titulares (como `findAssignableMechanics`) |
| Reglas de `E2E` | `test:e2e` borra el `.next` del dev, y la base y el puerto compartidos pisan corridas ajenas (memoria) | Worktree desechable, base y puerto propios |

### 7.4 Pruebas que hacen falta

**Unitarias (`npm run test:fast`).**
- `ownedWorksites` / `resolveOwners`: la tabla `local_first` / `global_first` × viewer (local, global, sólo administrador) × cobertura (sin locales, con locales, con globales). Sin base.
- `work-queue-eligibility.test.ts`: las 6 fuentes nuevas (sólo lectura no entra; el permiso de acción sí).
- `sidebar-badge-parity.test.ts`: las 3 claves nuevas.
- `operations-manifest-parity.test.ts`: roles de Mantención con trabajo pueden abrir la cola.
- `operational-work-queue-filters.test.ts`: `?module=mantencion` se conserva.
- `bootstrap.test.ts`: las altas nuevas replican un default y tienen clave propia.
- Paridad de etiquetas SQL de estado de OT contra `OT_STATUS_LABELS`.

**PGlite aislada, `lib/__tests__/operational-work-queue-mantencion-pglite.test.ts`.** Hay que registrarla en `tests/pglite-files.ts`. Usa los fixtures reales de `mantencion-sync-fixtures.ts` (jefe global, `supBio`, `adminBio`, `adminCho`, `mecBio`, `mecCho`, faenas Bio, Cho y Ara) y sesiones salidas de `getUserRbacById`, con un `administrador` agregado.
- Matriz rol × alcance, por cada tipo: cada rol ve sólo lo suyo (Bio con supervisor y administrador de contrato; Cho sin supervisor; Ara sin nadie).
- Escalamiento: sin supervisor, el jefe ve los registros de esa faena y con subtítulo; con supervisor, no. En Ara, el administrador ve la conformidad.
- Notas de pedido: llegan al jefe y no al supervisor ni al administrador de contrato (`global_first`).
- Mecánico: ve sus OT de cualquier faena y no las ajenas; las `solicitada` y las `cerrada` no entran.
- Equipo trasladado: la recepción y la conformidad van al administrador de contrato del destino.
- Registros: no se ofrecen los propios.
- Propiedad de «accionable»: para cada fila entregada, `canActOnWorkOrder` / `canManageNote` / `canActOnRecord` la aceptan.
- Paridad: el total de `getOperationalWorkCounts` es igual al `total` de `getOperationalWorkQueue`. Cada aviso es igual al conteo de sus filas (Registros, de sus registros). Con la sesión del mecánico sin faenas, igual.
- Orden y cursor con filas sin fecha mezcladas con otras fuentes.
- Falla de una rama de Mantención: el resto de la cola sigue (`probe…`).

**E2E, `e2e/pendientes-mantencion.spec.ts`** (con el patrón de espera de `control-operacional-navegacion.spec.ts:685`: `expect.poll` con recarga por el TTL de 30 s).
- Jefe: ve OT por asignar y notas en «Mis pendientes» con el filtro «Mantención»; los tres avisos coinciden con la lista; abre una fila, asigna, y el número baja. Tarjetas móviles a 390 px y axe en `/pendientes`.
- Administrador de contrato: una OT `recepcionada` aparece como «Dar conformidad»; al cerrarla desaparece.
- Supervisor: una fila de registros de su faena con enlace a la lista filtrada, que abre en «Por revisar».
- Mecánico: su OT asignada aparece; no ve las de otro.
- Persona sin permisos de Mantención: ningún aviso ni fila.
- Ajustes a pruebas existentes: `e2e/repuestos-catalogo.spec.ts:96` (link «Órdenes de trabajo» con `exact: true`) y la tabla de destinos de `e2e/control-operacional-navegacion.spec.ts` (usar `empiezaCon(...)` para los 3 ítems con aviso). Revisar también `e2e/dashboard.spec.ts` y `e2e/densidad-kpi-filtros.spec.ts`.

**Navegador asistido (AGENTS.md §3).** En un dev propio, con `bodega_dev` (clon de prod más datos de Mantención), los cuatro roles. Consola y red sin errores. Dejar el informe en `qa/reports/` con fecha. Puertas finales: `npm run typecheck`, `npm run lint`, `npm run test:fast`, `npm run test:pglite`.

### 7.5 Secuencia sugerida

1. Resolver las decisiones 1 a 7 con el usuario.
2. Función pura de dueños con su prueba, más la lectura de titulares.
3. Las 6 fuentes y `getOperationalWorkCounts`; `allowedModules`; etiqueta del módulo; relajar el corte de `scope = none`.
4. Permisos por defecto y `GRANT_ADDITIONS`, si la decisión 2 o la 6 los piden.
5. Badges en el manifiesto; `revalidateOperationalViews` en las acciones de Mantención; ajustar las dos pruebas E2E.
6. PGlite, E2E y navegador. `EXPLAIN` en `bodega_dev`.
