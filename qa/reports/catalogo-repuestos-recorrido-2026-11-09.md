# QA — Recorrido manual del catálogo de repuestos (fase 2), 2026-11-09

Rama `feat/catalogo-repuestos`, HEAD `06f1aa637`. Complementa `catalogo-repuestos-2026-11-09.md`
(puertas y E2E), que dejaba este recorrido como pendiente.

## Alcance y entorno

- `next dev --webpack -p 3002` desde el worktree, con `AUTH_URL`/`NEXTAUTH_URL`/`APP_URL`/`PDF_RENDER_ORIGIN`
  en :3002 y las variables de `.env.development.local` exportadas en el shell. BD `bodega_dev`
  (clon de prod + mock, migrada a 0385 y con `db:sync-rbac`). El dev de :3001 no se tocó.
- Chromium de `@playwright/test` desde scripts `.mjs` en el scratchpad (el MCP de Playwright no arranca
  aquí). Escritorio 1440×900 y móvil 390×844 (`isMobile`, `hasTouch`). Se registraron por paso los
  errores/avisos de consola, `pageerror`, respuestas ≥400 y solicitudes fallidas.
- Usuarios: el usuario QA de `.env.qa` (administrador + jefe_mantencion + jefa_chome, entre otros) y un
  usuario `QA_` nuevo con **sólo** `solicitante_faena` (tiene `repuestos:create`, no `repuestos:catalog`).
- **Correo:** antes de enviar/aprobar/emitir se verificó que no puede salir correo real: el único
  transporte es Resend (`lib/email/smtp.ts`) y no hay clave ni en el entorno (`.env`, `.env.local`,
  `.env.development.local`: vacía) ni guardada en `system_settings` (`email.resend.*`: 0 filas), así que
  `sendEmail` es un no-op («Clave de Resend no configurada»). Proveedor de las OC: uno mock
  (`mock-ti-sup-rep`, sin correo).
- Capturas: `/tmp/claude-1000/-home-allopze-dev-chome-bodega/b3e310bf-dea9-47fc-89e5-565925c7f16c/scratchpad/walkthrough/`
  (se citan abajo por nombre de archivo; esa carpeta no está versionada).

## PASS (verificado en el navegador, con la BD como segunda evidencia cuando aplica)

1. **Lista `/mantencion/repuestos`**
   - Estado vacío A4 con título, explicación y CTA real «Nuevo repuesto» (`01-lista-vacia-desktop.png`).
   - «Nuevo repuesto» abre la hoja; enviar vacío marca «Escribe el nombre del repuesto»
     (`03-sheet-validacion-vacio.png`). `QA_Filtro de aceite` / `QA-123` / `QA_Marca` → toast
     «Repuesto RPT-001 creado» y fila con «N° QA-123 · QA_Marca · RPT-001» (`06-lista-con-uno.png`).
   - Duplicado (`qa-123` + `qa_marca`, otra caja) rechazado en el campo con «Ya existe el repuesto
     RPT-001 con ese N° de parte», sin perder lo escrito (`05-duplicado-rechazado.png`).
   - Búsqueda de la TopBar por N° de parte, SKU y marca (`qa-123`, `RPT-001`, `qa_marca`); sin
     coincidencias muestra «Ningún repuesto coincide» (`07-busqueda-sin-resultado.png`).
   - Activos/Inactivos con contadores y `?estado=inactivos`; vacío propio de inactivos (`08-tab-inactivos.png`).
   - «Exportar Excel» (cabecera, variante secundaria) descarga `catalogo-repuestos-activos_2026-11-09.xlsx`
     (ZIP válido, hoja «Repuestos» + «Metadatos»), toast «Archivo exportado».
2. **Ficha `/mantencion/repuestos/[id]`**
   - Sin compras: vacío con explicación y CTA «Pedir repuestos» (`09-ficha-desktop.png`).
   - Editar: hoja precargada; guardar → toast «Repuesto RPT-001 actualizado», hoja cerrada, precio de
     referencia y notas visibles (`14-tras-guardar-edicion.png`).
   - Desactivar con confirmación → «Repuesto desactivado», badge Inactivo, aparece en Inactivos;
     «Activar» → «Repuesto activado» (`11-confirmar-desactivar.png`, `12-ficha-inactiva.png`,
     `13-lista-inactivos-con-uno.png`).
   - Tras emitir la OC: proveedor y precio vigente $14.000, fila de historial «Orden de compra»,
     «Comprado para» KA-54 · Mercedes 1720 y la línea REP/OC (`39-ficha-rpt001-tras-oc1.png`).
3. **Pedir desde la OT** (`OT-PAC-0006`, `mock-mant-ot-00582`, en ejecución)
   - «Pedir repuestos» lleva a `/solicitudes/nueva?tipo=repuestos&ot=…` con faena, equipo y OT precargados.
   - El buscador consulta el servidor mientras se escribe (`searchSparePartsForRequestAction`
     debounced, una llamada por pausa; visto en el log del dev) y busca por nombre y por N° de parte.
   - Elegido el repuesto: tarjeta «Repuesto elegido» con SKU, N° de parte y marca; el input libre de
     «N° de Parte» desaparece (`19-repuesto-elegido.png`).
   - Segunda línea en texto libre `QA_Correa alternador libre` + N° QA-777; borrador guardado
     (REP-2026-0002) con `product_id` en la 1.ª línea y `NULL` + atributo en la 2.ª (BD); envío sin
     cotización bajo el umbral → `submitted`.
   - **Precio precargado**: en la segunda solicitud (después de la 1.ª OC) el buscador, con el equipo
     elegido y sin texto, sugiere los dos repuestos ya pedidos con «Para este equipo», ordena RPT-003 y
     RPT-001 antes de RPT-002, y al elegir RPT-001 precarga 14000 (`41-…`, `42-picker-orden-por-equipo.png`,
     `43-precio-precargado.png`).
4. **Aprobar y armar la OC** (`/compras/nueva`)
   - «Aprobar sin cotización» con fundamento → ítems aprobados.
   - Sólo la línea libre ofrece «Catalogar»; la catalogada muestra «Repuesto de catálogo · N° QA-123».
   - Hoja «Catalogar repuesto»: muestra la unidad de cada repuesto («por unidad», «por juego») y
     **deshabilita** `QA_Correa juego` (RPT-002, juego) con «Se compra por «juego» y esta línea pide
     «unidad»» (`30-catalogar-busqueda-unidades.png`).
   - «Crear uno nuevo» llega prellenado (nombre y N° de parte) → RPT-003 vinculado a la línea
     (`31-…`, `32-linea-vinculada.png`). Repetirlo con el mismo N° de parte da «Ya existe el repuesto
     RPT-003 con ese N° de parte» y la vista «Vincular» sugiere «Coincide por N° de parte · Vincular
     este» (`33-…`, `34-catalogar-duplicado.png`).
   - OC-2026-0058 creada con 2 ítems: `product_id` en `purchase_order_items` **y** en el ítem de
     solicitud libre (BD).
5. **Emitir y anular**
   - Emitir OC-2026-0058 → `sent`; `product_supplier_price_history` con `source = purchase_order`
     para RPT-001 ($14.000) y RPT-003 ($20.000); ficha y lista muestran el precio (`38-oc1-emitida.png`,
     `40-lista-tras-oc1.png`).
   - Segunda OC (OC-2026-0059, RPT-001 a $16.000) emitida → ficha «$14.000 → $16.000»
     (`47-ficha-tras-oc2.png`); anulada con motivo → precio vigente vuelve a $14.000 y su fila de
     historial desaparece; la OC figura «Anulada» en «Últimas solicitudes» (`49-ficha-tras-anular-oc2.png`).
6. **Recepción en faena** (OC directa a faena)
   - Ambos ítems `delivered`; la OC `closed`; REC-2026-0104. **0 filas** en `inventory_movements` y
     `worksite_stock` para productos `is_spare_part` (antes y después). La solicitud dice «Pedido
     entregado en faena» (`57-solicitud-entregada.png`).
   - La OT sale de `/mantencion/ot?repuestos=pendientes` (estaba antes: `52-…`, `55-…`) y su sección
     «Repuestos pedidos» muestra RPT-001/RPT-003 «Entregado 2/2, 1/1» (`56-ot-tras-recepcion.png`).
7. **Rol sin `repuestos:catalog`** (`solicitante_faena`), escritorio y móvil
   - Sin ítem «Catálogo de repuestos» ni ningún enlace a `/mantencion/repuestos` en el menú (`50-…`).
   - Navegación directa a la lista y a la ficha → redirección de servidor a `/forbidden` «Sin permisos
     suficientes» (`51-sin-permiso-directo-desktop.png`, `…-mobile.png`).
   - El mismo usuario sí usa el buscador al pedir (lectura con `repuestos:create`).
8. **Admin › Productos**
   - La lista no incluye repuestos y la descripción remite a «Catálogo de repuestos».
   - «Nuevo producto» sólo ofrece «Elementos de protección personal» y «Servicios operacionales».
   - Editar la categoría «Repuestos»: slug `repuestos` con `readonly` y la ayuda «Lo usa el catálogo de
     repuestos: no se puede cambiar» (`63-categoria-repuestos-slug.png`).
9. **Móvil 390×844**: lista en tarjetas, acciones de cabecera visibles, hoja nueva, ficha, buscador,
   repuesto elegido, `/compras/nueva`, OT y OC: **sin desborde horizontal de página**
   (`scrollWidth = 390` en documento y en el pozo `[data-shell-scroll]`) (`m01`–`m08`).

## PRODUCT BUG

Ninguno confirmado. Ningún paso del flujo pedido falló; los datos en BD coinciden con lo que muestra la UI.

## FUNCTIONAL FINDING

- **FF-1 · «Ya se compró para este equipo» sin compra.** En la hoja «Catalogar», RPT-001 llevaba esa
  insignia antes de que existiera ninguna OC: el único antecedente era la línea de la **misma**
  solicitud que se estaba convirtiendo en OC (`30-catalogar-busqueda-unidades.png`). El orden se basa en
  ítems de solicitud no cancelados («pedido»), no en compras; el texto afirma una compra. Sugerencia:
  rotular «Ya se pidió para este equipo» o contar sólo líneas con OC emitida (y excluir la propia solicitud).
- **FF-2 · El precio de referencia no se usa.** Se captura en la hoja («Orientativo») y se ve en la
  ficha, pero no precarga el precio estimado al pedir (sin compras previas el campo quedó vacío:
  `19-repuesto-elegido.png`), ni aparece en «Último precio» de la lista ni en el Excel. Coherente con el
  plan («precio preferido/último»), pero entonces el campo no tiene efecto visible para quien pide.
  Decidir: usarlo como último escalón de la precarga o explicarlo en su ayuda.
- **FF-3 · Categoría «Repuestos»: el slug está bloqueado pero «Es EPP» y «Requiere aprobación de
  Prevención» siguen editables** (`63-categoria-repuestos-slug.png`). No se probó marcarlos (habría
  alterado `bodega_dev`); falta confirmar si eso desviaría solicitudes de repuestos a Prevención o
  chocaría con el CHECK `NOT (is_spare_part AND is_epp)`. Requiere investigación.
- **FF-4 · Validación esperada registrada como error.** El duplicado al «Crear y vincular» desde la OC
  queda en el log del servidor como `level: error` con stack completo (`[createSparePartForOcAction]
  Ya existe el repuesto RPT-003…`). Es una validación de negocio, no un fallo: en producción ensucia
  logs/Sentry.
- **FF-5 · Búsqueda de varias palabras fuera de orden.** «aceite filtro» no encuentra «QA_Filtro de
  aceite» en el buscador de la solicitud, y en la lista «filtro aceite» tampoco (la TopBar/`DataTable`
  busca por subcadena). Para un catálogo de repuestos es una consulta natural.

## UX FINDING

- **UX-1 · N° de parte duplicado en la OC.** En «Seguimiento del pedido» de la ficha de OC, cada línea
  catalogada dice «QA_Filtro de aceite · N° de parte: QA-123» y debajo otra vez «N° de parte: QA-123»
  (`36-oc-borrador.png`, `38-oc1-emitida.png`). El arreglo 071b3e671 lo resolvió en el formulario de OC,
  no aquí. En la recepción el rótulo de línea también añade «· N° de parte: …» al nombre.
- **UX-2 · Texto de recepción contradice el consumo directo.** Con una OC sólo de repuestos, el tipo de
  recepción dice «Actualiza stock y trazabilidad» y la ayuda «lo que … no ingresa a stock», pero los
  repuestos no tocan stock (`53-recepcion-form.png`).
- **UX-3 · «Proveedor preferido: Sin proveedor» con proveedor conocido.** Tras emitir, la lista muestra
  precio y fecha pero «Sin proveedor», porque emitir no marca preferido (`40-lista-tras-oc1.png`). Leído
  sin contexto parece que falta el dato; mostrar el último proveedor o rotular «Último proveedor».
- **UX-4 · Ficha y OT en móvil usan tablas con scroll interno.** La lista pasa a tarjetas, pero en la
  ficha «Historial de precio» corta la columna «Origen» y obliga a desplazar dentro de la tarjeta; en la
  OT, «Repuestos pedidos» parte el SKU/N° de parte mono en 4 renglones y el estado queda cortado
  (`m03-ficha.png`, `m07-ot-repuestos.png`). No hay desborde de página.
- **UX-5 · «Pedir repuestos» desde la ficha no preselecciona el repuesto** (enlaza a
  `/solicitudes/nueva?tipo=repuestos` sin el producto).
- **UX-6 · «Crear y vincular» sin confirmación explícita.** La hoja se cierra y la línea cambia a
  «RPT-003 · Repuesto de catálogo · Quitar vínculo», pero no hay toast que diga que se creó un repuesto
  nuevo en el catálogo (la creación persiste aunque luego no se cree la OC).
- **UX-7 (probablemente previo a la rama) · «Agregar ítem» en una solicitud abierta desde la OT no
  hereda equipo ni OT**; hubo que elegir KA-54 y OT-PAC-0006 de nuevo en la 2.ª línea.

## INCONSISTENCY

- **IN-1** «N° de Parte» (atributo de la línea libre) vs «N° de parte» (repuesto de catálogo) en la misma
  solicitud (`25-solicitud-enviada.png`).
- **IN-2 · Código crudo de unidad**: Excel «Unidad» = `unidad`; hoja Catalogar «por juego», «Se compra
  por «juego»…», «Unidad de medida: unidad»; la ficha sí usa el rótulo «Unidad» (A6).
- **IN-3** Las opciones de unidad del repuesto incluyen «Servicio» y «Dosis» (`03-sheet-validacion-vacio.png`).
- **IN-4 (previo)** En la solicitud con tipo «Repuestos», la ayuda del campo describe EPP
  («EPP: elementos de protección personal…») (`16-solicitud-nueva-desde-ot.png`).

## AUTOMATION WARNING

- El `next dev --webpack` de :3002 se reinició al menos 4 veces por «approaching the used memory
  threshold» (había gates corriendo en paralelo en el mismo worktree). Provocó `ERR_EMPTY_RESPONSE`,
  `ERR_CONNECTION_REFUSED` y timeouts de navegación, y una vez la página de recepción quedó en
  «Guardando…» aunque la recepción **sí** se registró (verificado en BD y en la UI tras recargar). Se
  repitieron los pasos afectados; esos fallos de red son del entorno, no del producto.
- La primera edición de la ficha pareció no dar feedback en 1,5 s: era la primera compilación de la
  acción. Repetida: toast a los ~0,8 s y hoja cerrada a ~1,3 s.
- Avisos de `preload` de fuentes del dev filtrados como ruido; el avatar de dicebear no aplica.

## Consola y red

- Sin errores de consola, `pageerror` ni respuestas ≥400 atribuibles a la funcionalidad en ninguno de
  los pasos (escritorio y móvil, ambos usuarios).
- `/admin/productos`: aviso de `DataTable` «la columna ordenable "referencePrice"/"isActive" no existe en
  la fila» — **previo a la rama** (`product-list.tsx` no cambió esas columnas).
- Fallos de red sólo durante los reinicios del dev (ver arriba).

## COVERAGE GAP / no cubierto

- Hoja «Catalogar», recepción y emisión/anulación **no** se recorrieron en móvil (sólo escritorio).
- WebKit/Safari: no ejecutable en este host.
- Teclado: sólo se observó que la hoja abre con foco en «Cerrar»; no hubo pasada de teclado completa
  ni axe.
- Conciliación de factura por N° de parte, compras parciales, OC `via_oficina` mixta y recepción con
  rechazo/daño: no recorridos.
- Llamada directa a las acciones de servidor del catálogo por el rol sin permiso: no se ejecutó; el
  código usa `guardPermission("repuestos:catalog")` / `requirePermission` (sólo inspección).
- Notificaciones en la app: los flujos de envío/aprobación/recepción pueden haber generado
  notificaciones internas para usuarios del clon; no se revisaron.

## Registros `QA_` creados en `bodega_dev` (para limpiar)

| Tipo | Id | Detalle |
|---|---|---|
| products (repuesto) | `vdyK5srVsi1egsXl0MYdo` | RPT-001 QA_Filtro de aceite (QA-123) |
| products (repuesto) | `teTxFlhrljUXjU5rhV-Qw` | RPT-002 QA_Correa juego (QA-778, juego) |
| products (repuesto) | `m0L-yCG5GiPdpwQzjRpNz` | RPT-003 QA_Correa alternador libre (QA-777), creado desde la OC |
| purchase_requests | `0kSLhdung8LkIIs2hJt5j` | REP-2026-0002 (OT-PAC-0006), entregada; ítems `KxBJIPp2REV4Wmw9rPns2`, `xz5Rda0ygCGOhIcS7Zc42` |
| purchase_requests | `VowUhAzfNm3snJYxL8WXq` | REP-2026-0003, aprobada; ítem de vuelta en la cola de compra tras anular la OC |
| purchase_orders | `9IYnEzh190LMl8-HzQpgv` | OC-2026-0058, cerrada |
| purchase_orders | `7yuCoE_5FvLnTW-povWje` | OC-2026-0059, anulada |
| receipts | `vMz7-3ubY6YcUqi2yj8R-` | REC-2026-0104 |
| product_suppliers | (RPT-001, RPT-003) × `mock-ti-sup-rep` | precios $14.000 / $20.000 |
| product_supplier_price_history | `wzYNY8rzyIYdhDYSCUivF`, `XJvMpyaiFcBmINju3UgSO` | fuente `purchase_order` |
| users | `qa-rpt-faena` | `qa-rpt-faena@qa.local`, rol `solicitante_faena`, faena Pacifico |

Además, `audit_log` (append-only) y los eventos/decisiones de las solicitudes y OC. La OT mock
`mock-mant-ot-00582` quedó con la solicitud vinculada.

---

## Segundo recorrido (HEAD `a1a4c601b`)

Mismo montaje que el primero: `next dev --webpack -p 3002` desde el worktree, con `AUTH_URL`/`NEXTAUTH_URL`/`APP_URL`/`PDF_RENDER_ORIGIN`
en :3002, y BD `bodega_dev` migrada a 0386 con RBAC sincronizado. Chromium de `@playwright/test`, escritorio 1440×900 y móvil
390×844. Se reutilizaron los registros `QA_` del primer recorrido. Las capturas están en
`/tmp/claude-1000/-home-allopze-dev-chome-bodega/b3e310bf-dea9-47fc-89e5-565925c7f16c/scratchpad/walkthrough2/`, carpeta que no
está versionada. **Correo:** se volvió a confirmar antes de emitir que sigue inerte. `RESEND_API_KEY` está vacía en `.env`,
`.env.local` y `.env.development.local`, y `system_settings` no tiene filas `email.resend.*`. El proveedor es el mock de siempre.

### PASS: arreglos re-verificados

1. **«Comprado para», «Para este equipo» y «Ya se compró» cuentan sólo OC emitidas.** RPT-004 se pidió y aprobó para KA-54
   en REP-2026-0004, todavía sin OC. En la hoja «Catalogar» de esa misma solicitud no lleva la insignia, y RPT-001 y RPT-003
   sí la llevan porque tienen la OC-2026-0058 emitida (`13-catalogar-inicial.png`, `14-catalogar-busqueda.png`). El buscador
   del pedido sugiere sólo RPT-001 y RPT-003 con «Para este equipo» (`07-picker-sugerencias-equipo.png`). La lista muestra
   «Comprado para: 1 equipo» únicamente en los repuestos con OC emitida. En la ficha, «Comprado para» se rotula «…con orden
   de compra emitida».
2. **El precio de referencia sirve de respaldo.** RPT-004 se creó con referencia $9.900 y sin compras. Al pedirlo, desde la
   OT y desde la ficha, se precarga 9900, y la BD guarda `estimated_unit_price = 9900` (`06-pedir-desde-ficha-preelegido.png`).
   En la lista se lee «$9.900 · Referencia», y en las filas con compras, «Último proveedor» bajo el proveedor
   (`02-tras-crear-rpt004.png`). El Excel trae las columnas «Proveedor preferido», «Último proveedor», «Último precio (CLP)»
   y «Precio de referencia (CLP)», y la unidad con su rótulo («Unidad», «Juego»).
3. **Categoría «Repuestos».** «Es EPP» y «Requiere aprobación de Prevención» aparecen deshabilitados y desmarcados, con la
   ayuda «un repuesto no es EPP ni pasa por Prevención». Un clic forzado no los marca (`04-categoria-repuestos.png`).
4. **Búsqueda de varias palabras en cualquier orden.** En la TopBar de la lista, «aceite filtro», «filtro aceite» y
   «QA-123 aceite» encuentran RPT-001, «lubri aceite» encuentra RPT-004 y «aceite xyz» deja el vacío
   (`03-busqueda-aceite-filtro.png`). En el buscador del pedido, «aceite filtro», «filtro QA-123» y «motor aceite» también
   funcionan (`08-picker-aceite-filtro.png`). En la hoja «Catalogar», «aceite filtro» devuelve RPT-001.
5. **La OC dice el N° de parte una sola vez y la recepción dice «Consumo directo».** En «Seguimiento del pedido» cada línea
   muestra «N° de parte: …» una vez (`oc-escritorio-emitida.png`). En la recepción, el tipo dice «Consumo directo: los
   repuestos se entregan sin pasar por stock» y cada línea dice «Consumo directo, no pasa por stock». Desapareció «Actualiza
   stock» (`23-recepcion-form.png`). Tras REC-2026-0105 quedan 0 filas en `inventory_movements` y en `worksite_stock` para
   RPT-004 y RPT-005.
6. **Móvil.** La ficha (precios, historial, «Comprado para», últimas compras), la sección «Repuestos pedidos» de la OT, la OC
   y la lista se ven como tarjetas. No hay desborde: `scrollWidth = 390` en el documento y en el pozo, y ningún contenedor
   con scroll horizontal interno. La única tabla visible en la OT es «Mantenciones solicitadas», que es previa a la rama y no
   desborda (`m-ficha-rpt001.png`, `m-ficha-rpt004.png`, `m-ot-repuestos.png`, `m-ot.png`, `oc-movil.png`, `m-lista.png`).
7. **«Pedir repuestos» desde la ficha preelige el repuesto.** El enlace lleva a
   `/solicitudes/nueva?tipo=repuestos&repuesto=<id>`, con la tarjeta «Repuesto elegido» (RPT-004, N° QA-901, QA_Lubri) y el
   precio precargado (`06-pedir-desde-ficha-preelegido.png`).
8. **«Crear y vincular» avisa.** Aparece el toast «Repuesto RPT-005 creado en el catálogo y vinculado a la línea»
   (`16-crear-y-vincular-toast.png`). La hoja muestra las unidades con su rótulo («por unidad», «por juego», «Unidad de
   medida: Unidad») y deshabilita el repuesto que se compra por juego (`14-…`, `15-catalogar-crear.png`).
9. **Regresión del flujo completo con un pedido nuevo.**
   - REP-2026-0004 se creó desde la OT OT-PAC-0006 (KA-54) con dos líneas: RPT-004 de catálogo y «QA_Bujía libre» en texto
     libre, N° QA-902. Se envió y se aprobó sin cotización (`09-…`, `10-…`, `11-solicitud-aprobada.png`).
   - La línea libre se catalogó como RPT-005. Luego se creó OC-2026-0061 con RPT-004 a $10.500 y RPT-005 a $3.800, ambas
     con `product_id` en la BD, y se emitió.
   - En las fichas aparece el precio vigente, la fila de historial «Orden de compra» y «Comprado para» KA-54
     (`22-ficha-rpt004-tras-emitir.png`, `22-ficha-rpt005-tras-emitir.png`).
   - La recepción en faena dejó la OC `closed`, la solicitud «Pedido entregado en faena» y la OT «Entregado 3/3, 4/4»
     (`oc-escritorio-recibida.png`, `25-ot-escritorio.png`, `26-solicitud-entregada.png`).
   - **Reversión de precio:** se armó OC-2026-0062 con RPT-001, que venía de REP-2026-0003. El formulario precargó $14.000,
     se cambió a $18.000 y se emitió: la ficha mostró «$14.000 → $18.000». Al anularla, el precio vigente volvió a $14.000 y
     su fila de historial desapareció (`27-rpt001-antes.png`, `27-rpt001-tras-emitir-18000.png`, `27-rpt001-tras-anular.png`).

### Capturas pedidas de una OC de mantención (OC-2026-0061)

| Archivo | Qué muestra |
|---|---|
| `oc-escritorio-emitida.png` | Escritorio, recién emitida. Seguimiento, códigos RPT-004 y RPT-005, «Equipo: KA-54 · UD-1187 · OT OT-PAC-0006» |
| `oc-escritorio-recibida.png` | Escritorio, después de la recepción. «Recepción completada», expediente con REC-2026-0105 |
| `oc-movil.png` | Móvil 390 px, página completa en tarjetas. Códigos, equipo y OT |
| `oc-pdf.png` + `oc.pdf` | Vista «Imprimir / PDF» y el PDF descargado de `/compras/<id>/print/pdf` (200, «OC 2026-0061.pdf», 1 página) |

En el expediente de las capturas aparece OC-2026-0060 (anulada). Es el borrador del hallazgo FF-6 y no forma parte del flujo
normal.

### PRODUCT BUG

Ninguno confirmado.

### FUNCTIONAL FINDING

- **FF-6 · El vínculo de «Catalogar» vive sólo en el navegador.** «Crear y vincular» crea RPT-005 en el servidor al instante,
  pero el vínculo con la línea queda en el estado del formulario (`use-oc-form.ts` `linkSparePart`). Si la página se recarga
  antes de crear la OC, la línea vuelve a «Catalogar» y RPT-005 queda huérfano en el catálogo. Así pasó en este recorrido: se
  creó OC-2026-0060 con la línea `product_id NULL`, y por lo tanto sin historial de precio para RPT-005 (verificado en la BD).
  Se anuló y se rehízo con «Coincide por N° de parte · Vincular este». Conviene persistir el vínculo en el ítem de la solicitud
  al crear o vincular, o avisar que se pierde al salir.
- **FF-7 · El PDF de la OC no dice para qué equipo ni para qué OT es el repuesto.** El detalle muestra «Equipo: KA-54 ·
  UD-1187 · OT OT-PAC-0006», pero la vista de impresión y el PDF sólo traen SKU, nombre y N° de parte. Lo comprobé con el
  texto extraído del PDF y con `oc-pdf.png`. `print/page.tsx` usa `requestItem.equipment`, que corresponde a los equipos de
  activos, y no `vehicle` ni la OT, que es lo que llevan los repuestos. Falta decidir si el proveedor y quien recibe deben
  verlo; si la respuesta es sí, es un arreglo de esa página.

### UX FINDING / INCONSISTENCY

- **UX-8.** El precio de referencia no aparece fuera de la ficha y la lista. En la hoja «Catalogar», RPT-004 dice «Sin
  precio» aunque tiene referencia de $9.900, y la opción del buscador del pedido tampoco la muestra. En cambio, la lista
  dice «$9.900 · Referencia».
- **UX-9.** En las tarjetas móviles de «Repuestos pedidos» de la OT, el N° de parte en mono se corta a la mitad («QA-» en un
  renglón y «901» en el siguiente) (`m-ot-repuestos.png`).
- **IN-5.** En la OC completada, el seguimiento muestra el paso «Entrega» vacío mientras el estado dice «Recepción
  completada». En la solicitud el mismo paso aparece como «Entrega completada» (`oc-escritorio-recibida.png` vs
  `26-solicitud-entregada.png`). Es probablemente previo a la rama.
- **UX-7 sigue igual** (previo a la rama): «Agregar ítem» no hereda el equipo de la OT, aunque sí la OT.
- «Vincular este» no muestra toast. Basta con el cambio de la línea; lo dejo sólo como observación.

### AUTOMATION WARNING

- El dev de :3002 se reinició tres veces por «approaching the used memory threshold»: al compilar la ruta del PDF y antes de
  la prueba de reversión. Eso provocó `socket hang up` y `ERR_CONNECTION_REFUSED`, y los pasos se repitieron. No son fallos
  del producto.
- La primera vez, «Guardar borrador» tardó por la compilación y el script pulsó «Enviar a aprobación» del mismo formulario.
  La solicitud quedó enviada directamente sin pasar por borrador; la BD está correcta.
- Justo después de anular OC-2026-0060, `/compras/nueva` todavía no listaba los ítems devueltos. En la carga siguiente sí
  estaban. Lo más probable es que la acción siguiera en curso en un dev lento.
- **Fuga de credencial en la salida de la automatización.** Un `TimeoutError`/`socket hang up` de `context.request.get`
  imprimió en la salida de la terminal el «call log» de Playwright, que trae las cookies de sesión del usuario QA en :3002.
  Se borraron de los archivos de salida del scratchpad y se eliminó `state-admin.json`. El token es un JWT de Auth.js que
  sigue válido hasta que expire. Los scripts siguientes imprimen sólo la primera línea de cada error.

### Consola y red

- Sin `pageerror` ni respuestas ≥400 en ningún paso, ni en escritorio ni en móvil.
- `/admin/productos` repite el aviso previo de `DataTable` sobre las columnas «referencePrice» e «isActive».
- Los únicos fallos de red ocurrieron durante los reinicios del dev, junto con un aviso «[Fast Refresh] performing full
  reload» del mismo reinicio.

### COVERAGE GAP

- Esta vez no se recorrió el rol `solicitante_faena`, la hoja «Catalogar» en móvil, ni la pasada de teclado/axe.
- No se probó WebKit.
- El vínculo perdido al recargar (FF-6) se observó en escritorio; no se intentó en móvil.

### Registros `QA_` nuevos en `bodega_dev`

| Tipo | Id | Detalle |
|---|---|---|
| products (repuesto) | `fTFZDnerTWs8EpjFY8qVi` | RPT-004 QA_Aceite motor 15W40 (QA-901, QA_Lubri, ref. $9.900) |
| products (repuesto) | `LhjwWL0rQ-7V_ARO1wwMy` | RPT-005 QA_Bujía libre (QA-902), creado con «Crear y vincular» |
| purchase_requests | `ero6hzlqeaqbn-pZvw-4U` | REP-2026-0004 (OT-PAC-0006), cerrada; ítems `HTUPoNI4bgvCwsPMUWtOk`, `olDUZu2_hyRelR29KtxjR` |
| purchase_orders | `tAZeX6w1F7qkNzyxsFbhj` | OC-2026-0060, anulada (borrador sin vínculo, FF-6) |
| purchase_orders | `EzdPF1-79WLizRlb2SeED` | OC-2026-0061, cerrada |
| purchase_orders | `VJv2Jyi-hYn_x6CdlhhFF` | OC-2026-0062, anulada (prueba de reversión, RPT-001 de REP-2026-0003, que vuelve a la cola) |
| receipts | `sC-0uGFi0Ccs6oXlTAvSi` | REC-2026-0105 |
| product_supplier_price_history | `HUDhiD0YJvBeTmLJsZI45`, `bXmZYoAjJIhSVs3DzuzTN` | RPT-004 $10.500 y RPT-005 $3.800, fuente `purchase_order` |

---

## Tercera verificación (HEAD `b446a9f5f`)

Verifica los cuatro arreglos posteriores al segundo recorrido: el vínculo de «Catalogar» guardado en el servidor con su
«Desvincular» (`2f2bc0dbc`), el precio de referencia en la hoja y en el buscador (`344b768b2`), «Equipo: … · OT …» en la OC
impresa y en el PDF (`8d7ae958f`) y el N° de parte que no se parte a mitad de token (`b446a9f5f`).

**Montaje.** `next dev --webpack -p 3002` desde el worktree de la rama, con `AUTH_URL`/`NEXTAUTH_URL`/`APP_URL`/`PDF_RENDER_ORIGIN`
en :3002. La base es `bodega_dev` en `127.0.0.1:5433`, con migraciones hasta la 0386. Chromium de `@playwright/test` desde scripts
`.mjs`, escritorio 1440×900 y móvil 390×844. **Correo:** antes de emitir o aprobar se comprobó que sigue inerte. `RESEND_API_KEY`
está vacía en `.env`, `.env.local` y `.env.development.local`, y `system_settings` no tiene filas `email.resend.*`. Las capturas,
el PDF y el registro de eventos están en
`/tmp/claude-1000/-home-allopze-dev-chome-bodega/b3e310bf-dea9-47fc-89e5-565925c7f16c/scratchpad/walkthrough3/`, carpeta que no está
versionada.

**Puertas y E2E sobre `b446a9f5f`** (en un worktree desechable para el E2E): `npm run typecheck`, `npm run lint`,
`npm run test:fast` (1320 archivos, 19.888 pruebas) y `npm run test:pglite` (373 archivos, 4.862 pruebas) salieron con código 0.
El E2E de compras, repuestos y documentos impresos o en PDF pasó completo: 48 de 48. Incluye `repuestos-catalogo`,
`repuestos-servicios-oc-flow`, `repuestos-servicios-flow`, `ot-repuestos`, `servicios-costo-pendiente`, `delivery-print`, `oc-flow`,
`oc-reconciliation`, `pdf-exports`, `prevencion-inspecciones-reportes-print`, `print-mobile` y `sst-pdf`.

### PASS: verificado en el navegador

1. **El vínculo de «Catalogar» sobrevive a la recarga y se deshace con «Desvincular».** Se creó REP-2026-0005 desde la OT
   OT-PAC-0006 con dos líneas en texto libre y se aprobó sin cotización. En `/compras/nueva`:
   - «QA_Aceite motor libre» (N° QA-901): la hoja abre con «Coincide por N° de parte» y RPT-004. «Vincular este» cierra la hoja y la
     línea pasa a «Repuesto de catálogo · N° QA-901» con «Desvincular». La BD guarda `product_id = RPT-004` en el ítem de solicitud
     al instante, antes de crear ninguna OC (`c04-linea-vinculada-sin-recargar.png`).
   - Tras recargar la página la línea sigue vinculada y conserva «Desvincular» (`c05-tras-recarga-vinculada.png`).
   - «QA_Filtro de aire libre» (N° QA-903): «Crear uno nuevo» llega prellenado, y «Crear y vincular» da el toast «Repuesto RPT-007
     creado en el catálogo y vinculado a la línea». Tras recargar, las dos líneas siguen vinculadas, con dos «Desvincular»
     (`c07-crear-y-vincular.png`, `c08-tras-recarga-ambas.png`).
   - «Desvincular» en cada una: la línea vuelve a «Catalogar» y la BD deja `product_id NULL` en ambas. Tras recargar siguen
     sin vínculo (`c09-tras-desvincular.png`, `c10-desvinculadas-tras-recarga.png`).
2. **«Equipo: … · OT …» en la OC impresa y en el PDF.** En OC-2026-0061, la vista `/compras/<id>/print` y el PDF descargado
   (`200`, `application/pdf`, «OC 2026-0061.pdf», 1 página) traen, bajo cada una de las dos líneas, «Equipo: KA-54 · UD-1187 · OT
   OT-PAC-0006», y el N° de parte una sola vez (`oc-pdf-final.png`, `oc-final.pdf`). Se comprobó con el texto extraído del PDF.
3. **Precio de referencia en la hoja «Catalogar» y en el buscador.** RPT-006 (`QA_Lubricante sin compras`, referencia $7.700, nunca
   comprado) aparece en la hoja como «$7.700 · Referencia» (`c02-hoja-referencia-rpt006.png`) y en el buscador de
   `/solicitudes/nueva` como «N° QA-904 · QA_Lubri · $7.700 · Referencia» (`b01-picker-referencia-desktop.png`).
   **RPT-004 ya no muestra «Referencia»**, y es lo correcto: se compró en OC-2026-0061 y ahora muestra su último precio, «$10.500
   · Comprado 09-11-2026» (`c03-hoja-rpt004-precio.png`). La referencia sólo se usa cuando no hay compra, así que se verificó con
   un repuesto nuevo sin compras.
4. **OT «Repuestos pedidos» a 390 px.** El N° de parte y el SKU no se parten dentro de la palabra: en el DOM, cada token
   («RPT-004», «QA-901», «REP-2026-0004», «OC-2026-0061»…) ocupa un solo renglón, y la lista de tokens partidos queda vacía. El
   rótulo «RPT-004 · N° de parte QA-901» sólo cambia de renglón entre palabras (`e01-ot-repuestos-390.png`). No hay desborde
   horizontal: `scrollWidth = 390` en el documento y en el pozo.

### PRODUCT BUG

Ninguno confirmado.

### UX FINDING

- **UX-10 · La línea vinculada desde «Catalogar» repite el N° de parte en `/compras/nueva` tras recargar.** La línea
  se llama «QA_Aceite motor 15W40 · N° de Parte: QA-901» y debajo lleva la etiqueta «Repuesto de catálogo · N° QA-901». El nombre
  arrastra el atributo que escribió quien pidió (`recordedById` en `formatVariantProductName`, `nueva/page.tsx`) y la etiqueta
  agrega el N° de parte del repuesto, con dos grafías («N° de Parte» y «N°»). Sin recarga no ocurre, porque el estado del
  formulario conserva el nombre libre. La vista de impresión y la ficha de la OC ya lo evitan con `withCatalogPartNumber`
  (`c05-tras-recarga-vinculada.png`, `c08-tras-recarga-ambas.png`). Es de forma, no de datos.
- **UX-11 · Tras recargar, la línea vinculada cambia de lugar.** En `c05` la línea recién vinculada pasa por debajo de la que
  sigue libre. Es un orden por producto o nombre y no por fecha de creación. Es una observación, sin impacto en los datos.
- «Vincular este» sigue sin toast (observación del segundo recorrido); «Crear y vincular» sí lo muestra.

### AUTOMATION WARNING

- El dev de :3002 se reinició una vez por «approaching the used memory threshold», entre la comprobación de la OC impresa y la
  de la OT en móvil. La primera navegación posterior superó los 240 s de espera y falló con `ERR_INCOMPLETE_CHUNKED_ENCODING` y
  `ERR_CONNECTION_RESET`. Esos 11 eventos son del reinicio y no del producto. Se repitió el paso tras calentar el servidor.
- Al enviar el formulario de la solicitud, la compilación inicial de la ruta hizo que el script pulsara «Enviar a aprobación» antes
  que «Guardar borrador», igual que en el segundo recorrido. REP-2026-0005 quedó enviada y se aprobó después. La BD es coherente.
- No se imprimió ninguna credencial. El estado de sesión del navegador se borró al terminar.

### Consola y red

- Escritorio, en todos los pasos de las secciones 1 a 3: sin errores de consola, sin `pageerror` y sin respuestas ≥ 400. El log del
  servidor de desarrollo no registra errores.
- Móvil: sólo los fallos del reinicio descrito arriba.

### COVERAGE GAP

- No se ejecutó WebKit/Safari. No se hizo pasada de teclado ni axe en la hoja «Catalogar».
- No se recorrió «Catalogar» en móvil; el móvil se limitó a la OT.
- No se creó una OC con las líneas vinculadas desde la hoja; esa parte la cubren el E2E `repuestos-catalogo` y
  `spare-part-item-link-pglite.test.ts`.
- El PDF se verificó por su texto extraído y por la vista de impresión, no por una imagen del PDF.

### Registros `QA_` nuevos en `bodega_dev`

| Tipo | Id | Detalle |
|---|---|---|
| products (repuesto) | `73RDsxmDH94yMta-Irhbf` | RPT-006 QA_Lubricante sin compras (QA-904, QA_Lubri, ref. $7.700) |
| products (repuesto) | `uKXT5Y5ONbpE_KOc3LDRd` | RPT-007 QA_Filtro de aire libre (QA-903), creado con «Crear y vincular»; sin vínculo tras «Desvincular» |
| purchase_requests | `7G1F0w_e9_A7zyPtHHNLp` | REP-2026-0005 (OT-PAC-0006), aprobada, a la espera de OC; ítems `E2goB0ecub43lpXG426mC` (QA_Aceite motor libre) y `ESrZoeN20r2hyZOBiL5LH` (QA_Filtro de aire libre), ambos sin `product_id` |

Además, `audit_log` (append-only) y los eventos y decisiones de la solicitud.
