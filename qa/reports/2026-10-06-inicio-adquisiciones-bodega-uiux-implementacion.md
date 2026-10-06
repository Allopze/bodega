# Implementación UI/UX de Inicio, Adquisiciones y Bodega — 6 de octubre de 2026

Implementa la auditoría [2026-10-05-inicio-adquisiciones-bodega-uiux-audit.md](2026-10-05-inicio-adquisiciones-bodega-uiux-audit.md): los 7 P1, los P2/P3 de las áreas tocadas y las decisiones de los dos `shape` (Inicio; Adquisiciones + Bodega).

- **Rama:** `fix/inicio-adq-bodega-uiux`, base `f66edb82`, sin commits todavía.
- **Diff:** 233 archivos, +9.066 / −3.357 líneas.

**Este informe es evidencia de verificación técnica.** No mide comprensión con usuarios reales. La sesión QA es de administrador global: no recorre roles con alcance de faena acotado.

## Decisiones de producto tomadas en la sesión

| Tema | Decisión |
|---|---|
| Inicio | "Hoy" arriba (alertas + 5 pendientes más urgentes + un enlace a `/pendientes`), panorama abajo. Las 7 vistas por área se quedan en Inicio, con los nombres del sidebar. La pestaña "Mi trabajo" desaparece: `/pendientes` es la única cola. |
| Responsables | Sin responsables genéricos. Se retiran de Inicio la alerta y el chip "sin responsable". De `/pendientes` se retiran los chips "Sin responsable" y "Asignadas a mí" y la etiqueta "Asignada a …". Los responsables propios del dominio (MIPER, CAPA, tickets TI) no se tocan. |
| Listas de Adquisiciones | Columna "Etapa + qué falta", con stepper compacto y texto impersonal, sin personas ni roles. Solicitudes con pestañas por etapa. |
| Badges | Corrigen el mapeo de estado → variante en `state-badge.tsx`; no tocan `Badge`. |
| Devolución a stock | Se retira de la hoja de Bodega. Exigía entregas "a faena", y el código solo crea entregas a trabajador. |
| Trazabilidad | Pasa a Adquisiciones como "Seguimiento de solicitudes" (`/seguimiento`), abre en "Todas las faenas" y las rutas viejas redirigen. |
| Confirmaciones (2026-10-06) | Sin diálogo de confirmación al emitir una OC ni al aprobar en lote, y sin avisos de que "Chome no envía la OC". Se retiró `issue-order-dialog.tsx` y volvió el botón directo en cada fila de borrador. Re-verificado con typecheck, lint, 157 pruebas unitarias, 31/31 E2E de los flujos de OC y aprobación, y navegador. |

## Resultado

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Pasa, en worktree limpio. En el checkout principal muere por OOM porque el `tsconfig` incluye `.next/types` (ver Riesgos). Hubo 4 errores reales, corregidos. |
| `npm run lint` | Pasa. Hubo 1 error (`react-hooks/refs` en `movement-sheet.tsx`) y 1 warning, corregidos. |
| `npm run test:fast` | 911 archivos / 11.553 pruebas pasan en la corrida final, hecha después de todas las correcciones. |
| `npm run test:pglite` | 253 archivos / 3.027 pruebas pasan (1 omitida), incluida la suite nueva `epp-pending-delivery`. |
| `npm run test:e2e` completa | 812 pasan y 12 fallan; detalle abajo. |
| E2E de re-verificación | 78/78 y 116/116 pasan: las 12 que fallaron, las de Compras y Recepción afectadas por los filtros, más Inicio, Entregas, Seguimiento, teclado, zoom 200 % y reflow. |
| `db:verify-migrations` | Pasa (351 entradas). No hay migraciones nuevas. |
| `check:secrets` | Pasa. |
| `check:security-audit` | **Falla por un hallazgo ajeno al cambio:** `source-map-js` (GHSA-68fv-2mgg-jv7q), que llega por Tailwind y PostCSS. `package.json` y `package-lock.json` no cambian en esta rama; también falla en `main`. |
| Detector Impeccable (CLI) | 0 hallazgos en las carpetas tocadas. El `side-tab` de `entity-timeline.tsx` se corrigió. |
| Navegador (`next dev` :3001) | 36 combinaciones de ruta × tamaño (1440 y 390): 0 errores de consola, 0 requests fallidos, sin desborde, **axe 0 violaciones** tras corregir `/seguimiento` en móvil. |

### Las 12 fallas de la E2E completa y su causa

| Spec | Causa | Clase |
|---|---|---|
| `bodega-conteo-fisico` (menú de fila) | El menú de fila se abría vacío sin registro de stock ni permiso de entrega. | **PRODUCT BUG**, corregido: sin acciones no se ofrece el menú. |
| `bodega-conteo-fisico` (ajuste, conteo, baja) | Documentos ahora abre en la faena propia (BOD-06) y la spec registraba en otra faena. | Spec desactualizada: va a `?faena=todas`. |
| `flujo-cuatro-modulos` ×3 | La primera corrección quitó los filtros a la cola "Por comprar", y una solicitud ya no se podía encontrar entre decenas. | **PRODUCT BUG (regresión de la ola 2)**, corregido: los filtros suben al nivel de página y filtran las dos secciones a la vista. |
| `correlativos-secciones` | La columna "Cotejada" pasó a llamarse "Recibida". El helper tomaba ese texto como señal de que la guía estaba confirmada y navegaba antes de que el servidor confirmara. | **AUTOMATION WARNING**: el helper y 3 specs ahora esperan a que desaparezca la acción. |
| `operational-work-queue` ×2 | El `h2` cambió de nombre, y además `h1` y `h2` decían igual "Mis pendientes". | Encabezados duplicados corregidos (`h2` "Lista de pendientes") y spec actualizada. |
| `pdtp-asignacion-nominal` | Exigía la etiqueta "Asignada a …", retirada por decisión de producto. | Spec actualizada: sigue probando el alcance (la ve el asignado y no el otro jefe). |
| `shell-landmarks` | Inicio ya no muestra el buscador de la shell (TRV-04). | Spec actualizada: usa `/ti/activos`. |

## Estado por hallazgo

| ID | Estado | Qué se hizo |
|---|---|---|
| BOD-01 | Resuelto | Búsqueda de servidor en `/entregas` por trabajador, RUT, código y producto. La ruta está en `ROUTES_WITH_OWN_SEARCH` y la tabla usa `disableInternalSearch`. El orden por columna, que solo ordenaba las 25 filas visibles, se desactivó. |
| INI-01 | Resuelto | Hay una sola definición de "OC emitidas" (`issuedAt` no nulo, estados emitidos, sin eliminadas) y de "Gasto en OC", servida por `getOperationalPeriodMetrics`. "Inversión emitida" deja de existir. `analyticsFilters` ya no suma el primer día del período siguiente. |
| INI-02 a INI-04 | Resuelto | Fecha real en el saludo, montos con `formatCLP` y plurales con `pluralize`. |
| INI-05 | Resuelto | El selector de período aparece solo en las vistas que responden. En las demás dice "Estado al día de hoy". |
| INI-06, INI-07, INI-08 | Resuelto | Bloque "Hoy" primero, sin tile hero ni cifras repetidas. La acción primaria es calculada (por ejemplo "Ver 215 vencidas"). `?vista=trabajo` redirige a `/pendientes`. "Mis pendientes" es el único nombre de la cola. |
| INI-09 | Resuelto | Las áreas llevan los nombres del sidebar (Control operacional, Prevención en terreno, Documentación y capacitación…). El disparador dice "Por área: X", con `aria-current` y una descripción por ítem. |
| TRV-01 | Resuelto | Compras muestra badge (cola "Por comprar" + OC en borrador). Recepción muestra badge. El badge de Bodega pasó a "Guías de despacho" (guías despachadas sin confirmar). |
| TRV-02 | Parcial (decisión) | Cerrar un conteo muestra antes el resumen de ajustes. El ajuste pide la cantidad real y muestra "4 → X"; el servidor recalcula el delta. **"Emitir OC" y aprobar en lote siguen siendo un clic, sin confirmación:** el usuario descartó los diálogos el 2026-10-06. |
| TRV-03 | Resuelto | Mapeo por principio: `signal` = alguien debe actuar; tono tranquilo para los estados cerrados. El vocabulario canónico está documentado en `state-badge.tsx`. |
| TRV-04 | Resuelto | Sin buscador de la shell en `/dashboard`. |
| ADQ-01 | Resuelto | El botón dice "Emitir OC" (antes "Emitir y enviar", que no enviaba nada). El banner dice "OC emitida; pasa a Recepción" y enlaza al PDF, sin afirmar un envío. La constancia de envío sigue siendo opcional en el detalle, ahora con `Field`. |
| ADQ-02 a ADQ-04, ADQ-07, ADQ-08 | Resuelto | "1 ítem", la guía real en el detalle REC, el siguiente paso considera la guía activa, "OC por emitir" y el stepper de una solicitud cerrada. |
| ADQ-05 | Resuelto | Sección "Por elegir cotización" (Repuestos y Servicios) en `/aprobaciones`. El estado vacío solo aparece cuando no queda nada. |
| ADQ-09 | Resuelto | Columna "Etapa + qué falta" en Solicitudes y Recepción, pestañas por etapa y estado vacío de Compras para OC emitidas. Los filtros de Compras quedan a nivel de página. |
| ADQ-10, ADQ-11 | Resuelto | Un solo vocabulario: "Por atender", "Pendiente de recepción" y "Confirmar llegada a faena". |
| BOD-02 | Resuelto (decisión) | Devolución retirada de la hoja; las devoluciones históricas siguen legibles. |
| BOD-03 | Resuelto | Franja de atención en `/bodega` con guías por confirmar (y su antigüedad), EPP por entregar, productos sin stock con demanda y conteos en borrador. |
| BOD-04 | Resuelto | Ajuste por cantidad real, con transacción y bloqueo de la fila de stock. |
| BOD-05 | Resuelto | Hoja de movimientos ordenada por trabajo y heredando la faena, menú por fila, pestañas Stock / Movimientos / Documentos, Guías abre en "Por confirmar" y Trazabilidad pasa a `/seguimiento`. |
| BOD-06 | Resuelto | Misma faena por defecto en Stock, Movimientos, Documentos y Guías. |
| Detector | Resuelto | Texto de 10 y 11 px en Inicio, `transition-all`, SVG de recharts sin nombre, tarjetas anidadas en móvil y borde lateral en la línea de tiempo. |

### Defectos encontrados en la verificación de navegador y corregidos

1. **`/entregas?nueva=1` abría dos hojas superpuestas, y Esc cerraba solo una.** `PageHeader` monta `actions` dos veces. Ahora se abre solo la copia visible.
2. **`/seguimiento` en móvil tenía `dl` mal formadas** (axe `definition-list` y `dlitem`), un defecto previo que llegó con la página al moverla. La grilla pasa al propio `<dl>`.
3. **"Hoy" anidaba tarjetas dentro de una tarjeta.** Queda como banda sin chrome.
4. **"Recepción · Pendiente de recepción: falta…" repetía la etapa y quedaba cortado.** Ahora dice "Falta que lleguen los ítems del proveedor.".
5. **`/compras` renderizaba, desde el servidor, un `React.memo` exportado por un módulo de cliente** (`ServerListFilters`, al subir los filtros). Lo detectó `client-memo-boundary`. Se corrigió en el componente compartido: ahora exporta una función que envuelve el `memo`, y eso cubre a todas las páginas.

## Riesgos y pendientes

- **Toggles de módulo:** los toggles guardados como `/bodega/trazabilidad` y `/bodega/documentos` quedan huérfanos. Si un administrador había apagado Trazabilidad, tiene que volver a apagar "Seguimiento de solicitudes".
- **`/seguimiento` en "Todas las faenas"** corre el pipeline por faena, de 4 en 4. No está medido con volumen de producción.
- **`/pendientes` sin "Asignadas a mí":** el "responsable" de la cola era el dueño propio de CAPA, inspección, PDTP o MIPER, no un sistema genérico. Sin el chip, nadie puede filtrar "mis acciones" en la cola. Hay que confirmarlo con el producto.
- **Código sin interfaz:**
  - los casos `unassigned`/`mine` y la plomería de `assignee` en `operational-work-queue.ts`;
  - `returnStockAction` en `bodega/actions.ts`;
  - `hero-kpi-card.tsx`.
- **"Guías por confirmar" en la franja de Bodega** cuenta todo el alcance salvo que se elija una faena a mano. Las guías nunca van a la oficina, así que con la faena por defecto contarían siempre 0.
- **Excel de Solicitudes por pestaña de etapa:** la lista de estados es aproximada para "En compra" y "En recepción".
- **No resuelto en esta ronda:** el detalle de solicitud sigue siendo un formulario deshabilitado (P2).
- **No verificado:**
  - vistas de roles con permisos acotados;
  - lector de pantalla real;
  - red lenta real;
  - volúmenes de producción;
  - la E2E completa no se repitió de punta a punta después de las correcciones; se cubrió con las dos re-corridas dirigidas.
- **Typecheck en el checkout principal:** muere por OOM mientras el `next dev` mantiene un `.next` grande dentro del alcance del `tsconfig`. Hay que verificar en un worktree limpio y borrar su `.next` antes de tipar.
