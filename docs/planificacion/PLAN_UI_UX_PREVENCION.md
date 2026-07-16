# Plan de mejora UI/UX — Programa de Prevención y módulos asociados

- **Estado:** en ejecución; decisiones D1 y D3 aplicadas de forma acotada, D2/D4/D5 parciales y D6 pendiente
- **Fecha base:** 15 de julio de 2026
- **Alcance:** experiencia de Prevención vigente después de la poda funcional de julio de 2026
- **Documento base:** `ANALISIS_PREVENCION_2026-07-15.md`

---

## 1. Resultado buscado

Transformar Prevención desde una colección plana de pantallas en un espacio de trabajo que permita responder, sin explorar varios módulos:

1. **¿Qué programa y faena estoy gestionando?**
2. **¿Qué debo hacer ahora?**
3. **¿Qué está atrasado, bloqueado o esperando aprobación?**
4. **¿Qué evidencia falta?**
5. **¿Cómo está avanzando el ciclo preventivo?**

El éxito no se medirá por agregar más tarjetas o gráficos. Se medirá por la capacidad de encontrar y completar el trabajo preventivo con menos dudas, menos retrocesos y una relación clara entre planificación, ejecución, corrección, evidencia y resultados.

### Principio rector

> El Programa de Prevención debe presentarse como un ciclo de trabajo, no como un catálogo de módulos.

La experiencia objetivo seguirá el lenguaje visual ya definido para Plataforma Chome: interfaz clara, bordes y jerarquía tipográfica por sobre sombras, color naranja reservado para atención real, densidad operativa controlada y acciones primarias en `PageHeader.actions`.

---

## 2. Alcance vigente y límites

### Incluido

El plan cubre cinco capacidades vigentes del área, más una cola transversal de acciones:

- **Programa preventivo SG-SST (PDTP):** programa anual, cronograma, ejecución, checklist, aprobación y seguimiento.
- **Evaluaciones de seguridad:** evaluaciones, detalle, checklist, historial y acciones derivadas.
- **Para, Piensa y Actúa (PPA):** registros, detenciones, revisión y seguimiento.
- **Documentación preventiva:** carpetas, documentos, versiones y evidencia.
- **Indicadores de accidentabilidad:** captura, consulta y lectura de resultados.
- **Acciones correctivas:** cola transversal de atención, manteniendo la propiedad de cada dominio.

### No incluido

- Reponer los submódulos eliminados en la poda de julio de 2026.
- Crear un nuevo modelo de incidentes, capacitaciones, IPER/MIPER u otras capacidades no vigentes.
- Fusionar de inmediato las tablas o servicios internos de PDTP, SST y PPA sin una decisión de dominio, migración y pruebas de paridad.
- Rediseñar todo el shell de la plataforma.
- Reemplazar reglas de negocio sin validación del dueño funcional.
- Automatizar indicadores manuales si no existe una regla de cálculo firmada y verificable.

Los documentos de auditoría anteriores a la poda sirven como contexto histórico, pero no como backlog actual. Este plan complementa el análisis vigente y no reabre hallazgos ya cerrados.

---

## 3. Diagnóstico verificado

### 3.1 Problema estructural

Hoy `/prevencion` abre directamente **Evaluaciones SST**. Programa, PPA, Documentación, Indicadores y Plan de acción aparecen como destinos hermanos en el menú. El usuario no recibe un punto de entrada al área ni una representación del ciclo preventivo.

Consecuencias:

- “Prevención” significa a veces el área completa y a veces solamente Evaluaciones.
- El breadcrumb de varios módulos conduce a una bandeja que no funciona como inicio.
- Las capacidades `sst`, `ppa` y `prevention` pueden habilitarse por separado; el futuro inicio debe degradarse correctamente cuando el usuario o la instalación solo tenga una parte del área disponible.
- Plan de acción parece otro módulo, aunque forma parte del trabajo derivado del programa.
- El programa anual muestra primero su catálogo, no el programa activo ni el trabajo del período.
- La vista de detalle del PDTP mezcla estado, filtros, tabla, bitácora y creación de actividades sin una prioridad inequívoca.

### 3.2 Hallazgos que afectan la confianza

| Prioridad | Hallazgo actual | Riesgo | Decisión del plan |
|---|---|---|---|
| P0 | La cola de acciones PDTP acepta una `faena` desde la URL sin aplicar siempre el alcance autorizado, y los flujos de ejecución/checklist requieren la misma revisión de alcance. | Exposición o mutación fuera de faena. | Corregir y cubrir por pruebas antes de enlazar estas colas desde el nuevo inicio. |
| P0 | La búsqueda y los contadores documentales pueden tratar un alcance `none` como global al no agregar una condición restrictiva. | Exposición de metadatos documentales. | Hacer que `none` devuelva cero resultados y cubrir listas, contadores y detalle. |
| P0 | La tarjeta PDTP del dashboard interpreta como porcentaje un valor fraccional y considera una sola faena en ciertos escenarios. | Métricas engañosas. | Unificar contrato de unidad y agregación antes de reutilizar métricas. |
| P0 | “Esta semana” filtra por cantidad planificada del mes, aunque el calendario posee mes y semana. | Trabajo actual incorrecto. | Calcular con la semana real o renombrar temporalmente la vista a “Mes actual”. |
| P0 | El formulario agrupa bajo “seguimiento” definiciones de persona e inspecciones que tienen sujetos y resultados distintos. | Flujo conceptualmente inválido. | Resolver el dominio antes de pulir el selector; ver decisión D1. |
| P1 | Varias búsquedas del TopBar están visibles pero no filtran PDTP, Evaluaciones ni otras superficies. | Pérdida de confianza y registros inaccesibles. | Toda búsqueda visible debe conectarse o desaparecer. |
| P1 | Evaluaciones carga solo 50 trabajadores, no pagina y reduce su historial a un registro por rol mediante `.find()`. | Historial oculto y mezcla de visitas independientes. | Bandeja paginada e historial cronológico explícito. |
| P1 | En móvil, `PageHeader` puede mostrar la acción sin título ni descripción. | Falta de orientación. | Corregir el patrón compartido antes de rediseñar páginas. |
| P1 | En Indicadores pueden quedar dos opciones del menú activas. | Ubicación ambigua. | Resolver el matcher y probar todos los destinos hermanos. |
| P1 | Evaluaciones muestra “cumplimiento” sin separar avance; el cierre falla recién al confirmar. | Un 100% aparente puede estar incompleto. | Separar avance y cumplimiento, mostrar pendientes y hacer preflight. |
| P2 | La matriz anual PDTP supera 19 columnas y no tiene alternativa móvil. | Flujo crítico inutilizable en terreno. | Crear vista operativa móvil y consulta anual por mes/período. |
| P2 | Indicadores usa filas clicables sin una acción explícita o equivalente completo de teclado. | Descubribilidad y accesibilidad deficientes. | Agregar acción semántica visible y estados vacíos. |

Los P0 de esta tabla provienen de una revisión complementaria del código vigente realizada el 15 de julio de 2026; no son hallazgos reabiertos del documento base, cuyo lote anterior aparece cerrado. Evidencia principal:

- alcance PDTP: `app/(app)/prevencion/pdtp/acciones/page.tsx:33-50`, `lib/services/pdtp/action-plan.ts:261-288`, `app/(app)/prevencion/pdtp/[programId]/ejecucion/[executionId]/page.tsx:23-69` y `app/(app)/prevencion/pdtp/actions/checklist-actions.ts:103-233`;
- alcance documental `none`: `lib/services/prevention-documents/search.ts:36-77` y `lib/services/prevention-documents/utils.ts:96-103`;
- fracción versus porcentaje: `lib/services/pdtp/compliance.ts:7-15,71-94` y `app/(app)/dashboard/pdtp-compliance-card.tsx:107-125`;
- semana real: `app/(app)/prevencion/pdtp/[programId]/page.tsx:90-95` y `lib/services/pdtp/sheets.ts:12-35,101-107`;
- sujeto de Evaluaciones: `lib/sst/definitions/index.ts:1-26`, `lib/validation/sst.ts:20-42` y `lib/sst/compliance.ts:158-205`.

### 3.3 Patrones existentes que deben conservarse

- PPA ya ofrece búsqueda en servidor, filtros URL-synced, paginación, tarjetas móviles y buenos estados vacíos.
- El formulario de Nueva Evaluación tiene validación contextual, foco al primer error y resumen previo a crear.
- El detalle de Evaluación ya usa navegación anterior/siguiente y divulgación progresiva para notas.
- PDTP ya soporta programa, hojas, ejecución, checklist, evidencia, aprobación, acción y seguimiento de extremo a extremo.
- `PageContainer`, `PageHeader` y el TopBar son el contrato común; el plan debe corregirlos o usarlos, no duplicarlos.

---

## 4. Usuarios y tareas prioritarias

| Rol operativo | Pregunta principal | Trabajo que debe aparecer primero |
|---|---|---|
| Prevencionista de faena | “¿Qué debo ejecutar y revisar hoy?” | Actividades de la semana, evaluaciones pendientes, PPA detenidos y acciones vencidas de sus faenas. |
| Prevencionista de oficina / jefatura | “¿Qué requiere mi decisión?” | Aprobaciones, excepciones, atrasos y comparación entre faenas autorizadas. |
| Administrador de contrato / jefe de terreno | “¿Qué compromiso me corresponde cerrar?” | Ejecuciones y acciones asignadas con fecha, evidencia y siguiente paso. |
| Conductor líder / evaluador | “¿Qué evaluación debo completar?” | Evaluaciones asignadas, avance por sección y siguiente pendiente. |
| Auditor / gerencia | “¿Qué evidencia respalda el resultado?” | Programa aprobado, trazabilidad, documentos, estado de acciones e indicadores con fuente y fecha. |
| Administrador funcional | “¿Cómo configuro el siguiente ciclo?” | Catálogos, programa borrador, responsables, permisos y consistencia de datos. |

El contenido del inicio será sensible a rol y alcance. No se debe presentar una acción que el usuario no puede completar.

---

## 5. Arquitectura de información objetivo

```text
Prevención
├── Inicio de Prevención                         /prevencion
├── Programa
│   ├── Programa preventivo SG-SST              /prevencion/pdtp
│   ├── Aprobaciones                            /prevencion/pdtp/aprobaciones?programId=...
│   └── Acciones correctivas                    /prevencion/pdtp/acciones
├── Control en terreno
│   ├── Evaluaciones de seguridad               /prevencion/evaluaciones
│   │   ├── Nueva evaluación                    /prevencion/nueva
│   │   ├── Detalle                             /prevencion/[id]
│   │   └── Historial de persona                /prevencion/trabajador/[workerId]
│   └── Para, Piensa y Actúa (PPA)              /prevencion/ppa
└── Evidencia y resultados
    ├── Documentación preventiva                /prevencion/documentacion
    └── Indicadores de accidentabilidad         /prevencion/indicadores
```

### 5.1 Decisiones de navegación

- Reservar `/prevencion` como inicio del área.
- Mover solo la bandeja actual a `/prevencion/evaluaciones`; conservar inicialmente `/prevencion/nueva`, `/prevencion/[id]` y `/prevencion/trabajador/[workerId]`, pero asociarlas al breadcrumb y estado activo de Evaluaciones.
- Mantener las rutas `/prevencion/pdtp/**` para reducir el riesgo de migración.
- Integrar **Acciones correctivas** y **Aprobaciones** como navegación del Programa en la misma entrega que retire “Plan de acción” como módulo par; nunca dejar un intervalo sin acceso visible.
- Usar etiquetas descriptivas; la sigla puede aparecer como apoyo, no como único nombre.
- Derivar o centralizar los prefijos activos del menú para que solo exista un destino activo.
- Preservar marcadores y enlaces históricos mediante redirecciones o compatibilidad de rutas explícita y probada.
- Tratar Inicio como una entrada virtual del área, visible si **cualquiera** de `sst`, `ppa` o `prevention` está habilitado y el usuario puede ver al menos una capacidad. No debe pertenecer exclusivamente al manifest `prevention`.

### 5.2 Propiedad de búsqueda por ruta

| Ruta | Contrato de búsqueda |
|---|---|
| `/prevencion` | Filtrar la cola de atención si está presente; ocultar el control si el usuario no tiene una lista buscable. |
| `/prevencion/evaluaciones` | Búsqueda propia en servidor por nombre/RUT y filtros URL-synced; ocultar la búsqueda genérica del TopBar. |
| `/prevencion/nueva`, `/prevencion/[id]`, `/prevencion/trabajador/[workerId]` | Ocultar la búsqueda genérica hasta que exista un caso de uso definido. |
| `/prevencion/pdtp/**` | Búsqueda propia sobre actividades en vistas operativas; ocultarla en configuración o detalle si no tiene consumidor. |
| `/prevencion/ppa` | Conservar su búsqueda en servidor existente. |
| `/prevencion/documentacion` | Búsqueda propia en servidor sobre el universo paginado. |
| `/prevencion/indicadores` | Ocultar búsqueda textual; usar período y faena como filtros estructurados. |

### 5.3 Navegación interna del Programa

```text
Programa preventivo SG-SST
├── Trabajo actual             vista predeterminada
├── Cronograma anual
├── Aprobaciones
├── Acciones correctivas
├── Historial y cambios
└── Configuración              solo con permiso de gestión
```

No habrá dos lugares canónicos para crear o editar una actividad. Administración mantiene catálogos base; Configuración del programa ajusta la copia anual y sus responsables.

---

## 6. Experiencia objetivo

### 6.1 Inicio de Prevención

El nuevo inicio no será un tablero de tarjetas equivalentes. Debe priorizar trabajo y excepciones:

1. **Contexto activo:** programa, faena o alcance, período y estado de aprobación.
2. **Atención requerida:** cola combinada de atrasos, pendientes y bloqueos, ordenada por urgencia y con propietario visible.
3. **Trabajo próximo:** actividades de la semana real y próximas fechas relevantes.
4. **Progreso del ciclo:** planificado, ejecutado, aprobado y verificado, con fuente y período.
5. **Accesos de módulo:** enlaces secundarios con una frase que explique su propósito y un contador útil solo cuando exista una fuente confiable.

Cada elemento de la cola debe incluir:

- tipo de registro en lenguaje humano;
- faena y período;
- responsable o rol esperado;
- vencimiento o antigüedad;
- estado y causa del bloqueo;
- una acción primaria;
- enlace profundo que preserve el contexto.

La cola será un **modelo de lectura transversal**. Cada dominio seguirá siendo dueño de su edición, permisos y reglas.

#### Contrato inicial de “Atención requerida”

La primera versión no fingirá una homogeneidad que los modelos aún no poseen:

| Fuente | Entra en v1 | Campos confiables iniciales | Campos que pueden faltar |
|---|---|---|---|
| PDTP — ejecución/aprobación | Pendiente, atrasada o esperando decisión | origen, faena, período, estado, rol siguiente, fecha planificada, enlace | usuario responsable individual, criticidad |
| PDTP — acción correctiva | Abierta, vencida o por verificar | responsable, prioridad, plazo, estado, faena, evidencia, enlace | — |
| Evaluación de persona | Borrador, seguimiento o cierre pendiente | persona, faena, rol evaluador, estado, avance, hito/fecha, enlace | prioridad uniforme |
| PPA | Por revisar o detenido | faena, estado, antigüedad, resultado y enlace | responsable, plazo, prioridad y acción estructurada hasta cerrar D5 |
| Documentación | Vencimiento, revisión u observación pendiente, después de corregir alcance | documento, faena, estado, responsable disponible, fecha y enlace | responsable en registros históricos incompletos |

- Autorizar cada fuente antes de agregarla; la capa de presentación no reemplaza el alcance del servicio.
- Ordenar primero vencidos con fecha real, luego bloqueados/detenidos, decisiones por antigüedad y próximos vencimientos.
- No inventar prioridad, responsable ni plazo. Mostrar “Sin plazo definido” o “Responsable por rol” cuando sea una verdad útil, y remitir la ausencia a D5.
- Limitar v1 a abrir el registro en su módulo de origen. La edición común depende de D5.

### 6.2 Programa preventivo SG-SST

La entrada debe abrir el programa activo y responder “qué toca hacer ahora”. El catálogo de programas e históricos pasa a segundo plano.

#### Trabajo actual

- Actividades de la semana real, atrasadas y próximas.
- Filtros por faena, responsable, estado y hoja conservados en la URL.
- Conteo de resultados y estado vacío contextual.
- Acción siguiente visible: registrar ejecución, adjuntar evidencia, completar checklist, enviar o revisar.
- Vistas de escritorio y móvil diseñadas por separado; la móvil no será la tabla anual comprimida.

#### Cronograma anual

- Mantener la matriz para planificación de escritorio.
- Ofrecer navegación por mes, trimestre u hoja en pantallas estrechas.
- Fijar contexto esencial y permitir inspeccionar una actividad sin perder la posición.
- Evitar bandas laterales de color como único diferenciador; usar texto, icono y contraste de estado.

#### Ciclo de aprobación

- Expresar las etapas completas en lenguaje humano.
- Mostrar actor, fecha, estado y próximo responsable.
- Evitar acrónimos aislados como `JDPR` o `Legal` cuando oculten la responsabilidad.
- Indicar por qué una acción está deshabilitada y qué falta para habilitarla.

#### Configuración

- Agrupar el editor en: **Datos**, **Contenido**, **Planificación** y **Verificación**.
- Definir un único punto para agregar y editar actividades.
- Explicar qué proviene del catálogo y qué se puede modificar en el programa anual.
- Proteger todo el bloque con permisos de gestión; el usuario operativo no debe verlo como trabajo cotidiano.

### 6.3 Evaluaciones de seguridad

#### Bandeja

- Búsqueda en servidor por nombre y RUT.
- Filtros URL-synced por faena, período, tipo, estado y rol pendiente.
- Paginación, total y resumen del resultado.
- Tabla semántica para escritorio y lista compacta para móvil.
- Fecha, tipo, rol, estado, avance y resultado visibles.
- Acción explícita por fila; no convertir toda la fila en un enlace ambiguo.

#### Historial

- Mostrar visitas/evaluaciones cronológicamente.
- No inferir una evaluación tripartita tomando el primer registro de cada rol.
- Si el negocio requiere agrupar roles en una visita, crear primero una definición explícita de “caso/ciclo” y su migración; no resolverlo solo en presentación.

#### Ejecución del checklist

- Separar **avance** (`respondidos / aplicables`) de **cumplimiento**.
- Mostrar pendientes por sección y una acción “Ir al siguiente pendiente”.
- Ejecutar un preflight de cierre y explicar faltantes antes de enviar.
- Deshabilitar el cierre incompleto o acompañarlo de la razón exacta.
- Anunciar estados de autoguardado con `aria-live="polite"`.
- Asociar programáticamente etiquetas, ayudas y errores con todos los controles.
- Usar objetivos táctiles mínimos de 44 × 44 px en móvil.

### 6.4 Para, Piensa y Actúa (PPA)

- Conservar su patrón sólido de filtros, paginación, estados vacíos y tarjetas móviles.
- Priorizar **por revisar** y **detenidos** antes de rankings o analítica; incorporar “acciones pendientes” solo después de cerrar D5 y disponer de acciones estructuradas.
- Mantener sus métricas como información secundaria o progresivamente desplegable.
- Usar el nombre completo “Para, Piensa y Actúa (PPA)” en navegación y contexto.
- Entrar desde Inicio con el filtro pertinente ya aplicado.
- No mezclar el modelo PPA con PDTP o Evaluaciones; compartir solo contexto, navegación y lenguaje de estado.

### 6.5 Acciones correctivas

- Crear una cola de lectura transversal para el inicio, con origen visible: PDTP, Evaluación o PPA.
- Mantener los formularios y reglas de edición dentro del dominio de origen.
- Normalizar, en la capa de lectura, los campos mínimos: origen, descripción, responsable, faena, vencimiento, criticidad, estado y enlace.
- Permitir filtros por origen, faena, responsable, estado y vencimiento.
- No mostrar una acción fuera del alcance de faenas del usuario, aunque la URL se manipule manualmente.
- Conservar trazabilidad desde la acción hasta su ejecución, evidencia y verificación.

### 6.6 Documentación preventiva

- Hacer la búsqueda realmente global mediante servidor y paginación; no filtrar solo los primeros 50 registros cargados.
- Conectar filtros de carpeta, categoría, estado y faena a la consulta real.
- Mostrar estado documental, versión, responsable y fecha de vigencia o actualización.
- En v1, permitir deep-links a una búsqueda o carpeta documental prefiltrada desde actividades, ejecuciones y acciones.
- Habilitar asociaciones persistentes solo después de cerrar D6, sin duplicar archivos.
- Mantener la biblioteca como fuente documental única.
- Evitar reponer rutas antiguas de revisión o vencimiento sin un requerimiento de producto vigente.

### 6.7 Indicadores de accidentabilidad

- Separar visualmente indicadores de resultado de señales operativas del programa.
- Mostrar período, fuente, fecha de actualización y si el valor es manual o derivado.
- Proporcionar estado vacío con una acción permitida y orientación concreta.
- Sustituir la edición oculta en toda la fila por una acción explícita, accesible con teclado.
- Crear lectura móvil sin depender de una tabla de doce meses.
- No reutilizar métricas en el inicio hasta verificar unidad, alcance y agregación.

---

## 7. Contrato compartido de interacción

Todos los módulos de Prevención deberán cumplir estas reglas:

1. **Contexto visible:** título humano, descripción corta, breadcrumb, faena/período cuando apliquen.
2. **Una acción primaria:** en `PageHeader.actions`; las acciones locales permanecen junto al objeto que afectan.
3. **Búsqueda honesta:** todo campo de búsqueda visible funciona sobre el universo declarado. Si el filtro es server-side, la búsqueda global se oculta para evitar dos contratos.
4. **Filtros persistentes:** faena, período, estado, página y vista sobreviven a navegación, cambio de selector y retorno.
5. **Estados completos:** carga, vacío inicial, cero resultados, permiso insuficiente, error recuperable y éxito.
6. **Siguiente paso:** cada estado operativo explica quién actúa y qué viene después.
7. **Color semántico:** el color refuerza texto e icono; nunca es el único portador de significado.
8. **Responsive real:** tablas operativas tienen alternativa móvil; no se resuelven solo con scroll horizontal.
9. **Accesibilidad:** WCAG 2.2 AA, teclado completo, foco visible, nombres accesibles y `prefers-reduced-motion`.
10. **Permisos y alcance:** la UI no filtra como sustituto de autorización del servidor.

### Patrón de filtros

| Necesidad | Contrato |
|---|---|
| Filtrar una lista ya cargada y acotada | TopBar mediante `searchQuery` o `DataTable.searchKeys`. |
| Buscar en un conjunto paginado o grande | Búsqueda propia URL-synced y ruta añadida a `ROUTES_WITH_OWN_SEARCH`. |
| Faena, período, estado, responsable | Filtros estructurados de página, persistidos en URL. |
| Cambiar hoja/vista | Constructor compartido de URL que preserve todos los filtros compatibles. |

---

## 8. Plan de implementación por fases

### Fase 0 — Baseline, prototipo, verdad y seguridad

**Objetivo:** conocer el punto de partida y asegurar que la futura experiencia no amplifique datos o accesos incorrectos.

- [ ] Definir las cinco tareas críticas, su guion, evento de inicio/fin, error y retroceso.
- [ ] Medir baseline cualitativo y cuantitativo con la instrumentación descrita en la sección 11.
- [ ] Crear y validar un prototipo navegable desktop/móvil de Inicio, Trabajo actual y Evaluaciones antes de implementar.
- [x] Registrar y aplicar las decisiones D1 y D3; documentar los límites operativos que mantienen D2, D4, D5 y D6 como parciales.
- [x] Aplicar alcance de faenas en el servicio de acciones PDTP, validar `faena` de la URL y proteger detalle/mutaciones de ejecución y checklist.
- [x] Corregir búsqueda y contadores de Documentación para que un alcance `none` nunca equivalga a acceso global.
- [x] Agregar pruebas negativas con una faena fuera de alcance para ejecución, checklist y acciones PDTP.
- [ ] Unificar la unidad del cumplimiento PDTP (`0–1` o `0–100`) y la agregación multifaena, incluida la tarjeta PDTP del Dashboard.
- [x] Corregir la tarjeta PDTP para interpretar la fracción `0–1` como porcentaje y ocultar la cifra cuando el alcance contiene varias faenas hasta cerrar D3.
- [x] Calcular “Esta semana” con mes y semana reales.
- [x] Corregir `PageHeader` para mostrar título, descripción y acciones en móvil.
- [x] Ocultar la búsqueda genérica del TopBar en Prevención hasta que cada pantalla implemente su contrato de búsqueda completo.
- [x] Corregir la doble selección de navegación en Indicadores.
- [x] Crear pruebas de regresión para calendario semanal, alcance, encabezado móvil, búsqueda y matcher de rutas.

**Criterio de salida:** baseline registrado, prototipo validado, D1–D3 cerradas, ninguna métrica prioritaria ambigua, ningún registro fuera de alcance consultable/modificable y ninguna búsqueda visible sin efecto.

### Fase 1 — Arquitectura, navegación e inicio

**Dependencias:** Fase 0 y D3 cerradas.

**Objetivo:** dar al área un punto de entrada claro y orientado a trabajo.

- [x] Crear `/prevencion/evaluaciones` moviendo solo la bandeja; conservar las rutas de nueva, detalle e historial descritas en 5.1.
- [x] Convertir `/prevencion` en Inicio de Prevención mediante una entrada ANY-of de los módulos `sst`, `ppa` y `prevention`.
- [x] Ocultar secciones y enlaces de módulos deshabilitados o sin permiso.
- [x] Agrupar el sidebar en Programa, Control en terreno y Evidencia y resultados.
- [x] Añadir la navegación interna de Acciones/Aprobaciones y retirar “Plan de acción” como opción par dentro de la misma entrega.
- [ ] Implementar un solo estado activo por ruta y actualizar breadcrumbs, paleta de comandos y deep-links de notificaciones.
- [ ] Construir la primera cola “Atención requerida” con el contrato limitado de 6.1, datos autorizados y enlaces al origen.
- [ ] Añadir contexto de programa, faena y período con estados explícitos para cero, uno o varios programas.
- [ ] Añadir progreso solo con fuentes verificadas; omitir bloques sin fuente antes que inventar datos.

**Criterio de salida:** desde Inicio se abre cualquier registro accionable disponible en dos clics o menos, existe una sola opción activa y cada combinación de módulos habilitados produce un inicio coherente.

### Fase 2 — Cockpit del Programa preventivo

**Dependencias:** Fase 1 y D3 cerradas con comportamiento definido para cero, uno y varios programas activos/visibles.

**Objetivo:** hacer que el trabajo actual sea la vista principal del PDTP.

- [x] Sin programa: mostrar vacío guiado y “Crear programa” solo con permiso.
- [x] Con un programa: abrirlo como contexto predeterminado.
- [x] Con varios programas: exigir selección explícita; nunca tomar silenciosamente el primero.
- [ ] Mover catálogo e históricos a una vista secundaria.
- [ ] Crear navegación interna: Trabajo actual, Cronograma, Aprobaciones, Acciones, Historial y Configuración.
- [ ] Separar la vista semanal operativa de la matriz anual.
- [ ] Implementar constructor compartido de URL que preserve hoja, faena, vista, período, estado y responsable.
- [ ] Conectar búsqueda y filtros con total de resultados.
- [ ] Diseñar una lista móvil de actividades sin scroll horizontal.
- [ ] Representar ciclo de aprobación, actores y próximos pasos con nombres completos.
- [ ] Ordenar el detalle: ejecución → evidencia → checklist → revisión → acciones.
- [ ] Consolidar creación/edición de actividades en un solo flujo.
- [ ] Diferenciar catálogos administrativos de configuración anual y ofrecer un enlace contextual a `/admin/pdtp-catalogos` solo con permiso.

**Criterio de salida:** un prevencionista completa el trabajo semanal en 320 CSS px sin abrir la matriz anual ni desplazarse horizontalmente.

### Fase 3A — Bandeja e historial de Evaluaciones

**Dependencias:** D1 y D2 cerradas.

**Objetivo:** hacer accesible cada evaluación real sin mezclar visitas o sujetos.

- [x] Aplicar la separación de persona/inspección acordada en D1; si se elige la opción corta, ocultar definiciones no válidas en este flujo.
- [x] Persistir la visita/caso y permitir elegir una visita en borrador o crear una nueva, sin inferir grupos en los históricos sin `visitId`.
- [ ] Implementar búsqueda server-side por nombre/RUT, filtros, total y paginación.
- [ ] Crear DTO de resumen; no serializar al cliente todo el historial para mostrar una fila.
- [ ] Añadir presentación móvil y acciones semánticas explícitas.
- [ ] Exponer historial cronológico completo y paginado según la agrupación acordada en D2.
- [ ] Mostrar tipo, fecha, rol, estado, avance y resultado en lenguaje humano.
- [ ] Reemplazar la carga completa de trabajadores en Nueva Evaluación por búsqueda asíncrona cuando el volumen lo justifique.

**Criterio de salida:** todo registro histórico es accesible y ninguna fila combina evaluaciones independientes.

### Fase 3B — Checklist y cierre de Evaluaciones

**Dependencias:** Fase 3A.

**Objetivo:** completar y cerrar una evaluación sin sorpresas ni barreras de acceso.

- [x] Separar avance de cumplimiento.
- [x] Mostrar pendientes por sección y “Ir al siguiente pendiente”.
- [x] Añadir preflight de cierre con razón exacta para cada bloqueo.
- [x] Corregir etiquetas, descripciones, errores, `aria-live`, foco y objetivos táctiles.
- [ ] Probar reflow, zoom/texto, teclado, foco/retorno de diálogos y anuncios dinámicos.

**Criterio de salida:** el cierre nunca descubre faltantes desconocidos y el flujo se completa con teclado, lector de pantalla y a 320 CSS px.

### Fase 4A — PPA integrado

**Objetivo:** conservar el buen flujo PPA y darle contexto dentro del ciclo preventivo.

- [x] Anteponer “por revisar” y “detenidos” a rankings y métricas.
- [x] Abrir desde Inicio con el filtro aplicado y regresar sin perder contexto.
- [x] Normalizar nombre, estados, vacíos, errores y acciones de encabezado.

**Criterio de salida:** un PPA que requiere atención se abre desde Inicio y se resuelve en su flujo actual sin perder filtros.

### Fase 4B — Acciones correctivas

**Dependencia:** D5 cerrada.

- [ ] Implementar el modelo de lectura transversal y conservar edición en origen como primera entrega.
- [ ] Si D5 aprueba una entidad común, ejecutar una fase propia de modelo, migración, compatibilidad, permisos y paridad antes de mover escrituras.
- [x] Incluir acciones PPA estructuradas al autorizar una detención, con responsable, prioridad y plazo obligatorios; rechazo no genera acción.

**Criterio de salida:** toda acción mostrada tiene origen y siguiente paso verdaderos; no se inventan responsable, prioridad o plazo.

### Fase 4C — Documentación preventiva

**Dependencias:** corrección de alcance de Fase 0; D6 solo para asociaciones persistentes.

- [x] Implementar búsqueda/paginación server-side y filtros reales.
- [x] Mostrar contadores autorizados de vencimiento, revisión, observación y acuse pendiente.
- [x] Implementar primero deep-links a búsqueda/carpeta prefiltrada.
- [ ] Si D6 lo aprueba, habilitar asociaciones persistentes con taxonomía y permisos definidos.

**Criterio de salida:** la búsqueda cubre el universo autorizado, el alcance `none` devuelve cero y todo vínculo conserva la fuente documental única.

### Fase 4D — Indicadores de accidentabilidad

**Dependencia:** D4 cerrada.

- [ ] Mostrar fuente, fecha, unidad, responsable y estado manual/importado/derivado.
- [x] Añadir estado vacío y acción explícita de edición.
- [x] Crear alternativa móvil a la tabla anual.
- [ ] Añadir meta, tendencia o comparación solo cuando exista una regla y fuente verificable.

**Criterio de salida:** cada valor visible explica período, origen y unidad; editar no depende de descubrir que toda la fila es clicable.

### Fase 5 — Piloto, calidad y despliegue

**Objetivo:** comparar el resultado contra Fase 0 y desplegar sin perder trazabilidad.

- [ ] Ejecutar una validación cualitativa con al menos un representante por rol prioritario.
- [ ] Para informar un porcentaje de éxito, reunir al menos 20 intentos de tareas distribuidos entre roles; con una muestra menor, reportar conteos y hallazgos, no “≥ 90%”.
- [ ] Comparar tiempos, clics, retrocesos, errores y claridad contra el baseline.
- [ ] Ejecutar WCAG 2.2 AA: 320 CSS px, zoom y texto al 200%, teclado completo, foco/retorno de diálogos, nombres accesibles, contraste, anuncios dinámicos y reduced motion.
- [ ] Actualizar el inventario de capturas; retirar rutas podadas y añadir rutas vivas faltantes.
- [ ] Cubrir Inicio, Programa, Acciones, Aprobaciones, Ejecución, Evaluaciones, PPA, Documentación e Indicadores en desktop y móvil.
- [ ] Resolver los escenarios PDTP omitidos en E2E o documentar por qué ya no representan el flujo canónico.
- [x] Actualizar `manual/prevencion.md`, `manual/prevencion/pdtp.md`, los manuales de módulos afectados y la documentación de navegación.
- [ ] Desplegar por fases y comparar métricas durante dos ciclos de trabajo.

**Criterio de salida:** la evidencia cumple el tamaño de muestra declarado, claridad cualitativa ≥ 4/5 y cero regresiones críticas de alcance, permisos, accesibilidad o navegación.

---

## 9. Decisiones de producto que deben cerrarse

Registrar las resoluciones en `docs/planificacion/DECISIONES_UI_UX_PREVENCION.md` y enlazarlas desde este plan. Si una decisión cambia esquema, autorización o propiedad de servicios, acompañarla además de un ADR en `docs/adr/`.

| Decisión | Responsable de cierre | Artefacto mínimo | Bloquea |
|---|---|---|---|
| D1 | Dueño funcional de Prevención + referente técnico SST/PDTP | mapa de sujetos, formulario y regla de resultado por familia | Fase 3A e inspecciones |
| D2 | Dueño funcional + responsables de los roles evaluadores | definición de visita/caso, cardinalidad y estados | Fase 3A |
| D3 | Dueño funcional PDTP + producto/UX | regla para cero, uno y varios programas/faenas | Fases 1 y 2 |
| D4 | Dueño de datos SST + referente técnico | catálogo de indicadores con fórmula, unidad, fuente y cierre | Fase 4D y métricas del Inicio |
| D5 | Dueño funcional + arquitectura + seguridad | contrato de acción, opción elegida y plan de migración si aplica | Fase 4B y edición transversal |
| D6 | Dueño documental + seguridad | taxonomía de vínculos, herencia de permisos y retención | asociaciones persistentes de Fase 4C |

### D1 — Persona versus instalación/equipo en Evaluaciones

El catálogo actual contiene evaluaciones de trabajador junto con inspecciones u observaciones, pero el formulario y la lógica de cumplimiento fuerzan trabajador, cargo y resultado de persona.

Antes de rediseñar el selector se debe elegir una opción:

- **Opción recomendada de corto plazo:** exponer en Evaluaciones de seguridad solo las definiciones válidas para persona y ejecutar desde PDTP las inspecciones ya ligadas a sus actividades.
- **Opción completa:** crear un flujo separado de Inspecciones/Observaciones con sujeto, campos, permisos, estados y reglas de resultado propios, definiendo una única puerta canónica cuando nazca desde PDTP.

No se debe maquillar esta diferencia con etiquetas distintas sobre el mismo formulario.

### D2 — Agrupación de los tres roles evaluadores

El código usa `conductor_lider`, `admin_contrato` y `prevencionista_faena`. Primero se debe confirmar si la etiqueta de negocio “Jefe de terreno” corresponde a `admin_contrato` o representa un rol distinto. Después, definir si las tres participaciones pertenecen a una única visita/caso o son evaluaciones independientes. Si forman un caso, el agrupador debe existir en el modelo, no inferirse en React mediante `.find()`.

### D3 — Programa activo multifaena

Definir si el contexto predeterminado es un único programa global con lectura por faena o programas independientes por faena. La portada y sus métricas deben seguir esa semántica y nunca elegir silenciosamente “la primera faena”.

### D4 — Fuente de indicadores

Catalogar cada indicador como manual, importado o derivado. Para los derivados se debe documentar fórmula, unidad, período, población y responsable antes de mostrarlos como dato oficial.

### D5 — Acción correctiva transversal

PDTP posee responsable, prioridad, plazo, evidencia, seguimiento y verificación; SST mantiene una acción más simple y PPA guarda texto libre. La primera entrega puede agregarlas como un modelo de lectura común, pero eso no resuelve campos ausentes ni una cola operable de punta a punta.

Se debe decidir entre:

- **Evolución incremental:** conservar escrituras por dominio, exigir un contrato mínimo y enriquecer SST/PPA hasta alcanzar trazabilidad equivalente.
- **Entidad transversal:** extraer o generalizar el motor de acciones con `sourceType/sourceId`, faena, responsable, prioridad, plazo, evidencia y verificación, acompañado de migración y pruebas de paridad.

La nueva portada no debe prometer edición uniforme hasta que esta decisión esté cerrada.

### D6 — Vínculos persistentes con Documentación

La primera versión usará deep-links de búsqueda o carpeta. Para asociar un documento permanentemente a una actividad, ejecución, evaluación o acción, definir antes:

- tipos de entidad y cardinalidad;
- quién puede crear o retirar el vínculo;
- cómo se heredan confidencialidad y alcance por faena;
- qué ocurre al archivar, reemplazar versión o eliminar el objeto de origen;
- qué información queda en auditoría.

Solo después se habilitará la capacidad persistente ya modelada o se generará una migración nueva si el contrato vigente no es suficiente.

---

## 10. Pruebas y evidencia requerida

### Unitarias y de servicio

- Alcance por faena en listas, detalle y mutaciones.
- Semántica y formato de porcentajes.
- Selección de semana real.
- Constructor de URL y preservación de filtros.
- Matcher activo de todos los destinos de Prevención.
- Contrato de evaluación según sujeto/tipo.
- Agregación de la cola transversal sin saltar permisos.

### Componentes

- `PageHeader` móvil con y sin acciones.
- Búsqueda, filtros combinados, paginación y cero resultados.
- Estados sin programa, sin faena, borrador, activo, cerrado y sin permiso.
- Avance versus cumplimiento y preflight de cierre.
- Vistas desktop/móvil de actividades, evaluaciones e indicadores.
- Etiquetas accesibles, foco, mensajes de error y autoguardado.

### Accesibilidad y reflow

- Reflow sin pérdida de información ni scroll horizontal a 320 CSS px, salvo la matriz anual especializada y con alternativa operativa disponible.
- Zoom de página y tamaño de texto al 200%.
- Recorrido completo por teclado, orden de foco y foco visible.
- Foco inicial y retorno al disparador en diálogos, sheets y confirmaciones.
- Nombre, descripción, error y estado para cada control; anuncios `aria-live` sin duplicación.
- Objetivos táctiles de al menos 44 × 44 px en flujos de terreno.
- Axe automatizado como guardrail, complementado con revisión manual de lector de pantalla.

### Playwright por rol

1. Prevencionista de faena abre un pendiente semanal, registra ejecución, adjunta evidencia y envía checklist.
2. Jefatura entra desde su cola y aprueba o devuelve con una razón.
3. Después de D5, responsable abre una acción vencida, actualiza el seguimiento y conserva trazabilidad.
4. Evaluador encuentra un trabajador por RUT, completa pendientes y cierra una evaluación.
5. Revisor abre un PPA detenido desde Inicio con el filtro ya aplicado.
6. Auditor identifica período, fuente, unidad y responsable de un indicador, sin prometer un drill-down que el origen manual no posee.
7. Usuario de una faena intenta consultar por URL un registro de otra faena y recibe una respuesta segura.
8. Usuario entra desde una notificación de Prevención, conserva el contexto autorizado y obtiene un destino útil si el registro ya no está disponible.

### Verificación técnica por pasada

- Vitest focalizado en los servicios/componentes modificados.
- ESLint focalizado.
- `npm run typecheck`.
- `npm run build` cuando cambien rutas, layouts o límites de Server/Client Components.
- React Doctor al cerrar cada fase con cambios React.
- `git diff --check` antes de dar una fase por terminada.

---

## 11. Métricas de éxito

Medir baseline antes de implementar y comparar con el piloto:

| Métrica | Objetivo inicial | Fuente de medición |
|---|---:|---|
| Éxito de las tareas críticas | ≥ 90% | Guion moderado y eventos inicio/fin; mínimo 20 intentos para reportar porcentaje. |
| Claridad percibida del área | ≥ 4/5 | Pregunta post-tarea y entrevista breve por rol. |
| Tiempo mediano para encontrar un pendiente | reducción ≥ 40% | Timestamps desde Inicio hasta apertura del registro correcto. |
| Retrocesos o entrada al módulo equivocado | reducción ≥ 50% | Secuencia de rutas anonimizada y observación del piloto. |
| Registro accionable desde Inicio | ≤ 2 clics | Prueba Playwright y verificación del prototipo. |
| Flujos móviles críticos sin cambiar a escritorio | 100% | Matriz Playwright/manual a 320, 390 y 768 CSS px. |
| Estados activos dobles en navegación | 0 | Pruebas unitarias sobre todos los destinos vivos. |
| Búsquedas visibles sin efecto | 0 | Pruebas de componente/E2E y contrato de rutas. |
| Registros fuera de alcance visibles/modificables | 0 | Pruebas negativas de servicios, páginas y Server Actions. |
| INP p75 en rutas prioritarias | < 200 ms | Web Vitals en entorno real; laboratorio solo como referencia previa. |
| Respuesta perceptible de filtro local | < 100 ms | `performance.mark/measure` sobre conjuntos representativos. |

### Instrumentación mínima

- Registrar inicio, apertura del registro correcto, finalización, abandono y cambio de módulo durante las tareas críticas.
- Asociar solo rol funcional, módulo, origen y clase de resultado; nunca enviar RUT, nombres, texto de notas ni evidencia.
- Definir qué cambio de ruta cuenta como “retroceso” antes del baseline.
- Si no existe telemetría de producto, usar observación moderada y trazas de Playwright para el baseline y declarar la limitación; no presentar INP de laboratorio como p75 real.

Las métricas de cumplimiento o avance de negocio solo se incluirán después de validar su unidad, fuente y alcance.

---

## 12. Mapa técnico inicial

| Frente | Superficies principales |
|---|---|
| Inicio y rutas | `app/(app)/prevencion/page.tsx`, nueva ruta de evaluaciones, layouts de Prevención |
| Navegación | `modules/{prevention,sst,ppa}/manifest.ts`, `modules/registry.ts`, `components/layout/nav-items.ts`, `components/layout/nav-rows.tsx` |
| Encabezado y búsqueda | `components/ui/page-header.tsx`, `components/layout/top-bar.tsx`, `components/layout/header-context.tsx` |
| Programa PDTP | `app/(app)/prevencion/pdtp/**`, `lib/services/pdtp/**` |
| Dashboard y notificaciones | `app/(app)/dashboard/**`, `app/(app)/dashboard/pdtp-compliance-card.tsx`, `components/layout/notification-bell.tsx`, `app/api/notifications/route.ts`, servicios de notificación vigentes |
| Catálogos PDTP | `app/(app)/admin/pdtp-catalogos/**`, manteniendo Administración como dueño de plantillas base |
| Acciones y alcance | `app/(app)/prevencion/pdtp/acciones/**`, `lib/services/pdtp/action-plan.ts`, acciones de ejecución/checklist |
| Evaluaciones | `app/(app)/prevencion/**`, `lib/services/sst-module/**`, `lib/sst/**`, `lib/validation/sst.ts` |
| PPA | `app/(app)/prevencion/ppa/**`, servicios PPA vigentes |
| Documentación | `app/(app)/prevencion/documentacion/**`, servicios de documentación vigentes |
| Indicadores | `app/(app)/prevencion/indicadores/**`, servicios de indicadores vigentes |
| QA visual/E2E | `scripts/capture-all-routes.ts`, `e2e/pdtp-flow.spec.ts`, pruebas de navegación y Prevención |
| Manual | `manual/prevencion.md`, `manual/prevencion/pdtp.md`, manuales de módulos asociados y `docs/diseño/DESIGN.md` si nace un patrón compartido nuevo |

La lógica de negocio nueva o corregida debe vivir en `lib/` y `app/`. Los manifests se modificarán solo para navegación, permisos y paridad de registro.

---

## 13. Secuencia recomendada de entrega

Para evitar un rediseño grande y difícil de validar, ejecutar en rebanadas utilizables:

1. **Baseline y fundación confiable:** tareas/medición, prototipo, decisiones D1–D3, alcance, porcentajes, semana real, encabezado móvil, búsqueda y estado activo.
2. **Inicio navegable:** IA, ruta de Evaluaciones, grupos del menú y primera cola autorizada.
3. **Trabajo PDTP:** programa activo, vista semanal, filtros persistentes y móvil.
4. **Evaluaciones localizables:** bandeja, historial y separación de casos/sujetos.
5. **Evaluaciones cerrables:** avance, pendientes, cierre y accesibilidad.
6. **Módulos conectados:** PPA, Acciones, Documentación e Indicadores en entregas independientes y con sus decisiones cerradas.
7. **Piloto y endurecimiento:** comparación contra baseline, pruebas por rol, manual y despliegue gradual.

Cada rebanada debe poder liberarse y medirse por sí sola. La fase siguiente no debe comenzar si la anterior dejó métricas ambiguas, accesos fuera de alcance o navegación sin una ruta canónica.

---

## 14. Registro de ejecución

Este bloque se actualizará cuando comience la implementación.

| Fecha | Fase | Cambio realizado | Evidencia | Pendiente |
|---|---|---|---|---|
| — | — | Plan inicial creado | Revisión de código, rutas, servicios y capturas actuales | Validación de IA, decisiones D1–D6 y baseline con usuarios |
| 2026-07-15 | Fase 0.1 | Alcance PDTP y Documentación, métrica PDTP, semana real, PageHeader móvil, búsqueda honesta y estado activo | 38 pruebas Vitest focalizadas, ESLint, `tsc --noEmit` y `npm run build` correctos; React Doctor 86/100 sin diagnósticos nuevos en los cambios | D1–D6, agregación multifaena y contratos de búsqueda server-side por módulo |
| 2026-07-15 | Fase 1.1 | Bandeja SST movida a `/prevencion/evaluaciones`; la ruta histórica redirige mientras se construye Inicio; manifest y estado activo conservan creación y detalle SST | 9 pruebas de navegación, ESLint, `tsc --noEmit` y `git diff --check` correctos | Inicio ANY-of, agrupación del sidebar y cola autorizada |
| 2026-07-15 | Fase 1.2 | Sidebar de Prevención agrupado y ordenado en Programa, Control en terreno y Evidencia y resultados; etiquetas de PPA y acciones aclaradas | 10 pruebas de navegación, ESLint, `tsc --noEmit` y `git diff --check` correctos | Inicio ANY-of, navegación interna de Programa y cola autorizada |
| 2026-07-15 | Fase 1.3 | `/prevencion` es Inicio virtual con acceso solo a módulos habilitados y autorizados; sin módulos visibles se niega el acceso | 12 pruebas de navegación, ESLint, `tsc --noEmit` y `git diff --check` correctos | Cola autorizada, contexto programa/faena/período y progreso con fuentes verificadas |
| 2026-07-15 | Fase 1.4 | Aprobaciones y Acciones correctivas pasan a ser destinos internos del Programa; el padre mantiene enlace directo y cada ruta activa solo su destino | 12 pruebas de navegación, ESLint, `tsc --noEmit` y `git diff --check` correctos | Cola autorizada, contexto programa/faena/período y progreso con fuentes verificadas |
| 2026-07-15 | Verificación de la rebanada | Cobertura de navegación reorganizada para permisos, toggles, rutas SST y destinos internos; normalización de lookups de navegación | 41 pruebas Vitest focalizadas, `tsc --noEmit`, ESLint, `git diff --check` y build Next con `BUILD_ID=yozUNezlKJveumYPp7jR2`; React Doctor 86/100 sin avisos nuevos de navegación | Decisiones D1–D6 y entregas funcionales restantes |
| 2026-07-15 | Fase 3B.1 | Evaluaciones separa avance de cumplimiento, anuncia el primer ítem pendiente y bloquea el cierre hasta completar respuestas aplicables | 21 pruebas de detalle/progreso, `tsc --noEmit`, ESLint y `git diff --check` correctos | Accesibilidad final de Evaluaciones y decisiones D1–D2 para bandeja/historial |
| 2026-07-15 | Fase 4D.1 | Indicadores muestra estado vacío por faena/período y botones explícitos para registrar o editar cada mes | Prueba de interfaz, `tsc --noEmit`, ESLint y `git diff --check` correctos | Fuente/unidad de métricas, alternativa móvil y comparación con reglas verificadas |
| 2026-07-15 | Fase 4D.2 | Indicadores ofrece lista mensual móvil con métricas relevantes y acciones semánticas, manteniendo la tabla para escritorio | Prueba de interfaz, `tsc --noEmit`, ESLint y `git diff --check` correctos | Fuente/unidad de métricas y comparación con reglas verificadas |
| 2026-07-15 | Verificación de la rebanada 3B/4D | Preflight de Evaluaciones e Indicadores explícitos/móviles integrados con los cambios anteriores de Prevención | Pruebas focalizadas, `tsc --noEmit`, ESLint, `git diff --check` y build Next con `BUILD_ID=kQ1ZGYNi_1VvuWbDjWdBH`; React Doctor 86/100, sin errores ni regresiones de navegación | Decisiones D1–D6 y validación de usuarios |
| 2026-07-15 | Fase 4C.1 | Documentación aplica búsqueda, categoría, estado, faena y paginación en servidor; los enlaces de carpeta conservan los filtros activos | Prueba de filtros URL, `tsc --noEmit`, ESLint y `git diff --check` correctos | Contadores autorizados y decisión D6 sobre asociaciones persistentes |
| 2026-07-15 | Fase 4C.2 | Biblioteca documental muestra atención autorizada de revisión, observaciones, acuses y vencimientos, sin mezclar datos fuera de alcance | 10 pruebas de biblioteca/filtros, `tsc --noEmit`, ESLint y `git diff --check` correctos | Decisión D6 sobre asociaciones persistentes |
| 2026-07-15 | Fase 4A.1 | PPA usa el nombre completo “Para, Piensa y Actúa” en encabezado y breadcrumb; el resultado no detenido deja de mostrarse como “Auto” | `tsc --noEmit`, ESLint y `git diff --check` correctos | Enlace desde Inicio con filtro y retorno de contexto, dependiente de la cola autorizada |
| 2026-07-15 | Fase 4A.2 | Inicio dirige PPA a “Por revisar”; los filtros/página se sincronizan con URL, el detalle conserva un retorno interno validado y la atención antecede a las métricas descriptivas | 3 pruebas Vitest de contexto URL PPA y `tsc --noEmit` correctos | Cola transversal autorizada y D5 para acciones PPA estructuradas |
| 2026-07-15 | Fase 3B.2 | Evaluaciones anuncia bloqueo, guardado y error; al ir al pendiente devuelve foco al selector de sección, amplía los controles críticos y describe el diálogo de cierre | 21 pruebas Vitest de detalle/progreso y `tsc --noEmit` correctos | Prueba manual WCAG (320 px, zoom, teclado/diálogo y reduced motion) y D1–D2 para bandeja/historial |
| 2026-07-15 | Fase 5.1 | Manuales de Prevención, Programa, Evaluaciones, PPA, Documentación e Indicadores actualizados a la navegación, contexto URL y estados reales | Revisión contra rutas y componentes vivos de Prevención | Validación manual por rol, recorrido WCAG y despliegue gradual |
| 2026-07-15 | Verificación de frentes accionables | Contexto PPA, accesibilidad de Evaluaciones y manuales integrados; el estado PPA se concentra en un reductor para evitar actualizaciones impuras | 50 pruebas Vitest focalizadas, ESLint, `tsc --noEmit`, `git diff --check` y `npm run build` correctos; React Doctor 85/100 sin errores | D1–D6, cockpit PDTP, bandeja/historial SST, contrato de indicadores y validación manual por rol |
| 2026-07-15 | Decisiones | Cuestionario explicativo creado para resolver D1–D6, la cola de Inicio, tareas críticas, piloto y despliegue | `docs/planificacion/CUESTIONARIO_DECISIONES_PREVENCION.md` | Respuestas y confirmación de responsables |
| 2026-07-16 | D1 y D2 parcial | Evaluaciones SST restringidas a sujetos persona; inspecciones se rechazan desde UI/acción; `admin_contrato` se muestra como Supervisor de faena | 38 pruebas de definiciones/acciones y ESLint focalizado correctos | Identificador persistente y estados de visita D2 |
| 2026-07-16 | D2 — visita persistente | `sst_evaluation_visits` y `visitId` separan casos reales; la creación permite elegir una visita en borrador o iniciar otra, sin mezclar históricos | Migración `0058`, 53 pruebas SST/acciones/contexto de visita, ESLint y `tsc --noEmit` correctos | Estados, cierre y una bandeja cronológica paginada por visita |
| 2026-07-16 | D3 — contexto de programa | PDTP usa año calendario y resuelve cero/uno/varios programas; con varias faenas exige elección explícita y preserva hoja/faena/vista | 9 pruebas PDTP de contexto/tabla, ESLint y `tsc --noEmit` correctos | Cockpit de trabajo actual, filtros completos y lista móvil operacional |
| 2026-07-16 | D4 parcial y D5 — acciones PPA | Supervisor de faena puede gestionar Indicadores. Autorizar un PPA detenido crea en transacción una acción estructurada con responsable, rol, plazo y prioridad; rechazo no crea acción | Migración `0059`, 12 pruebas PPA, ESLint y `tsc --noEmit` correctos | Ciclo de cierre de Indicadores; seguimiento/evidencia/verificación y cola transversal de acciones |
| 2026-07-16 | QA de cierre | Corregida la escritura impura a `localStorage` dentro del actualizador de densidad del PDTP; se mantiene el cambio de densidad sin efectos repetibles | 23 pruebas focalizadas, `tsc --noEmit`, ESLint y `git diff --check` correctos; React Doctor 82/100 sin errores | Advertencias de refactors amplios ya existentes en archivos modificados; revisar en una pasada dedicada |
| 2026-07-16 | D4 — períodos de Indicadores | Se agregó cierre persistente por faena/año/mes; solo Jefa del Departamento y Administración pueden cerrar o corregir un período cerrado | Migración `0060`, `tsc --noEmit`, ESLint y `db:generate` sin cambios posteriores | Catálogo oficial, fórmulas, unidad, tendencias y motivo/versionado de correcciones |
| 2026-07-16 | D6 — vínculos documentales | Vínculos activos/retirados para PDTP, SST, acciones y PPA; retiro lógico con motivo y auditoría, y lectura real en detalle documental | Migración `0061`, migración local aplicada, `tsc --noEmit`, ESLint y prueba de detalle documental correctos | Selector/acción de vínculo desde cada origen y validación adicional de permiso del objeto |

### Próxima decisión concreta

Validar con el dueño funcional, en una sesión corta, estas seis piezas durante la Fase 0:

1. árbol de navegación propuesto;
2. contenido de la cola “Atención requerida” por rol;
3. separación de Evaluaciones de persona e Inspecciones;
4. semántica de programa activo y métricas multifaena;
5. evolución incremental o entidad común para acciones correctivas;
6. contrato de vínculos persistentes con Documentación.

La ejecución comienza por la **Fase 0**. La nueva arquitectura de rutas e Inicio de Prevención no comienza hasta completar sus gates de seguridad y cerrar D1–D3.
