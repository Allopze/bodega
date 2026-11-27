# Mantención: arreglos de la auditoría y de encontrabilidad (2026-11-26)

Implementación, en un solo día, de lo decidido tras la auditoría de Mantención (`mantencion-auditoria-2026-11-26.md`) y el análisis de encontrabilidad (`mantencion-encontrabilidad-2026-11-26.md`). Rama `fix/mantencion-encontrabilidad` sobre `main` `290ec0387`, con `main` `e3d6c006f` ya integrado. **Sin desplegar ni fusionar a `main`.**

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

**Pulido final (`/impeccable polish`, una ronda de capturas, una de arreglos y una de confirmación):**
- **Anillo de foco:** la regla global `:focus-visible` de `app/globals.css` no tiene capa, y las utilidades de Tailwind (`@layer utilities`) no le ganan: `outline-none` y `focus-visible:outline-offset-[-2px]` no tenían efecto. Con la clase `.focus-ring-inset`, también sin capa, el anillo queda por dentro en la paleta de «Ir a…», en los rótulos de grupo del menú y en los segmentados con desplazamiento del Historial. Antes se recortaba contra el borde.
- **Notas de pedido:** la etapa de una línea habla del repuesto, como la app del mecánico: «Rechazado» y «Reservado por…», junto a «Pedido» y «Reservado».
- **Observados:** «con respuesta» (le toca a jefatura) va en señal; «espera al mecánico», sin señal.

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
- **Despliegue:** la rama no trae migraciones ni pide `db:sync-rbac`. Ya integra `main` `e3d6c006f` (merge `46c285efe`), que trae la migración 0404 de las pautas cíclicas: ésa es de `main`, no de estos arreglos.

## Verificación

- **Puertas finales**, sobre la rama con `main` integrado (`46c285efe`):
  - `typecheck` y `lint` en 0;
  - `test:fast`: 22.835 pruebas, todas en verde;
  - `test:pglite`: 454 archivos y 5.959 pruebas, todas en verde;
  - `db:verify-migrations`: 405 entradas hasta la 0404.
- **Fallas de corridas anteriores, ajenas a la rama (en la final pasan):**
  - `scripts/backup-env-whitelist.test.ts` ya fallaba en `290ec0387` y lo arregló `main` `e3d6c006f`;
  - `inspection-run-detail.test.tsx` (Prevención) falló una vez bajo carga y pasa sola.
- **Pruebas nuevas que fallan sin el arreglo:**
  - corte y REG4-1 en el Historial: 3 de 11;
  - notas de pedido al cerrar o anular la OT: 5 de 35;
  - Panel por unidad con la OT anulada: 1 de 17.
- **E2E aislada** (base desechable `bodega_e2e_mantenc`, puerto 3140, build de producción): 36 specs de Mantención, repuestos y navegación.
  - Primera corrida, con 2 workers: 257 pasan, 9 fallan y 61 no corren.
  - 7 de esas fallas son exactamente las 7 que ya fallan en la base `b848c1423`: `1-app:166`, `3a-equipos:33`, `3b-pautas:65`, `4-permisos:72`, `5-ot`, `panel-looker-cobertura:63` y `panel-looker:83`. Vienen de la unidad km/h por equipo: el fixture E2E deja los camiones en horas y sin pauta.
  - Las otras 2 vinieron de la carga, no del producto. Con 1 worker `panel-looker-export` pasa 13 de 13 (su semilla chocaba con otra spec en paralelo), y `repuestos-catalogo` pasa 3 de 3 después de esperar el título real (el h1 del esqueleto de carga no lleva folio).
  - `mantencion-5-ot` ahora pide la lectura en la unidad del equipo y pasa 8 de 8. Corren por primera vez el registro desde el PC, la recepción, la conformidad, la OT cerrada con su historial y PDF, y el alcance.
  - **Corrida final** (build nuevo con el pulido, 2 workers):
    - 242 pasan y 10 fallan.
    - 6 fallas son las de la base (km/h).
    - 4 son de la carga:
      - `5-ot` «a» y `notas-pedido` «1» leían el h1 del esqueleto de carga (ya esperan el folio);
      - `mantencion-historial` «Exportar Excel» encontró la semilla de Looker reiniciada por otra spec en paralelo;
      - `panel-looker-export`, por la misma semilla.
    - Con 1 worker, esas cuatro specs pasan 32 de 32: `5-ot` 8, `notas-pedido` 7, `mantencion-historial` y `panel-looker-export`. Incluye la conformidad que libera la reserva y rechaza las líneas pendientes, contra Postgres.
- **Navegador** (pulido sobre `bodega_e2e_auditmant`, puerto 3141; escritorio 1440×900 y teléfono 390×844):
  - Menú: a 1440×900 se ven 8 de los 11 destinos de Mantención sin desplazar el menú, contra 2 de 7 antes. «Marcas y talleres», «App del mecánico» y «Catálogo de repuestos» quedan al borde del pie fijo. La ficha `/flota/<id>/mantencion` marca «Equipos».
  - Panel: las pestañas llevan el período; Planificación ya no tiene período.
  - OT: el PDF está a la vista, «Más acciones» tiene 5 opciones y «Registrar ingreso» pide la lectura en horas con la última lectura.
  - Búsqueda: «mcpac0004» encuentra MC-PAC-0004.
  - «Ir a…» ofrece la OT por su folio.
  - Alcance: un mecánico de otra faena recibe «No encontramos el folio».
  - Enlaces a Bodega: los ve el jefe y no el supervisor.
  - En la app, «Nuevo registro» queda en la primera pantalla (entre 322 y 510 px de 844).
  - Ronda de confirmación del pulido:
    - el foco queda por dentro (`outline-offset: -2px`) en la paleta, en un rótulo del menú y en un segmentado a 390 px;
    - «Editar orden» sobre una OT con descripción y 3 mantenciones avisa «Al guardar se borra la descripción.» y «Al guardar se borran 3 mantenciones solicitadas.»;
    - la nota dice «Rechazado» y «Reservado por»;
    - en Observados, «con respuesta» va en naranja y «espera al mecánico» en gris.
  - Sin desborde a 390 px y sin errores de consola ni de red.
- **Lo que no cubrió la E2E:** los flujos que están detrás de las 7 fallas previas (app del mecánico, Equipos, pestañas del Panel, pautas, permisos del catálogo). Se revisaron en el navegador. Arreglar el fixture km/h es trabajo aparte.

## Riesgos y brechas

- **Concurrencia:** el orden de bloqueo OT → notas → líneas está razonado y no ejercitado; PGlite tiene una sola conexión.
- **`/mantencion/ir`:** probado con un doble de la base y en el navegador; sin prueba contra Postgres.
- **Enlace a Bodega:** lleva al kárdex del producto, porque la vista Stock no filtra por id. Las cifras de existencia, reservado y libre dentro de la ficha quedan para otra vez.
- A 1440×900, los hijos de «Configuración» quedan al borde del pie fijo del menú: «Pautas» se ve y los otros dos piden desplazar un poco.
- **Anillo de foco en el resto de la plataforma:** la causa de fondo sigue: `:focus-visible` sin capa le gana a cualquier utilidad de Tailwind. Otros controles que intentan ajustar su anillo con utilidades, como la campana de avisos, siguen igual. El arreglo de fondo es mover esa regla a `@layer base`, revisando antes cada `outline-none` que no traiga su propio anillo; si no, alguno quedaría sin foco visible.

## Segunda tanda (26-11, decisiones del usuario sobre lo pendiente)

Tres líneas más (Sonnet), integradas en la misma rama.

- **«Mis pendientes» por responsable**, según `docs/mantencion/brief-mis-pendientes.md`, con las opciones recomendadas.
  - **Filas:** 7 tipos (OT por asignar, por recibir y por conformidad, mis OT por ingresar y en taller, notas por resolver y registros por revisar por faena), con el reparto «el más cercano a la faena» (`local_first` o `global_first`). El administrador sólo recibe lo huérfano.
  - **Avisos** en Órdenes de trabajo, Registros firmados y Notas de pedido. Salen del mismo cálculo que la cola.
  - **Permisos nuevos por defecto** (`GRANT_ADDITIONS`, se aplican en el deploy o con `db:sync-rbac`):
    - `mant:records:review` al supervisor;
    - `operations:view_work` al mecánico y al supervisor.
  - **Nadie revisa lo que firmó o ejecutó:** el servidor lo rechaza y la ficha no ofrece el botón.
- **Notas de pedido (D14 a D18 del ADR 0001):**
  - NP4-1: una compra rechazada en aprobaciones devuelve la línea;
  - NP4-2: «por resolver» es toda nota con alguna línea pendiente, y una nota con compras por llegar sigue en gestión;
  - NP4-3: el saldo de una reserva parcial queda como línea nueva;
  - NP4-4 y NP4-6: liberar devuelve las líneas y la nota se puede anular.
- **OT-1:** anular una OT nacida de un hallazgo cancela su CAPA abierta y el hallazgo vuelve a quedar abierto.
- **Fixture E2E:** la faena Biodiversa nace con su código real, así que sus camiones miden en km. El resto mide en horas con la pauta «Maquinaria pesada». Vuelven a correr los 6 specs rojos y las 75 pruebas que había detrás.
- **Renombre:** «Marcas y talleres» pasa a «Catálogos de mantención».

**Verificación:**
- **Puertas:** `typecheck` y `lint` en 0, y `db:verify-migrations` OK.
- **`test:pglite`:** 456 archivos, 6.030 pruebas en verde.
- **`test:fast`:** 22.873 pasan y 1 falla, intermitente bajo carga: `oc-catalog-sheet.test.tsx`, de Compras, pasa sola y la rama no la toca.
- **Regresiones nuevas que fallan sin el arreglo:**
  - `np-reglas-pglite`: 15 de 16;
  - la cola de Mantención: 42 pruebas, incluida la propiedad «toda fila es accionable».
- **E2E final** (build nuevo, 1 worker, 34 specs): 300 pasan y 1 se salta, porque espera el corte del 01-12.
  - La única falla fue la regla nueva funcionando: el spec intentaba que la jefatura revisara un registro propio. Lo ajusté y ahora pasa 13 de 13.
  - Cero specs rojos.

**Al desplegar:**
- correr `db:sync-rbac`, que el deploy ya corre, para los tres permisos nuevos;
- ninguna migración;
- revisar el interruptor «Historial de mantenciones».

**Riesgos:**
- Cancelar una CAPA por OT-1 no avisa a Prevención.
- Anular una recepción o guía, el cotejo o un ajuste no recalculan la nota (descrito en el ADR).
- Un camión nuevo fuera de Biodiversa nace en horas y sin pauta.
- No hay `EXPLAIN` de la cola en `bodega_dev`.
