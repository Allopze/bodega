# Auditoría UI/UX del flujo de Inspecciones

**Fecha:** 24 de agosto de 2026  
**Perspectiva evaluada:** prevencionista de riesgos, con énfasis en trabajo de terreno  
**Estado final:** auditoría remediada localmente; implementación, pruebas y capturas finales completadas

## Veredicto actualizado después de la remediación

**Sí: el flujo ahora es suficientemente intuitivo para el trabajo habitual de un prevencionista**, tanto en escritorio como en un teléfono. La bandeja responde qué requiere atención; la ejecución móvil mantiene la pregunta, el resultado, el comentario y la evidencia en una sola unidad; y las acciones de completar, revisar o derivar explican sus condiciones antes de confirmar.

Evaluación heurística posterior a la implementación y a la revisión visual:

- Escritorio / gestión: **8,5/10**
- Teléfono / terreno: **8/10**
- Experiencia general: **8/10**

No se asigna una nota mayor porque todavía falta una prueba observada con prevencionistas reales en condiciones de faena y conectividad degradada. La capacidad offline continúa limitada al cierre ya preparado; la mejora consiste en describir ese alcance sin prometer que fotografías y documentos se encolan.

Las secciones de hallazgos conservan el diagnóstico original como línea base histórica. El estado vigente de cada hallazgo está resumido a continuación.

## Estado de remediación de los 34 hallazgos

| Grupo | Hallazgos | Estado actual | Evidencia principal |
|---|---|---|---|
| Bandeja y creación | UX-I-01, 08–14, 32, 34 | **Resueltos** | Tarjetas móviles; búsqueda y filtros coherentes; vencidas primero; exportación fiel; alta sin valores peligrosos; acciones consolidadas y pie persistente. |
| Ejecución en terreno | UX-I-02, 03, 06, 15–17, 19, 30 | **Resueltos** | Checklist móvil por tarjetas; navegación y acciones persistentes; respuesta + evidencia en un gesto; progreso obligatorio; bloqueos enlazados; ubicación persistida; copy offline exacto. |
| Reporte de Equipos, revisión y CAPA | UX-I-04, 05, 07, 18, 31 | **Resueltos** | Planilla física primero; visor de imagen/PDF; refresco sin descartar borradores; responsabilidades explícitas; auto-revisión advertida; responsable CAPA obligatorio con gravedad y plazo visibles. |
| Plantillas y programación | UX-I-20–28, 33 | **Resueltos** | Ciclo borrador/aprobación inequívoco; tarjetas y filtros móviles; PDTP por número y nombre; ejecución creada se abre; cambios de estado confirmados; intervalo efectivo explícito; sujeto/riesgo visibles. |
| Entrada diaria | UX-I-29 | **Resuelto** | Inicio de Prevención incluye ejecuciones y revisiones de inspección según los mismos estados accionables y permisos de la cola personal. |

Detalle de implementación y evidencia por ítem: `tasks/TODO_INSPECCIONES_UI_UX_2026-08-24.md`.

## Modelo actual del flujo

```text
Programación
    ↓
Inspección planificada
    ↓
Ejecución y guardado de respuestas
    ↓
Carga de evidencias
    ↓
Finalización → “Pendiente de revisión”
    ↓
Revisión segregada
    ↓
Hallazgos → CAPA / mantención / fuera de servicio
```

Para Reporte de Equipos existe una rama diferente:

```text
Registro físico → jefe de faena lo transcribe → prevencionista lo revisa
```

La interfaz ahora explica que el jefe de faena transcribe el registro físico y que la revisión corresponde a otra persona con permiso de Prevención; la misma segregación se valida en el servidor.

## Evidencia visual ejecutada

Se ejecutó el capturador oficial `scripts/capture-all-routes.ts` con Node 22.13 sobre la base PostgreSQL desechable `bodega_capture`, usando el filtro `prevencion-inspeccion` y el modo completo de interacciones.

Resultados finales posteriores a la implementación:

- **5 rutas**: bandeja, plantillas, programación, detalle y acta imprimible.
- **2 viewports**: escritorio de 1920 × 1080 y móvil de 390 × 844.
- **42 capturas** con estado `capture-ok`: 10 vistas base y 32 estados de diálogos, selectores o menús.
- Build de producción completo, TypeScript, migraciones y fixtures completados.
- Las 10 rutas base respondieron HTTP 200.
- Ningún error JavaScript de cliente.
- Ningún desbordamiento horizontal a nivel de página.
- Integridad verde: sin URL inválida, archivo faltante, huérfano, obsoleto, referencia duplicada, hash duplicado ni hash compartido.
- La primera repetición final descubrió una colisión de nombres entre dos selectores cuyas etiquetas truncadas eran iguales. Se corrigió el capturador con una prueba de regresión y se regeneró toda la evidencia; no era un defecto de la interfaz.

Evidencia representativa:

- [Bandeja en escritorio](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/desktop-prevencion-inspecciones.png)
- [Bandeja en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones.png)
- [Detalle en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspeccion-detalle.png)
- [Nueva inspección en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones-modal-auto-nueva-inspecci-n.png)
- [Plantillas en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones-plantillas.png)
- [Incorporar borrador en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones-plantillas-modal-auto-incorporar-borrador.png)
- [Nueva programación en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones-programacion-modal-auto-nuevo-programa.png)
- [Derivar a CAPA en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspeccion-detalle-modal-auto-derivar-a-capa.png)
- [Acreditación PDTP en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspecciones-plantillas-modal-auto-acreditaci-n-pdtp.png)
- [Acta en escritorio](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/desktop-prevencion-inspeccion-print.png)
- [Acta en móvil](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/mobile-prevencion-inspeccion-print.png)
- [Manifiesto completo](audit/screenshots/inspecciones-ui-ux-fixes-2026-08-24/manifest.json)

### Evidencia posterior: estados operativos que faltaban

Se añadió una segunda pasada específica sobre la base desechable `bodega_inspections_capture`, con dos fixtures persistidos y el filtro `inspecciones-evidencia`:

- **Inspección en curso:** dos de tres respuestas obligatorias guardadas, una pendiente, avance separado del cumplimiento y acciones persistentes.
- **Reporte de Equipos en transcripción:** definición completa de 70 campos, cinco valores transcritos, responsabilidad asignada a jefatura y planilla física N° 03101 servida por la ruta autenticada.
- **14 capturas `capture-ok`:** 4 vistas base —dos rutas × escritorio/móvil— y 10 estados de diálogo.
- **4/4 vistas base HTTP 200**, sin errores de cliente ni desbordamiento horizontal.
- Integridad verde: cero resultados inválidos, archivos faltantes, huérfanos, referencias duplicadas o hashes duplicados.

La primera revisión visual de esta nueva evidencia detectó tres defectos que la verificación automática no podía interpretar y que se corrigieron antes de conservar las capturas finales:

1. El standalone cambia su directorio de trabajo y buscaba la planilla en una ruta distinta a la usada por el sembrado. El capturador ahora comparte un `CAPTURE_STORAGE_PATH` absoluto y desechable, sin heredar el volumen `STORAGE_PATH` de la aplicación.
2. El tipo técnico `equipment` aparecía sin traducir. Los tipos conocidos ahora se presentan como **Equipo**, **Vehículo** o **Camión**, conservando intactos los tipos libres del usuario.
3. La evidencia por respuesta exponía el control nativo en inglés (`Choose Files`). Se reemplazó por **Adjuntar fotos**, manteniendo el input accesible y oculto.

La inspección en curso muestra en la primera pantalla móvil qué trabajo es, quién responde, cuánto falta y por qué todavía no puede cerrarse. Reporte de Equipos presenta primero el documento fuente y explica, antes del formulario, que jefatura transcribe el registro físico y Prevención realiza la revisión segregada. En escritorio, la planilla permanece a la derecha del formulario; en móvil se apila después del paso documental.

Evidencia representativa adicional:

- [Inspección en curso — escritorio](audit/screenshots/inspecciones-estados-operativos-2026-08-24/desktop-prevencion-inspeccion-en-curso.png)
- [Inspección en curso — móvil](audit/screenshots/inspecciones-estados-operativos-2026-08-24/mobile-prevencion-inspeccion-en-curso.png)
- [Reporte de Equipos — escritorio](audit/screenshots/inspecciones-estados-operativos-2026-08-24/desktop-prevencion-inspeccion-reporte-equipos.png)
- [Reporte de Equipos — móvil](audit/screenshots/inspecciones-estados-operativos-2026-08-24/mobile-prevencion-inspeccion-reporte-equipos.png)
- [Manifiesto de estados operativos](audit/screenshots/inspecciones-estados-operativos-2026-08-24/manifest.json)

La cobertura funcional completa también quedó ejecutada en Chromium: **17/17 E2E** de catálogo, programación, cierre, CAPA, flota y roles/permisos. La corrida descubrió y corrigió un caso real: una actividad PDTP ya acreditada desaparecía del selector cuando dejaba de pertenecer al programa activo; ahora se conserva rotulada como histórica y puede retirarse conscientemente.

### Límites de la evidencia visual

Los nuevos fixtures sí ejercitan visualmente una ejecución en progreso y la variante física de Reporte de Equipos. La planilla es un documento sintético de captura, no evidencia de una operación real, y la sesión corresponde a un administrador con permisos globales; no reemplaza una prueba observada iniciando sesión como jefatura y luego como Prevención.

El área principal de la aplicación utiliza un scroller interno. Por eso las capturas móviles base documentan la primera pantalla visible, no todo el contenido que se alcanza desplazándose verticalmente.

## Aspectos que funcionan bien

1. La separación entre **Inspecciones**, **Plantillas** y **Programación** es coherente.
2. Faena, sujeto, estado, responsable y fecha aparecen en la bandeja.
3. Se unifican inspecciones, observaciones y auditorías sin duplicar módulos.
4. Los bloqueos para completar indican qué respuestas obligatorias faltan.
5. Existe una cadena de trazabilidad completa entre respuestas, evidencias, hallazgos, CAPA, mantención y revisión.
6. La segregación entre ejecución y revisión es conceptualmente correcta.
7. La cola general **Mi trabajo** puede mostrar ejecuciones y revisiones pendientes según permisos.
8. Los principales estados y resultados están traducidos y cuentan con indicadores visuales.
9. El estado vacío de la bandeja distingue entre ausencia de registros y filtros sin resultados.
10. Los diálogos de **Reabrir para rectificar** y **Retirar** explican claramente sus consecuencias antes de confirmar.
11. Los selectores estructurados son legibles y mantienen objetivos táctiles razonables en móvil.
12. El acta imprimible es la superficie mejor resuelta del flujo: tiene jerarquía clara, resumen comprensible y una adaptación móvil realmente responsiva.

## Línea base histórica: hallazgos críticos y altos

> Los textos UX-I-01–34 documentan el estado observado antes de implementar. No describen la interfaz vigente; su cierre está en la matriz de remediación y en el to-do enlazado al comienzo.

### UX-I-01 — La ejecución no está diseñada realmente para teléfono

**Severidad:** crítica  
**Confirmación:** visual y técnica

El checklist es una tabla ancha con columnas para ítem, resultado, comentario y evidencia. En terreno esto obliga a desplazarse horizontalmente, trabajar con controles pequeños y perder el contexto de la pregunta.

La captura móvil confirma que sólo quedan visibles **Ítem**, **Resultado** y parte de **Comentario**. La evidencia queda fuera del encuadre. En la bandeja también desaparecen visualmente estado, fecha, cumplimiento y hallazgos; en Plantillas desaparecen las acciones. No hay sombra, degradado, flecha ni texto que comunique que la tabla continúa hacia la derecha.

Las suites móviles configuradas tampoco incluyen los escenarios de inspecciones. Por tanto, el principal flujo de terreno no tiene una garantía específica en navegadores móviles.

**Impacto:** abandono, respuestas equivocadas o captura posterior desde oficina en vez de registro inmediato.

### UX-I-02 — La acción principal queda lejos del trabajo

**Severidad:** alta  
**Confirmación:** visual y técnica

Antes del checklist aparecen hasta diez datos de contexto. La captura móvil confirma que el bloque ocupa cerca de la mitad de la primera pantalla; el primer ítem recién comienza en el borde inferior.

Los botones **Guardar**, **Completar** y **Revisar** están arriba y no son persistentes. Después de recorrer una inspección extensa, el usuario debe volver al inicio.

**Recomendación:** checklist por tarjetas o pasos, navegación por sección y barra inferior persistente con las acciones principales.

### UX-I-03 — Adjuntar fotografías exige un recorrido de dos pasadas

**Severidad:** crítica  
**Confirmación:** funcional por código; el fixture visual cerrado no ejercita la carga de fotografías

Una evidencia no puede adjuntarse hasta guardar previamente la respuesta. El usuario debe:

1. Contestar.
2. Volver al inicio.
3. Guardar.
4. Encontrar nuevamente el ítem.
5. Adjuntar la fotografía.

Esto contradice el orden natural de una inspección: resultado → comentario → foto → siguiente ítem.

### UX-I-04 — El insumo principal de Reporte de Equipos está enterrado

**Severidad:** crítica  
**Confirmación:** técnica; no cubierta por el fixture visual disponible

La carga de la planilla física aparece después del checklist y de las desviaciones, aunque para ese registro la planilla debería ser el punto de partida.

En móvil, el documento de referencia aparece después de toda la digitación. En escritorio recién se vuelve lateral en pantallas grandes.

### UX-I-05 — Se aceptan PDF, pero el visor está construido como imagen

**Severidad:** alta  
**Confirmación:** técnica; no cubierta por el fixture visual disponible

La carga acepta imagen o PDF, pero la visualización utiliza un elemento de imagen. Un PDF no se puede consultar correctamente en ese visor.

Además, la carga termina recargando la página completa, con riesgo de perder respuestas todavía no guardadas.

### UX-I-06 — “Guardar sin conexión” promete más de lo que hace

**Severidad:** crítica  
**Confirmación:** funcional por código; no cubierta por el fixture visual disponible

La función offline sólo encola el cierre cuando la inspección ya cumple las condiciones para completarse. No permite crear la inspección ni guardar progresivamente respuestas, fotografías o planillas sin conectividad.

Para una persona en faena, la etiqueta comunica que su trabajo completo está protegido. Actualmente no lo está.

### UX-I-07 — La responsabilidad del prevencionista no queda clara

**Severidad:** alta  
**Confirmación:** funcional por código y permisos; no cubierta por el usuario del fixture visual

El prevencionista puede tener permisos de ejecución y revisión. Si ejecutó la inspección, puede ver el botón **Revisar** y recién después de abrirlo descubre que no puede auto-revisarse.

En Reporte de Equipos tampoco se explica en el selector que el jefe de faena transcribe y el prevencionista realiza la revisión segregada.

### UX-I-08 — “Ejecutada” no describe la tarea pendiente

**Severidad:** alta  
**Confirmación:** por copy visible y estados del flujo

Una inspección completada pero todavía no revisada se presenta como **Ejecutada**. Desde la perspectiva operacional debería comunicar **Pendiente de revisión**. El KPI utiliza “Esperando revisión”, pero la tabla utiliza otra expresión.

### UX-I-09 — Resumen y paginación no representan todos los filtros

**Severidad:** alta  
**Confirmación:** funcional por código

El resumen se calcula sólo con el tipo de inspección, mientras la lista también puede filtrarse por estado, faena, texto y vista rápida. La paginación utiliza ese total más amplio.

Esto puede producir cantidades de páginas incorrectas, páginas vacías y KPIs que parecen contradecir la lista visible.

### UX-I-10 — “Programaciones vencidas” no lleva a programaciones vencidas

**Severidad:** alta  
**Confirmación:** funcional por código; la tarjeta engañosa quedó visible en ambos viewports

La cuarta métrica se comporta como botón, pero al pulsarla restablece la vista a todas las inspecciones, en vez de filtrar o navegar hacia programaciones atrasadas.

### UX-I-11 — El Excel no respeta todos los filtros visibles

**Severidad:** alta  
**Confirmación:** funcional por código

Aunque la interfaz indica que la exportación respeta los filtros, la URL incorpora sólo el tipo. Faena, estado, búsqueda y vista rápida no se transfieren.

### UX-I-12 — La búsqueda es inconsistente

**Severidad:** alta  
**Confirmación:** visual y por integración

- La búsqueda del TopBar sólo está conectada a la bandeja principal.
- En Plantillas, Programación y el detalle puede seguir visible, aunque no filtra nada.
- El TopBar reinicia su valor al cambiar de ruta; una URL compartida con `?q=` puede perder la búsqueda.
- En móvil el buscador del TopBar está oculto.

### UX-I-13 — “Nueva inspección” favorece errores de faena y sujeto

**Severidad:** alta  
**Confirmación:** visual y funcional

El diálogo selecciona automáticamente la primera plantilla y la primera faena. Para un prevencionista global, aceptar los valores por defecto puede crear el registro en una faena equivocada.

La evidencia lo vuelve concreto: el encabezado declara **Tu faena: Faena Mininco**, mientras **Nueva inspección** y **Nueva programación** aparecen preseleccionadas en **Faena Cabrero**. El sistema no explica esta discrepancia ni exige una elección consciente.

Al cambiar la faena no se limpia explícitamente el sujeto seleccionado anteriormente. También coexisten un selector de activo y campos libres de tipo e identificación sin explicar cuál prevalece.

### UX-I-14 — Las inspecciones vencidas pueden quedar enterradas

**Severidad:** alta  
**Confirmación:** funcional por código

La bandeja se ordena por creación reciente, no por urgencia ni fecha programada. Tampoco existe una vista efectiva de vencidas dentro del módulo.

### UX-I-15 — Progreso y cumplimiento pueden inducir a error

**Severidad:** alta  
**Confirmación:** funcional por código; el fixture visual cerrado no reproduce el caso engañoso

El progreso muestra respuestas sobre el total de ítems, aunque algunos sean opcionales. Puede permitirse completar una inspección mientras la pantalla sigue mostrando un progreso aparentemente incompleto.

El cumplimiento previsto también puede mostrar 100 % antes de responder todas las preguntas, sin explicar claramente el denominador.

### UX-I-16 — El guardado tiene confirmación débil

**Severidad:** alta  
**Confirmación:** funcional por código y contratos E2E; no cubierta por una interacción de guardado

Después de revalidar, el mensaje de éxito puede desaparecer al remontarse la pantalla. Si el usuario está abajo en una inspección extensa, tampoco obtiene confirmación próxima a su posición.

### UX-I-17 — Los bloqueos se duplican y no ayudan a corregir

**Severidad:** media  
**Confirmación:** técnica; no cubierta por el fixture visual cerrado

Los errores de filas y los bloqueos de cierre pueden repetir la misma causa en paneles diferentes. No incluyen enlaces para saltar al ítem problemático.

### UX-I-18 — CAPA puede crearse sin dueño y sin mostrar el plazo resultante

**Severidad:** alta  
**Confirmación:** visual y funcional

El diálogo permite generar una acción correctiva con **Responsable: Sin asignar** y no muestra gravedad ni fecha límite derivada de ella. La captura confirma que el botón **Derivar** permanece disponible en esa condición.

### UX-I-19 — La geolocalización carece de continuidad

**Severidad:** media  
**Confirmación:** funcional por código; no cubierta por el fixture visual

Al capturarla se muestran coordenadas momentáneamente, pero después de recargar no existe una presentación evidente de la ubicación guardada. Tampoco se explica para qué se solicita o si es obligatoria.

## Plantillas y programación

### UX-I-20 — El ciclo de publicación se contradice

**Severidad:** crítica  
**Confirmación:** visual, por copy y por contratos E2E

La captura muestra literalmente **Publicar nueva versión**, “queda vigente al incorporarla” y el botón **Incorporar**. El flujo probado, en cambio, incorpora la plantilla como borrador y exige aprobación antes de programarla.

También alterna **Publicar**, **Incorporar** y **Reemplazar** para la misma operación.

### UX-I-21 — Plantillas y programación son tablas administrativas demasiado densas

**Severidad:** alta  
**Confirmación:** visual y técnica

Ambas vistas usan tablas de muchas columnas, acciones por fila y sin alternativa móvil. Tampoco ofrecen búsqueda o filtros suficientes por tipo, estado o vigencia. En la captura móvil de Plantillas quedan fuera del encuadre el estado completo, la gravedad, PDTP, desviaciones y todas las acciones.

### UX-I-22 — La asociación PDTP es propensa a errores

**Severidad:** media  
**Confirmación:** visual y funcional

Las actividades se introducen como números separados por espacios o comas, en vez de seleccionarse por número y nombre desde el programa correspondiente.

### UX-I-23 — “Ejecutar ahora” no ejecuta ni abre la inspección

**Severidad:** alta  
**Confirmación:** funcional por código; el fixture visual no contiene programas

La acción materializa una ejecución y avanza la programación, pero no abre el nuevo registro ni muestra claramente cuál fue creado. El verbo hace pensar que comenzará la inspección.

### UX-I-24 — Activar o detener una programación no exige confirmación

**Severidad:** alta  
**Confirmación:** funcional por código; el fixture visual no contiene programas

Una pulsación puede detener futuras inspecciones sin explicar el impacto, pedir motivo ni confirmar la decisión.

### UX-I-25 — Frecuencia e intervalo pueden contradecirse

**Severidad:** media  
**Confirmación:** visual y funcional

El formulario presenta **Frecuencia: Mensual** junto a un campo independiente **Intervalo (días)**. La ayuda “Vacío = el propio de la frecuencia” no explica qué ocurrirá si ambos valores se contradicen.

### UX-I-26 — Falta contexto para reconocer una programación

**Severidad:** media  
**Confirmación:** técnica; el fixture visual no contiene programas

La tabla no muestra claramente el tipo de sujeto ni el peligro u origen de riesgo asociado. Dos programaciones con la misma plantilla y faena pueden resultar indistinguibles.

### UX-I-27 — Las acciones de página están en toolbars internos

**Severidad:** media  
**Confirmación:** visual y técnica

**Publicar nueva versión** y **Nuevo programa** aparecen dentro del panel en lugar del encabezado persistente. La captura de Programación confirma dos botones **Nuevo programa** simultáneos: uno en la esquina superior y otro en el estado vacío.

### UX-I-28 — Hay lenguaje de implementación expuesto

**Severidad:** media  
**Confirmación:** por copy; no aparece porque el fixture sí contiene una plantilla

El estado vacío de plantillas puede indicar que “falta correr el sembrado”. Esa frase no le dice a un prevencionista qué hacer ni quién debe resolverlo.

## Entrada al trabajo diario

### UX-I-29 — Inicio de Prevención puede omitir trabajo pendiente

**Severidad:** alta  
**Confirmación:** funcional por código; esta ruta no formó parte del filtro visual

La cola general **Mi trabajo** incluye inspecciones por ejecutar o revisar, pero el bloque de atención de Inicio de Prevención no las incorpora.

Un prevencionista que utilice ese inicio como bandeja principal puede ver que no tiene pendientes mientras existen inspecciones esperando su actuación.

## Hallazgos visuales y de accesibilidad técnica

### UX-I-30 — Se utiliza un token visual inexistente

**Severidad:** baja  
**Confirmación:** técnica; la captura no demuestra un defecto perceptible atribuible al token

Las celdas informativas usan `--color-surface-1`, token que no está declarado en el sistema de colores actual. Esto puede producir fondos transparentes o inconsistentes.

### UX-I-31 — Encabezado de acciones inconsistente por permisos

**Severidad:** baja  
**Confirmación:** técnica; el fixture utiliza un usuario administrador

En Hallazgos, una persona con permiso sólo de revisión puede recibir celdas de acciones sin el encabezado correspondiente porque encabezado y filas utilizan condiciones de permiso diferentes.

### UX-I-32 — Demasiadas acciones compiten antes del trabajo móvil

**Severidad:** media  
**Confirmación:** visual

En la bandeja móvil aparecen cuatro acciones de página antes de las métricas: **Nueva inspección**, **Plantillas**, **Programación** y **Exportar Excel**. Se reparten en dos filas y, junto con la descripción extensa y los cuatro KPIs, retrasan considerablemente la llegada a los filtros y a la lista.

La acción primaria queda clara, pero las tres secundarias deberían consolidarse en un menú o distribuirse en la navegación del módulo.

### UX-I-33 — Una plantilla aparece “Aprobada” y “Definición retirada” simultáneamente

**Severidad:** alta  
**Confirmación:** visual

La única fila del catálogo muestra el badge **Aprobada** y, debajo, el mensaje **Definición retirada**. No se explica si la versión sigue siendo utilizable, si sólo se retiró su fuente o si debe reemplazarse. La acción **Retirar** permanece disponible, lo que añade una tercera interpretación posible.

Para el prevencionista, un estado debe responder inequívocamente si la plantilla puede ejecutarse y programarse.

### UX-I-34 — Los formularios móviles largos ocultan la confirmación

**Severidad:** alta  
**Confirmación:** visual

En **Nueva inspección** y **Nueva programación**, el formulario excede la altura disponible y el botón final queda bajo el pliegue. El modal no presenta encabezado o pie persistente ni una señal visual clara de que debe desplazarse internamente.

Esto aumenta la sensación de formulario incompleto y dificulta terminar la tarea con una mano.

## Orden de corrección ejecutado

Los diez frentes siguientes quedaron implementados y verificados localmente; se conserva el orden para documentar la secuencia de remediación.

1. **P0 — Ejecución móvil:** tarjetas o pasos, barra inferior persistente, navegación por secciones y evidencia incorporada al mismo gesto de respuesta.
2. **P0 — Reporte de Equipos:** planilla primero, visor alternable, soporte PDF real y protección de borradores.
3. **P0 — Corregir promesas engañosas:** offline, exportación filtrada, programaciones vencidas, Ejecutar ahora y publicación de plantillas.
4. **P1 — Orientar por tarea:** Pendiente de revisión, vencidas primero, responsable esperado y auto-revisión explicada anticipadamente.
5. **P1 — Corregir bandeja:** resumen y paginación con los mismos filtros; búsqueda estable y disponible en móvil; reemplazar tablas por filas o tarjetas que muestren estado y siguiente acción sin scroll lateral.
6. **P1 — Simplificar creación:** faena explícita y coherente con el alcance activo, sujeto reiniciado al cambiar faena, tipo visible en la selección y acción final persistente en móvil.
7. **P1 — Hacer CAPA operacional:** responsable, fecha de compromiso y gravedad visibles antes de confirmar.
8. **P2 — Simplificar administración:** filtros, representación responsiva, selección PDTP con nombres y acciones en el encabezado.
9. **P2 — Incorporar inspecciones al Inicio de Prevención y a la matriz de pruebas móviles.**
10. **P2 — Corregir el estado ambiguo Aprobada / Definición retirada y reducir las acciones secundarias visibles en móvil.**

## Conclusión después de revisar las capturas finales

Las capturas finales sí cambian el veredicto de la línea base. En escritorio la bandeja conserva densidad útil sin perder la siguiente acción. En móvil, la bandeja y los catálogos ya no dependen de tablas horizontales; el detalle presenta el trabajo actual antes del contexto secundario; y los diálogos largos mantienen la confirmación visible mientras el contenido se desplaza internamente.

Desde la perspectiva del prevencionista, el flujo ahora responde con claridad cuatro preguntas: **qué debo atender, dónde debo hacerlo, qué me falta y qué consecuencia tendrá cerrar o derivar**. La terminología también distingue ejecución, revisión y trazabilidad sin exponer estados técnicos.

Riesgo residual no bloqueante:

- Reporte de Equipos y la ejecución en curso ya tienen fixtures visuales dedicados, pero todavía no una sesión observada con jefatura y Prevención reales alternando responsabilidades;
- la cola offline no incorpora fotografías ni documentos y lo declara expresamente;
- React Doctor mantiene deuda estructural en componentes grandes, aunque ya no reporta las advertencias de accesibilidad y manejo de respuestas detectadas durante esta remediación;
- la evidencia es local y no demuestra despliegue ni comportamiento en producción;
- falta una prueba observada con prevencionistas reales, idealmente en terreno, con conectividad degradada, guantes, luz exterior y un teléfono de gama media.
