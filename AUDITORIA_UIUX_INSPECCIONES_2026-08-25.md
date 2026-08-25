# Auditoría UI/UX del flujo de Inspecciones

**Fecha:** 25 de agosto de 2026
**Método:** base de dev poblada con el servicio real + 60 capturas (escritorio 1600×1000 y teléfono 390×844) recorridas como **Jefa Dpto. Prevención**, **Prevencionista de faena** y **Jefe de terreno**, más lectura de código y dos comportamientos reproducidos en la base.
**Capturas:** `audit/screenshots/inspecciones-2026-08-25/`
**Datos:** `scripts/seed-inspecciones-demo.ts` (12 plantillas aprobadas, 8 programaciones, 59 ejecuciones en los 4 estados, 199 respuestas, 78 hallazgos).

---

## Veredicto

| Perspectiva | Nota | Lo que falla |
|---|---|---|
| Jefa de Prevención (escritorio, gestión) | **6,5 / 10** | No puede responder "¿qué le debe cada prevencionista?" ni "¿cómo cerró agosto?": no hay filtro por responsable ni por fecha. La revisión se atasca sin salida ofrecida. |
| Prevencionista de faena (teléfono, terreno) | **6 / 10** | El contador de avance miente, los ítems que faltan no son alcanzables desde el bloqueador, y el color desaparece en el teléfono justo donde hace falta. |
| Cualquier otro (jefe de terreno, admin. contrato) | **5,5 / 10** | Recibe instrucciones de pasos que no puede ejecutar y no se le dice quién sí. |

La arquitectura es buena: el orden de la bandeja está pensado por tarea, los KPI se calculan sobre el universo y no sobre la página, la segregación de revisión se valida en el servidor y **axe no reporta ni una violación** de accesibilidad en las cinco pantallas, en ambos viewports. Lo que falla es el último tramo: el sistema sabe qué falta y no lleva hasta ahí, y tres contadores dicen cosas distintas sobre el mismo avance.

---

## P0 — Riesgo de dato o de evidencia legal

### I-01 · «Crear y abrir inspección» consume ciclos del programa anual — reproducido

Cada clic materializa **y avanza `nextDueOn` un intervalo completo**, así que el segundo clic ya no cae en el mismo período y la guarda «La inspección de este período ya existe» nunca se dispara.

Medido sobre un programa mensual real de la base:

```
programa insprog-BxRbbx… · intervalo 30d · nextDueOn inicial = 2026-08-13
  clic 1: created=1 → nextDueOn = 2026-09-12
  clic 2: created=1 → nextDueOn = 2026-10-12
  clic 3: created=1 → nextDueOn = 2026-11-11
  runs creados: …@2026-08-13, …@2026-08-13→09-12, …@2026-10-12
```

Tres clics = tres ejecuciones (dos con fecha futura) y **el programa saltó tres meses**. Un doble clic por lentitud percibida se salta un mes del programa anual sin decir nada. El botón no confirma, no advierte que consume el ciclo, y su etiqueta no sugiere que tenga efecto sobre el calendario.

`lib/services/prevention-inspection-scheduler.ts:110` (avance de `nextDueOn`) + `lib/prevention/inspections.ts:680` (`nextDueAfter` siempre devuelve una fecha posterior a hoy).

### I-02 · El contador de avance contradice el gate en 11 de 12 plantillas

La barra dice `{obligatorios respondidos} de {obligatorios} obligatorios`, pero el numerador cuenta sólo ítems con `required: true` y el denominador cae a **el total** cuando no hay ninguno.

En el catálogo real **11 de 12 plantillas declaran cero ítems obligatorios**:

```
✗ Inspección de Equipos Móviles       → 0 obligatorios de 55
✗ Auditoría interna del SGSST         → 0 obligatorios de 75
✗ Inspección de Estado de Extintores  → 0 obligatorios de 10
✓ Reporte de Uso Diario de Equipos    → 5 obligatorios de 70
```

Consecuencias visibles en las capturas:

- Equipos Móviles con 24 respuestas: **«0 de 55 obligatorios · 24 de 55 totales»** — se lee como si nada obligatorio estuviera hecho.
- Auditoría del SGSST **completa**: «0 de 75 obligatorios · 75 de 75 totales» — dice 0 sobre una inspección terminada y firmada.
- Reporte de Equipos: **«5 de 5 obligatorios · 31 de 70 totales»** — se lee como *terminado* cuando el gate todavía bloquea por ~39 ítems.

Y el gate real (`assessRunCompletion`) exige **todos los ítems que puntúan**, no los marcados `required`. O sea: el número que el usuario mira y la regla que lo bloquea no son la misma. En el teléfono este contador es la tarjeta «Avance obligatorio», el único indicador de progreso.

`app/(app)/prevencion/inspecciones/[runId]/inspection-run-detail.tsx:762`

### I-03 · Dos instrumentos distintos comparten código: aprobar uno retira el otro en silencio

`Inspección de Uso y Estado de EPP (JT)` y `… EPP (PRF)` son instrumentos **de roles distintos** (jefe de terreno / prevencionista), no dos versiones del mismo. Comparten el código `inspeccion_epp`, así que `supersedePreviousApproved` retira uno al aprobar el otro.

Lo produje sin intentarlo: al aprobar el catálogo completo, `02-jt` quedó **«Reemplazada»** y `02-prf` «Aprobada». La pantalla lo presenta como una sucesión de versiones normal, la fila reemplazada **queda sin ninguna acción** (no hay cómo revisarla ni reactivarla), y nadie recibe un aviso de que el instrumento del jefe de terreno dejó de existir.

El diálogo de importación agrava la confusión: dice «Ya hay una versión vigente de esta definición» sobre instrumentos que no son versiones el uno del otro.

### I-04 · Un programa muerto se ve sano, activo y vencido

Cuando la plantilla de un programa queda `superseded`, el materializador la salta (y notifica, bien), pero **la pantalla de Programación no lo refleja**: la fila sigue mostrando «Activa: Sí», una «Próxima» fecha y un botón «Crear y abrir inspección» de aspecto operativo.

Capturado en `extra-desktop-programacion-plantilla-reemplazada.png`: la primera fila —EPP (JT), Administración, mensual, **Vencida** desde el 2026-07-31, **Activa: Sí**— no puede producir nada. La jefa que persigue sus «4 programaciones vencidas» la va a perseguir para siempre.

### I-05 · «No cumple» es el único resultado que no exige comentario

`validateAnswerRow` exige justificación (mínimo 3 caracteres) para **«No aplica»** y para **«Regular»**, y **no exige nada para «No cumple»** — el único resultado que genera un hallazgo, dispara una CAPA y queda como registro legal.

Un incumplimiento grave puede quedar registrado con el hallazgo descrito únicamente por la etiqueta del ítem. Está invertido: la respuesta más consecuente tiene el piso más bajo del formulario.

`lib/prevention/inspections.ts:264-270`

---

## P1 — El flujo se atasca y no ofrece la salida

### I-06 · El sistema sabe qué ítems faltan y no lleva hasta ellos

El diálogo «Declarar ejecutada» lista 11 ítems y **«y 21 más…»** — 31 pendientes, ninguno accionable. En escritorio los bloqueadores del panel inline tampoco son enlaces (el ancla existe sólo en el árbol móvil). El usuario cierra el diálogo y busca a mano entre 9 secciones y 55 ítems.

No hay «ir al primer ítem sin responder» en ninguna parte, ni forma de expandir el «y 21 más…».

### I-07 · La revisión bloqueada por CAPA no ofrece crear la CAPA

El diálogo «Revisar y cerrar» explica bien el bloqueo («El hallazgo … es Alta y no tiene CAPA») y deshabilita el botón, pero **no enlaza al hallazgo ni ofrece derivarlo**. Hay que cerrar, bajar más allá de 3 secciones hasta la tabla de Hallazgos, «Derivar a CAPA», y volver a abrir.

Además el botón que abre el diálogo no da ninguna pista de estar bloqueado: se descubre después de escribir el comentario.

### I-08 · La auto-revisión es un callejón sin nombre

«Tú ejecutaste esta inspección. Para conservar la revisión segregada, debe cerrarla otra persona con permiso de revisión.» — correcto y bien redactado, pero **no dice quién**, no ofrece «solicitar revisión» y no notifica a nadie. La jefa que ejecuta su propia auditoría del SGSST queda con una inspección terminada, 8 hallazgos y ninguna acción disponible.

### I-09 · El revisor no tiene navegación y ve los hallazgos al final

La barra de secciones está condicionada a `editable`, así que **desaparece justo para quien revisa**. La auditoría del SGSST son 14 secciones y 75 ítems sin índice ni saltos.

Y la tabla de Hallazgos se renderiza **después** de todo el checklist (`inspection-run-detail.tsx:1140`, tras el bucle de secciones). El trabajo del revisor son los hallazgos; el producto lo obliga a recorrer 75 filas conformes para llegar a ellos.

### I-10 · Sin responsable: la jefa no puede gestionar a su equipo

`InspectionListFilters` acepta estado, faena, tipo, búsqueda y las tres vistas rápidas. **No acepta responsable ni rango de fechas**, y la tabla no tiene columna de responsable.

- La jefa no puede responder «¿qué le debe cada prevencionista?» — la pregunta de gestión número uno.
- Nadie puede filtrar «lo mío» dentro del módulo.
- «Exportar Excel» se anuncia como filtrado pero **no hay filtro de período**, así que exportar «agosto» es imposible desde la interfaz.

En cambio la tabla sí gasta una columna entera en «Origen», que en los datos reales dice «Departamento de Prevención» en todas las filas.

### I-11 · `/prevencion` entierra el trabajo bajo 22 enlaces que ya están en la barra lateral

«Atención requerida» —la única sección accionable— aparece **después** de una lista de 22 módulos que duplica exactamente el menú lateral. En un viewport de 1000 px hay que bajar ~1.300 px para verla, y arriba de la cola aparecen revisiones de cambio de marzo: como se ordena por fecha de vencimiento, las inspecciones pendientes de revisión de hoy quedan al final.

Resultado práctico: ni la jefa ni la prevencionista ven sus inspecciones al abrir Prevención.

### I-12 · En el teléfono hay ~700 px de cabecera antes de la primera tarea

Título, descripción de tres líneas, dos botones, cuatro KPI en rejilla 2×2 y tres selectores a ancho completo. La primera tarjeta empieza cerca de y≈700 y **su botón de acción queda fuera de pantalla**. El prevencionista con guantes, a pleno sol, hace dos scrolls antes de ver una sola inspección.

En escritorio esos mismos KPI son botones-filtro sin ninguna señal de que se pueda hacer clic.

### I-13 · En el teléfono la respuesta pierde el color

En la tabla de escritorio el resultado es un badge con color (CUMPLE verde / NO CUMPLE rojo). En las tarjetas móviles es un `Select` con texto plano. Recorrer 70 tarjetas buscando las que marcaste «No cumple» es imposible en el teléfono — que es exactamente donde se ejecuta.

### I-14 · «Acreditación PDTP»: mensaje sin salida y botón que guarda nada

El diálogo dice «No hay un PDTP activo con actividades seleccionables. Activa el programa anual antes de agregar nuevas acreditaciones» — **sin enlace** a `/prevencion/pdtp` — y deja **«Guardar» habilitado** sobre un formulario vacío.

Se promete «Elige por número y nombre» y no se muestra ninguno de los dos.

### I-15 · La prevencionista de faena puede crear borradores que nunca podrá aprobar

Tiene `manage` pero no `approve`, así que ve «Incorporar borrador» y puede importar un instrumento que quedará en borrador para siempre: no hay «solicitar aprobación» ni indicación de que la habilitación es de otra persona. El diálogo lo menciona en su descripción, pero nada en la fila resultante lo recuerda.

Detalle relacionado: la cabecera muestra el chip «Tu faena: Administración» sobre un catálogo de plantillas que es **global**, no de esa faena.

---

## P2 — Consistencia, ruido y copy

| # | Hallazgo | Evidencia |
|---|---|---|
| I-16 | **Tres comportamientos de filtro en un módulo.** Bandeja: todos los filtros en la URL. Programación: 3 en estado local y sólo «Sólo vencidas» en la URL. Plantillas: los 3 en estado local. Refrescar pierde el filtro en dos de las tres pantallas. | `inspection-catalog.tsx:133,294` vs `inspection-run-list.tsx` |
| I-17 | **Tres formatos de fecha.** Bandeja `25-08-2026 13:18`; Programación `2026-07-31`; valores de ítem tipo fecha `2027-02-21`. | capturas 02 / 04 / detalle |
| I-18 | **Columnas de relleno.** «Origen» (todas iguales), «Contexto: Sin sujeto especificado» ×8, «Activa: Sí» ×8, «Desviaciones: Sin catálogo» en 8 de 9 plantillas. Ocupan el ancho que necesitan responsable y fecha. | capturas 02 / 04 / 06 |
| I-19 | **Chips de sección duplican el número:** «1. 1. Documentos», «2. 2. Estado general de cabina». El componente antepone el índice y el título ya lo trae. | `inspection-run-detail.tsx:871` |
| I-20 | **Acciones destructivas como texto plano** junto a la primaria: «Cancelar» (junto a Declarar ejecutada), «Detener» (programación), «Cerrar» (hallazgo), «Retirar» (plantilla). En móvil son objetivos táctiles sin diferenciación. | capturas de detalle y programación |
| I-21 | **El acta de cierre imprime las claves crudas del rol:** «prevencionista: Prevencionista faena · …» / «supervisor: …», en minúscula y sin mapa de etiquetas. Es la parte legal del documento. | `extra-desktop-detalle-revisable-hallazgos.png` |
| I-22 | **PDTP por número sin nombre** en la tabla de Plantillas («N° 65») y en el detalle («N° 33 al ejecutar») — pero el diálogo de importación **sí** muestra «N° 27 — Inspección Taller de Mantención…». El dato existe; dos de tres pantallas no lo usan. | capturas 06 y detalle |
| I-23 | **La descripción de Programación cita un botón que no existe:** «…«Ejecutar ahora» usa el mismo camino», y el botón se llama «Crear y abrir inspección». | captura 04 |
| I-24 | **Diálogo CAPA:** «Acción correctiva» acepta **3 caracteres** (el comentario de revisión exige 10); el plazo «Compromiso automático · 7 días» no es editable ni explica dónde cambiarlo; el campo obligatorio (Responsable) va **después** de uno opcional; y sólo él lleva asterisco. | `extra-desktop-dialog-capa.png` |
| I-25 | **Diálogo «Nueva inspección»:** ningún campo marcado obligatorio aunque Plantilla y Faena lo son; «Programada para» queda vacía por defecto, así que la inspección nace sin fecha y nunca puede aparecer como vencida; los campos de sujeto libre se ofrecen **antes** de que exista el selector de inventario (que sólo aparece al elegir faena, desplazando el formulario). | `extra-desktop-dialog-nueva-inspeccion.png` |
| I-26 | **Dos estilos de badge en la misma columna:** «EN EJECUCIÓN» en versalitas y «Pendiente de revisión» en caja de oración. | captura 02 |
| I-27 | **Pluralización con paréntesis** visible al usuario: «8 programación(es)», «cada 30 día(s)». | captura 04 |
| I-28 | **La plantilla demo vive en el catálogo real:** `INSP-DEMO · Inspección planeada`, aprobada, «0/0 con gravedad», «4 por clasificar» y 48 ejecuciones asociadas. Indistinguible de un instrumento real. | captura 06 |
| I-29 | **«Gravedad declarada: 30/75 con gravedad»** sin explicación. Es la señal de calidad más importante de un instrumento (45 ítems sin gravedad ⇒ hallazgos con criticidad por defecto) y se muestra como una fracción cruda. | captura 06 |
| I-30 | El KPI «Pendientes de revisión» cuenta todo lo `completed` del alcance, **incluidas las que el propio usuario ejecutó** y por tanto no puede revisar. Sobrestima la cola accionable de quien también ejecuta. | `prevention-inspections.ts:1922` |
| I-31 | **No hay vista rápida «Vencidas»** en la bandeja, aunque vencido es el primer criterio de ordenamiento y la pregunta principal del terreno. El único acceso a lo vencido es el KPI de *programaciones*, que lleva a otra pantalla. | captura 02 |
| I-32 | La descripción del hallazgo concatena etiqueta y comentario con dos puntos: «Manguera sin cortes ni obstrucciones.: Se detecta el incumplimiento…». Aparece así en la tabla, en el diálogo de revisión y en el de CAPA. | capturas de hallazgos |

---

## Lo que está bien (para no romperlo)

- **Accesibilidad automática limpia:** axe (`wcag2a/aa`, `wcag21a/aa`) reporta **0 violaciones** en bandeja, programación, plantillas, detalle en ejecución y detalle en revisión, en escritorio y en teléfono.
- **Orden de la bandeja por tarea:** vencidas primero (y dentro, la más antigua arriba), luego pendientes de revisión, en ejecución y planificadas. Es el orden correcto.
- **KPI sobre el universo, no sobre la página** — sobreviven a la paginación.
- **Idempotencia del materializador** por `(program_id, scheduled_for)`: el cron no duplica. (El problema de I-01 es el avance del ciclo, no la unicidad.)
- **Segregación de revisión validada en el servidor**, no sólo escondiendo el botón.
- **Alcance por faena correcto:** la prevencionista de faena ve 6 programaciones y la jefa 8; un detalle fuera de alcance da un 404 con copy honesto («no existe, fue eliminado o está fuera del alcance de tus faenas»).
- **El diálogo «Incorporar nueva versión como borrador» es el mejor de la pantalla:** explica el estado borrador, la segregación de aprobación, muestra secciones/ítems/gravedad y la actividad PDTP con nombre, y advierte sobre la versión vigente. Es el modelo que le falta a los otros.
- **Copy honesto del modo offline:** «Sólo protege el cierre cuando ya está listo; no guarda fotografías ni planillas.»
- **La evidencia fotográfica cuelga de la respuesta** y se guarda en el mismo gesto, con el mensaje que lo explica.

---

## Orden de corrección sugerido

1. **I-01** (ciclos del programa) y **I-04** (programa muerto que se ve sano) — son pérdida de evidencia del programa anual.
2. **I-02** (contador vs. gate) y **I-05** (No cumple sin comentario) — un número que miente y un registro legal vacío.
3. **I-03** (código compartido JT/PRF) — separar variante de versión, o al menos avisar y dejar acciones en la fila reemplazada.
4. **I-06, I-07, I-08** — que cada bloqueador lleve a su remedio: ancla al ítem, botón de CAPA en el diálogo, y nombrar a quién le toca revisar.
5. **I-10** — responsable como columna y como filtro, más filtro de período (que además arregla el export).
6. **I-09, I-11, I-12, I-13** — jerarquía: hallazgos antes del checklist para el revisor, navegación siempre visible, cola antes del menú en `/prevencion`, cabecera móvil comprimida y color en las respuestas.
7. El resto de P2 en una pasada de consistencia (filtros a la URL, un formato de fecha, columnas de relleno fuera, destructivas con variante propia).

---

## Riesgo residual

- No hay prueba observada con prevencionistas reales en faena, con conectividad degradada y guantes. Todo lo anterior es heurístico más código más datos.
- La base de dev quedó poblada por `scripts/seed-inspecciones-demo.ts`; **aprobar el catálogo completo es lo que destapó I-03**, así que ese estado (EPP JT reemplazada) es el que tendrá producción en cuanto alguien apruebe ambos instrumentos.
- No se auditó el flujo de impresión (`/(print)/…/print`) ni el importador de planilla física con OCR, porque ninguna de las dos rutas tiene datos sembrados.
