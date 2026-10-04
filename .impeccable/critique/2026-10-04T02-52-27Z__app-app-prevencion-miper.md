---
target: Auditoría UI UX MIPER y plan de mejora integral
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:/home/allopze/dev/chome/bodega/app/(app)/prevencion/miper"
timestamp: 2026-10-04T02-52-27Z
slug: app-app-prevencion-miper
---
# Plan de mejora UI/UX de MIPER

Fecha: 3 de octubre de 2026. Alcance: todo el submódulo. Entregable: auditoría y plan; no se modificó la aplicación.

## 1. Diagnóstico y objetivo

**MIPER tiene funciones y componentes útiles, pero obliga a entender su organización antes de poder trabajar.** La mejora debe comenzar por la primera lectura de la pantalla, la explicación del recorrido y la correspondencia entre cada rótulo y su acción. Un cambio de colores o espaciado por sí solo no resolvería el problema.

La prioridad expresada por el usuario es transversal: «todo en general, no entiendo nada a primera vista, no es nada intuitivo». Por eso este plan cubre entrada, creación, importación, navegación, edición, revisión, ejecución y consulta; no se limita a una pantalla.

Objetivo verificable: una persona que entra por primera vez reconoce **qué gestiona, en qué faena está, qué falta y dónde comenzar**, sin aprender antes la estructura del RE-04 ni leer un manual completo.

La complejidad propia de identificar peligros, evaluar riesgos y acreditar medidas debe permanecer. La interfaz debe reducir la complejidad añadida por navegación, vocabulario, repetición y destinos inesperados.

## 2. Método y límites de la auditoría

- Skill **Impeccable**, modos de evaluación `critique` y `audit`, con dos evaluaciones independientes: A (`/root/miper_design`) revisó diseño y fuente; B (`/root/miper_evidence`) obtuvo detector y evidencia de navegador. B no vio los hallazgos de A para producir su evaluación.
- Skill **web-ai-slop**, aplicada al plan para evitar agregar tarjetas, indicadores, formularios o explicaciones sin una tarea concreta que justifique su presencia.
- Contexto real: `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, manual de Prevención, diseño del 02-10, planes y reportes MIPER recientes; implementación viva en `app/` y `lib/`.
- Base del checkout al inicio: `8c699148`, con cambios previos sin commit en importación y otros archivos. La auditoría contempla el árbol de trabajo actual, no una versión limpia del commit ni producción. Durante el recorrido se registraron commits concurrentes de importación 10363dd3 y 9de01f91; no fueron commits de esta auditoría.
- Navegador autenticado local en `http://localhost:3001`, con sesión existente. Recorrido de lectura y apertura/cierre de interfaces, sin confirmar escrituras de negocio.
- El inventario exacto de capturas, comprobaciones y estados no disponibles está en [el informe de QA](qa/reports/2026-10-03-miper-uiux-audit.md). No se ejecutaron en esta auditoría las suites de pruebas que los informes anteriores declaran aprobadas.

Las conclusiones distinguen **observado en navegador**, **confirmado en fuente** y **pendiente de validar con datos/roles adecuados**. Un escáner sin alertas no demuestra una interfaz intuitiva.

## 3. Qué ya funciona y debe aprovecharse

1. La portada ya está organizada por faena, incluye faenas sin MIPER y permite iniciar una matriz.
2. La matriz ya usa actividad → tarea → riesgo. El editor ya tiene cuatro pasos, contexto, chequeo y estado de guardado automático.
3. Existen búsqueda, filtros en URL, conservación de scroll/plegados, siguiente pendiente, edición de contexto y acciones masivas.
4. El Programa ya usa tarjetas y vistas de detalle. Importar ya contempla medidas, responsables y plazos.
5. La revisión distingue la versión enviada de las ediciones posteriores y conserva roles, observaciones, versiones y trazabilidad.

Estas capacidades son la base del plan. La nueva propuesta mejora su presentación y conexión; no vuelve a proponerlas como funciones ausentes.

La revisión visual actual confirma dos efectos importantes: a **390×844 px no aparece ninguna tarea en la primera vista de la matriz**; al buscar «soldar», la primera tarea comienza en **y=999 px**. En el editor móvil sólo el paso activo conserva su nombre visible. Son evidencias directas de densidad y orientación, además de los problemas identificados en fuente.

## 4. Hallazgos que explican la confusión

Escala: S0 crítico, S1 alto, S2 medio, S3 bajo, S4 oportunidad. Prioridad de ejecución: P1 primero, P2 después, P3 cierre. La severidad UX no implica un incidente de seguridad o integridad.

| ID | Prioridad / severidad | Hallazgo y efecto | Evidencia |
|---|---|---|---|
| UX-01 | P1 / S2 | La entrada ofrece métricas, tabla, segmentos y acciones, pero no una explicación breve del recorrido ni una llamada inequívoca a continuar el trabajo. Una faena se abre haciendo clic en su nombre; la acción de continuar compite con enlaces y datos. | Portada de navegador; `miper-home.tsx`, columnas y `Worksite`. |
| UX-02 | P1 / S2 | La matriz acumula recomendación, cinco pestañas, franja documental, clasificación, filtros y contadores por actividad y tarea. La clasificación se repite a varios niveles. Sin filtro se ve estructura; al filtrar aparecen riesgos y selección: el usuario debe descubrir un cambio de presentación implícito. | Capturas de matriz y filtro de 222 riesgos; `miper-workspace.tsx:156`, `summary-strip.tsx:35`, `activity-section.tsx:35`, `matrix-view.tsx:40`. |
| UX-03 | P1 / S2 | «Riesgos completos» y «Completos» llevan a los pendientes. El texto visible y la acción tienen sentidos opuestos. | `resumen-panel.tsx:61`, `summary-strip.tsx:47`; reproducción de enlaces detallada en QA. |
| UX-04 | P1 / S2 | El editor conserva las cinco pestañas del documento y añade cuatro pasos, varias formas de avanzar y un panel de chequeo. En móvil los pasos inactivos muestran su número y ocultan el nombre visible. Es difícil reconocer qué se completa ahora y qué se abre después. | `risk-editor/risk-editor.tsx:101`, `risk-aside.tsx:23`, captura editor; ver comprobaciones móviles en QA. |
| UX-05 | P1 / S2 | El vocabulario mezcla peligro, riesgo, daño, control, medida, actividad y ocurrencia; completar datos, verificar control y cumplir una ejecución se muestran próximos, aunque son cosas distintas. Faltan ejemplos y explicaciones en el momento de decidir. | `identification-step.tsx:57`, `follow-up-step.tsx:45`, `program-activity-view.tsx`, `verify-control-form.tsx`. |
| UX-06 | P2 / S2 | Cuando existe Programa, antecede a la lista una ficha de nueve datos, el avance se repite y hay dos entradas de edición cuyo alcance no es obvio. El detalle ordena y despliega las ejecuciones cronológicamente, sin anteponer el trabajo pendiente. | Confirmado en fuente: `program-panel.tsx:310`, `program-activity-view.tsx`. El estado poblado exige datos que no existen en la matriz local recorrida. |
| UX-07 | P2 / S2 | La importación introduce requisitos técnicos y cuatro pasos; el resumen de confirmación necesita identificar mejor faena, período y destino. Cerrar descarta decisiones revisadas sin advertencia. | Primer paso visto en navegador; destinos/descarte confirmados en `import-dialog.tsx:127`, `:320`. No se importó un archivo en esta auditoría. |
| UX-08 | P2 / S2 | Verificar un control pide una referencia escrita; registrar ejecución admite archivo. La ficha de control muestra hash y cantidad de vínculos, mientras la evidencia queda como texto. La relación entre evidencia, medida y actividad no es navegable de forma clara. | Confirmado en fuente: `controles/[id]/page.tsx:55`, `verify-control-form.tsx:71`, `occurrence-dialog.tsx`. Sin control/evidencia disponibles para recorrido local. |
| UX-09 | P2 / S3 | «Seleccionar» aparece solamente al filtrar. Quien quiere actualizar varios riesgos no ve cómo iniciar ese trabajo en la estructura. | Fuente y recorrido; ya identificado en el informe de cierre anterior. |
| UX-10 | P3 / S3 | El catálogo de factores usa seis columnas sin tarjetas móviles propias. La advertencia sobre factores utilizados depende de `title`, difícil de descubrir en táctil. | `factores/risk-factors-admin.tsx:47`, `:75`. Validación del rol administrador pendiente si no está disponible en sesión. |

Accesibilidad técnica adicional: axe encontró **un hallazgo minor** de `aria-allowed-role` en la portada (`nav` con `role="group"`). Corregir en `SegmentedControl` si se confirma allí la causa compartida, y verificar consumidores. El detector de diseño obtuvo cero alertas; eso no invalida los hallazgos de comprensión y densidad. Véase QA para alcance de consola/red y estados instrumentados.

### Evaluación heurística de la fuente

Assessment A produjo **28/40**, provisional: no es una medición con usuarios nuevos ni una certificación de accesibilidad. Reconoce que existen mecanismos correctos; no contradice la dificultad de entenderlos a primera vista.

| Heurística Nielsen | 0–4 | Lectura |
|---|---:|---|
| Estado visible | 3 | Guardado y siguiente paso existentes; completitud ambigua. |
| Lenguaje del mundo real | 3 | Contexto de faena claro; términos documentales/técnicos por simplificar. |
| Control y libertad | 3 | Volver y memoria de navegación; descarte de importación insuficiente. |
| Consistencia | 3 | Primitivas compartidas; excepciones en programa, evidencia y catálogo. |
| Prevención de errores | 3 | Bloqueos y versiones; destino importado debe ser más explícito. |
| Reconocer antes que recordar | 3 | Contexto y chequeo presentes; modos y estados requieren aprendizaje. |
| Eficiencia | 3 | Filtros, lote y siguiente pendiente; ejecución histórica muy visible. |
| Minimalismo | 2 | Información y acciones secundarias compiten con el trabajo. |
| Recuperación de errores | 3 | Autosave y errores por campo; formularios auxiliares menos claros. |
| Ayuda contextual | 2 | Manual y criterios existentes; faltan explicaciones junto a decisiones. |

El diseño sí es específico de Chome: faena, período, evaluación, medidas, revisión por roles y evidencia. La oportunidad consiste en traducir esa estructura a un recorrido comprensible. La emoción predominante que buscamos cambiar es «no sé por dónde empezar» por «sé cuál es mi próximo paso»; es una hipótesis de diseño, no un resultado de investigación con usuarios.

## 5. Experiencia propuesta

### 5.1 Entrada: elegir faena y continuar

Mantener la portada por faena. Encabezado visible: **«Matriz de riesgos»**, con **«MIPER · RE-04»** como referencia secundaria y una frase: «Identifica los peligros de cada tarea, define medidas y revisa su cumplimiento».

La tabla prioriza cuatro elementos: **faena, estado del documento, trabajo pendiente y acción**. Dotación, actualización y desglose de clasificaciones pasan a información secundaria o detalle. Una columna o acción claramente rotulada «Continuar», «Revisar» o «Crear matriz» depende del rol y del estado; no se deduce solamente del nombre de la faena.

Mostrar una explicación corta y plegable «Cómo se trabaja aquí»: **Identificar → Evaluar → Definir medidas → Revisar y dar seguimiento**. No un tour obligatorio, una pared de ayuda ni cuatro nuevos KPI.

Nueva matriz y archivo Excel deben seguir siendo caminos de igual importancia. Usar un único punto de inicio «Crear matriz» que ofrezca «Completar en la plataforma» e «Importar desde Excel», reutilizando el patrón de elección de creación disponible. En contexto de una faena, preseleccionarla y mostrarla antes de continuar. «Factores de riesgo» pasa a una entrada de administración claramente secundaria para los roles autorizados.

### 5.2 Inicio del documento: saber dónde comenzar

Convertir el Resumen existente en un **inicio de trabajo**, no añadir un segundo dashboard. Primera apertura desde portada: contexto de faena/período, estado y una recomendación principal específica. Accesos posteriores o enlaces directos a tareas/riesgos conservan su destino.

Ejemplo para el borrador recorrido: «Esta matriz está en elaboración. Hay riesgos con datos pendientes». Acción principal «Continuar completando»; secundaria «Ver actividades y tareas». Si la ficha está incompleta, la recomendación muestra ese requisito primero. Los conteos proceden del mismo validador que exige el servidor.

La propuesta cambia deliberadamente la elección actual de abrir Matriz por defecto, documentada en el diseño anterior. Debe validarse como parte de este plan; no introducir el cambio sin actualizar especificación, URL y pruebas que hoy exigen ese comportamiento.

Cinco áreas pueden conservarse con nombres claros: **Inicio**, **Riesgos**, **Plan de medidas**, **Revisión** e **Historial**. «Programa de Trabajo RE-04.1» debe seguir reconocible como nombre formal en su área. La denominación final se valida con usuarios; no renombrar permisos, entidades ni documentos exportados para acomodar una etiqueta.

### 5.3 Matriz: explorar o resolver sin cambios implícitos

Hacer explícitas las dos presentaciones que hoy ya existen: **«Por actividades y tareas»** y **«Resultados de riesgos»**. Una búsqueda puede llevar a resultados, pero debe mostrar nombre de vista, cantidad y acción de volver a estructura. No añadir otra tabla ni una tercera jerarquía.

En estructura, cada actividad muestra nombre, tareas y pendientes; el desglose completo de clasificación se consulta al ampliar o desde filtros. En resultados, cada riesgo muestra peligro, tarea, clasificación y el pendiente más relevante. Menos contadores repetidos; un solo control interactivo por dimensión en cada vista.

«Seleccionar riesgos» debe ser descubrible antes de filtrar y llevar a una lista seleccionable con alcance explícito. Conservar las casillas sólo en ese modo, los controles por rol y la distinción entre seleccionar visibles y seleccionar todos los resultados. Nunca aplicar un lote fuera de la selección mostrada.

### 5.4 Editor: completar un riesgo cada vez

Conservar la edición a página completa y el guardado automático. Dar prioridad al contexto compacto «Faena → Actividad → Tarea» y al peligro actual; los campos heredados se muestran como contexto y se editan mediante una acción explícita, cuando corresponde.

Mantener cuatro bloques, con preguntas y ayuda breve:

| Bloque | Pregunta que responde | Ejemplo de ayuda |
|---|---|---|
| Identificación | ¿Qué puede causar daño? | «Peligro: piso mojado. Riesgo: resbalar. Daño probable: lesión por caída». |
| Evaluación | ¿Qué probabilidad y consecuencia tiene? | Criterios reales del RE-04 al elegir, con resultado explicado. |
| Medidas | ¿Cómo se controla y quién responde? | Distinguir medida ya implementada de medida por implementar. |
| Seguimiento | ¿Qué debe ejecutarse o revisarse? | Actividades programadas, observaciones y cambios, separados por propósito. |

El ejemplo es ilustrativo, no una evaluación predeterminada ni una instrucción de seguridad para un caso real.

Añadir avance entre **pasos**: «Continuar a Evaluación / Medidas / Seguimiento». Separarlo visualmente del avance entre **riesgos**, cuyos botones dicen «Riesgo anterior / siguiente». Mantener «Siguiente pendiente» como atajo de trabajo, explicando su alcance.

En móvil mostrar **«Paso 2 de 4 · Evaluación»** y una forma accesible de abrir el listado completo de pasos. No exigir recordar qué significan 1, 2, 3 y 4. Panel de contexto y chequeo plegables, sin duplicar la validación junto al campo. Foco y acción de continuar deben quedar accesibles con teclado virtual abierto.

### 5.5 Revisión: estado, responsable y decisión

Mostrar un recorrido breve de estados **Elaboración → Revisión técnica → Aprobación Legal/RRHH → Vigente**, con etapa actual, responsable y siguiente acción. Es representación de `states.ts`, no otra máquina de estados.

Priorizar observaciones por responder o confirmar y los cambios de la ronda. Explicar «Estás revisando la versión enviada el …; los cambios posteriores van a otra ronda». Mostrar la versión vigente y el trabajo editable como conceptos distintos, sin combinar todo en una frase difícil de leer.

Antes de enviar, presentar preparación agrupada: ficha, identificación/evaluación, medidas y vínculos requeridos. Cada grupo lleva al lugar donde se resuelve. Sustituir el modal que lista hasta 40 bloqueos por grupos útiles y acceso al conjunto completo; no truncar silenciosamente ni volver a calcular reglas en el cliente.

### 5.6 Plan de medidas: el trabajo próximo primero

Arriba: período, encargado, avance una sola vez y acción contextual. La ficha administrativa queda en «Datos del programa» plegable. «Datos de empresa» y «Responsable y fecha del programa» nombran claramente destinos distintos de edición.

La lista muestra descripción de actividad, responsable, próxima fecha, estado y acción permitida. El número formal de actividad queda secundario. Priorizar vencidas y próximas; «Historial de ejecuciones» conserva realizadas, incumplidas y reemplazadas con acceso completo.

Usar «Ejecuciones programadas» como rótulo de usuario para ocurrencias. No confundir crear una actividad, programar una ejecución, registrar que se hizo y verificar que una medida funciona. Cada acción explica el resultado que registra.

### 5.7 Importación: decisiones claras antes de escribir

Mantener cuatro pasos con resultados comprensibles: **Archivo → Revisar riesgos → Revisar medidas → Confirmar destino**.

Primera vista: faena y archivo; requisitos de formato en ayuda secundaria. Vista previa: primero «Listos / Requieren tu revisión / No se cargarán» con causas y acciones. Mantener recomendaciones editables y decisiones por valores distintos; no obligar a revisar manualmente cada fila cuando la decisión se aplica al conjunto.

Confirmación: **faena, período, documento de destino y estado**, cantidades a cargar/omitir y consecuencia sobre la revisión. «Agregar al vigente» debe explicar que no equivale a aprobar una nueva versión. Botones con verbo y destino; respetar todas las reglas existentes de importación y concurrencia.

Si ya se revisaron decisiones y se cierra, ofrecer «Continuar importación» o «Descartar». Volver a pasos anteriores conserva decisiones cuando el archivo/contexto no cambiaron. Retención tras recargar navegador sería un alcance adicional; no prometerla sin resolver almacenamiento y privacidad del archivo.

### 5.8 Verificar control y consultar evidencia

Ficha: medida, peligro/tarea, responsable, estado y última verificación. Acción «Ver evidencia» sólo cuando haya una referencia autorizada y resoluble. Cobertura PDTP muestra actividades enlazables y nombres; huella/hash se conserva en detalle de trazabilidad.

Explicar las dos evidencias: **de ejecución** («se realizó esta actividad») y **de verificación** («este control se comprobó»). No fusionar ambas ni acreditar automáticamente una a partir de la otra.

Antes de proponer un nuevo uploader, investigar la referencia actual y los selectores documentales reutilizables. Un texto libre no debe convertirse indiscriminadamente en enlace. Ampliar este contrato, si resulta necesario, es una tarea separada con autorización, acceso a archivos y pruebas de integridad.

## 6. Plan de ejecución por fases

Los tamaños son relativos: S pequeño, M medio, L grande. No son fechas comprometidas. Cada fase entrega una mejora verificable y conserva el flujo anterior hasta completar su cobertura.

| Fase | Entregable | Dependencia | Tamaño |
|---|---|---|---|
| F0 | Validar el recorrido propuesto con pantallas de portada, inicio y editor móvil; vocabulario acordado y casos de aceptación. | Auditoría actual. | M |
| F1 | Coherencia de rótulos, destinos, estados y ayuda contextual; corregir «Completos» y establecer vocabulario. | F0 para nombres; discrepancias claras pueden resolverse primero. | S–M |
| F2 | Portada orientada a continuar, inicio de trabajo y navegación explícita estructura/resultados. | F1. | L |
| F3 | Editor claro en escritorio y móvil; avance por pasos y riesgos distinguible. | F1 y contrato de navegación F2. | M–L |
| F4 | Revisión y preparación de envío, con etapas y pendientes agrupados. | F2/F3, fixtures de roles y rondas. | M |
| F5 | Programa orientado a ejecución y evidencia comprensible. | F1; fixtures de programa/control. | L |
| F6 | Importación, catálogo responsive y protección de decisiones. | F1/F2; conservar trabajo concurrente del importador. | M |
| F7 | Verificación integral de recorridos, accesibilidad y comprensión con usuarios. | F2–F6. | M |

### F0 — Validación de diseño

- Dibujar la primera vista de portada, inicio, estructura/resultados y editor móvil con contenido representativo.
- Probar con quien no conoce el submódulo y con quien lo usa habitualmente; incluir prevencionista, revisora y responsable de ejecución.
- Comprobar que importar y capturar manualmente son caminos comprensibles y equivalentes.
- Salida: decisión sobre inicio por defecto, nombres de áreas, flujo de creación y reducción de datos primarios. Actualizar la especificación vigente, sin crear una arquitectura documental contradictoria.

### F1 — Semántica y ayuda

Archivos: `resumen-panel.tsx`, `summary-strip.tsx`, `next-step-card.tsx`, `lib/prevention/miper/next-step.ts`, `risk-editor/identification-step.tsx`, `program-activity-view.tsx` y manual.

Aceptación: ningún «Completo» abre pendientes; texto visible y nombre accesible describen la misma acción; «Pendiente» indica pendiente de datos, revisión o ejecución según contexto; ejemplos ayudan a distinguir peligro/riesgo/daño; siglas explicadas sin ocupar la vista principal.

Pruebas: ampliar `resumen-panel.test.tsx`, `summary-strip.test.tsx`, `next-step.test.ts`, `program-activity-view.test.tsx`; 0, 1 y N pendientes, filtros preexistentes y enlace final.

### F2 — Entrada y estructura

Archivos: `miper-home.tsx`, `new-miper-dialog.tsx`, `miper-workspace.tsx`, `resumen-panel.tsx`, `matrix-view.tsx`, `activity-section.tsx`, `matrix-filters-bar.tsx`, `workspace-url.ts` y `workspace-memory.ts` sólo si cambia su contrato.

Aceptación: faena y período visibles; continuar tiene un destino inequívoco; la primera apertura explica el trabajo; deep links conservan destino; modo estructura/resultados reconocible; lote accesible con alcance mostrado; volver conserva filtros, plegados y scroll. No crear otra cola de negocio para la nueva presentación.

Pruebas: suites de portada/workspace/matriz/URL/memoria, E2E `prevencion-miper-matriz`, `interacciones`, `masivas` y `revision-lectura`. Actualizar conscientemente el test que hoy exige Matriz por defecto.

### F3 — Editor y móvil

Archivos: `risk-editor/risk-editor.tsx`, `risk-aside.tsx`, los cuatro pasos, `task-view.tsx`; reutilizar `Tabs`, `Field`, `ChoiceCardGroup`, `Combobox` y estado de guardado. No inventar otra abstracción de formulario.

Aceptación: acción de avanzar indica paso o riesgo; paso actual visible en 390 px; campos heredados y faltantes diferenciados; no hay overlays que oculten campos enfocados; guardado, rechazo y conflicto permanecen visibles. Los cambios de presentación no pierden parches pendientes ni alteran `expectedVersion`.

Pruebas: editor, chequeos, navegación de riesgos, autosave y conflicto; E2E `interacciones` y `flujo`; teclado, 200 % zoom, 390/768/1440 px.

### F4 — Revisión y envío

Archivos: `review-panel.tsx`, `observation-item.tsx`, `workflow-bar.tsx`, `next-step.ts` y `states.ts` sólo para adaptar la presentación de las reglas existentes.

Aceptación: remitente/revisora/Legal distinguen su tarea y la versión que deciden; bloqueos agrupados sin omisiones; cada corrección tiene destino; no aparece aprobación permitida sólo por ocultar navegación; segregación de funciones intacta.

Pruebas: `review-panel.test.tsx`, `workflow-bar.test.tsx`, `states.test.ts`, `workspace-mode.test.ts`, servicios de workflow; E2E `revision-lectura`, `flujo` y `escenario` con tres roles y ronda observada.

### F5 — Programa y evidencia

Archivos: `program-panel.tsx`, `program-action-card.tsx`, `program-activity-view.tsx`, `occurrence-dialog.tsx`, `controles/[id]/page.tsx`, `verify-control-form.tsx` y workspace para acciones en `PageHeader`.

Aceptación: actividades/ejecuciones antes de antecedentes extensos; un avance por vista; próximas/vencidas accesibles sin atravesar todo el historial; evidencia autorizada consultable; actividad, ejecución y verificación claramente distintas. Número y versión históricos preservados.

Pruebas: panel/detalle/programa/progreso, `miper-program-execution`, controles; E2E `programa`, `controles`, `escenario`. Fixtures dedicadas con programa poblado, mensual histórico, evidencia y conflicto de verificador. Si falta un contrato de referencia documental, estimarlo aparte antes de ampliar almacenamiento.

### F6 — Importación y catálogo

Archivos: `import-dialog.tsx`, `import-measures-step.tsx`, `factores/risk-factors-admin.tsx`; reutilizar selección, `Sheet`, `ConfirmDialog`, `DataTable.renderMobileCard` y reglas de importación ya existentes.

Aceptación: destino humano completo antes de cargar; descarte avisa sólo cuando hay trabajo que perder; retroceder conserva decisiones; propuestas se distinguen de valores confirmados; omisiones tienen causa; factores utilizables en táctil y advertencia de uso accesible. Ajustar sobre los cambios concurrentes existentes, sin revertirlos.

Pruebas: importador/decisiones/medidas y E2E `importacion`; archivo real en entorno de QA autorizado y un archivo con filas rechazadas; no ejecutar importaciones exploratorias en producción.

## 7. Métricas y criterios de salida

Estas son **metas propuestas**, no resultados alcanzados:

| Criterio | Cómo comprobarlo | Meta inicial |
|---|---|---|
| Comprensión inicial | Mostrar portada e inicio durante 5 segundos a 5 usuarios sin explicar. Preguntar qué gestiona, cuál es la faena/estado y dónde comenzar. | Al menos 4 de 5 responden correctamente; anotar errores, sin tratar una muestra pequeña como estadística poblacional. |
| Recorrido básico | Crear tarea, identificar riesgo, evaluar, agregar medida y localizar revisión en QA. | Al menos 4 de 5 completan el recorrido sin ayuda del moderador. |
| Semántica | Comparar texto del control y destino/resultados. | 0 discrepancias del tipo completo → pendiente. |
| Primera vista | Captura con datos reales largos, en escritorio y móvil. | Contexto y acción principal reconocibles; métricas secundarias no desplazan toda acción útil. |
| Estados distintos | Pedir que expliquen completo, Importante, control verificado y ejecución realizada. | No se infiere que completar datos equivale a controlar o cumplir. |
| Navegación | Ir a riesgo, cambiar paso, volver, recargar y usar Atrás. | Contexto/filtros y datos conservados según contrato; ausencia de saltos inesperados. |
| Accesibilidad | Axe, teclado, foco, etiquetas, contraste y zoom. | Sin hallazgos graves/críticos en lo recorrido; corregir hallazgos confirmados; prueba manual no sustituida por axe. |
| Integridad | Roles, faenas, concurrencia, snapshots y evidencia. | Reglas y permisos existentes preservados y verificados. |

No convertir «menos clics» en la única medida: evitar errores y comprender una decisión vale más que ocultar su significado.

## 8. Verificación técnica y de producto

Por fase: pruebas focalizadas, typecheck/lint pertinentes y navegador del recorrido cambiado. Antes de integrar React: `npm run doctor` según el skill del repositorio, distinguiendo avisos de línea base.

Cierre: E2E MIPER desde base dedicada, roles de faena/revisión/Legal/responsable, y datos vacíos, incompletos, observados, vigentes con cambios, programa poblado y evidencia. Reusar helpers y locators por rol; no usar `.first()` para ocultar duplicados móvil/escritorio.

No declarar cobertura de programa/control poblado basándose en la matriz local vacía en esas áreas. Probar Chrome escritorio, emulación móvil y, para recorridos de terreno, navegador móvil/Safari cuando el entorno lo permita. Emulación Chromium no certifica Safari ni lector de pantalla.

Dejar informe fechado en `qa/reports/`, actualizar `latest.md`, conservar capturas y registrar rutas, roles, consolas, red y huecos. Comparar estados y tareas antes/después; un flujo que «pasa» no basta para validar facilidad de comprensión.

## 9. Reutilización, dependencias y riesgos

Primitivas a conservar: `PageHeader`, `PageContainer`, `SummaryBar`, `FilterToolbar`, `EmptyState`, `DataTable`, `Tabs`, `Field`, `ChoiceCardGroup`, `Dialog`, `Sheet`, `ConfirmDialog`, selectores y `DatePicker`. La portada sigue conectada al buscador TopBar; workspace mantiene su excepción de búsqueda propia. Acciones de página en el header, con contexto y sin toolbars duplicados.

- **Cambiar entrada por defecto** puede desorientar usuarios habituales: validar F0 y conservar enlaces directos/continuar trabajo.
- **Ocultar información** puede perjudicar revisión experta: mover a detalle consultable, no eliminar ni resumir sin acceso al original.
- **Simplificar estados** puede mezclar datos completos con seguridad efectiva: vocabulario y entidades distintos, con fuente canónica.
- **Evidencia** puede requerir integración más allá de UI: investigar referencias actuales antes de estimar un selector o carga nueva.
- **Datos de QA insuficientes** bloquean evaluar programa, control y rondas pobladas: crear fixtures en entorno dedicado, no improvisar sobre datos operacionales.
- **Cambios concurrentes** del importador requieren reconciliación antes de implementar F6. Este plan no valida ni revierte ese trabajo.

No se prevén migraciones para claridad, presentación o navegación. Cualquier necesidad de nuevo contrato persistente debe justificarse y seguir las reglas Drizzle del repositorio; el plan UI no autoriza modificar metodología, cálculo, alcance de faena o acreditación.

## 10. Orden recomendado

Comenzar por **F0/F1/F2/F3**: primera lectura, semántica, entrada y editor. Son el núcleo de la dificultad transversal descrita. Seguir con revisión, ejecución/evidencia e importación. Terminar con validación de comprensión y cierre técnico.

La aceptación final debe responder una pregunta concreta: **¿alguien que no conoce MIPER puede comprender la pantalla y comenzar su trabajo sin que otra persona le explique cómo está organizada?**
