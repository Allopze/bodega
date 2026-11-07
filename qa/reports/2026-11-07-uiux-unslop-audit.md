# Auditoría UI/UX: oficio visual y consistencia, 7 de noviembre de 2026

**Estado:** auditoría de `main` en `8a611f79d`. **No se modificó código.** El informe lista lo que debe mejorarse, con evidencia, causa cuando se conoce y la corrección propuesta.

**Lectura rápida:** Chome no tiene el *slop* típico de las interfaces generadas: no hay degradados de color, texto con degradado, brillos ni emoji en las pantallas principales. Lo que hay es **ruido tipográfico** (mayúsculas espaciadas y monoespaciadas en insignias, rótulos y cabeceras de tabla), **un mismo concepto dibujado de 3 a 6 maneras** (cifras, períodos, exportar, estado activo del menú, estados) y **fugas de lenguaje interno** (códigos de regla, *slugs*, etiquetas en plural). Hay además **una pantalla rota por volumen** (Capacitación) y **un defecto móvil** (buscador de Mis pendientes).

En la escala de unslop esto es **slop leve: modo pulido**. Se conservan la paleta, las fuentes, el shell y el orden de las pantallas, y se corrige sólo lo que la auditoría encontró. Casi todo se arregla en **cuatro primitivas compartidas**, no pantalla por pantalla.

---

## Alcance y método

- **Código:** barrido de `app/` y `components/` (1.960 `.tsx`, 293 `page.tsx`) con la lista de señales de *unslop* (Damir Sokolovsky, CC BY 4.0) y la lista de verificación UI de `AGENTS.md`. Cada hallazgo de código cita archivo y línea.
- **Navegador:** Chromium de `@playwright/test`, sesión QA (`playwright/.auth/monkeytest.json`) y `next dev` en `:3001`, sobre `bodega_dev` (clon de producción del 2026-11-02 con datos *mock*).
  - **Escritorio, 1440 × 900:** 32 rutas autenticadas y `/login`.
  - **Móvil, 390 × 844 (DPR 2, táctil):** 11 rutas, incluida la app del mecánico `/m/mantencion`.
  - En cada carga se midieron los estilos calculados de todo nodo de texto visible (tamaño, peso, familia, `text-transform`, `letter-spacing`, itálica), los emoji, los tiles `[data-kpi-card]`, el desborde horizontal, los objetivos táctiles de menos de 24 px, los errores de consola y las respuestas HTTP ≥ 400.
- **Resultado técnico de las 44 cargas:** todas respondieron **HTTP 200**, con **0 errores de consola** y **0 respuestas fallidas**. Se filtró el avatar de `api.dicebear.com`, que siempre falla sin internet y es ruido del entorno.
- **Capturas:** quedaron fuera del repositorio porque muestran nombres, correos y RUT reales del clon de producción. Las mediciones son reproducibles con el mismo recorrido.

### Brechas de cobertura

| Brecha | Efecto |
|---|---|
| Modales, hojas laterales, fichas `[id]` y flujos completos de alta/edición no se abrieron. | Los hallazgos de formularios salen del código, no del navegador. |
| Sólo el rol QA (administrador global). | No se vio la navegación ni la densidad de un prevencionista de faena. |
| Móvil: 11 de las 33 rutas. | Las demás pantallas móviles quedan sin verificar. |
| `next dev`, no un *build* de producción. | Los tiempos medidos sirven como orden de magnitud, no como cifra de producción. |
| Gráficos. | Los cubre [AUDITORIA_VISUALIZACIONES_CHOME.md](../../AUDITORIA_VISUALIZACIONES_CHOME.md); aquí sólo se tocan donde afectan la consistencia general. |
| Sin lector de pantalla real, zoom al 200 % ni prueba con usuarios. | La accesibilidad se infiere de estilos y del DOM. |

Se procesó el **100 % de las rutas elegidas** (44 cargas). Eso no equivale a la aplicación completa: hay 293 páginas.

---

## Resumen priorizado

| ID | Prioridad | Tipo | Hallazgo | Dónde |
|---|---|---|---|---|
| UX-01 | **P0** | Defecto de producto | Capacitación renderiza 3.905 actividades de una vez: 29,8 MB de HTML y 134 mil nodos | `/prevencion/capacitacion` |
| UX-02 | **P1** | Defecto de producto | El buscador de Mis pendientes se aplasta a 16 px de alto en móvil | `/pendientes` |
| UX-03 | **P1** | Defecto de producto | Se muestra un código interno de regla («horometro_regresivo») | `/combustibles` |
| UX-04 | **P1** | Inconsistencia | Las insignias de estado mezclan dos sistemas tipográficos en la misma columna; las largas se cortan o parten en 3 líneas | `Badge`, todas las listas |
| UX-05 | **P1** | Hallazgo UX | Mayúsculas espaciadas en rótulos, cabeceras y marca: 15 por pantalla de mediana, hasta 63 | `text-eyebrow`, `th-type` |
| UX-06 | **P1** | Inconsistencia | Una cifra se dibuja de cuatro maneras; números sin separador de miles; palabras con estilo de número | `KpiCard`, `SummaryBar` |
| UX-07 | P2 | Inconsistencia | Seis controles distintos para elegir período y tres modelos de aplicar filtros | Inicio, Combustible, Control operacional, Mantención, PDTP, Analítica |
| UX-08 | P2 | Inconsistencia | Exportar tiene 4 rótulos, 2 íconos y 2 jerarquías | `ExportButton` y usos |
| UX-09 | P2 | Inconsistencia | El sidebar usa la paleta `slate` fuera de los tokens, tiene dos estados activos distintos y trunca rótulos | `components/layout/` |
| UX-10 | P2 | Hallazgo UX | Textos internos o descuidados: plural como estado, *slugs*, códigos aleatorios, mezcla de «Dashboard», «Panel» y «Resumen» | Varios |
| UX-11 | P2 | Hallazgo UX | La descripción de la cabecera, la línea de los 5 segundos, se corta con elipsis | `TopBar` |
| UX-12 | P2 | Hallazgo UX | Tablas: códigos, unidades y fechas que se parten en varias líneas | Recepción, Cargas, Pendientes, Compras |
| UX-13 | P2 | Hallazgo UX | Un módulo vacío muestra 7 estados vacíos por una sola causa; filas de tiles que dicen «Ninguna» | Mantención, Cargas, Bodega |
| UX-14 | P3 | Hallazgo UX | Color de peligro o pendiente repetido en todas las filas | Usuarios, Recepción |
| UX-15 | P3 | Oportunidad | Pesos y tamaños fuera de la escala: 4 pesos por pantalla, `text-[10px]` y `text-[11px]` sueltos | Global |
| UX-16 | P3 | Oportunidad | La app del mecánico usa una paleta de marca paralela (73 hex) | `app/(mecanico)/` |
| UX-17 | P3 | Oportunidad | Restos de *slop*: brillo, *ping*, `transition-all`, emoji, `extrabold`, itálicas, fechas nativas | Ver lista |
| UX-18 | P3 | Hallazgo UX | El título del Inicio es un saludo («Hola, Alejandro») | `/dashboard`, app del mecánico |

---

## P0

### UX-01 — Capacitación renderiza el programa completo en una sola página

**Tipo:** defecto de producto (rendimiento y usabilidad).

**Evidencia en el navegador:**

| Medida | Valor |
|---|---|
| Actividades listadas (pestaña «Todas») | 3.905 |
| Nodos del DOM | 133.981 |
| Botones visibles en escritorio | 11.705 |
| Elementos en mayúsculas | 7.525 |
| HTML | 29.805 KB descomprimidos, 417 KB transferidos |
| Alto del contenido en escritorio | 827.716 px |
| Alto del contenido en móvil | 1.196.074 px (≈ 1.400 pantallas de teléfono) |
| Tiempo hasta que la TopBar muestra el título, local | 3,7 s (Programa de trabajo: 0,8 s) |

Durante esos 3,7 s la cabecera de escritorio queda vacía: el título lo inyecta `PageHeader` al hidratar. En un teléfono en faena, con mala señal, el costo es mucho mayor. La auditoría de visualizaciones ya había contado 2.730 tarjetas; el calendario nuevo (CHART-008) quedó bien, pero la lista de abajo sigue sin límite.

**Corrección propuesta:**

1. Paginar en el servidor con `ServerPagination`, que ya existe, en páginas de 25 a 50 actividades.
2. Por defecto, mostrar **«Pendientes de este mes»**, no «Todas».
3. Que la celda del calendario sea el filtro de la lista (`?mes=` y `faena=`, el patrón de `/prevencion/cgrd` en DESIGN.md).
4. Los tres botones por tarjeta («Marcar hecha», «Marcar no hecha», «No aplica») pasan a una sola acción primaria más un menú. Hoy son 3 × 3.905 controles.

**Verificación sugerida:** un E2E que cuente filas visibles (≤ 50) y mida el `decodedBodySize` del documento.

---

## P1

### UX-02 — El buscador de Mis pendientes se aplasta en móvil

**Tipo:** defecto de producto.

**Evidencia:** a 390 px el campo «Buscar código, tarea o faena» mide **358 × 16 px**: el texto apenas cabe y parece roto. El botón «Buscar» de abajo sí mide 44 px.

**Causa:** en [work-queue-workbench.tsx:166-173](../../app/(app)/pendientes/work-queue-workbench.tsx#L166-L173) el `<input>` lleva `h-11 … flex-1` dentro de un `flex-col`. En columna, `flex-1` (base 0) anula la altura `h-11`. Además es un `<input>` crudo con `text-xs`, en vez del campo compartido (`FilterSearchInput` / `Input`). Con 12 px, iOS hace zoom al enfocarlo; `Input` ya usa `text-base` en móvil para evitarlo.

**Corrección:** reemplazarlo por el campo de búsqueda compartido o, como mínimo, usar `sm:flex-1` y `text-base sm:text-xs`.

**Regresión:** un E2E móvil que verifique que el campo mide ≥ 44 px de alto.

### UX-03 — Código interno de regla en el Panel de combustible

**Tipo:** defecto de producto (texto; regla A6).

**Evidencia:** la tarjeta «Paso 2 · Por revisar» dice «… 12 casos de **horometro_regresivo**», tanto en escritorio como en móvil.

**Causa:** [lib/combustibles/panel/steps.ts:205](../../lib/combustibles/panel/steps.ts#L205) interpola `ruleCode` para toda regla que no está en `knownRules`.

**Corrección:** usar el nombre visible de la regla (el mismo que muestran los casos de «Por revisar»). Si una regla no tiene nombre, decir «otras reglas», nunca el código.

**Regresión:** prueba unitaria de `steps.ts` con una regla desconocida.

### UX-04 — Las insignias de estado mezclan dos sistemas tipográficos

**Tipo:** inconsistencia de alto alcance; la causa está en una sola primitiva.

**Evidencia en el navegador:**

- **Mis pendientes, columna Prioridad:** «Normal» (sans, caja normal) junto a «● ALTA» (mono, mayúsculas, espaciado).
- **Seguimiento, columna Estado:** «SOLICITADO» (mono), «Pedido a proveedor» (sans) y «APROBADO (POR COMPRAR)» (mono con borde naranja). Son tres tratamientos en una columna.
- **Compras:** «● APROBADA» frente a «● Anulada».
- **Las insignias largas no caben:**
  - Cargas: «LECTURA DE MEDIDOR MENOR A LA ANTERIOR» se parte en una píldora de 3 líneas.
  - Facturas emitidas: «PENDIENTE DE PAG…» queda cortada por el borde de la tabla a 1440 px.
  - Recepción: «● PENDIENTE DE RECEPCIÓN» ocupa unos 200 px y empuja el código de OC a 3 líneas (`OC-` / `2026-` / `0057`).

**Causa:** [components/ui/badge.tsx:8](../../components/ui/badge.tsx#L8) define `severityType = "font-mono font-semibold uppercase tracking-wider"` para las variantes de severidad y `proseType` (sans) para las neutras. El propio comentario de las líneas 22-25 reconoce el problema («ACTIVO junto a Inactivo») y lo resuelve agregando una variante más, no unificando. `DESIGN.md` § Tipografía («Badges en font-mono, uppercase, tracking wide») lo convierte en regla.

**Corrección**, un solo tratamiento para todas las variantes:

- `font-sans`, caja de oración, 12 px, peso 500, `tracking-normal`.
- Fondo `-tint`, texto `-ink` y punto opcional, como hoy.
- **La severidad la lleva el color y el punto**, no la tipografía.
- `whitespace-nowrap` y, para textos de más de unos 24 caracteres, la insignia corta más el detalle en la fila. «Lectura menor a la anterior» basta como insignia.

Se cambia en `badge.tsx`, se actualiza `DESIGN.md` y se revisan las capturas de las E2E que comparan insignias.

### UX-05 — Mayúsculas espaciadas en rótulos, cabeceras y marca

**Tipo:** hallazgo UX (lectura y jerarquía).

**Evidencia:**

- En las 31 rutas de escritorio (sin `/login` ni Capacitación) hay entre **2 y 63 elementos en mayúsculas espaciadas** por pantalla, con mediana de 15. Es cerca del 9 % del texto visible.
- Los máximos:

  | Pantalla | Elementos en mayúsculas |
  |---|---|
  | `/facturacion/facturas` | 63 |
  | `/control-operacional` | 56 |
  | `/combustibles/revisar` | 56 |
  | `/seguimiento` | 44 |
  | `/flota` | 43 |

- Dónde aparecen:
  - el subtítulo de marca «GESTIÓN OPERACIONAL», en mono a 11 px, en cada pantalla;
  - el rótulo «PLATAFORMA» y los de sección del menú («SEGUIMIENTO», «FLOTA», «CUMPLIMIENTO DEL PROGRAMA»);
  - todas las cabeceras de tabla;
  - los rótulos de bloque del Inicio («REQUIERE ATENCIÓN», «LO MÁS URGENTE DE TUS PENDIENTES»);
  - los rótulos de las tiras de cifras («VEHÍCULOS ACTIVOS», «PLAZOS ATRASADOS»);
  - las etiquetas de filtro («AÑO», «FAENA» en Programa de trabajo).
- En el código: `text-eyebrow` 121 usos en 66 archivos, `uppercase` 156 en 88, `tracking-wide*` 93 en 64.

Al mismo tiempo, `KpiCard` usa rótulos en caja de oración. El mismo papel («rótulo de una cifra») aparece en dos tratamientos según la pantalla.

**Causa:** las utilidades [`text-eyebrow` y `th-type`](../../app/globals.css#L215-L233), además de clases sueltas en [brand-mark.tsx:63](../../components/layout/brand-mark.tsx#L63) y [desktop-nav.tsx:134](../../components/layout/desktop-nav.tsx#L134).

**Corrección**, en las utilidades para que se propague sola:

| Utilidad | Hoy | Propuesto |
|---|---|---|
| `text-eyebrow` | 11 px, peso 600, `uppercase`, `0.06em` | 12 px, peso 500, caja de oración, tracking 0, `--color-text-muted` |
| `th-type` | 12 px, peso 600, `uppercase`, `0.025em` | 12 px, peso 500, caja de oración, `--color-text-subtle` |
| Subtítulo de marca | mono, 11 px, mayúsculas | Myriad, 12 px, caja de oración, muted, o eliminarlo: el logo y «Plataforma Chome» ya identifican |
| Rótulos de sección del menú | negrita y mayúsculas | 12 px, peso 500, muted, 24 px arriba y 8 px abajo |

La jerarquía queda a cargo del tamaño y el color, que es lo que DESIGN.md ya pide para el resto.

### UX-06 — Una cifra, cuatro maneras de dibujarla

**Tipo:** inconsistencia.

**Evidencia en el navegador:**

| Patrón | Dónde | Rótulo | Cifra |
|---|---|---|---|
| `KpiCard` tarjeta | Programa de trabajo, Mantención, Analítica | Caja de oración + caja con ícono + «i» | Mono, 24 px, **700** |
| `KpiCard` plano | Inicio | Caja de oración | Sans, 28 px, 600 |
| Tira (`SummaryBar`) | Flota, Incidentes, Cargas, Control operacional | **MAYÚSCULAS** | Mono, 700 |
| Métrica en cabecera | Bodega | En línea | Mono |

**Defectos de formato que se repiten:**

- **Sin separador de miles.** Programa de trabajo muestra «**2246**» ejecutadas ([prevencion/pdtp/page.tsx:380](../../app/(app)/prevencion/pdtp/page.tsx#L380), `value={String(executedCount)}`), mientras el resto de la app escribe «$1.171.436». El mismo `value={String(…)}` aparece en otros 9 archivos que dibujan tiles (las secciones del tablero, `ti/page.tsx` y `panel-kpis.tsx` de Mantención): toda cifra de 1.000 o más sale sin separador.
- **Palabras con estilo de número.** «Ninguno», «Ninguna» y «Sin datos» se dibujan en mono negrita de 24–28 px en Control operacional, Panel de combustible (Paso 4) y Cargas. Se leen como cifras rotas.
- **Íconos de color en tiles.** En Programa de trabajo, cada tile lleva un ícono en verde o naranja: escudo, gráfico, lista, advertencia. Es decoración que compite con la cifra y usa los colores de estado para nada.

**Corrección:**

1. `KpiCard` y `SummaryBar` reciben `value: number` más un formateador (`formatQty` o `formatCLP` de `lib/utils`) en vez de un `string`, así no se puede volver a pasar `String(n)`.
2. Un valor no numérico va en sans, `text-base`, peso 500, `--color-text-muted`. Ya existe la prop `empty` para esto.
3. Un solo rótulo en toda la app: caja de oración, 12 px, muted (UX-05).
4. Íconos de tile en `--color-text-subtle` sin caja, o eliminarlos fuera del tablero.
5. Cifra de tarjeta: peso 600, no 700 (UX-15).

---

## P2

### UX-07 — Seis controles distintos para elegir el período

**Tipo:** inconsistencia (regla A6).

**Evidencia:**

| Pantalla | Control | Cómo se aplica |
|---|---|---|
| Inicio | Segmentado Mes / Trimestre / Año | Al instante |
| Panel de combustible, Cargas | Paso de mes «‹ Noviembre 2026 ›» | Al instante |
| Control operacional | Dos campos Desde/Hasta de unos 480 px cada uno | Botón «Aplicar período» |
| Panel de mantención | Chips 7 días / 30 días / Este mes / Todo | Al instante |
| Programa de trabajo | Selector Año | Al instante |
| Analítica | Desde/Hasta + 3 selectores | Botón «Filtrar» |

Además, Mis pendientes busca con un botón «Buscar», mientras Solicitudes y Compras buscan al escribir.

**Corrección:**

- Un `PeriodPicker` compartido. Ya existe [period-picker.tsx](../../components/ui/period-picker.tsx). Debe tener atajos (este mes, mes anterior, 90 días, año) y «Personalizado…» en un *popover* con el `DateRangePicker` del sistema.
- Que todo filtro estructurado se aplique al cambiar, con `router.replace` y `scroll: false`, sin botón «Aplicar». El botón sólo se justifica cuando la consulta es costosa, y entonces debe decirlo.

### UX-08 — Exportar: cuatro rótulos, dos íconos, dos jerarquías

**Tipo:** inconsistencia.

**Evidencia:**

- Rótulos: «Exportar Excel» (31 usos), «Exportar a Excel» (6), «Exportar» (4) y «Exportar reporte» (1).
- Íconos: una flecha de descarga en Solicitudes, Compras y Facturas; un ícono de archivo «XLS» en Flota, Control operacional y Mantención.
- Jerarquía: en Analítica es el botón **primario verde**; en el resto, secundario.

**Corrección:** que `ExportButton` fije el rótulo («Exportar Excel», o «Exportar Excel · *qué*» cuando hay varias exportaciones), el ícono y la variante `secondary`. El primario de la cabecera queda para la acción que crea trabajo («Nueva solicitud», «Registrar carga»).

### UX-09 — Sidebar: paleta fuera de tokens, dos estados activos y rótulos truncados

**Tipo:** inconsistencia.

**Evidencia:**

1. **Paleta fuera de tokens.** El menú usa `slate-*` de Tailwind, un gris azulado (matiz ≈ 255), en vez de los neutros del sistema (croma 0,002 y matiz 0). Está en [nav-rows.tsx:19-29](../../components/layout/nav-rows.tsx#L19-L29), [desktop-nav-areas.tsx:90-100](../../components/layout/desktop-nav-areas.tsx#L90-L100) y [sidebar-user-profile.tsx:66-79](../../components/layout/sidebar-user-profile.tsx#L66-L79). Hay 31 líneas con `slate-*`, `gray-*` y similares en 10 archivos, incluidos los *layouts* públicos de TAE y PPA y tres pantallas de administración.
2. **Dos estados activos.** «Inicio» y «Mis pendientes» se marcan con verde `--color-primary-tint` ([desktop-nav.tsx:59](../../components/layout/desktop-nav.tsx#L59), [143](../../components/layout/desktop-nav.tsx#L143), [169](../../components/layout/desktop-nav.tsx#L169)); el resto de los ítems, con gris `slate-200/80`.
3. **Tres documentos, tres versiones.** `DESIGN.md` describe un tercer estado (regla izquierda sin fondo) que el código ya no usa, y la regla 7 de `AGENTS.md` prescribe `bg-slate-100`. Ninguno coincide con el código.
4. **Rótulos truncados.** El ítem activo se corta («Programa de tr…», «Campañas y Capacitac…», «Seguimiento de solici…»), y en Administración 4 de 7 grupos quedan truncados («Configuración de …», «Comunicaciones …», «Seguridad y traza…», «Productos y abast…»). Los rótulos de grupo van a 15 px y peso 600, más pesados que los ítems.
5. **Rótulos ambiguos fuera de contexto.** Hay dos ítems «Panel» (Mantención y Combustible) además de «Panel operacional».

**Corrección:**

- Tokens `--color-nav-active-bg` y `--color-nav-active-ink`, derivados de la rampa neutra, con un solo estado activo para todo el menú.
- Rótulos de grupo a 14 px y peso 500.
- Acortar o renombrar los rótulos largos: «Programa de trabajo» → «Programa»; «Campañas y capacitación»; «Panel de mantención», «Panel de combustible».
- Alinear `DESIGN.md` y la regla 7 de `AGENTS.md` con lo que se decida.

### UX-10 — Lenguaje interno o descuidado en pantalla

**Tipo:** hallazgo UX (principio «sin jerga ni IDs internos» de `PRODUCT.md`).

| Evidencia | Dónde | Corrección |
|---|---|---|
| La insignia de una sola actividad dice «● PENDIENTES» (y «Hechas», «No hechas», «No aplican»): `statusMeta` reutiliza los rótulos plurales de las pestañas | [training-occurrence-list.tsx:54-66](../../app/(app)/prevencion/capacitacion/training-occurrence-list.tsx#L54-L66) | Mapa singular para estados: «Pendiente», «Hecha», «No hecha», «No aplica» |
| Se muestra el *slug* «programa-capacitacion-2026-v1» | `/prevencion/capacitacion` | «Programa anual 2026 · versión 1» |
| Códigos aleatorios: «INC-2026-AUIA6LVVHJ», «INSP-2026-3F0TZUWS», frente a los correlativos «SOL-0063» y «OC-2026-0057» | Incidentes, Mis pendientes | Folio correlativo por año, como Solicitudes y OC |
| «Dashboard de Cumplimiento SG-SST» (anglicismo y mayúsculas de título) frente a «Panel operacional» y «Panel de combustible»; el de TI se titula sólo «Resumen» | [pdtp/page.tsx:43](../../app/(app)/prevencion/pdtp/page.tsx#L43), [237](../../app/(app)/prevencion/pdtp/page.tsx#L237); `/ti` | «Panel de cumplimiento SG-SST»; «Resumen de TI» |
| Mayúsculas de título en rótulos: «Acciones Pendientes», «Campañas y Capacitación» | [pdtp/page.tsx:419](../../app/(app)/prevencion/pdtp/page.tsx#L419), capacitación | Caja de oración |
| «CRÍTICO» (urgencia de una solicitud) junto a «Urgencia crítica» en la cabecera y «CRÍTICA» en el Inicio | Solicitudes, Compras, Inicio | Concordar con «urgencia»: «Crítica» |
| «se consultan en su tab» | Descripción de `/recepcion` | «en su pestaña» |
| «Filtros avanzados» es el título de los únicos filtros de la pantalla | `/flota` | «Filtros» |
| El selector «Faena» de Capacitación aparece vacío, sin valor ni marcador | `/prevencion/capacitacion` | «Todas las faenas» como valor visible |

### UX-11 — La descripción de la cabecera se corta

**Tipo:** hallazgo UX (prueba de los 5 segundos).

**Evidencia:** a 1440 px la descripción termina en «…» en:

- Control operacional: «…entre 10-08-2026 y 07-…», justo donde estaba el período;
- Programa de trabajo;
- Facturas emitidas;
- Incidentes.

Es la línea que responde «qué es esto», y se pierde.

**Causa:** `truncate` en [top-bar.tsx:197](../../components/layout/top-bar.tsx#L197), que comparte la fila con el título, el chip de faena, hasta 3 botones y el buscador.

**Corrección:**

- Permitir 2 líneas (`line-clamp-2`) bajo el título, en lugar de la misma fila.
- Fijar un tope de unos 90 caracteres para `description` (prueba en `page-header.test.tsx`).
- Sacar de la descripción los datos que cambian, como el período: ya están en el control de período.
- Quitar las acciones duplicadas. Programa de trabajo ofrece «Ver actividades» en la cabecera **y** «Ver actividades del programa →» en la tarjeta de filtros.

### UX-12 — Tablas: lo que no debe partirse se parte

**Tipo:** hallazgo UX.

**Evidencia:**

| Pantalla | Qué se parte |
|---|---|
| Recepción | Código de OC en 3 líneas |
| Cargas | «200» y «L» en líneas distintas |
| Mis pendientes | «21-08-2026 / Vencida hace 78 / días» en 3 líneas, con espacio libre a la derecha |
| Compras | Nombre de solicitante en 4 líneas, mientras «Proveedor sugerido» tiene espacio de sobra |

**Corrección:** `whitespace-nowrap` y `tabular-nums` para códigos, cifra + unidad y fechas en `DataTable` y `TableCell`. Se puede hacer con un `cellType: "code" | "quantity" | "date"` que también fije la alineación. Además, anchos mínimos por tipo de columna y que el texto libre (nombres, descripciones) sea lo que se ajusta.

### UX-13 — Muchos estados vacíos para una sola causa

**Tipo:** hallazgo UX (regla A4; prueba de los 5 segundos).

**Evidencia:**

- **Panel de mantención:** 2 tiles vacíos, 2 tiles en «0», una tira «Horas hombre: 0 · Equipos activos: 0» y 5 tarjetas vacías («Ningún equipo en taller», «Todavía no hay mantenciones…», «Aún no hay equipos en el módulo»…). Todo viene de una causa: no hay equipos.
- **Cargas:** 4 tiles seguidos que dicen «Ninguna».
- **Bodega:** «Cobertura del stock» dibuja una barra gris de ancho completo para decir «Sin consumo». Ocupa unos 200 px de la primera pantalla.

**Corrección:**

- Cuando una causa raíz vacía la pantalla, mostrar **un** `EmptyState` con la acción («Agrega o importa los equipos»).
- Una fila de tiles en cero se convierte en una línea: «Nada por validar, observar ni completar en noviembre».
- Un gráfico sin datos no se dibuja (DESIGN.md § Gráficos): sólo la frase.

---

## P3

### UX-14 — Color de alerta repetido en todas las filas

**Tipo:** hallazgo UX.

**Evidencia:**

- **Usuarios:** un ícono de papelera **rojo** en cada fila; son unos 20 puntos rojos en la primera pantalla.
- **Recepción**, pestaña «Por atender»: casi todas las filas llevan «● PENDIENTE DE RECEPCIÓN» en naranja, aunque la pestaña ya acota ese estado (A5).

**Corrección:**

- Íconos de fila en `--color-text-subtle`; el rojo aparece al pasar el puntero y en la confirmación.
- Ocultar la columna de estado cuando la pestaña activa ya fija ese estado, o mostrar sólo la desviación («Recibido en oficina»).

### UX-15 — Pesos y tamaños fuera de la escala

**Tipo:** oportunidad de mejora.

**Evidencia:**

- Las 31 pantallas renderizan **cuatro pesos** (400, 500, 600 y 700). Se usa 700 en el título de la TopBar ([top-bar.tsx:190](../../components/layout/top-bar.tsx#L190)), en las cifras mono de los tiles y en `text-h1`/`text-display`.
- `font-semibold`: 965 usos en 446 archivos.
- Tamaños sueltos: `text-[11px]` 152 usos (no es un token) y `text-[10px]` 81 usos, por debajo del piso de 11 px que [badge.tsx:35](../../components/ui/badge.tsx#L35) declara como mínimo legible.

En el navegador la escala se respeta casi siempre (11, 12, 13, 15, 17 y 22 px); los 10 px aparecieron en `/admin/usuarios`. Los demás viven en contenido plegado o en pantallas que no se recorrieron: el detalle desplegable de Seguimiento, el formulario de OC y la planilla del Programa de trabajo.

**Corrección:**

- Token `--text-2xs: 11px` y reemplazar los `text-[11px]`.
- Prohibir `text-[10px]` con la misma regla `no-restricted-syntax` que ya protege las fechas.
- Títulos en Exo **600**; cifras de tile en 600; el 700 sólo para la marca.

### UX-16 — La app del mecánico tiene una paleta de marca paralela

**Tipo:** oportunidad de mejora (consistencia de marca).

**Evidencia:** [mant-app.css:6-23](../../app/(mecanico)/mant-app.css#L6-L23) define su propio verde, ámbar y naranja, distintos de los tokens de la marca:

| Color | App del mecánico | Token de marca |
|---|---|---|
| Verde | `#27894d` | `--color-primary` `#005c3f` |
| Ámbar | `#ffd21e` | `--color-accent` `#ffd53f` |
| Naranja | `#f39200` | `--color-signal` `#e78400` |

Entre `mant-app.css` y `mant-screens.css` hay 73 hex. Ni `DESIGN.md` ni `AGENTS.md` lo declaran como excepción.

**Corrección:** mapear las variables `--g`, `--am`, `--or`… a los tokens de `globals.css`, o declarar la excepción en `DESIGN.md` con su motivo, por ejemplo el contraste a pleno sol.

### UX-17 — Restos de *slop* sueltos

**Tipo:** oportunidad de mejora. Cada uno es una línea.

| Señal | Dónde | Corrección |
|---|---|---|
| Brillo de color en la barra de progreso | [navigation-progress.tsx:53](../../components/layout/navigation-progress.tsx#L53) `shadow-[0_0_6px_…primary]` | Quitar la sombra |
| Animación `ping` permanente en el contador de la campana | [notification-bell.tsx:42](../../components/layout/notification-bell.tsx#L42) | Estático; el número ya avisa |
| `animate-pulse` en el ícono Play mientras corre | [backup-actions.tsx:43](../../app/(app)/admin/backups/backup-actions.tsx#L43), [dte-sync-actions.tsx:106](../../app/(app)/admin/dte/dte-sync-actions.tsx#L106) | `Button loading` |
| `transition-all` | [pdtp-sheet-table-ui.tsx:190](../../app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx#L190), [selectable-card.tsx:22](../../components/ui/selectable-card.tsx#L22), [app-toaster.tsx:47](../../components/ui/app-toaster.tsx#L47) | `transition-colors` o `transition-[opacity,transform]` |
| `hover:shadow-md` en tarjetas (DESIGN: «transiciones de color») | [worker-evaluations-card.tsx:59](../../app/(app)/prevencion/trabajador/[workerId]/worker-evaluations-card.tsx#L59), [pdtp/programas/page.tsx:105](../../app/(app)/prevencion/pdtp/programas/page.tsx#L105) | `hover:bg-(--color-surface-2)` |
| Emoji en la interfaz | [soporte/nuevo/report-form.tsx:18-20](../../app/(app)/soporte/nuevo/report-form.tsx#L18-L20) («🐛 Bug», «❓ Consulta», «💡 Sugerencia»); [solicitudes/item-editor.tsx:338](../../app/(app)/solicitudes/item-editor.tsx#L338) («⚠️»); [role-list.tsx:89](../../app/(app)/admin/roles/role-list.tsx#L89) y [use-evaluation-navigation.ts:77](../../app/(app)/prevencion/[id]/evaluation-detail/use-evaluation-navigation.ts#L77) («🔒»); [import-fuel-modal-preview.tsx:122](../../app/(app)/combustibles/import-fuel-modal-preview.tsx#L122) («➕») | Íconos Phosphor (`Bug`, `Question`, `Lightbulb`, `Warning`, `Lock`, `Plus`) en `--color-text-muted`; «Bug» → «Error» |
| Configuración `⚠️` sin usar | [confirm-dialog.tsx:47-48](../../components/ui/confirm-dialog.tsx#L47-L48) | Borrarla o usar `Warning` |
| `font-extrabold` | [ppa/offline-saved.tsx:51](../../app/(public)/ppa/offline-saved.tsx#L51), [ppa/result/[token]/page.tsx:58](../../app/(public)/ppa/result/[token]/page.tsx#L58) | `font-semibold` |
| Itálica para texto vacío o meta («Sin nombre», «Pendiente», «Sin registros en el historial») | 17 archivos, p. ej. [evaluation-list.tsx:94-139](../../app/(app)/prevencion/evaluation-list.tsx#L94-L139), [entity-timeline.tsx:80](../../components/states/entity-timeline.tsx#L80) | Color `--color-text-subtle` sin itálica |
| `<input type="date">` nativo (A6) | [incident-workflow-panel.tsx:216-217, 266](../../app/(app)/prevencion/incidentes/[id]/incident-workflow-panel.tsx#L216), [pdtp-assignee-picker.tsx:173](../../app/(app)/prevencion/pdtp/pdtp-assignee-picker.tsx#L173), [consolidated-filters-advanced.tsx:207, 216](../../app/(app)/seguimiento/_components/consolidated-filters-advanced.tsx#L207), [reportar-incidente/report-form.tsx:73](../../app/(public)/reportar-incidente/report-form.tsx#L73) | `DatePicker`. Los 5 de la app del mecánico pueden quedar nativos (selector táctil), pero hay que declararlo |
| Documentación desalineada: `AGENTS.md` (§ Search architecture) cita `components/admin/data-table.tsx`, que ya no existe | La tabla vive en [components/ui/data-table.tsx](../../components/ui/data-table.tsx) (48 importaciones) | Corregir la ruta en `AGENTS.md` |
| Control «Columnas» suelto entre los filtros y la tabla, con unos 50 px de franja vacía | Solicitudes, Compras, Cargas | Moverlo a la fila de filtros, a la derecha, junto a «Vistas» |
| Dos tarjetas pegadas (≈ 2 px) | Bodega: «Cobertura del stock» y «Stock por faena» | `space-y-6` entre secciones |

### UX-18 — El título del Inicio es un saludo

**Tipo:** hallazgo UX. Requiere una decisión.

**Evidencia:** «Hola, Alejandro» es el `h1` y el título de la TopBar en `/dashboard` ([dashboard/page.tsx:144](../../app/(app)/dashboard/page.tsx#L144)). La app del mecánico abre igual ([home-screen.tsx:131](../../components/mantencion/app/home-screen.tsx#L131)), con un rótulo mono «PRIMER INGRESO» en la pantalla del PIN.

Fue una decisión deliberada: el comentario de las líneas 134-142 explica que reemplazó un «Inicio» duplicado. Aun así, el título no nombra el contexto: en el historial del navegador y en el lector de pantalla, «Hola, Alejandro» no dice dónde está la persona.

**Propuesta:** título «Inicio» y, como descripción, la fecha que ya está: «sábado, 7 de noviembre». Si se quiere conservar el saludo, que vaya en la descripción y no en el `h1`.

---

## Lo que funciona y debe preservarse (verificado)

- **Tokens y contraste con prueba automática** (`design-tokens-contrast.test.ts`), guarda de gráficos y guarda de modales de alto estable. Son el mejor activo del sistema: los cambios de arriba se apoyan en ellos.
- **Sin *slop* clásico.** No hay degradados de un matiz a otro, texto con degradado ni manchas de color. El único degradado radial es el hero de `/login`, que es una excepción declarada y acotada en DESIGN.md. Tampoco hay emoji en las pantallas recorridas.
- **0 errores de consola y 0 respuestas fallidas** en 44 cargas. Sin desborde horizontal del documento en móvil; el calendario de Capacitación se desplaza dentro de su propio contenedor.
- **El Inicio abre con «Hoy»:** lo que requiere atención y lo más urgente con su vencimiento. Pasa la prueba de los 5 segundos.
- **La cadena de etapas** (✓ ✓ ✓ ● ○) de Solicitudes, Recepción y Seguimiento es el elemento visual más propio de Chome.
- Los estados vacíos con explicación y acción (TI) y los objetivos táctiles de 44 px en móvil (botones de Mis pendientes, app del mecánico).

---

## Dirección propuesta (modo pulido)

No se inventa una dirección nueva: sale de `PRODUCT.md` y de la marca existente.

- **Producto:** plataforma interna con la que prevencionistas, jefaturas y administrativos de Chome resuelven, faena por faena, el trabajo pendiente de abastecimiento, combustible, mantención y prevención.
- **Carácter:** serena, rigurosa, operativa.
- **Mundo:** la bitácora de faena: planilla de terreno, folio, timbre de recepción. El verde esmeralda Chome es la tinta; el naranja aparece sólo donde algo espera a alguien.
- **Momentos:**
  1. El bloque «Hoy» del Inicio.
  2. La cadena de etapas de una solicitud u OC.

  Ahí puede haber color y detalle; el resto del chrome (menú, rótulos, insignias, cabeceras de tabla) queda en neutros.
- **Firma:** la **cadena de etapas**, usada igual en todo proceso con ciclo de vida: solicitud, OC, incidente, OT y cierre mensual de combustible, que hoy usa otra forma («Paso 1 … Paso 5»). Debe ser un solo componente y el único lugar donde el naranja marca «aquí estás».

**Prueba de plantilla:** si se cambia «Chome» por otro nombre, el shell (pozo blanco, menú gris, botón verde) le serviría a cualquier SaaS. Lo que lo hace de Chome son la cadena de etapas, el chip de faena y el lenguaje de faena. Por eso la firma va a la cadena y no a más decoración.

---

## Orden recomendado de trabajo

1. **UX-01:** paginar Capacitación (P0). Un PR, con un E2E que mida filas y peso del documento.
2. **UX-02, UX-03 y la insignia plural de UX-10:** tres defectos pequeños, cada uno con su prueba de regresión.
3. **Primitivas tipográficas: UX-04, UX-05 y UX-15.** Cambian `badge.tsx`, `text-eyebrow`, `th-type`, `brand-mark.tsx` y los pesos en `globals.css`. Es un PR con alto efecto visual: actualizar `DESIGN.md` en el mismo PR y revisar las E2E que leen textos en mayúsculas. `getByRole` no depende del `text-transform`, pero conviene correr `e2e/densidad-*.spec.ts` y `e2e/dashboard-rediseno.spec.ts`.
4. **Cifras: UX-06.** `KpiCard` y `SummaryBar` reciben número y formateador.
5. **Controles: UX-07 y UX-08.** `PeriodPicker` y `ExportButton` únicos.
6. **Sidebar: UX-09.** Tokens de navegación y alineación de `DESIGN.md` con la regla 7 de `AGENTS.md`.
7. **Barrido de textos y tablas: UX-10, UX-11 y UX-12.**
8. **Detalles: UX-13, UX-14, UX-16 y UX-17.**

Los pasos 3 a 6 tocan primitivas compartidas. Según la regla «Fix Shared UI Problems at the Correct Layer», ninguno debe resolverse con clases locales por pantalla.

---

## Lista de unslop: estado actual

| Punto | Estado |
|---|---|
| Espaciado en la escala de 4 px, mismas cosas del mismo tamaño | Mayormente. Tarjetas pegadas en Bodega; franja vacía del control «Columnas» |
| Íconos, rótulos y cifras alineados en columna | Sí, salvo los códigos que se parten (UX-12) |
| Una rampa neutra, tres roles de texto, un acento con contraste | Tokens sí; el sidebar usa `slate` (UX-09) |
| Sin degradados de color, texto con degradado, brillos ni manchas | Sí, salvo el brillo de la barra de progreso (UX-17) |
| Sin emoji en la interfaz | No: 5 lugares (UX-17) |
| Un set de íconos, un tamaño y un trazo | Phosphor en todas partes; tamaños de 12 a 20 px según el lugar |
| Pesos 400–600, sin rótulos en mayúsculas espaciadas, sin itálica | No (UX-05, UX-15, UX-17) |
| Sin signos de exclamación, sin título-saludo, sin cifras inventadas | Sin exclamaciones; con saludo (UX-18) |
| Cifras en un solo formato y con dígitos tabulares | No: «2246» sin separador; palabras con estilo de cifra (UX-06) |
| Radios anidados coherentes | Sí: tokens de radio usados de forma consistente |
| Sin animación en bucle | No: `ping` en la campana y `pulse` en los botones de administración (UX-17) |

---

*Método de señales: unslop, de Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0.*
