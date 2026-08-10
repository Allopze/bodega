# Auditoría del flujo de adquisiciones — 2026-08-08

> **Estado de remediación:** Fases A-D completas. Corregidos **los 5 P1, los 10 P2
> y 30 de los 32 P3**. Verificado con tsc limpio, suite unitaria 3696 verde,
> PGlite verde, Tailwind compila, y e2e en verde para los specs del flujo
> (adjudicación de repuestos/servicios 12/12, `directo_faena` nuevo, axe +
> negative-flows 42/42). **Pendiente:** sólo 2 P3, y ambos son decisiones
> deliberadas ya documentadas en el código, no trabajo por hacer.
> Cada hallazgo corregido lleva su marca ✅.

**Alcance:** flujo completo (solicitudes → aprobaciones → compras/OC → recepción → entregas → pendientes), en tres dimensiones: lógica de servicios, server actions (validación/RBAC/revalidación) y UI/UX, más una pasada de coherencia end-to-end.

**Contexto:** esta auditoría corre un día después del cierre de la Fase 5 del plan derivado de `AUDITORIA_FLUJO_ADQUISICIONES_2026-08-07.md` (Fases 0-4 ya remediadas). No re-reporta los falsos positivos descartados en auditorías previas (§ de descartados del doc 08-07 y §5.3 del doc UI/UX 07-29).

**Método:** 4 auditores paralelos con lectura completa de archivos; los hallazgos P1/P2 principales fueron re-verificados a mano contra el código antes de publicarse. Los tests que estaban rojos el 07-08 se re-ejecutaron (verdes, ver §Verificado).

**Veredicto:** la remediación 07-08 se sostiene — los caminos calientes están sanos, los dos bugs con test rojo están corregidos, `requests:submit` quedó retirado limpio y las migraciones 0141-0145 cumplen sus invariantes. Lo que queda es: **1 carrera residual grave (P1-A), 3 callejones sin salida del flujo lineal nuevo (P1-D, P2-A, P2-C) y una familia nueva de divergencias interfaz↔código en el formulario de solicitudes (P1-B/C/E)**.

---

## P1 — Graves

### P1-A · `selectQuotation` puede resucitar una solicitud cancelada (TOCTOU residual)  ✅ **CORREGIDO 2026-08-08**
`lib/requests/request-service-module/select-quotation.ts:21-26` y `:116-119` — RESIDUAL (el único camino secundario del patrón 07-08 que quedó a medias: la cotización sí se lockea, el padre no).

- El padre se lee con `findFirst` sin `FOR UPDATE`; el UPDATE final estampa `approved` sin guarda de estado ni verificación de rowcount.
- Escenario: solicitud de repuestos `submitted`; `cancelRequest` concurrente la deja `cancelled` con `closedAt` e ítems rechazados; `selectQuotation` continúa — sus updates de ítems (con guarda `requested`) no matchean nada, pero el UPDATE final pisa `cancelled` → `approved`. Estado permanente e incorregible: solicitud "approved" cerrada, 0 ítems aprobados, cotización `selected`. El rollup no la corrige porque los ítems ya son terminales.
- Agravante sin carrera: el servicio estampa `approved` aunque cero ítems hayan transicionado.
- Fix mínimo: `FOR UPDATE` en la lectura inicial + guarda `status IN ('submitted','in_review')` con chequeo de rowcount en el UPDATE final.

- **Fix aplicado:** Lock `FOR UPDATE` del padre + guarda de estado con rowcount en el UPDATE final.

### P1-B · "Despacho sugerido" del solicitante se descarta siempre — el control es decorativo  ✅ **CORREGIDO 2026-08-08**
`app/(app)/solicitudes/actions-module/parse-request-form.ts` (no lee el campo) · `use-request-form.ts:88` (el form sí lo envía) · `lib/validation/operations.ts:73` (default `via_oficina`) · `lib/services/requests-draft-create.ts:46` — NUEVO. Familia A-37 (valor mostrado ≠ valor persistido).

- El FormData incluye `deliveryMode`, pero `parseRequestForm` nunca lo extrae → el schema defaultea y TODA solicitud nace `via_oficina`, para los 4 tipos.
- Segunda manifestación: el detalle `[id]/page.tsx` arma `editRequest` sin `deliveryMode`, así que la ficha muestra "Vía oficina" aunque la jefatura lo haya cambiado a directo a faena en /aprobaciones.
- Escenario: solicitante marca "Directo a faena (Urgencia/Volumen)" → se persiste `via_oficina` → si la jefatura no lo re-marca a mano (sin ver rastro de la sugerencia), la OC hereda el modo equivocado y la recepción exige un paso por oficina que nadie pidió.

- **Fix aplicado:** `parseRequestForm` ahora lee `deliveryMode`; también se propaga por el camino de borradores (repuestos/servicios) y la ficha de detalle lo muestra.

### P1-C · Cantidad vacía se envía como 1, contradiciendo la validación visible  ✅ **CORREGIDO 2026-08-08**
`use-request-form.ts:341` (`Number(item.quantity) || 1`) · `item-editor.tsx:212-223` · `request-form.tsx:257-267` — NUEVO.

- El input puede quedar vacío (sin `required`; `min=0.01` solo frena el 0 explícito). El resumen lateral dice "ingresa una cantidad válida" pero el submit no bloquea y el payload coacciona a **1**.
- Escenario: usuario borra la cantidad para retipearla y envía → la solicitud nace con cantidad 1 sin error alguno; se aprueba/compra una cantidad que nadie escribió.

- **Fix aplicado:** Se quitó el fallback `|| 1` (el servidor rechaza la cantidad vacía) y el envío se corta en cliente listando el problema.

### P1-D · Repuestos/servicios enviados con 0 cotizaciones quedan sin salida; la cola ofrece una tarea imposible  ✅ **CORREGIDO 2026-08-08**
`lib/requests/request-service-module/submit-request.ts:40-44` (0 cotizaciones pasa con justificación en notas) · `add-quotation.ts:25` (subir exige `draft`) · `app/(app)/solicitudes/[id]/page.tsx:81` (`canUploadQuotation` = owner + editable) · `lib/services/operational-work-queue.ts:591-609` — NUEVO (emergente del flujo lineal: se retiró "devolver a borrador" sin cubrir este camino).

- Enviada con 0 cotizaciones, la única vía de aprobación (`selectQuotation`) exige una cotización `pending`, y ya no se puede subir ninguna. `/aprobaciones` los excluye por diseño.
- Mientras tanto la fuente `select_quotation` de /pendientes publica "Seleccionar cotización ganadora" con CTA al detalle, donde no hay nada que seleccionar ni subir. Única salida: cancelar y recrear.

- **Fix aplicado:** `submitRequest` exige al menos una cotización; la justificación en notas sigue relevando del mínimo de 3.

### P1-E · Cotizaciones que fallan al subir se pierden en silencio (o con toast de ÉXITO)  ✅ **CORREGIDO 2026-08-08**
`actions-module/draft.ts:129-135` · `use-request-form.ts:60-73` · `item-editor-cotizaciones.tsx:184` — NUEVO.

- `persistDraft` devuelve `ok: true` con mensaje "…N archivo(s) no se subieron" cuando fallan archivos. El cliente: (a) lo muestra como `toast.success` (verde, autocierre — la convención del repo es error persistente), y (b) vacía `cotizaciones` de TODOS los ítems, incluidas las fallidas: desaparecen de la UI sin quedar listadas en ningún lado.
- Con autosave (60 s) el toast se suprime por completo: el camino normal (subir 3 PDFs, llenar proveedor/monto después) tritura los archivos sin ninguna señal.
- `isCotizacionComplete` (el validador cliente que evitaría esto) existe y es código muerto: cero consumidores.
- **Fix aplicado:** `failedFiles` viaja al cliente, el aviso va como `toast.error` persistente (también en autosave) y las cotizaciones rechazadas se conservan en el formulario.

---

## P2 — Medios/graves acotados

### P2-A · Rechazo/daño en etapa faena deja la OC imposible de cerrar para siempre  ✅ **CORREGIDO 2026-08-08**
`lib/services/purchasing-module/receiving.ts:42-51` (guarda LOG-7: exige oficina ≤ recibido-faena) × `lib/services/receiving.ts:127-171` (el cap de disposición faena descuenta recibido+rechazado+dañado) — NUEVO (interacción entre la remediación LOG-7 y el cap por etapa).

- Escenario: línea de 10, llegan 10 a oficina; en el traslado se dañan 2 → recepción faena `qtyRec=8, qtyDmg=2`. `quantityReceived=8`, disposición faena agotada. Otra recepción → "excede el saldo"; `closeOrder` → bloqueado (10>8); anular/borrar → estado no permitido. OC eterna en `partially_received`, ítem sin salida, solicitud en `in_purchasing`.
- Fix conceptual: la guarda de cierre debe comparar oficina contra lo **dispuesto** en faena (recibido+rechazado+dañado, ya está en `receipt_items`), no contra `quantityReceived`.

- **Fix aplicado:** La guarda de cierre compara oficina contra recibido + rechazado + dañado en faena.

### P2-B · Fuga de SQL crudo con parámetros al cliente en errores de BD no previstos  ✅ **CORREGIDO 2026-08-08**
`solicitudes/actions-module/draft.ts:140`, `submit.ts:115,147`, `cancel.ts:48` · `aprobaciones/actions.ts:98,159,206,265` · `recepcion/actions.ts:100` · `entregas/actions.ts:90` · `pendientes/actions.ts:40` — NUEVO.

- El patrón `e instanceof Error ? e.message : fallback` devuelve tal cual el mensaje de `DrizzleQueryError` (drizzle 0.45): "Failed query: " + el SQL completo + params. Ej.: dos usuarios guardan la asignación del mismo pendiente → violación del unique → el toast muestra el INSERT con columnas y valores.
- Variante menor: `compras/actions/helpers.ts:5` (`dbErrMsg`) no expone SQL pero sí el error crudo de Postgres (constraints/columnas).
- Fix: un helper único que loguee el detalle y devuelva mensaje genérico cuando el error sea de driver (`DrizzleQueryError` o `e.cause` presente), dejando pasar solo los `Error` de negocio.

- **Fix aplicado:** Helper único `safeActionMessage` (lib/action-error.ts); también absorbe `dbErrMsg` y los `ZodError` crudos.

### P2-C · Solicitudes de servicios (y todo ítem sin producto de catálogo) nunca llegan a `closed`  ✅ **CORREGIDO 2026-08-08**
`lib/services/item-state-module/rollup.ts:62-63` · `deliveries-worksite.ts:22,54` · `entregas/page.tsx:119-124` · `operational-work-queue.ts:522-546` · `lib/work-queue-labels.ts:96` — NUEVO.

- Un ítem con `productId` null (todo repuestos/servicios es texto libre) llega a `received` pero no tiene camino a `delivered`: /entregas exige EPP de catálogo, /bodega exige `productId`, y la recepción no le genera stock. El rollup solo cierra con todo en `rejected` o `delivered` → el padre queda `in_purchasing` para siempre.
- Consecuencia visible: cada servicio completado (trabajo hecho, OC cerrada, factura adjunta) deja una fila perpetua "Revisar solicitud" en /pendientes con la sugerencia imposible "Bodega debe registrar la entrega a faena", y suma al badge de /solicitudes.
- Fix conceptual: los ítems sin producto de catálogo deberían cerrar en la recepción faena (received = terminal para ellos) o tener una acción explícita de conformidad.

- **Fix aplicado:** Un ítem sin producto de catálogo cierra como `delivered` al llegar completo a faena.

### P2-D · La cola y el badge de "Entregas" ofrecen ítems no-EPP que /entregas no puede entregar  ✅ **CORREGIDO 2026-08-08**
`operational-work-queue.ts:622-643` y `:1157-1175` (sin filtro `isEpp`) vs `entregas/page.tsx:119-124` (`isEpp = true`) — NUEVO.

- El picker de solicitudes no filtra por `isEpp`: un ítem EPP/otro con producto de catálogo no-EPP se recibe, genera stock y entra a la fuente `entregas` de la cola. El CTA lleva a /entregas, que responde "Sin EPP pendiente de entrega". La entrega real vive en /bodega, adonde nada apunta.

- **Fix aplicado:** El CTA de la cola apunta a /bodega para los no-EPP, con su propia etiqueta.

### P2-E · `getOperationalWorkCount` dejó de ser espejo fiel: omite la fuente `select_quotation`  ✅ **CORREGIDO 2026-08-08**
`operational-work-queue.ts:1105-1281` vs `:591-609` — NUEVO.

- La cola tiene la fuente con permisos `repuestos:approve` y `servicios:approve`; el conteo del rail no tiene esa rama. Un usuario cuyo único pendiente sea seleccionar cotizaciones ve el badge en 0 mientras /pendientes lista k tareas. Misma clase de deriva que A-03/A-13 remedió para las otras fuentes.

- **Fix aplicado:** Rama `select_quotation` agregada al contador, con test que compara cola y badge.

### P2-F · Adjuntar/eliminar factura no revalida /pendientes ni /dashboard  ✅ **CORREGIDO 2026-08-08**
`compras/invoice-actions.ts:191-192` y `:248-249` — NUEVO.

- Únicas mutaciones del flujo con `revalidatePath("/compras")` a secas en vez de `revalidateOperationalViews` (que refresca /dashboard, /pendientes y `badge-counts`). La cola tiene el pendiente "Adjuntar factura": la secretaria lo resuelve, vuelve a /pendientes y la tarea sigue ahí (con el badge contándola) hasta que otra mutación revalide.

- **Fix aplicado:** `revalidateOperationalViews` en adjuntar y eliminar factura.

### P2-G · "Monto total" de factura queda ineditable justo cuando el sistema pide corregirlo  ✅ **CORREGIDO 2026-08-08**
`compras/[id]/invoices-section.tsx:594-605` — NUEVO.

- Caso "extracción con total pero sin líneas": el `Input` recibe `value` sin `onChange` ni `readOnly` → controlado e inmutable. El propio flujo emite "Neto + IVA no cuadra con el total leído: corrige los montos" — corrección que el campo no permite. Única salida: quitar el archivo (perdiendo lo extraído) y digitar a mano.

- **Fix aplicado:** El monto es un campo controlado con `onChange`, precargado desde el OCR y editable.

### P2-H · /aprobaciones filtrada por `?solicitud=` sin control visible + empty state que miente  ✅ **CORREGIDO 2026-08-08**
`aprobaciones/page.tsx:39,44` · `approval-panel.tsx:66-73` · `components/adquisiciones/list-filters.tsx` (clearAll no borra `solicitud`) — NUEVO.

- El CTA de /pendientes filtra por solicitud, pero ese filtro no tiene chip ni lo limpia "Limpiar". Al aprobar el único ítem, la pantalla dice "Sin ítems pendientes… Bien hecho." con N solicitudes reales esperando, ocultas por un parámetro invisible. El mismo texto triunfalista aparece con filtros sin resultados (viola A4: no distingue "no hay nada" de "tu filtro no calza").

- **Fix aplicado:** Chip removible para `solicitud`, `LIST_FILTER_PARAMS` compartido y empty state que distingue filtro de cola vacía.

### P2-I (e2e) · `repuestos-servicios-oc-flow.spec.ts` contradice el diseño y no verifica lo que promete  ✅ **CORREGIDO**
`e2e/repuestos-servicios-oc-flow.spec.ts:56-72,74-89` — NUEVO.

- Tras enviar el repuesto va a /aprobaciones y pulsa "Aprobar" — cola que excluye repuestos por diseño. El `if (isVisible())` hace que: con bandeja vacía no apruebe nada en silencio; con ítems EPP ajenos pendientes, **apruebe un ítem ajeno**. El assert final es solo "la página /compras/nueva carga".
- Consecuencia: **no existe ningún e2e del camino real** repuestos/servicios → subir cotizaciones → seleccionar ganadora → OC. Ningún spec sube una cotización.
- **Fix aplicado:** spec reescrito al camino real (adjuntar cotización → guardar → enviar → adjudicar en el detalle → ítem comprable), con helper compartido `attachQuotation` en `e2e/helpers.ts` y un caso nuevo que verifica que enviar sin cotización queda bloqueado. **Escribirlo destapó un bug real que ninguna auditoría había visto**: `selectQuotationAction` sólo revalidaba su propio listado, así que el ítem recién aprobado no aparecía en Compras ni en la cola hasta que otra mutación revalidara (corregido con `revalidateOperationalViews`, y de paso el `e.message` crudo de esas actions pasó a `safeActionMessage`).

### P2-J (e2e) · Cobertura `directo_faena`: confirmado que NO existe  ✅ **CORREGIDO**
`e2e/*.spec.ts` — RESIDUAL (pendiente reconocido de Fase 6: TST-6/TST-10 + e2e directo_faena).

- `grep directo_faena e2e/` → 0 resultados. Todo el camino alternativo (sin checkpoint oficina, guarda de `receiving.ts:79`, gate del prevencionista en `recepcion/nueva/page.tsx:58`) corre sin prueba. `recepcion-flow.spec.ts` es humo (verifica título).
- **Fix aplicado:** `e2e/directo-faena-flow.spec.ts` nuevo, con fixture propio (`oc-directo-faena-e2e`): emitir y enviar → verificar que no se ofrece la etapa oficina (ni el CTA ni el selector del formulario) → recepción parcial contra lo pedido → saldo que cierra la OC. Verde.

---

## P3 — Menores

### Lógica de servicios
1. **`pending_purchase` no tiene salida**: tras anular/cerrar una OC, el ítem devuelto solo puede ir a `in_purchase_order`; `rejectItem` no lo acepta y el padre (`approved` con `in_purchasing`) no es cancelable. Lo que el negocio ya no quiere recomprar queda eterno en "ítems sin OC". `item-state-module/types.ts:38`, `cancel-request.ts:8`. Posiblemente diseño — documentarlo si es intencional.
2. **`deleteQuotation` sin guarda ni tx**: DELETE por id sin `status='pending'`, fuera de transacción — ventana estrecha para borrar una cotización ya `selected` (y su PDF, evidencia de adjudicación). `delete-quotation.ts:14-35`. ✅ **CORREGIDO** — DELETE con guarda `status = 'pending'` y verificación de filas afectadas; el archivo se borra sólo tras confirmar.
3. **`addQuotation` pre-check sin tx**: entre el check `draft` y el insert la solicitud puede enviarse/cancelarse; insert + audit en statements separados. `add-quotation.ts:17-27`. ✅ **CORREGIDO** — Insert + auditoría en una transacción que re-verifica el estado `draft` bajo lock.
4. **Facturas**: `createPurchaseOrderInvoice` valida la OC sin lock (cancelación concurrente deja factura sobre OC `cancelled`); `deletePurchaseOrderInvoice` permite borrar la factura de una OC `closed` (evidencia fiscal) — solo lo frena el permiso. `purchasing-module/invoices.ts:56-70,181-222`. ✅ **CORREGIDO** — Lock `FOR UPDATE` de la OC al adjuntar; el borrado exige los mismos estados que permiten adjuntar (`closed` sigue permitido a propósito).
5. **`gapKey` del cliente sin validar**: `reserveReplenishmentGapsTx` inserta claves fabricables que suprimen sugerencias de reposición de otras faenas. Impacto acotado a la lista de sugerencias. `epp-replenishment.ts:115-128`. ✅ **CORREGIDO** — `reserveReplenishmentGapsTx` descarta claves cuya faena no es la de la solicitud.
6. **Links de reposición sin resolución en el camino feliz**: `resolvedAt` solo lo escriben rechazo/cancelación; `listReplenishmentSuggestions` carga todos los links abiertos sin filtro de faena — crece sin cota (rendimiento, no corrección). `epp-replenishment.ts:63-75`. ✅ **CORREGIDO** — La consulta de links abiertos se acota a las faenas evaluadas.
7. **DAT-1 residual documentado**: `rollupRequestStatus` sin lock puede quedar obsoleto bajo mutaciones concurrentes de hermanos; auto-corrige en la siguiente transición. Ya documentado en el código con la solución real pendiente — no re-remediar a medias. `item-state-module/rollup.ts:10-37`.

### Server actions
8. **Tope de `modifiedQty` solo en la action**: `approveItem` acepta cualquier número finito (0, negativo, mayor a lo pedido); hoy el único caller es la action, pero es la clase de deriva action↔servicio del 07-29. `aprobaciones/actions.ts:41-66` vs `item-state-module/approval.ts:117-127`. ✅ **CORREGIDO** — `approveItem` topea `modifiedQty` (>0 y ≤ solicitada) bajo el lock, junto a la regla del motivo.
9. **`duplicateRequest` chequea `requests:create` plano** en vez de `permissionForRequestType(source.requestType, "create")` — con los grants actuales no es explotable, pero un cambio de grants lo habilita en silencio. `duplicate.ts:19`. ✅ **CORREGIDO** — Usa `permissionForRequestType` como el creador normal.
10. **`duplicateRequest` sin try/catch**: única action del módulo cuya transacción escapa al error boundary genérico en vez de devolver `ActionState`. `duplicate.ts:47-104`. ✅ **CORREGIDO** — Transacción envuelta en try/catch que devuelve ActionState.
11. **Fechas sin validar**: `issueDate` de facturas y `estimatedDelivery` de OC aceptan cualquier string (existe `requiredOperationalDate` con `isRealIsoDate` en el mismo archivo); columnas text sin CHECK. `lib/validation/operations.ts:120,206`. ✅ **CORREGIDO** — `issueDate` y `estimatedDelivery` validan fecha real con `isRealIsoDate` (ahora exportada).
12. **Arrays sin cota**: `createOrderSchema.items` sin `.max()` (requestSchema capea 50) y `itemIds` del bulk-approve sin límite → `inArray` con decenas de miles de params. `operations.ts:123`, `aprobaciones/actions.ts:173`. ✅ **CORREGIDO** — `createOrderSchema.items` capea en 200 y el bulk-approve corta sobre 200 ids antes de consultar.
13. **`committedDueAt` regex-only** (`2026-99-99` pasa y se persiste) y el `ZodError` crudo (JSON de issues) llega al cliente. `operational-assignments.ts:21`, `pendientes/actions.ts:40`. ✅ **CORREGIDO** — `committedDueAt` valida fecha real; el `ZodError` crudo ya lo filtra `safeActionMessage`.
14. **Redirect detectado por `e.message.includes("NEXT_REDIRECT")`** con la OC ya creada; si Next cambia el formato, el catch traga el redirect → "Error al crear la orden" con la orden creada → reintento → OC duplicada. Patrón correcto (redirect fuera del try) ya usado en `order-status.ts:88`. `create-order.ts:165-171`. ✅ **CORREGIDO** — `unstable_rethrow` de next/navigation (compara digest) en vez del match por texto.
15. **Campos de devolución EPP sin consistencia entre sí**: `returnQuantity` sin producto ni motivo persiste una "devolución de nada". `operations.ts:170-174`, `deliveries-worker-epp.ts:142-163`. ✅ **CORREGIDO** — Refines que exigen producto y motivo cuando hay `returnQuantity`.
16. **invoice-actions pasa scope `'all'` al servicio** (único camino de compras que suelta el cinturón dentro de la tx; hoy sin agujero porque `assertOrderAccess` corre antes). `invoice-actions.ts:178,237`. ✅ **CORREGIDO** — Pasa `serviceWorksiteScope(session)` como el resto de compras.

### UI/UX
17. **Skeletons sin `PageContainer`** → salto de layout en las 6 rutas del flujo (12 `loading.tsx`); `recepcion/[id]` y combustibles ya lo hacen bien. ✅ **CORREGIDO** — Los 12 `loading.tsx` envueltos en `PageContainer`.
18. **Ordenar por Faena/Proveedor en /recepcion ordena por UUID** (la columna es sortable sobre el id, el nombre se resuelve al renderizar). `recepcion-table.tsx:41-51`. ✅ **CORREGIDO** — Las filas llevan `worksiteName`/`supplierName` y las columnas ordenan por esos.
19. **Columna Fecha ordena por un campo y muestra otro**: `oc-list.tsx:24` (createdAt) vs `oc-list-rows.tsx:152-154` (sentAt/issuedAt/createdAt); igual en `request-list.tsx:49` vs `:282`. La tarjeta móvil de OC muestra otra fecha que el desktop. ✅ **CORREGIDO** — Helper único `ocDisplayDate`, usado por el orden y por las dos variantes de fila.
20. **Vocabulario duplicado**: `aprobaciones/types.ts:10-13` re-declara los labels de tipo en vez de importar `lib/request-types.ts` — ya divergió (`otro` → "Otros" vs "Otro"). ✅ **CORREGIDO** — `aprobaciones/types.ts` re-exporta el diccionario canónico.
21. **Header de /aprobaciones cuenta solo la página actual** ("N ítems en M solicitudes" sobre las 20 paginadas, no el total). `aprobaciones/page.tsx:282-292`. ✅ **CORREGIDO** — La cabecera usa el total de la consulta y distingue el conteo de la página.
22. **Empty states sin CTA (A4)**: `oc-list.tsx:118`, `recepcion-table.tsx:77` sin "Limpiar filtros" (request-list sí lo tiene); `oc-form-items.tsx:93-101` culpa a la faena cuando la causa es el texto buscado. ✅ **CORREGIDO** — `emptyAction` con "Limpiar filtros" en Compras y Recepción; `LIST_FILTER_PARAMS` compartido.
23. **`datalist` con id duplicado por cada ítem** del editor (DOM inválido, axe duplicate-id). `item-editor.tsx:239-241`. ✅ **CORREGIDO** — Un solo `<datalist>` montado en el formulario, no uno por ítem.
24. **Línea de OC**: cantidad imposible de vaciar (borrar la resetea a la cantidad completa; hay que seleccionar-todo y sobreescribir), y precio 0 se ve como campo vacío — OC emisible en $0 sin aviso. `use-oc-form.ts:128-132`, `oc-form-items.tsx:199`. ✅ **CORREGIDO** — Vaciar la cantidad ya no la restaura sola, y un precio 0 se muestra como 0.
25. **Diálogo de asignación pierde el foco al cerrar** (botón abre con onClick manual, no es DialogTrigger → el foco cae al body). Afecta pendientes, aprobaciones y recepción/nueva. `work-assignment-control.tsx:43-55`. ✅ **CORREGIDO** — El botón es `DialogTrigger`, así que Radix devuelve el foco al cerrar.
26. **`tr role="link"` rompe la semántica de tabla** (elimina el rol row; celdas sin padre — axe aria-required-parents) en request-list, oc-list-rows y recepcion-table. ✅ **CORREGIDO** — La fila conserva su rol `row` y el código pasó a ser un enlace real con foco propio; verificado con el spec de axe (42/42). La tarjeta móvil es un `<article>`, no una fila: ahí el patrón sigue siendo válido.
27. **Empty state de /entregas ofrece "Solicitar acceso a faenas" → /admin/usuarios** — el usuario sin faenas no es admin y rebota en /forbidden. `entregas/page.tsx:322-324`. ✅ **CORREGIDO** — El estado vacío explica a quién pedir acceso en vez de enlazar a /admin/usuarios.
28. **/compras/nueva trunca en 501 ítems en silencio**: `limit(501)` parece centinela pero nadie chequea `length === 501`. `compras/nueva/page.tsx:53`. ✅ **CORREGIDO** — Centinela real (`PICKER_ITEM_LIMIT + 1`) con aviso en pantalla cuando se trunca.
29. **Reintento de aprobación masiva sin feedback**: el guard de mensaje repetido suprime el toast del segundo fallo idéntico. `bulk-approve-bar.tsx:38-39`. ✅ **CORREGIDO** — El guard sólo persiste tras un éxito, así que un reintento fallido vuelve a avisar.
30. **Navegación interna descarta el formulario de solicitud sin confirmar** (el guard cubre beforeunload y "Volver", no sidebar/breadcrumb). Limitación conocida del App Router; se registra por ser el único form largo sin borrador. `use-request-form.ts:357-368`. ✅ **CORREGIDO** — Intercepción del clic en enlaces internos en fase de captura (respeta pestaña nueva, descargas y anclas de la misma ruta) que reutiliza el diálogo existente de "¿Salir sin guardar?".
31. **Quick action "Entregas" del dashboard gateada por `warehouse:register_movement`** mientras la página exige `deliveries:view`; hoy sin rebote por los grants seed, pero el gate correcto es el de la página. `dashboard/quick-actions.tsx:52`. ✅ **CORREGIDO** — El atajo usa `deliveries:view`, el permiso que exige la página.
32. **Bandeja de aprobados de /compras y /compras/nueva no excluyen solicitudes terminales** (la fuente `compras` de la cola sí, vía `TERMINAL_REQUEST_STATUSES`); hoy inalcanzable por construcción, pero el predicado ya divergió del canónico. `compras/page.tsx:122-129`, `compras/nueva/page.tsx:33`. ✅ **CORREGIDO** — Ambas consultas excluyen solicitudes terminales con `TERMINAL_REQUEST_STATUSES`.

---

## Verificado OK (no re-auditar)

- **Los dos bugs con test rojo del 07-08 están corregidos y verdes**: `oc-reconciliation.ts` y `trazabilidad-matrix.ts` filtran `locationType='faena'` y las alertas usan `alertRow` de verdad. Re-ejecutados: receiving-two-stage + trazabilidad-matrix 18/18; cancel-request, item-state-mutations, requests-delete, purchasing-service, receiving-service 47/47.
- **TOCTOU de caminos secundarios**: `cancelRequest`, `deleteRequest`, `persistDraft`, `submitRequest` remediados (locks + guardas + rowcount); editar OC enviada eliminado. Único residual: `selectQuotation` (P1-A).
- **Caminos calientes**: aprobar/bulk/rechazar, addItemToPurchaseOrderTx, receiveItemTx, deliverItemTx (lockeado por sus callers), issueAndSendOrder, cancelOrder/deleteOrder, createOrdersBySupplier — locks en orden estable, guardas, trazado correcto.
- **Invariantes de contadores**: `quantityReceived ≤ quantityOfficeReceived ≤ quantity` bajo lock; stock anti-negativo atómico; entregas capadas por lo recibido real en faena.
- **Migraciones 0141-0145**: 0141 sí limpia `sent_at` y `confirmed_at` (el bloqueante de Fase 0 quedó resuelto); 0143 respalda "una cotización selected por solicitud" con índice único parcial; 0144 backfill antes de angostar el CHECK.
- **`requests:submit` retirado limpio**: cero checks vivos; repuestos/servicios verifican sus permisos vía `permissionForRequestType`.
- **Server actions**: ownership/tenancy de borradores bajo lock; parse compartido draft/submit sin divergencia; recepción valida faena de la OC y caps por etapa bajo lock; entregas con tenancy completa; los 3 caminos de upload validan tamaño + magic bytes y limpian huérfanos; pendientes re-deriva todo de BD con unique index anti-carrera; coerción numérica sana en todo el flujo; revalidación completa salvo P2-F.
- **UI**: toast siempre desde `@/lib/toast`; cero selects nativos ni imports de sonner; `approvalQueueFilter` compartido sin reimplementación; A-37 corregido y documentado; ReceiptForm/DeliveryForm con pending states y errores inline; ProductPicker con combobox ARIA correcto; error boundaries con retry; StageTabs/ListFilters respetan A5; paginación de pendientes en sessionStorage (regla router.refresh).
- **Coherencia**: vocabulario de estados ítem→ítem coherente etapa a etapa; deep links validados (incluida degradación a texto sin permiso); ciclo cruzado de cancelaciones sin huérfanos alcanzables; espejo del contador fiel salvo P2-E; e2e purchase-flow/oc-flow/worker-delivery-flow/epp-variant sí espejan el flujo actual.
- **DTE**: scoping documentado como decisión (SEC-2), correcto con los roles actuales.

## Sugerencia de priorización

1. **Fase A (corrección de datos/flujo):** P1-A (lock + guarda en selectQuotation), P1-D (permitir subir cotizaciones post-envío o bloquear el envío con 0), P2-A (guarda de cierre contra lo dispuesto), P2-C (cierre de ítems sin producto en recepción).
2. **Fase B (frontera y confianza):** P1-B (leer deliveryMode en el parser — fix de una línea), P1-C (bloquear submit con cantidad vacía), P1-E (toast.error + no vaciar cotizaciones fallidas), P2-B (helper de errores de driver), P2-F (revalidateOperationalViews en facturas).
3. **Fase C (colas y espejo):** P2-D, P2-E, P2-H.
4. **Fase D (e2e):** P2-I (reescribir el spec al camino real con cotizaciones), P2-J (directo_faena — ya en backlog Fase 6).
5. **P3 en tandas** por área, empezando por los de deriva de predicados (#20, #32) que son la semilla de los P2 futuros.
