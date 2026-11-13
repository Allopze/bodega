# Auditoría UI/UX — Control operacional (2026-11-13)

Solo lectura: no se cambió código. Alcance: el área completa del menú «Control operacional».
- Panel operacional (`/control-operacional`).
- Flota: Vehículos, ficha, Conductores y Monitoreo GPS.
- Mantención: 8 ítems más fichas y altas.
- Combustible: 8 ítems y sus pestañas.

> **Corrección de entorno (misma fecha).** El recorrido de este informe se hizo en `:3001`, que no es el `next dev` de `main`: es el contenedor `plataforma-dev-app-1` (imagen `bodega-dev:latest`), con su propia base `plataforma-dev-db-1`, que no tiene datos de Mantención ni de licencias. La segunda pasada (§8) corrió sobre `next dev` de `main` en `:3002` contra `bodega_dev`, con datos en todas las pantallas del área. Los hallazgos de las secciones 1 a 7 que salen del código siguen vigentes.

## Método y cobertura

- **Navegador.** Recorrido con Chromium del repo en el dev `:3001` (`bodega_dev`) y la sesión QA.
  - 47 rutas en escritorio (1440×900) y 11 en móvil (390×844).
  - 0 errores de consola y 0 respuestas ≥400 (sin contar el avatar externo).
  - Capturas en el scratchpad de la sesión; no están versionadas.
- **Código.** Lectura de `app/(app)/{control-operacional,flota,mantencion,combustibles}/**` y sus componentes, contra `AGENTS.md`, `DESIGN.md`, `PRODUCT.md`, el brief `.impeccable/surfaces/app-app-combustibles.md` y la lista de señales de *unslop*.
- **Brecha de cobertura.** Mantención no tiene datos en `bodega_dev` para el alcance de la sesión QA (0 OT, 0 registros, 0 equipos). De esas pantallas solo se vieron estados vacíos; lo demás sale del código. Tampoco se abrieron fichas de detalle ni diálogos en navegador.
- **Veredicto *unslop*.** Slop leve. No hay degradados, brillos, emoji, rótulos en mayúsculas espaciadas ni animaciones en bucle, y el sistema visual (DESIGN.md) se respeta casi siempre. Los problemas reales son de **arquitectura de información, densidad, vocabulario y consistencia entre módulos**: tres módulos se construyeron por separado y se nota al recorrerlos seguidos.

Clasificación: PRODUCT BUG · FUNCTIONAL · UX · INCONSISTENCY · A11Y · COPY · VISUAL. Severidad: alta / media / baja. «Verificado» = visto en el navegador; el resto sale del código.

---

## 1. Transversal a toda el área (lo más importante)

| # | Sev | Tipo | Hallazgo | Cambio |
|---|---|---|---|---|
| T1 | alta | UX | **El menú del área tiene unos 22 ítems** (verificado): Seguimiento 1, Flota 3, Mantención 8, Combustible 8. Al abrir Combustible, Inicio y Adquisiciones salen de la pantalla. | En Mantención y Combustible, separar lo diario de la configuración. Pautas, Catálogos, Dispositivos, Catálogo de repuestos, Fuentes y Ajustes van a un subgrupo «Configuración» o detrás de un engranaje en la página. |
| T2 | alta | UX | **Tres «Panel» en la misma área**: «Panel operacional», «Panel» (Mantención) y «Panel» (Combustible). Cada uno usa un control de período distinto (ver T4). | Rotular «Panel de mantención» y «Panel de combustible» también en el menú, o subtítulos. Decidir qué pregunta responde cada panel y no repetir cifras entre ellos. |
| T3 | alta | INCONSISTENCY | **El mismo vehículo se identifica de cinco maneras** (verificado). Flota: patente primero, sin código interno. Panel operacional: «Código» en mono y luego «Camión · patente». Cargas: código verde con «Camión · patente» debajo. Pagos: «KA-115 · DZTH-66» en mono negrita. Por revisar: «KA-127 · KLJZ-69» en sans negrita. El aviso de Flota «Documentos vencidos: CR-35, CA-18…» usa códigos que la tabla de abajo no muestra. | Un componente `VehicleIdentity` compartido: código en mono y patente debajo en muted, con enlace a la ficha. Usarlo en todas las tablas del área. |
| T4 | media | INCONSISTENCY | **Tres controles de período.** Panel operacional: `PeriodControl` con rango «15 ago – 12 nov». Combustible: `PeriodControl` mensual. Panel de mantención: pastillas «7 días / 30 días / Este mes / Todo». Además, el Panel operacional avisa «el período elegido no cambia estas cifras» para su primera fila. | Usar `PeriodControl` en todos (DESIGN § Período). Si una fila no depende del período, debe ir fuera de la zona que el control gobierna, no llevar una nota. |
| T5 | media | INCONSISTENCY | **Dos padrones paralelos.** Flota tiene 89 vehículos y Mantención dice «89 vehículos de la flota aún no están en Mantención» (verificado). Existen Vehículos (Flota), Equipos (Mantención) y Activos (Panel). | Al menos: el vacío de Mantención/Equipos debe ofrecer **«Incorporar los 89 vehículos»** como CTA primario (hoy ofrece «Nuevo equipo» e «Importar desde Excel»). La ficha de Flota debe enlazar a la de Mantención y viceversa. A futuro: un padrón único. |
| T6 | media | INCONSISTENCY | **El estado del vehículo se pinta distinto en cada pantalla.** En Flota solo «Operativo» lleva color; el Panel usa warning y signal; en Mantención «Estado» significa vencida/próxima/al día. | Un `VehicleStatusBadge` único. En Mantención, renombrar ese otro estado a «Mantención». |
| T7 | media | COPY | **Siglas que el brief prohíbe y que siguen visibles** (verificado): TAE y TCT («13 sólo TAE · 91 sólo TCT» en el Panel operacional; «Copec TCT Diesel» como proveedor crudo en Tarjetas), IEC en Pagos, MTTR, OT, OC, «Σ km ÷ Σ litros», el código de error `ONWAY_SNAPSHOT_EMPTY` en Monitoreo. | Mapear a nombres de usuario («Tarjeta Copec de equipos», «Abastecimiento de estanques», «Impuesto específico») o usar `FuelTerm`/tooltip. Nunca mostrar códigos de error. |
| T8 | media | INCONSISTENCY | **Formatos de fecha mezclados en una misma pantalla** (verificado): «15 ago – 12 nov», «15-08-2026 – 12-11-2026», «31 ene» sin año, «Venció el 31-01-2026», «03-11-2026 09:26». | Un formato corto con año cuando no es el actual, siempre vía `formatDate`. |
| T9 | baja | VISUAL | **Cifras decimales en Geist Mono**: «45 , 6%», «$8 , 3M», «536,9 L · 100 %». La coma de ancho fijo abre un hueco. Porcentajes con y sin espacio (24 contra 27 usos), y miles como k, K, mil y M. | En cifras grandes de KPI, sans `tabular-nums` (como en el tablero) o una regla única. Un formato de porcentaje y una abreviatura de miles. |
| T10 | baja | INCONSISTENCY | **Tres «idiomas» de filtros**: `FilterToolbar` (Cargas, Pagos, Revisar), `ControlFilters` (Cuadratura, Litros, Motor) y `ConsumptionFiltersBar`, más la tarjeta «Filtros» de Flota. «Limpiar filtros» convive con «Quitar filtros». | Migrar todo a `FilterToolbar` con chips y «Más filtros (N)». |
| T11 | baja | VISUAL | **`loading.tsx` dispares.** Siete pantallas de Mantención usan un `Skeleton` anónimo sin `PageHeader`, y la TopBar queda sin título mientras carga. `/flota/monitoreo` hereda el esqueleto «Vehículos». Ninguna ruta de `/mantencion` tiene `error.tsx` propio. | Cada `loading.tsx` lleva su `PageHeader`. |

## 2. Panel operacional (`/control-operacional`)

| # | Sev | Tipo | Hallazgo | Cambio |
|---|---|---|---|---|
| P1 | alta | UX (A1) | **Diez tiles antes de la tabla** (verificado): 4 de «Requiere atención» y 6 de «Desempeño», más un glosario, avisos y «Cruces». Falla el test de los 5 segundos. | Dejar 4 de atención y una tira de texto (`MetricBar`) con Disponibilidad, Horas en taller y Tiempo de reparación. «Licencias» y «Equipos con un solo canal» van a sus pantallas. |
| P2 | media | COPY | «Combustible por revisar **492** · 10 cargas por decidir · 482 casos». La cifra grande mezcla dos cosas, y los 482 casos son mayoritariamente históricos (ver C3). | La cifra principal debe ser lo accionable del mes, y el histórico ir aparte. |
| P3 | media | UX | La tabla tiene 19 columnas visibles por defecto: en 1440 px se corta la columna «R…» (verificado). La tarjeta móvil llega a unas 25 líneas por vehículo. Cada fila repite «Vehículo / equipo móvil». | Por defecto, Código, Faena, Estado, Próximo vencimiento, OT abiertas y Casos; el resto en «Columnas». En móvil, 6 campos y «Ver ficha». |
| P4 | baja | COPY | Se filtra jerga de implementación al glosario: «`inspection_finding_id`», «/flota/conductores» escrito como ruta, «mean time to repair», «Σ vacío ÷ Σ funcionamiento». Hay un párrafo fijo que explica que el Tablero mide otra cosa. | Lenguaje de usuario; mover la meta-explicación al glosario. |
| P5 | baja | A11Y | El conteo de críticos «· 2» va solo en color con `title`. Los botones «Ver»/«Combustible» se repiten sin contexto. | `Badge` con texto «2 críticos»; `aria-label` con el código del vehículo. |
| P6 | baja | VISUAL | Los tiles llevan un ícono decorativo en un cuadro (verificado). DESIGN y *unslop* piden cifras sin adorno. | Quitar los íconos de los tiles. |

## 3. Flota

| # | Sev | Tipo | Hallazgo | Cambio |
|---|---|---|---|---|
| F1 | **alta** | **PRODUCT BUG** | **La búsqueda de Conductores y Monitoreo GPS no existe** (verificado en código y captura). `ROUTES_WITH_OWN_SEARCH` incluye `/flota` por prefijo y oculta el buscador de la TopBar. Las tablas de `/flota/conductores` y `/flota/monitoreo` filtran con `searchQuery` de esa TopBar, y el vacío de Monitoreo dice «en el filtro superior». | Limitar la excepción a `/flota` y `/flota/[id]`, o dar a cada tabla su input rotulado. Agregar un caso a `top-bar-own-search.test.ts`. |
| F2 | media | PRODUCT BUG | En la lista de Flota los `Select` usan `defaultValue`: al quitar un chip o limpiar filtros, el select sigue mostrando el valor viejo. El buscador es un `<form method=get>` con recarga completa y sin `scroll:false`. | Selects controlados por la URL; `router.replace` con debounce. |
| F3 | media | COPY | Las columnas «Costo por km/h» y «Km/Hr» se leen como velocidad (verificado). La columna «Combustible» muestra «$0» sin dato, mientras el Panel muestra «—». | «Costo por km u hora», «Lectura (km u h)», «Gasto combustible (12 m)» y «—» cuando no hay dato. |
| F4 | media | UX | Tarjeta «Filtros» con mucho alto vacío y una segunda tarjeta titulada «Vehículos» que repite el título de la página (verificado). El aviso rojo lista todos los códigos vencidos sin enlace. | Barra de filtros sin tarjeta; aviso con conteo y enlace a `?vencimiento=vencidos`. |
| F5 | media | A11Y | `role="link"` sobre `<tr>` con `router.push`: no hay clic medio ni «abrir en pestaña», y la patente parece un enlace sin serlo. | `<Link>` real en la celda del vehículo. |
| F6 | alta | UX | **Monitoreo: tres avisos apilados** (verificado; el código admite hasta 8): «Consulta atrasada», «Sincronización falló» con `ONWAY_SNAPSHOT_EMPTY` y «7 dispositivos sin patente». Debajo dice «Actualización automática cada minuto» aunque los datos tienen 13 días. | Un bloque «Estado de las fuentes» con una fila por proveedor, su insignia y su acción. Ocultar «cada minuto» cuando la fuente está atrasada. |
| F7 | media | UX | Monitoreo duplica «Configurar»/«Actualizar ahora» en el header y en la pestaña «Configuración». Los avisos usan cursiva (*Configurar*, *Actualizar ahora*), que DESIGN prohíbe. | La configuración solo en su pestaña; quitar la cursiva. |
| F8 | media | PRODUCT BUG | La pestaña «Historial» manda a «consultar su historial en la ficha de Flota», pero la ficha no tiene historial. | Implementarlo o quitar la pestaña. |
| F9 | media | COPY | Enums crudos en Monitoreo: `linkedEntityType.toUpperCase()`, `alertType`, `processingStatus`, `gpsStatus`. | Mapa de etiquetas más `Badge`. |
| F10 | media | A11Y | El mapa codifica el encendido solo por color: apagado (`#64748b`) y sin dato (`#94a3b8`) son casi iguales y no hay leyenda. | Leyenda de texto y forma o trazo distinto para «sin dato». |
| F11 | media | UX | Ficha de Flota: 8 tarjetas, tres de documentación. «Próximo vencimiento» aparece dos veces. El formulario de subida está siempre abierto (A3). El botón dice «Eliminar» y el diálogo «Anular». `toFixed(2)` muestra punto decimal y sin unidad. | Una tarjeta «Documentos»; subida en `Sheet`; un solo verbo; `formatQty` con unidad. |
| F12 | baja | INCONSISTENCY | Conductores no tiene breadcrumb (verificado), a diferencia de sus hermanas. Con 0 registros muestra los chips «Requieren atención · 0 / Vigentes · 0 / Todos · 0». | Agregar el breadcrumb y ocultar los chips en el vacío inicial. |

## 4. Mantención

| # | Sev | Tipo | Hallazgo | Cambio |
|---|---|---|---|---|
| M1 | alta | UX | El menú pone «Órdenes de trabajo» antes que «Panel», pero `/mantencion` redirige al Panel. Las 8 entradas mezclan el trabajo diario con la configuración (ver T1). | Panel primero y un subgrupo de configuración. |
| M2 | media | COPY | «Catálogos» y «Catálogo de repuestos» son casi homónimos. «Registros» frente a «Órdenes de trabajo» no se distingue para un no técnico. Lo antiguo tiene 4 nombres («Historial anterior», «Antecedente histórico», «Trabajos históricos», «Importar historial»). El rótulo del menú no coincide con el título en 5 pantallas. | «Marcas y talleres», «Registros firmados», un solo nombre para lo histórico y el rótulo igual al título. |
| M3 | media | INCONSISTENCY | Faltan niveles del breadcrumb en `equipos/nuevo`, `importar`, `incorporar`, ficha de equipo, editor de pautas y `registros/historicos/**`. | El mismo arreglo de 3 niveles en todas. |
| M4 | media | UX | El Panel de mantención no habla de OT («por asignar», «esperando repuesto»), que es el trabajo accionable de jefatura. | Cambiar un tile por «Órdenes por asignar». |
| M5 | media | UX | Lista de OT (verificado): 8 pestañas, y «Abiertas» es la suma de 5 de ellas. Hay dos campos con lupa: búsqueda libre y combobox «Equipo». Los contadores «0» quedan bajo la línea base del texto. | Quitar «Abiertas» o las intermedias; un solo campo de búsqueda; alinear los contadores con el texto. |
| M6 | media | UX | Detalle de OT: 10 tarjetas, cuatro de ellas etapas vacías («Aún no…»). El estado vive dentro del cuerpo. | Un bloque «Avance» con las 4 etapas en línea; estado y siguiente paso arriba. |
| M7 | media | COPY | «SÍ»/«NO» en mayúsculas, «Sr.» como etiqueta, «Fec. estimada», «Cant.», «OC». La cadena de estados se nombra de tres maneras (Por recibir/Recepcionar/Recepción (conformidad)). El toast dice «OT OT-BIO-0003 creada». | Un vocabulario único: «Sí/No», «Recibió», «Entrega estimada», «Orden OT-BIO-0003 creada». |
| M8 | media | INCONSISTENCY | Registros abre en la pestaña «Todos», que es la última (verificado). OT abre en la primera. El filtro de equipo es texto libre aquí y combobox en OT. «Hecho por: todos» rompe el patrón «Todos los…». | Abrir en «Por revisar», combobox de equipo, «Todos los mecánicos». |
| M9 | media | UX (A1) | Registros muestra tiles con «0 · Ninguno detenido» sin datos (verificado). «Equipos en taller» se repite en el Panel operacional y en el Panel de mantención (A5). Su vacío ofrece «Abrir la app del mecánico» a un usuario de oficina. | Ocultar los tiles sin datos; dejar la cifra en un solo panel; CTA según rol. |
| M10 | media | INCONSISTENCY | La exportación del detalle de registro es un `ghost` «Exportar ▾» con PDF/Excel, fuera del patrón `ExportButton`. | `ExportButton` para Excel; el PDF como acción aparte. |
| M11 | media | UX | En Equipos, dos avisos y cuatro botones de header empujan la lista. Hay tres vías para dar de alta, y «Incorporar» está escondido en un aviso. «Estimación GPS» no se explica, y su chip queda «Estimación GPS: Vencida (estimación GPS)». | Un botón «Agregar equipos» que pregunte cómo (regla 5); tooltip en la cabecera; opción corta. |
| M12 | media | FUNCTIONAL | El formulario de equipo ofrece «Nueva faena…» y permite crear faenas desde ahí, lo que reabre el riesgo de duplicados tras la unificación de faenas. | Confirmar con el responsable si debe seguir. |
| M13 | media | UX | La ficha de equipo no tiene «Crear orden de trabajo». Sus tablas (hoja de vida con 8 columnas, OT) y la incorporación no tienen vista de tarjetas en móvil. | CTA con el equipo preseleccionado; `renderMobileCard`. |
| M14 | baja | VISUAL | El gráfico semanal del Panel usa hex fijos y el naranja signal para «Correctivas», un color reservado a pendientes. Hay `text-[13px]` unas 40 veces y la galería usa `bg-black/70`. | `CHART_COLORS`; `text-sm`; tokens. |
| M15 | baja | COPY | Pautas pinta una insignia «No» por fila en «Reglas por marca» (verificado). Una pauta con 0 actividades no se marca como incompleta. Repuestos dice «OC» sin expandir. | Texto vacío o «Con reglas»; aviso de pauta sin actividades; «orden de compra». |

## 5. Combustible

| # | Sev | Tipo | Hallazgo | Cambio |
|---|---|---|---|---|
| C1 | alta | INCONSISTENCY | **Consumo: cuatro pantallas con el mismo título «Consumo y rendimiento»** (verificado en código). El menú «Consumo» abre la pestaña «Rendimiento», y existe además una pestaña llamada «Consumo». | Un título por vista («Rendimiento», «Litros cargados», «Motor en vacío»); pestaña «Litros». |
| C2 | alta | UX | **Cuadratura: «Proveedor y terreno» y «Tarjeta y terreno»** son pestañas casi homónimas y ambas son Copec. «Sellos» cuelga de Cuadratura aunque no cuadra nada. | «Facturado y terreno» o fundirlas; mover Sellos. |
| C3 | alta | UX | **Por revisar se ahoga en histórico** (verificado). 482 de 492 pendientes son casos de meses viejos. Todos dicen en rojo «Venció el 31-01-2026 · Espera 12 días», porque `inboxDueDate` toma el fin del mes del dato. Encabezan el orden y tapan las 10 cargas del mes. «Lo que vence primero» del Panel muestra los mismos casos como «31 ene», sin año. | Para casos detectados con el mes ya cerrado, fecha límite = detección + N días, o separar «Histórico por depurar». Mostrar el año. Decisión de producto. |
| C4 | alta | UX (A5) | El total pendiente se repite en la pestaña «Pendientes 492», el chip «Todo · 492», la frase «492 cosas esperan…», el paso 2 del Panel, el Panel operacional y el menú «99+» (verificado). | Dejar el conteo en la pestaña o en el chip, no en ambos; quitar la frase cuando hay conteo. |
| C5 | alta | INCONSISTENCY | **El menú y el título dicen «Pagos», pero la pantalla lista facturas** (pestaña «Facturas»). Los pagos están en «Estados de cuenta». El botón dice «Exportar con montos», fuera de la regla «Exportar Excel». La línea dice «8 cargas en esta lista» bajo la pestaña Facturas. En 1440 px la columna «Total» toca el borde (verificado). | «Facturas y pagos»; «Exportar Excel»; contar facturas; revisar el ancho de la tabla. |
| C6 | media | PRODUCT BUG | Cargas dice «Nada por validar, observar ni completar **noviembre**» (verificado): falta «en», porque `inLabel` no trae la preposición y la prueba sí la espera. La misma frase aparece sobre filas que muestran «Caso abierto» y «Lectura menor a la anterior» como pendientes, y se contradice con ellas. | Pasar «en …» y que la frase considere también los casos abiertos, o diga «Nada por validar; N casos abiertos». |
| C7 | media | PRODUCT BUG | Importador de sellos: el rótulo «Sello observadas» (debe ser «Sellos observados»), el enum crudo `{item.confidence}` (`exacta`/`probable`/`sin_match`), «Sin match» y «Generando...» con tres puntos. | Corregir el texto y mapear la confianza. |
| C8 | media | PRODUCT BUG | `.toFixed(2)` da «5.43» con punto decimal y sin unidad en la tabla de tarjetas y en el detalle de archivos. | `formatQty` con km/L o L/h. |
| C9 | media | UX | El paso 2 del Panel es un muro (verificado): «210 regresiones de kilometraje · 12 regresiones de horómetro · 111 saltos de medidor · variación brusca: 149 históricos sin producto atribuible…». En el paso 1, «Pendiente» cae a otra línea y desalinea la tira. «3 fuera» no dice fuera de qué. | Una frase y el dato más antiguo; el desglose en la bandeja; insignia en la misma línea; «1 mandante fuera de tolerancia». |
| C10 | media | UX (A1/A5) | Son 5 tiles de paso (A1 pone el tope en 4) y el avance se muestra tres veces: barra, «0 de 5 pasos listos» e insignias. La excepción no está documentada en AGENTS/DESIGN, como sí lo está la del tablero. | Documentar la excepción de la tira y dejar barra **o** texto. |
| C11 | media | VISUAL | Cada paso lleva un borde superior de color (naranja/rojo) además de su insignia (verificado), lo que suma un acento por tarjeta. Las minibarras de «El período en tres cifras» se dibujan vacías cuando dice «Sin datos». También aparecen `text-[26px]`/`text-[28px]` y `tracking-tight` en cifras. | Que el estado lo lleve solo la insignia; ocultar barras sin datos; escala `text-2xl/3xl`. |
| C12 | media | UX | Cabeceras con hasta 5 controles: período, Agregar datos, Exportar, acción primaria y «¿Qué significa?». En móvil se apilan en 3 filas antes del contenido (verificado). | «¿Qué significa?» como ícono `?` con `aria-label`; «Agregar datos» solo donde el flujo lo usa. |
| C13 | media | UX | Cargas tiene el estado en tres controles: el select, el checkbox «Sólo con algo pendiente» y dos casillas en «Más filtros» (A5). «Más filtros» trae unos 20 controles. La columna dice «Lugar de carga» y el filtro «Punto de carga». En una misma columna conviven insignias de estilo distinto («Importada» gris y «• Registrada» con punto) y pastillas «Lectura menor a la anterior» partidas en dos líneas (verificado). | Fundir los filtros de estado; un rótulo; insignias de un solo estilo y que no se partan. |
| C14 | media | COPY | El canal Copec tiene tres nombres según la pantalla, con la sigla TAE en Fuentes. Para meter datos se usan tres verbos: «Agregar», «Importar» y «Tengo…». El aviso «Copec: hace 10 días que no llegan datos…» se repite en 4 lugares (Panel operacional, paso 1, cabecera de Fuentes y tarjeta Copec). | Un mapa único de nombres; un verbo; el aviso en un solo lugar con enlace desde los demás. |
| C15 | media | COPY | Ajustes mezcla preguntas («¿Por dónde llega el combustible?») con sustantivos («Familias de equipos») en el submenú (verificado), y la pista se oculta en móvil. | Un sustantivo como título y la pregunta como descripción. |
| C16 | media | UX | Consumo/Litros acumula unos 11 bloques y unos 13 gráficos. La tabla de Rendimiento muestra una fila llena de «—» bajo «Ningún equipo rinde más de 10 % peor» (verificado). «Por faena» tiene un vacío sin CTA. Hay tres «Exportar Excel» idénticos sin `ariaLabel`. | Pliegues cerrados y como máximo 3 gráficos visibles; ocultar filas sin rendimiento; CTA en el vacío; nombres accesibles. |
| C17 | baja | VISUAL | `fontStyle="italic"` en `meter-rate-chart`; ticks de eje con dos tamaños; eje de % sin unidad; «Motor en vacío (ralentí)» arrastra el término viejo. | `AXIS_TICK`; rotular ambos ejes; quitar el paréntesis. |
| C18 | baja | A11Y | El punto «nuevo» de la bandeja es solo color. La barra de progreso de Copec es un `div` sin `role`. Hay `<label>` sin `htmlFor`. Las tres «Descargar plantilla» tienen el mismo nombre accesible. `BigField` no conecta `aria-describedby` al error. | Primitivas `Progress`/`Field`; nombre accesible con contexto; `describedby={hint,error}`. |
| C19 | baja | UX | Registrar carga en escritorio (verificado): el botón «Siguiente» mide 56 px a todo el ancho y el separador sobresale de la columna de campos. Son 7 pasos para una carga. | Tamaño de botón por breakpoint; alinear el separador; evaluar si algunos pasos se pueden fusionar en escritorio. |
| C20 | baja | INCONSISTENCY | Componentes vivos dentro de carpetas legacy de redirección (`control/_charts`, `bitacora/bitacora-table`, `tae/importar/...`, `importar/copec-sync-status`), y 30 páginas que solo redirigen. | Mover cada componente junto a la pantalla que lo usa, para que nadie borre «lo legacy» y rompa pantallas vivas. |

## 6. Lo que ya cumple

- `PageHeader` y `PageContainer` en todo el alcance; acciones de página en el header.
- Exportación en Excel; `DatePicker` (sin fechas nativas); filtros con `router.replace` y `scroll:false`, salvo Flota (F2).
- `EmptyState` con CTA en la mayoría de las listas.
- Sin `slate-*`, hex sueltos en UI (salvo el mapa y M14), `uppercase`, `transition-all` ni `animate-pulse`.
- Los destructivos van con `ConfirmDialog`.
- La cobertura de fuentes en Fuentes de datos (una matriz por mes con su estado) es el mejor momento visual del área y debería ser el modelo para los avisos de fuentes del Panel operacional y de Monitoreo.

## 7. Orden sugerido

1. **Defectos** (rápidos y verificables): F1, F2, C6, C7, C8, F8, M7 (copy).
2. **Arquitectura de información del área:** T1, T2, M1, M2, C1, C2, C5.
3. **Identidad y estado del vehículo:** T3, T6 (dos componentes compartidos que arreglan una docena de pantallas).
4. **Densidad:** P1, P3, F6, C3, C4, C9, C16.
5. **Vocabulario y formatos:** T7, T8, T9, C14, C15.
6. **El resto.**

Decisiones que corresponden al producto y no al código: C3 (cómo vencen los casos históricos), T5 (padrón único) y M12 (crear faenas desde Mantención).

---

## 8. Segunda pasada: dev con datos y tarjetas dentro de tarjetas

### Datos

- **Entorno.** `next dev` de `main` en `:3002` contra `bodega_dev`, que es un clon de prod con 12 meses de mock (`mock-*`, `QA_mock`).
- **Datos que ya estaban en el área.**
  - Flota: 89 vehículos activos.
  - Mantención: 121 equipos, 545 registros, 36 OT en los 7 estados, 3 pautas con 90 ítems, 16 marcas, 10 talleres, 6 dispositivos y 7 repuestos.
  - Conductores: 32 licencias.
  - GPS: 60 posiciones y 149 alertas.
  - Combustible completo.
- **Sembrado el 2026-11-13** (por servicios, con auditoría):
  - Capacidad de los 4 estanques (estaban en `NULL`; «Nivel contra capacidad» salía vacío).
  - 16 casos de combustible decididos (8 resueltos y 8 descartados, nota `QA_mock:`); «Por revisar → Decididas» estaba vacío.
  - Reversión: `~/backups-dev/mock-2026-11-02/revert-gaps-2026-11-13.sql`.
- **Recorrido.** 46 rutas del área, 11 fichas de detalle, pestañas de cliente y 7 diálogos de alta. Todas las listas con filas.
- **Sin cubrir.** La ficha de consumo de un equipo sin cargas sigue vacía, y es correcto que lo esté.

### Tarjetas dentro de tarjetas

**Cómo se detectó.** En el DOM renderizado se marca como tarjeta todo elemento con borde de 3 o 4 lados (o sombra), radio de 12 px o más y al menos 160×56 px. Como interior también cuenta una caja tintada con radio de 8 px o más. Se reporta toda tarjeta que tenga otra como ancestro dentro de `<main>`.

**Patrón principal: una `Card` que envuelve una tabla con marco propio.** `TableRoot` lleva `rounded-2xl border` y la `Card` también: quedan dos marcos concéntricos con el **mismo radio de 20 px** separados por unos 20 px de relleno. Es el doble marco que se ve y rompe la regla de radios anidados (radio interior = exterior − relleno). En otros módulos se corrige a mano con `<TableRoot className="rounded-none border-0">` (unos 10 archivos: bodega, compras, facturación), pero `DataTable` no lo expone, así que no se puede aplicar ahí.

| Pantalla | Archivo | Qué hay |
|---|---|---|
| Panel operacional | `app/(app)/control-operacional/page.tsx:328` | Card «Activos y estado operacional» ⊃ `DataTable` |
| Flota / Vehículos | `app/(app)/flota/page.tsx:162-166` | Card «Vehículos» ⊃ `FleetTable`; el título repite el de la página (F4) |
| Monitoreo GPS → Configuración | `app/(app)/flota/monitoreo/fleet-gps-workspace.tsx:136-141` | Card «Unidades Wialon y vínculo» ⊃ tabla |
| Fuentes → archivo de tarjeta | `app/(app)/combustibles/fuentes/archivos/[tipo]/[id]/tarjeta-detail.tsx:133` | `Section` «Registros del archivo» ⊃ tabla |
| Estado de cuenta (detalle) | `app/(app)/combustibles/cuenta-corriente/[id]/statement-detail.tsx:134` | Card ⊃ `div rounded-lg border`. **Defecto aparte:** `border` sin color toma `currentColor` y el marco sale casi negro. Con 0 cargas muestra solo la cabecera, sin estado vacío. |
| Ajustes → Reglas | `app/(app)/combustibles/ajustes/reglas/rule-catalog.tsx:97-100` | `<details rounded-xl border>` ⊃ `TableRoot` de radio 20, **mayor** que el exterior de 16 |
| Cuadratura → Estanques (vacío) | `app/(app)/combustibles/cuadratura/estanques/estanques-sections.tsx:64-75` | `ChartSection` ⊃ caja gris con borde punteado para el vacío; con datos ya no ocurre |

Casos detectados que **no** son defecto: la zona de arrastre del archivo dentro del paso del importador (`/mantencion/equipos/importar`, `/mantencion/registros/historicos/importar`; es un control), la caja tintada de totales en `/combustibles/pagos/nueva` (resumen dentro del formulario) y los `Callout` dentro de diálogos o tarjetas.

**Mismo barrido en el resto de la app** (105 rutas del menú). Anidamientos reales:

| Pantalla | Qué hay |
|---|---|
| `/analitica` | Card «Alertas accionables» ⊃ cada alerta como tarjeta gris con borde. Las cards «Rotación de bodega», «EPP entregados», «Producto» y «OC» envuelven tablas con marco. Además, «Brechas de trazabilidad» es una card vacía sin estado vacío, y las barras del ranking usan relleno con degradado. |
| `/prevencion/cgrd` | Card «Sesiones que el programa espera» ⊃ una fila con borde y radio de 12 px por sesión: una lista de tarjetas dentro de una tarjeta. |
| `/prevencion/incidentes/configuracion` | Card «Listas desplegables» ⊃ tabla con marco (unos 3.000 px de alto). |
| `/admin/parametros-operativos` | Card «Motor de generación de PDF» ⊃ tabla con marco. |

En `/admin/almacenamiento`, `/admin/configuracion` (vista previa de la OC), `/admin/correo-smtp` y `/admin/dte` lo anidado son `Callout` o vistas previas, que son válidos.

**Arreglo en la capa correcta** (regla «Fix shared UI at the correct layer»):
1. Agregar a `TableRoot` y a `DataTable` una prop del tipo `framed={false}` que quite el borde y el radio cuando la tabla vive dentro de una superficie. Usarla en los casos de arriba y reemplazar los ~10 `className="rounded-none border-0"` sueltos.
2. Donde la tarjeta solo pone un título (Flota «Vehículos», Panel operacional), quitar la `Card` y dejar la tabla como la única superficie, con el título como encabezado de sección.
3. Las listas de filas con borde dentro de una card (CGRD, alertas de Analítica) pasan a filas separadas por `divide-y`.
4. Corregir `border` sin color en `statement-detail.tsx:134` e `import-fuel-modal-preview.tsx:203`.

---

## 9. Re-verificación tras la implementación (rama `feat/control-operacional-uiux`)

**Implementación.** Plan `en-base-a-tus-sequential-flurry`:
- Fase 0 de contratos: `framed`, `StateBadge entity="fleet"`, `VehicleIdentity`, `source-labels` y búsqueda de Flota.
- 5 líneas en paralelo e integración. Unos 33 commits sobre `main` 6862e5b93; sin merge.

**Decisiones del usuario aplicadas:**
- C3: un caso detectado con su mes ya cerrado vence a la detección + 7 días.
- Menú reorganizado con «Configuración» plegable.
- Se quitó «Nueva faena…» del formulario de equipo (M12).

### Puertas
| Puerta | Resultado |
|---|---|
| `npm run typecheck` | limpio |
| `npm run lint` | limpio |
| `npm run build` (incluye validadores de rutas) | OK |
| `npm run test:pglite` | 378 archivos, 4.952 pruebas en verde |
| `npm run test:fast` | 1.337 archivos en verde, 4 con fallos. **Los 4 fallan igual en `main` 6862e5b93**, así que la rama no agrega ninguno (ver abajo). |
| `npm run db:verify-migrations` | 390 entradas, sin migraciones nuevas |
| `npm run test:e2e` (worktree desechable) | Suite completa: 1.121 en verde y 5 fallos, todos en specs del área (ver «E2E») |

Fallos de `test:fast` que ya estaban en `main`:
- `integration-settings-dialog.test.tsx`: 4 fallos. Buscan un `checkbox` que el `Switch` no expone.
- `operational-control-hub-attention.test.ts`: 14 fallos.
- `server-action-error-boundaries.test.ts`: 1 fallo.
- `scripts/backup-env-whitelist.test.ts`: 1 fallo.

Hay que revisarlos aparte, porque `main` está en rojo.

### E2E
Primera pasada completa: 1.136 pruebas, 1.121 en verde, 5 fallos y 6 omitidas. Causas de los fallos:
- `combustibles-control` y `control-operacional-navegacion`: un segundo «Agregar datos» en los vacíos de Fuentes. Rompía la regla del área de un botón por pantalla; se quitó y el vacío remite al de la cabecera.
- `combustibles.spec`: el localizador de «N de 5 pasos listos» chocaba con el `<strong>` que lleva la cifra.
- `mantencion-2-jefatura`: `?estado=anulado` se redirigía a «Por revisar» y escondía el registro. Ahora, si la URL trae filtros, la lista abre en «Todos».
- `mantencion-3c` y `mantencion-historico`: localizadores sobre nodos duplicados (tabla y tarjeta) y un `searchbox`.

Re-ejecución tras los arreglos:
- Mantención, repuestos y Control operacional: 96 pruebas, todas en verde.
- Combustible, Flota y Panel: 91 pruebas, todas en verde.
- `mantencion-historico`: falló una vez por un `POST` abortado al navegar (intermitente) y pasó 2 de 2 con `--repeat-each=2`.

### Navegador
Build de producción de la rama (`next start`, puerto 3002) contra `bodega_dev`, que tiene datos en toda el área.
- **Cobertura y errores.**
  - 76 rutas: el área completa, 11 fichas, las 4 pantallas externas y los dos `…/configuracion`.
  - 0 errores de consola, 0 respuestas ≥400 y 0 páginas con error.
  - Ningún desborde horizontal en las 13 rutas móviles (390 px).
- **Tarjetas dentro de tarjetas.** El detector da **0 casos reales**. Quedan solo los válidos: la zona de arrastre del importador, la caja de totales en Nueva factura y un `Callout` dentro de una tarjeta en Configuración RE-20.
- **Defectos originales, ya no se reproducen:**
  - F1: la búsqueda de la shell está visible en Conductores y Monitoreo.
  - F2: los selects de Flota vuelven a «Todos…» al limpiar la URL.
  - §8: el estado de cuenta no tiene bordes casi negros.
  - Tarjetas Copec: sin TCT/TAE y sin decimales con punto.
  - Monitoreo: sin código `ONWAY_*` y sin pestaña «Historial».
  - Por revisar: el total aparece solo en la pestaña y cada fila dice «Datos de <mes año>».
  - «Configuración» de Mantención y de Combustible redirige al primer hijo permitido.
- **Revisión visual.**
  - Panel operacional: 4 tiles arriba, desempeño como tira de texto.
  - Panel de combustible: avance solo en texto, sin bordes de color.
  - OT: pestañas por estado con el contador alineado.
  - Monitoreo: un solo bloque «Estado de las fuentes».
  - Flota: sin tarjeta «Filtros» ni «Vehículos».
- **Corregido después del recorrido, sin volver a capturar.** Íconos de los tiles del Panel de mantención, `VehicleIdentity` en la lista de OT y «tarjeta Copec» con mayúscula. Pasaron typecheck y vitest.

### Pendiente o decidido distinto
- **«Desasignar» sin confirmación:** es rutina y reversible (preferencia del usuario «confirmar sólo lo destructivo»).
- **M8:** Registros conserva su búsqueda de texto «Código o patente», en vez de un combobox de equipo.
- **«Limpiar filtros» frente a «Quitar filtros»:** sigue el verbo del `FilterToolbar` compartido; no se unificó.
- **Vocabulario del Panel operacional:** quedan «Equipos detenidos», el caption «Activos operacionales» y «Activos» en el Excel; los fijan E2E de otras áreas.
- **`RankedList`:** se conserva su rampa de opacidad de un solo tono, que DESIGN admite.
- **Fuera del área:** el documento de impresión de OT (`app/(print)`) y la app del mecánico conservan «Salida taller» y «Sr.».
- **Carpetas legacy de Combustible:** siguen los asistentes de `control/importar/**` e `importar/*`, que usa Fuentes.
