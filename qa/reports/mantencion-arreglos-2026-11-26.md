# Mantención: arreglos de la auditoría y de encontrabilidad (2026-11-26)

Implementación, en un solo día, de lo decidido tras la auditoría de Mantención (`mantencion-auditoria-2026-11-26.md`) y el análisis de encontrabilidad (`mantencion-encontrabilidad-2026-11-26.md`). Rama `fix/mantencion-encontrabilidad` sobre `main` `290ec0387`. **Sin desplegar ni fusionar a `main`.**

## Cómo se hizo

- Ocho líneas en paralelo, cada una en su worktree y con archivos exclusivos (subagentes Sonnet), más la integración y la revisión de cada diff:
  - **A · Órdenes de trabajo:** OT4-6, OTN-6, OT4-8, OT4-9, PDF a la vista y rótulos.
  - **B · Servicios:** REG4-1, NP4-7 y NAV-13.
  - **C · Notas de pedido:** NAV-3 y UI4-11.
  - **D · App del mecánico:** «Nuevo registro» arriba y el mismo vocabulario que el PC.
  - **E · Menú y paleta:** grupos plegables en escritorio, Historial en el menú, folios en «Ir a…».
  - **F · Registros e Historial:** búsqueda por folio y desborde a 390 px.
  - **G · Equipos y Panel:** pestañas por unidad que conservan los filtros y filtro «En taller».
  - **I · Restos del plan:** REGN-4, NAV-7 y PAN4-6.
- La integración unificó lo que cruzaba líneas: «Días en taller» también en los impresos y los Excel, «Solicitar compra» en la tarjeta de compras de Flota, REG4-1 en las pestañas por unidad del Panel, el dueño de ruta de `/mantencion/ir`, la decisión D13 del ADR 0001 y DESIGN.md.

## Qué cambió para quien usa Mantención

**Datos (primero, por decisión del usuario):**
- **OT4-6:** «Editar orden» ya no borra la descripción ni los trabajos anexos al elegir el tipo de acción. Desmarcar Reparación o Mantención con contenido avisa, junto a la casilla, qué se borrará al guardar.
- **OTN-6:**
  - «Registrar ingreso» lee «8.100» como 8100, con un solo campo en la unidad del equipo;
  - muestra la última lectura y no acepta una que baje o pase la siguiente;
  - pide confirmar un salto, como la app.
- **REG4-1:**
  - si una OT se anula después de la firma, su registro firmado vuelve a contar en el Historial, el Panel (Hoy y las pestañas por unidad), la hoja de vida y el Excel;
  - mientras la OT cuente, el trabajo es la OT y el registro no se repite.
- **NP4-7:**
  - cerrar o anular una OT rechaza, en la misma transacción, las líneas pendientes de sus notas abiertas, con el motivo, y la nota sale de «Pendientes»;
  - no hay aviso al mecánico;
  - queda como D13 en el ADR 0001.

**Encontrar las cosas:**
- **Menú de escritorio:**
  - los grupos se pliegan y abre el de la pantalla actual;
  - Mantención tiene «Historial de mantenciones»;
  - «Configuración» se ve desplegada;
  - «Equipos» tiene su propio ícono y queda marcado en `/flota/<id>/mantencion`;
  - «Dispositivos» se llama «App del mecánico».
- **«Ir a…» en la barra superior:** abre la paleta. `OT-`, `MP-`, `MC-` y `NP-` llevan directo a la ficha por `/mantencion/ir`, que aplica el mismo alcance que cada ficha. Un folio ajeno da lo mismo que uno inexistente.
- **Búsqueda por folio:** Registros firmados y el Historial encuentran folio, código y patente aunque se escriban sin guiones ni espacios («mpstf0147», «ka 91»).
- **Panel:**
  - «Por kilómetros» y «Por horas»;
  - cambiar de pestaña conserva período y faena;
  - Planificación ya no muestra un período que no usaba.
- **Equipos:** filtro «En taller».
- **OT:** el PDF es un botón a la vista.
- **Observados:** dice «con respuesta» o «espera al mecánico».
- **Notas y ficha del repuesto:** enlazan al kárdex de Bodega del producto, sólo con `warehouse:view_stock`.
- **App del mecánico:** «Nuevo registro» queda en la primera pantalla.

**Un nombre por concepto:**
- «Reservar de bodega» (antes «Sacar de bodega», «apartar» y «En bodega»);
- «Solicitar compra» y «Solicitudes de compra» (antes «Pedir repuestos» y «Repuestos pedidos», en el PC);
- «Editar orden», «Corregir tipo de acción», «Editar plan de mantención»;
- «Días en taller» (pantallas, impresos y Excel);
- «Intervalo elegido a mano»;
- «Entrega estimada»;
- «Movimientos», «Datos de la orden», «Datos de la nota», «Ficha del equipo», «Exportar Excel».

El plan de texto del anexo A de encontrabilidad quedó aplicado salvo dos decisiones del dueño: «Marcas y talleres» y «Faena de imputación».

## Hallazgos

| Estado | Identificadores |
|---|---|
| Arreglados (P1) | OT4-6, OTN-6, REG4-1 |
| Arreglados (P2) | NP4-7, NAV-1, NAV-3, NAV-7 (con enlace, no con cifras en la ficha), PAN4-6, PAN4-9, PAN4-14, EQ4-4, UI4-2 |
| Arreglados (P3) | OT4-8, OT4-9, NAV-13, UI4-11, UI4-14 |
| Arreglados (previos) | REG-7 (búsqueda por folio) |
| A medias | REGN-4: la lista distingue la respuesta, pero «Marcar revisado» sigue cerrando una observación sin respuesta sin avisar |
| Sin tocar, P1 | OT-1 (previo), NP4-1 (pasa por el rechazo en Compras; sin reproducir) |
| Piden decisión | NP4-2, NP4-3, NP4-4, NP4-6; «Mis pendientes» (brief listo); «Marcas y talleres»; «Registros firmados» |

## Cambios que se notan al desplegar

- **Interruptores:**
  - en `/admin/modulos` aparece «Historial de mantenciones», que deja de depender de «Registros firmados»;
  - `/mantencion/ir` depende sólo del módulo.
- **Grupos plegados:** se pliegan también en Prevención y TI.
- **Columnas del Excel renombradas:**
  - registros: «Días en taller», «Intervalo elegido a mano», «Motivo del intervalo a mano»;
  - OT: «Días en taller».
- **Cifras:** las del Panel y del Historial suben por los registros de OT anuladas (REG4-1).
- **Notas de pedido** (aún no están en producción):
  - las líneas auto-rechazadas no reviven al reabrir la OT;
  - no hay backfill.
- **Despliegue:** sin migraciones ni `db:sync-rbac`.

## Verificación

- **Puertas sobre la rama completa:** `typecheck` y `lint` en 0. En `test:fast`, 22.825 pruebas pasan y 2 fallan; ninguna de las dos es de esta rama:
  - `scripts/backup-env-whitelist.test.ts` falla igual en `290ec0387`: las variables `ONWAY_CAPTCHA_*` no están en la lista blanca del respaldo.
  - `inspection-run-detail.test.tsx` (Prevención) falló bajo carga y pasa sola, tanto en la base como en la rama.
- **`test:pglite`:** 453 archivos, 5.952 pruebas, todas en verde.
- **Pruebas nuevas que fallan sin el arreglo:**
  - corte y REG4-1 en el Historial: 3 de 11;
  - notas de pedido al cerrar o anular la OT: 5 de 35;
  - Panel por unidad con la OT anulada: 1 de 17.
- **E2E aislada** (base desechable `bodega_e2e_mantenc`, puerto 3140, build de producción): 36 specs de Mantención, repuestos y navegación.
  - Primera corrida, con 2 workers: 257 pasan, 9 fallan y 61 no corren.
  - 7 de esas fallas son exactamente las 7 que ya fallan en la base `b848c1423`: `1-app:166`, `3a-equipos:33`, `3b-pautas:65`, `4-permisos:72`, `5-ot`, `panel-looker-cobertura:63` y `panel-looker:83`. Vienen de la unidad km/h por equipo: el fixture E2E deja los camiones en horas y sin pauta.
  - Las otras 2 vinieron de la carga, no del producto. Con 1 worker `panel-looker-export` pasa 13 de 13 (su semilla chocaba con otra spec en paralelo), y `repuestos-catalogo` pasa 3 de 3 después de esperar el título real (el h1 del esqueleto de carga no lleva folio).
  - `mantencion-5-ot` ahora pide la lectura en la unidad del equipo y pasa 8 de 8. Corren por primera vez el registro desde el PC, la recepción, la conformidad, la OT cerrada con su historial y PDF, y el alcance.
- **Navegador** (pulido sobre `bodega_e2e_auditmant`, puerto 3141; escritorio 1440×900 y teléfono 390×844):
  - Menú: los 11 ítems de Mantención se ven sin desplazar, contra 2 de 7 antes. La ficha `/flota/<id>/mantencion` marca «Equipos».
  - Panel: las pestañas llevan el período; Planificación ya no tiene período.
  - OT: el PDF está a la vista, «Más acciones» tiene 5 opciones y «Registrar ingreso» pide la lectura en horas con la última lectura.
  - Búsqueda: «mcpac0004» encuentra MC-PAC-0004.
  - «Ir a…» ofrece la OT por su folio.
  - Alcance: un mecánico de otra faena recibe «No encontramos el folio».
  - Enlaces a Bodega: los ve el jefe y no el supervisor.
  - En la app, «Nuevo registro» queda en la primera pantalla.
  - Sin desborde a 390 px y sin errores de consola ni de red.
- **Lo que no cubrió la E2E:** los flujos que están detrás de las 7 fallas previas (app del mecánico, Equipos, pestañas del Panel, pautas, permisos del catálogo). Se revisaron en el navegador. Arreglar el fixture km/h es trabajo aparte.

## Riesgos y brechas

- **Concurrencia:** el orden de bloqueo OT → notas → líneas está razonado y no ejercitado; PGlite tiene una sola conexión.
- **`/mantencion/ir`:** probado con un doble de la base y en el navegador; sin prueba contra Postgres.
- **Enlace a Bodega:** lleva al kárdex del producto, porque la vista Stock no filtra por id. Las cifras de existencia, reservado y libre dentro de la ficha quedan para otra vez.
- A 1440×900, los hijos de «Configuración» quedan al borde del pie fijo del menú: «Pautas» se ve y los otros dos piden desplazar un poco.
