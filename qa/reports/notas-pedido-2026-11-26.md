# Notas de pedido y repuestos con stock — verificación, 2026-11-26

El mecánico pide repuestos para su OT desde la app, con una **nota de pedido** (`NP-AAAA-NNNN`). Jefatura resuelve cada
línea de tres formas: sacándola de la bodega de la faena, comprándola (solicitud de repuestos precargada) o rechazándola.

Lo que cambia en el stock:
- El repuesto que llega a la faena **entra al stock** y queda **reservado** para su OT.
- El registro del mecánico lo **descuenta** (`egreso_mantencion`).
- Anular el registro lo repone, y cerrar la OT libera lo que no se usó.

Esto revierte el «consumo directo» del 2026-11-09. Las decisiones están en
[docs/mantencion/adr/0001-repuestos-con-stock-y-notas-de-pedido.md](../../docs/mantencion/adr/0001-repuestos-con-stock-y-notas-de-pedido.md).

Árbol probado: rama `feat/notas-pedido`, worktree `bodega-wt/notas-pedido`, con base en `main` `f08c4ed8a`.

## Qué cambió

- **Migración 0403**, aditiva:
  - tablas nuevas: notas de pedido, sus líneas, reservas por OT y los orígenes de cada reserva;
  - columnas nuevas: `purchase_request_items.parts_note_item_id` y las columnas de stock de `mant_record_parts`;
  - `egreso_mantencion` y los eventos `parts_*` entran a los CHECK.
- **Motor de stock:**
  - un repuesto no se entrega, devuelve ni retira a un trabajador;
  - las salidas que no son consumo (desecho, traslado, anulaciones) no tocan lo reservado;
  - el ajuste sí puede, y rebaja la reserva.
- **Núcleo de reservas** (`lib/services/mantencion/parts`):
  - bloqueos en un orden global: equipo → OT → faena → stock → reservas;
  - cantidades en centésimas, porque el stock se guarda en float4;
  - el registro nunca se rechaza por falta de stock: la línea queda «pendiente de conciliar».
- **Recepción y guías:** el repuesto entra a stock y se reserva para la OT, también por la vía oficina. Al anular, sólo se
  revierte lo que esa misma recepción ingresó, de modo que las recepciones anteriores al corte no mueven stock ajeno.
- **App del mecánico:**
  - «Pedir repuestos», que funciona sin señal;
  - sección «Repuestos» en la OT;
  - chips «Disponibles para esta OT» en el trabajo.
- **Web de jefatura:**
  - bandeja `/mantencion/notas-pedido`, con la pestaña «Por conciliar»;
  - detalle con «Sacar de bodega», «Comprar» y «Rechazar»;
  - tarjeta «Repuestos» en la OT;
  - aviso de lo reservado al conformar o anular la OT;
  - conteo en el Panel.
- **Compras:** la solicitud se precarga desde la NP (`?np=`). Una OC con una línea de OT o de NP no se emite si el repuesto
  no está catalogado.
- **Bodega:**
  - el kárdex muestra «Uso en mantención» enlazado al registro y a la OT;
  - columnas «Reservado OT» y «Libre»;
  - trazabilidad hasta la NP;
  - Excel con las columnas OT, registro y repuestos.
- **Permisos** `mant:np:create`, `mant:np:view_worksite` y `mant:np:manage`. Son permisos nuevos, así que
  `ensureSystemRbac` aplica sus defaults sin `GRANT_ADDITIONS`.

## Verificación

- **PASS · puertas** (sobre el estado final):
  - `typecheck` y `lint` con exit 0;
  - `db:verify-migrations`: 404 entradas hasta la 0403, y `db:generate` dice «No schema changes»;
  - `test:fast`: **22.635 pasan, 1 falla, 277 omitidas**. La falla es `scripts/backup-env-whitelist.test.ts`, la misma que en la base (`ONWAY_CAPTCHA_*`);
  - `test:pglite`: **5.934 pasan, 1 omitida** (453 archivos).
- **PASS · E2E nueva** `e2e/notas-pedido.spec.ts`, **7/7**:
  - sobre build de producción, con base `bodega_e2e_np` y puerto 3130 propios (no se usó `bodega_e2e` ni `:3100`);
  - el mecánico pide sin señal y la NP se envía sola al volver la señal;
  - jefatura saca de la bodega eligiendo el repuesto y verifica el prellenado de «Comprar»;
  - el mecánico usa el reservado desde el chip;
  - el kárdex muestra el uso, anular el registro repone el stock y conformar la OT libera la reserva;
  - sin errores de consola en la app ni en la web.
- **PASS · E2E de las áreas tocadas**, 16 specs de recepción, guías, conteo, OC, compras, repuestos, entregas, OT y
  mantención: **72 pasan, 3 fallan, 1 omitido**.
  - `repuestos-catalogo` congelaba el consumo directo. Se actualizó al comportamiento nuevo (ingreso, reserva de la línea con OT, stock libre de la que no tiene OT) y pasa **3/3**.
  - `mantencion-1-app:166` y `mantencion-5-ot:280` son dos de los 7 rojos previos de la base por la unidad km/h (informe del 2026-11-25).
  - `crearOt` de `repuestos-catalogo` tuvo una carrera de lectura del título una vez.
- **PASS · revisión final independiente** (Opus, solo lectura), enfocada en integridad de stock y autorización:
  - sin bloqueantes;
  - 1 importante corregido con prueba: una recepción en oficina anterior al corte armaba una guía con un repuesto que nunca entró al stock de oficina;
  - 2 menores corregidos: alcance de faena al conciliar, y la reserva de REC-001 limitada a lo libre;
  - 2 menores documentados en el ADR: el ajuste no escribe evento de OT, y el choque posible entre recepción y despacho.
- **PASS · bugs que encontró la E2E, corregidos con prueba:**
  - «Sacar de bodega» quedaba deshabilitado porque el mecánico pide en texto libre. Ahora jefatura elige entre los repuestos con stock en la faena, sin preselección.
  - Al volver la señal, el refresco del catálogo se fundía con uno anterior al envío y la NP seguía «por enviar». Ahora se encadena un refresco.
  - Además, un bug del núcleo que sacó la suite de consumo: lo liberado al cerrar la OT era la reserva entera.
- **PASS · recorrido visual** en escritorio (1440) y móvil (390), sobre el mismo entorno aislado, con capturas de la bandeja, el detalle, el diálogo, la OT, el Panel y la app del mecánico. Se corrigieron tres defectos:
  - el folio de la OT pegado al código del equipo;
  - la preselección del repuesto;
  - el «0 libres» que aparecía antes de elegir.

## Límites

- **Concurrencia real:** dos registros sobre el último repuesto, o un deadlock entre recepción y despacho, no se probaron contra Postgres con dos conexiones. PGlite es de una conexión y el diseño de bloqueos se revisó en código.
- **Fuera de la E2E:** el tramo solicitud → aprobación → OC → recepción que reserva al llegar la compra; lo cubren las suites PGlite.
- **Pendiente para el mecánico:** la pregunta «¿Salió de bodega?» queda como seguimiento, porque el teléfono no tiene el stock libre de la faena. También la foto por línea de NP (D9).
- **Sin verificar:** Safari y Android reales, y lector de pantalla.
- **Antes de llevarlo a producción:**
  - inventario de arranque con jefatura, porque los repuestos que hoy están en las faenas nunca entraron a stock;
  - orden de despliegue: migración → `db:sync-rbac` → servidor → inventario → PWA.
  - La rama no está en `main` ni desplegada.
