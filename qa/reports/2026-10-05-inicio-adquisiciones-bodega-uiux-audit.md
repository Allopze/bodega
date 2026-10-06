# Auditoría UI/UX de Inicio, Adquisiciones y Bodega — 5 de octubre de 2026

**Alcance:**

- **Inicio:** `/dashboard`, con sus 9 vistas (`?vista=` trabajo, finanzas, adquisiciones, bodega, prevencion, flota, terreno y gobernanza).
- **Adquisiciones:**
  - listas `/solicitudes`, `/aprobaciones`, `/compras` (incluye `?factura=pendiente` y `/compras/dte`) y `/recepcion`;
  - 5 detalles de solicitud, 6 de OC y 2 de recepción;
  - los formularios `/solicitudes/nueva`, `/compras/nueva` (en blanco y desde una solicitud) y `/recepcion/nueva`.
- **Bodega:**
  - `/bodega` (Stock y Kardex), `/bodega/documentos`, `/bodega/trazabilidad` (3 pestañas), `/bodega/guias` y un detalle de guía, y `/entregas`;
  - la hoja "Registrar movimiento" en sus 4 modos, el formulario de entrega y los diálogos de anular y exportar (solo abiertos).

**Método:** Impeccable `critique`, con cuatro evaluaciones aisladas que no vieron el trabajo de las otras:

- **A-Inicio, A-Adquisiciones y A-Bodega:** revisión de diseño, heurísticas de Nielsen, carga cognitiva y personas.
- **B:** detector determinista (CLI sobre 174 archivos y `detect.js` inyectado en 36 combinaciones de ruta y tamaño), axe-core, consola, red y mediciones de layout.

La síntesis y la verificación en código de los hallazgos P1 son de la sesión principal.

**Entorno:**

- `next dev` en :3001 contra `bodega_dev`, con Chromium headless de `@playwright/test` y la sesión QA (rol administrador global).
- Vistas a 1440×900 y 390×844.
- **Solo lectura:** no se envió ningún formulario. A-Adquisiciones bloqueó por ruta los POST de server actions.
- Los tiempos medidos son de modo dev, **no de producción**.

Leyenda de evidencia: **[V]** verificado en navegador · **[C]** verificado en código · **[D]** detector determinista.

## Resultado

| Área | Heurísticas de Nielsen | Banda |
|---|---|---|
| Inicio | **20/40** | Aceptable (límite con Pobre) |
| Adquisiciones | **23/40** | Aceptable |
| Bodega | **21/40** | Aceptable |
| **Combinado** | **64/120 (53 %)** | Aceptable |

| Medición | Resultado |
|---|---|
| axe-core (wcag2a, wcag2aa, wcag21aa) | **0 violaciones** en 36/36 combinaciones de ruta y tamaño |
| Errores de consola y requests fallidos | **0 / 0** (sin contar `api.dicebear.com`, ruido del sandbox) |
| Desborde horizontal | Ninguno en 390 ni en 1440 |
| Detector CLI | **0 hallazgos** en `app/(app)/{dashboard,solicitudes,aprobaciones,compras,recepcion,bodega,entregas}` |
| Detector en navegador | 419 en bruto → ~80 verdaderos positivos con ~10 causas, todas P3 de acabado |
| Hallazgos priorizados | P0: 0 · P1: 7 · P2: ~20 · P3: ~15 |

**Veredicto:** no hay un problema de calidad visual ni de accesibilidad automática. El problema es de **arquitectura de información y semántica de estado**:

- las pantallas se organizan por entidad o por estado interno del módulo, no por la pregunta del usuario ("¿qué me toca, en qué etapa va, quién lo tiene?");
- el tablero contradice sus propias cifras;
- el peso visual de los estados va al revés de la acción esperada.

Eso explica el síntoma reportado: "parece funcionar bien, pero es poco intuitivo".

### Heurísticas de Nielsen por área

| # | Heurística | Inicio | Adq. | Bodega | Hallazgo clave |
|---|---|---|---|---|---|
| 1 | Visibilidad del estado | 2 | 2 | 2 | La etapa y el responsable solo aparecen en el detalle. Lo pendiente se ve más débil que lo cerrado. |
| 2 | Lenguaje del mundo real | 2 | 2 | 2 | Siglas sin expandir. "Emitir y enviar" no envía nada. "Trazabilidad" muestra compras. |
| 3 | Control y libertad | 3 | 2 | 3 | El alcance vive en la URL y "atrás" funciona. Los actos irreversibles se hacen con un clic. |
| 4 | Consistencia | 1 | 2 | 2 | Mismo rótulo con cifras distintas. 7 nombres para "esperando proveedor". La faena por defecto cambia según la pantalla. |
| 5 | Prevención de errores | 3 | 2 | 2 | Sin confirmación al aprobar en lote, emitir una OC ni cerrar un conteo. El ajuste no muestra el saldo resultante. |
| 6 | Reconocer antes que recordar | 2 | 2 | 2 | La OC emitida "se muda" a Recepción. La hoja de movimientos no hereda la faena. |
| 7 | Flexibilidad y eficiencia | 2 | 3 | 1 | Bodega: 6–7 interacciones por movimiento, hoja que se cierra tras cada uno, sin acciones por fila. |
| 8 | Estética y minimalismo | 2 | 2 | 2 | Hero "Inversión $0". Detalle de solicitud de 7.837 px en móvil. Trazabilidad abre con 7 ceros. |
| 9 | Recuperación de errores | 2 | 3 | 3 | Búsquedas que responden "sin resultados" cuando el registro existe. |
| 10 | Ayuda y documentación | 1 | 3 | 2 | Inicio no expande ninguna sigla; `KpiCard.glossary` existe y no se usa. |

---

## PRODUCT BUG — comportamiento incorrecto confirmado

| ID | Hallazgo | Evidencia |
|---|---|---|
| BOD-01 | **La búsqueda de `/entregas` devuelve "Sin entregas" para entregas que existen.** El input de la shell filtra solo las 25 filas de la página actual del historial paginado: "Eduardo" (página 3) da "No hay entregas que coincidan" con el pie "1 - 25 de 58". El orden por columna también es solo de la página. Incumple "Search architecture" de AGENTS.md. | [V] `entregas/deliveries-table.tsx:48-52` (sin `disableInternalSearch`); `/entregas` no está en `ROUTES_WITH_OWN_SEARCH` (`components/layout/top-bar.tsx:33`) |
| INI-01 | **Una misma etiqueta muestra cifras distintas entre vistas del tablero.** Con período Mes: Resumen "OC emitidas 0", Adquisiciones "2", Finanzas "2 OC emitidas". Con período Año: 28 contra 29, e "Inversión $4.276.923" contra "Gasto en OC $3.105.487". Resumen cuenta por `issuedAt`; Adquisiciones rotula "OC emitidas" lo que su propio detalle llama "Órdenes creadas". | [V] capturas de las tres vistas; [C] `dashboard/sections/acquisitions-section.tsx:57-58`, `views/resumen-view.tsx:340`, `lib/services/operational-period-metrics.ts:75-77`, `sections/finance-section.tsx:161-162` |
| ADQ-01 | **El banner del detalle de OC afirma "Orden emitida y enviada al proveedor."** La plataforma no despacha nada (lo documenta la propia acción) y la constancia de envío es opcional. | [C] `compras/[id]/page.tsx:587`; `compras/actions/order-status.ts:80-90` |
| INI-02 | **El saludo de Inicio termina en "—" en vez de la fecha.** `formatDateLong()` se llama sin argumento y devuelve `VALUE_MISSING`. El `h1` sr-only también se anuncia como "—". | [V][C] `dashboard/page.tsx:169`, `lib/utils.ts:315-316` |
| INI-03 | **La variación de dinero sale sin formato:** "Inversión emitida: $0 · -472526 vs. mes anterior". | [V][C] `dashboard/views/resumen-view.tsx:321-327` (`periodComparison` sin `formatCLP`) |
| INI-04 | **Plurales fijos:** "1 tareas críticas", "1 ítems esperan aprobación". | [V][C] `dashboard/views/resumen-view.tsx:524,529` |
| TRV-01 | **Badges del sidebar desalineados.** El ítem Bodega declara `badge: "count"` pero el layout nunca calcula `/bodega`, así que siempre vale 0. Compras y Recepción tienen el conteo calculado, pero sus manifests no declaran `badge`, así que no se muestra. | [C] `modules/warehouse/manifest.ts:43`, `app/(app)/layout.tsx:142-148`, `modules/{purchasing,receiving}/manifest.ts` |
| ADQ-02 | "1ÍTEM" sin espacio en la columna de pendientes de Recepción (desktop; móvil ya está corregido). | [V][C] `recepcion/recepcion-table.tsx:157` |
| ADQ-03 | **El detalle de la recepción contradice su guía.** Dice "Guía: Sin guía" junto a GDI-000019. | [V] `recepcion-detalle-1.png`; [C] `recepcion/[id]/page.tsx:324` |
| ADQ-04 | **"Siguiente paso" desactualizado.** Dice "Despacha los ítems a faena" cuando la GDI ya salió y el CTA pide cotejar. | [V] `oc-oficina-0022.png`; [C] `lib/work-queue-builders.ts:136,147` |

## FUNCTIONAL FINDING — requiere investigar o decidir

| ID | Hallazgo | Evidencia |
|---|---|---|
| BOD-02 | **"Devolución a stock" no puede ofrecer nada con el código actual.** Exige entregas con `destinationType = 'faena'`, y el único creador de entregas escribe `'worker'`. En dev, las 58 entregas son a trabajador y hay 0 devoluciones posibles en las 7 faenas (GET de solo lectura a `/api/bodega/opciones`). **Antes de decidir:** comprobar si producción conserva entregas antiguas "a faena". | [V][C] `app/api/bodega/opciones/route.ts:91-93`, `lib/services/stock-movement.ts:222`, `lib/services/deliveries-worker-stock.ts:258` |
| INI-05 | **El selector de período no cambia nada en 5 de 9 vistas, y no lo avisa.** Mes → Año deja el texto idéntico en Mi trabajo, Prevención y Terreno; en Flota y Gobernanza solo cambia la palabra "año". | [V] `interact-log.txt`; [C] `dashboard/page.tsx:133-136`, `sections/prevention-section.tsx:235`, `dashboard-scope-controls.tsx:282-291` |
| ADQ-05 | **Repuestos y Servicios quedan fuera de `/aprobaciones`** (se aprueban eligiendo cotización en el detalle). El vacío "Bien hecho" puede ser falso para un aprobador que tiene de esas pendientes. Sin datos en dev para verificarlo. | [C] `lib/approvals-queue.ts:34` |
| ADQ-06 | **Faena por defecto en la nueva solicitud.** Es la primera alfabética (Biodiversa), mientras el chip dice "Tu faena: Oficina Central". | [C] `solicitudes/.../use-request-form.ts:248`, `solicitudes/nueva/page.tsx:180-182` (no usa `primaryWorksiteId`) |
| ADQ-07 | Un ítem de una OC en **Borrador** aparece como "Pendiente recepción". | [V][C] `lib/work-queue-builders.ts:160-164` |
| ADQ-08 | **SOL-0044 está "Cerrada"**, pero el stepper muestra "Recepción" con reloj y "Entrega" vacía. | [V] `sol-cerrada-0044-top.png` |
| BOD-03 | **Las guías despachadas sin confirmar no aparecen en ningún lado.** No alimentan Mis pendientes ni el detector de integridad. Hay 5 guías del 31-08 sin confirmar (35 días). | [V][C] `lib/.../dispatch-guide-detector.ts:52` |
| BOD-04 | **Ajuste sin tope visible.** Un egreso de 99999 con stock 4 deja el botón habilitado y no muestra el saldo resultante. No se envió, así que la validación del servidor no se verificó. | [V] `d-sheet-adjust-3-partial.png`; [C] `bodega/adjust-panel.tsx:288-313` |

## UX FINDING

**P1 — Inicio: jerarquía invertida (INI-06).** El tile hero es siempre la primera ranura, que para quien ve compras es dinero: hoy muestra "Inversión $0" en verde oscuro.
- Las 215 vencidas quedan en el 4.º tile.
- "Requiere atención" queda unos 2.000 px más abajo en móvil, porque el aside va después de `main` en el DOM.
- El CTA primario "Revisar aprobaciones" apunta a 1 ítem.

Evidencia: [V] `desktop-resumen-fold.png`, `mobile-resumen-full.png`; [C] `operational-metrics-strip.tsx:248-262`, `dashboard-control-center.tsx:83-127`, `quick-actions.tsx:376-378`.

**P1 — Inicio: "Mi trabajo" duplica `/pendientes` y se comporta distinto (INI-07).**
- Corta en 12 filas y dice "12 de 12 visibles" con 331.
- El buscador filtra solo esas 12.
- Los chips son idénticos a los de `/pendientes` pero navegan fuera de la página.
- Hay 5 nombres para la misma cola.

Evidencia: [V] `desktop-trabajo-full.png`; [C] `dashboard/page.tsx:40`, `views/trabajo-view.tsx:172-209`.

**P1 — Adquisiciones: el proceso solo existe en el detalle (ADQ-09).**
- Las listas muestran el enum de estado de cada módulo y ninguna dice la etapa ni el responsable, aunque el dominio ya los calcula (`lib/work-queue-labels.ts:96-130`).
- La OC emitida desaparece de Compras: buscar `OC-2026-0029` da "Sin órdenes de compra".
- "APROBADA" se ve como éxito, pero significa "espera OC".
- En Aprobaciones, el código de la solicitud no enlaza a ella.

Evidencia: [V] `compras-busca-oc-emitida.png`, `solicitudes.png`; [C] `compras/list-scope.ts:30-39`, `aprobaciones/request-group.tsx:66-87`.

**P1 — Bodega: la arquitectura sigue los documentos, no los trabajos (BOD-05).**
- La hoja "Registrar movimiento" no ofrece Entregar ni Ingresar, y su primera opción es BOD-02.
- Una "merma" cabe en tres opciones.
- "Trazabilidad" es un tablero de compras que abre en la faena principal (7 ceros y vacío sin CTA para la oficina).
- "Documentos" es pestaña y página a la vez, y al entrar desaparecen las pestañas.
- Guías se titula "Historial" aunque contiene lo pendiente.
- La hoja no hereda la faena visible.

Evidencia: [V] `d-sheet-0-choices.png`, `d-bodega-trazabilidad.png`, `d-docs-from-tab.png`; [C] `bodega/movement-sheet.tsx:47,86`, `guias/page.tsx:75`, `lib/services/trazabilidad-consolidated.ts:273`.

**P1 — Actos irreversibles sin confirmación (TRV-02).**
- "Emitir y enviar" se ejecuta con un clic, también desde la fila (`compras/oc-list-rows.tsx:110-118`).
- "Aprobar N" en lote no confirma (`aprobaciones/bulk-approve-bar.tsx:72-80`), mientras que aprobar un solo ítem sí.
- "Cerrar conteo" aplica los ajustes sin resumen previo, y el conteo carga 266 productos con 8 en stock (`opciones/route.ts:61-73`).
- La recepción viene precargada al 100 % y no se edita después.

**P2:**
- **Detalle de solicitud:** es un formulario deshabilitado de 3.269 px en desktop y 7.837 px en móvil. Los ítems aparecen 3 veces y el estado 5–6. Un lector de pantalla oye unos 15 combobox atenuados. Se filtra el rol crudo `supervisor_faena` (`solicitudes/[id]/page.tsx:450-459`, `request-people-panel.helpers.ts:27-40`).
- **Compras:** dos tablas cuyos filtros se cruzan; la cola de arriba se vacía en silencio. Con `factura=pendiente` las pestañas no suman (Todas 8 / Borrador 0 / Anuladas 0). "COMPLETADA" aparece junto a "Revisar conciliación" (`compras/page.tsx:131`, `oc-list.tsx:68-72`).
- **Recepción:**
  - en móvil, la primera tarjeta aparece a unos 590 px, después de hint, leyenda, 6 pestañas cortadas, búsqueda, 2 filtros y Vistas;
  - el chip "12 Por recibir" duplica la pestaña, contra la regla A5.
- **Nueva solicitud:** 13 campos antes del primer envío. La urgencia se pide 2 veces y se piden decisiones de compras (proveedor y despacho sugerido).
- **"Crear OC (5 ítems)"** crea 2 OC (`oc-form.tsx:159` contra `oc-form-summary.tsx:35`).
- **Inicio:**
  - jerga sin expandir: Backlog, CAPA, PDTP, MIPER, TAE, NC, "pp", "S1", "Consolidado v1 + v2". Ningún `<abbr>` ni `glossary`, contra la regla A6;
  - "Por área" esconde 7 dominios y su rótulo cambia al del área activa (`dashboard-view-tabs.tsx:143-161`).
- **Bodega:**
  - las filas en 0 pesan igual que el stock real (`stock-table.tsx:461-464`);
  - el tile "Movimientos · 30 d: 6" lleva a un Kardex que muestra 70 (`bodega-header-metrics.tsx:297-301`);
  - el Kardex tiene 9 columnas y 6 filtros sin "Más filtros", contra la regla A2.
- **Entregas:**
  - el orden "Bodega de origen" → "Trabajador" está invertido respecto del modelo "¿a quién le entrego?";
  - el trabajador no se busca por RUT (`delivery-form.tsx:298`): "17" da 0;
  - los 25 "Anular" en rojo son lo más saturado de la página.
- **Móvil:**
  - en Guías hay 19 objetivos bajo 24 px (enlaces de 19 px, `guides-table.tsx:49`) y en Entregas 17 (`deliveries-table.tsx:71`);
  - el formulario de entrega mide 1.207 px y su botón queda al final, sin barra fija;
  - el conteo trunca los nombres y se pierde la talla.

**P3:**
- **Inicio:**
  - un gasto menor se pinta de rojo (falta `trendPolarity`, `finance-section.tsx:163`);
  - estados crudos como "borrador: 99" (`governance-section.tsx:198-200`);
  - formatos de monto y mes mezclados en los gráficos ("$1600.0M", "2026-07");
  - "Inversión por faena" con un color distinto por barra;
  - sparklines planos;
  - dos `<svg>` de recharts enfocables y sin nombre.
- **Adquisiciones:**
  - "Sugerido" con la variante warning en el formulario de OC;
  - "$0 +1 pend.";
  - el vacío de Aprobaciones está hecho a mano en vez de usar `EmptyState`;
  - la leyenda de estados existe solo en Recepción.
- **Bodega:**
  - Documentos repite título y descripción;
  - chips de fecha en ISO crudo en Trazabilidad (`consolidated-filters.tsx:139-142`);
  - motivos de canje en minúscula ("desgastado");
  - dos estilos de selector de faena;
  - los toasts de éxito no enlazan al folio.

## INCONSISTENCY

| ID | Hallazgo | Evidencia |
|---|---|---|
| TRV-03 | **Lo pendiente se ve débil y lo cerrado, fuerte.** Las variantes de severidad del `Badge` van en mono y mayúsculas; `default` e `info` en caja normal. Así resaltan APROBADA, RECIBIDA, ANULADA y COMPLETADA, y pasan desapercibidas Borrador, Despachada y Pendiente de recepción, que son las que piden acción. "Despachada" usa `info` aunque es lo que falta confirmar. Contradice la regla de DESIGN.md "naranja signal solo para pendientes". | [V][C] `components/ui/badge.tsx:5-8`, `components/states/state-badge.tsx:155-157` |
| ADQ-10 | **"Esperando al proveedor" tiene 7 nombres:** Pendiente de recepción / Por recibir / Pendiente recepción / Esperando recepción en oficina o bodega / En proceso / En curso / Comprado. Recepción pone lado a lado las pestañas "Por recibir" y "Pendiente de recepción". | [V][C] `recepcion/page.tsx:36-41` |
| ADQ-11 | **"Cotejar" tiene 4 rótulos:** Cotejar / Cotejar entrega en faena / Cotejar en faena / Completar guía. | [C] `recepcion-table.tsx:167,225`, `recepcion/[id]/page.tsx:276`, `oc-reception-cta.tsx:95` |
| INI-08 | **La cola de trabajo tiene 5 nombres** (Mi trabajo, Mis pendientes, Cola de trabajo, Tareas pendientes, "Abrir cola completa") y 4 contadores (331, 99+, 215, 238). | [V] |
| INI-09 | **Las áreas del tablero no coinciden con las del sidebar:** Flota, Finanzas, Terreno y Gobernanza contra Control operacional, Facturación, Reportes y TI. | [C] `dashboard-domains.ts:270-283`, `components/layout/areas.ts:54-62` |
| BOD-06 | **La faena por defecto cambia según la pantalla** (propia / propia sin datos / todas). "Limpiar filtros" desde "Todas" vuelve a Oficina Central. | [V] |
| TRV-04 | **El buscador de la shell promete algo que no cumple:** "Filtrar en esta página…" aparece en las 9 vistas de Inicio y solo filtra Mi trabajo. Es el mismo defecto que TIUX-35. | [V] `desktop-interact-search-resumen.png`; [C] `top-bar.tsx:33,209` |

## Detector — verdaderos positivos (todos P3)

- `components/layout/notification-bell.tsx:42`: `motion-safe:animate-ping` permanente sobre el contador de no leídas, en todas las rutas. Contradice "la bitácora es calma".
- **Texto de 10 px**, fuera de la escala: `compras/oc-list-rows.tsx:104,242` y `dashboard/pdtp-compliance-card.tsx:100`.
- **Texto de 11 px** en gris tenue: `dashboard/operational-metrics-strip.tsx:51`, `dashboard/dashboard-domain-shell.tsx:76` y `entregas/deliveries-table.tsx:79,161`.
- **Frase de 38 caracteres** en mono y mayúsculas dentro de un badge: `recepcion/recepcion-table.tsx:219`.
- **Tarjetas anidadas en móvil:**
  - `bodega/documentos/documents-table.tsx:177` (25 tarjetas);
  - `bodega/stock-table.tsx:326`;
  - `dashboard/views/trabajo-view.tsx:221` (este último, además, con el contenido pegado al borde derecho).
- **Transiciones:**
  - `transition-all` en `components/ui/kpi-card.tsx:62` y `hero-kpi-card.tsx:33` (visto en estilos computados; el detector no lo marcó);
  - `transition-[width]` en `components/ui/progress.tsx:94`.
- **Borde lateral coloreado** sobre caja redondeada: `components/states/entity-timeline.tsx:118` (side-tab).

## AUTOMATION WARNING

- **El escaneo por URL no autentica.** `impeccable detect <url>` no acepta storage state y cae en `/login`. Todo lo autenticado vino de la inyección en el navegador.
- **Con la CSP real no se puede inyectar el detector.** El nonce hace que el navegador ignore `unsafe-inline` y bloquea `detect.js`. Hubo que usar un contexto de Playwright con `bypassCSP: true`. La pasada de axe, consola y red se hizo en otro contexto con la CSP real.
- **`detect.js` corrió sin el contexto de DESIGN.md** (solo `live.js` lo reenvía), así que las reglas del navegador fueron genéricas.
- **Si se llama `impeccableDetect()` con el overlay ya dibujado, el detector se detecta a sí mismo** (`dark-glow` y ~31 `text-occlusion`). Los conteos de este informe son de una corrida previa al overlay.
- **Falsos positivos descartados:**
  - 233 `nested-cards` cuyo único contenedor es el pozo de la shell;
  - 7 `nested-cards` sobre controles o tablas planas;
  - 36 `layout-transition: height`, que vienen de Sonner y de una utilidad compilada que no se usa;
  - 38 `clipped-overflow-container` de `app-shell.tsx:73,93`;
  - 8 `text-occlusion` y 1 `line-length`, todos dentro de `<details>` cerrados.

## COVERAGE GAP

- **Vistas por rol.** La sesión QA es de administrador global: lo recorrido es el superconjunto de lo que ve un solicitante, un bodeguero de faena o un aprobador acotado.
- **Envíos.** Por diseño de la auditoría no se envió nada. Lo posterior a enviar se revisó solo en código: toasts, redirecciones, mensajes de error del servidor, cierre de conteo y emisión de OC.
- **Repuestos y Servicios.** No hay solicitudes de esos tipos en dev, así que su flujo de aprobación por cotización no se recorrió.
- **Inicio en móvil.** Solo se capturaron Resumen, Mi trabajo, Prevención y Finanzas. Tampoco se abrieron las opciones del selector de faena ni los tooltips de los gráficos.
- **Detector en detalles.** Las rutas `[id]` no se escanearon con el detector en navegador; solo se escaneó el CLI de `components/`.
- **Sin lector de pantalla real, sin red lenta real y sin volúmenes de producción.**
- `/pendientes` no se recorrió más allá de los enlaces que llegan desde Inicio.

## IMPROVEMENT OPPORTUNITY

1. **Inicio como "Hoy".** Que responda "qué me toca hoy y en qué faena", con "Requiere atención" primero, y que los 7 tableros por área pasen a Analítica, donde el período tiene sentido.
2. **Adquisiciones como un solo proceso.** Una columna "Etapa · Le toca a" en las listas (con `buildRequestProgress`, que ya existe), pestañas por etapa, un mapa de vocabulario único y badges de sidebar que cuenten lo que te toca. Pregunta abierta: ¿una sola lista de "Pedidos" con vistas por rol?
3. **Bodega con capa de atención.** Una franja de hasta 4 alertas accionables (guías por confirmar con la antigüedad de la más vieja, EPP recibido por entregar, sin stock con demanda, conteo en borrador) y el badge del menú conectado.
4. **Hoja de movimientos por frecuencia.** Entregar, Recibir guía u OC (con contador), Baja o merma, Ajuste y Conteo. Que herede faena y producto desde un menú por fila en Stock.

## Errores de consola y fallas de red

- **Consola:** 0 errores, 0 advertencias y 0 errores de página en las 36 combinaciones de ruta y tamaño. Las tres evaluaciones A tampoco registraron errores en sus propias corridas.
- **Red:** 0 requests fallidos y 0 respuestas HTTP ≥ 400. Las fallas de `api.dicebear.com` se filtraron: son ruido del sandbox sin internet.

## Cobertura de rutas

| Ruta | Desktop | Móvil | Detector navegador | axe |
|---|---|---|---|---|
| `/dashboard` (9 vistas) | 9/9 | 4/9 (A) · 9/9 (B) | 9/9 × 2 | 9/9 × 2 |
| `/solicitudes` (+ nueva, 5 detalles) | ✔ | ✔ | lista | lista |
| `/aprobaciones` | ✔ | ✔ | ✔ | ✔ |
| `/compras` (+ nueva, 6 detalles, dte, `?factura=pendiente`) | ✔ | ✔ | lista | lista |
| `/recepcion` (+ nueva, 2 detalles) | ✔ | ✔ | lista | lista |
| `/bodega` (Stock, Kardex, hoja ×4 modos) | ✔ | ✔ | lista | lista |
| `/bodega/trazabilidad` (3 pestañas) | ✔ | ✔ | ✔ | ✔ |
| `/bodega/guias` (+ 1 detalle) | ✔ | ✔ | lista | lista |
| `/bodega/documentos` | ✔ | ✔ | ✔ | ✔ |
| `/entregas` (+ formulario, anular) | ✔ | ✔ | ✔ | ✔ |

## Recomendaciones priorizadas

1. **Corregir los bugs baratos** (un PR):
   - BOD-01, búsqueda de servidor en Entregas;
   - INI-02, INI-03 e INI-04, que son de texto;
   - ADQ-01 y ADQ-02;
   - TRV-01, badges del sidebar;
   - TRV-04, ocultar el buscador de la shell en `/dashboard` salvo en `vista=trabajo`.
2. **Reconciliar las cifras de Inicio** (INI-01, INI-05, INI-08): una definición por rótulo y el selector de período solo donde algo responde.
3. **Semántica de estado transversal** (TRV-03, ADQ-10, ADQ-11): corregir el mapeo de `state-badge` y unificar el vocabulario. Es la capa compartida y debe corregirse ahí, no página por página.
4. **Confirmaciones en actos irreversibles** (TRV-02, BOD-04).
5. **Rediseño de flujo** (ADQ-09, BOD-05, INI-06, INI-07, BOD-02): requiere decisiones de producto. Conviene un `shape` antes de implementar.

Comandos sugeridos: `/impeccable clarify` (1–3), `/impeccable harden` (1, 4), `/impeccable colorize` (3), `/impeccable layout` + `/impeccable distill` (Inicio), `/impeccable shape` (5) y `/impeccable polish` al final.

Evidencia de las evaluaciones (fuera del repo, en el scratchpad de la sesión): `a-dashboard/`, `a-adquisiciones/`, `a-bodega/` y `b-detector/`. Algunas capturas contienen nombres reales de trabajadores: no se versionan.
