# Rediseño UI/UX de la MIPER: de planilla a espacio de trabajo guiado

Fecha: 2026-10-02 · Estado: **diseño propuesto, pendiente de revisión**
Alcance: todo el submódulo `app/(app)/prevencion/miper` (portada, espacio de trabajo, matriz,
ficha del riesgo, programa, revisión, historial, importación) y lo mínimo del backend que el
rediseño necesita.
Referencia visual: `miper-web-mockup-3.html` (raíz del repo, entregado por el usuario).
Antecedente: `PLAN_REDISENO_MIPER_2026-09-30.md` (F1–F3). Su modelo de datos, flujo de revisión,
permisos y metodología RE-04 **se conservan**. Este documento reemplaza sólo su §8 (Experiencia
de usuario), y en especial el §8.2, que pedía una "grilla editable".

---

## 1. Por qué

`PRODUCT.md` lista como anti-referencia "una planilla reproducida celda por celda dentro del
navegador". El §8.2 del plan F1 pidió justamente eso, y el resultado es el RE-04 de Excel montado
en la web. El PDTP ya pasó por la misma transición y la resolvió con vistas de trabajo en lugar
de la hoja (`PDTP_COMPARATIVA_EXCEL_VS_MODULO_2026-09-16.md`). La MIPER sigue el mismo camino.

### 1.1 Evidencia

Medido con Playwright en `bodega_dev`, sobre la MIPER "Oficina Central 2099": 222 riesgos
importados del RE-04 de Biodiversa, viewport de 1440×900, sin errores de consola.

| Hallazgo | Medida |
|---|---|
| La grilla tiene 19 columnas en una tabla de 2.488 px; el área visible mide 1.126 px | Sin desplazarse se ven 8 de 19 columnas. MR/Clasificación, ¿Controlado? y Medidas, que definen el estado del riesgo, quedan fuera de pantalla. El QA del 2026-10-01 lo validó a 1920 px y dejó anotado que "< 1600 px, Medidas queda fuera de la vista". |
| Controles montados a la vez | 4.716 controles interactivos y 1.113 `<select>` nativos (5 por fila). |
| Estado del trabajo | "Con pendientes (222)" y "Enviar a revisión (222 pendientes)": todas las filas tienen bloqueos y nada indica por dónde empezar. |
| Ficha del riesgo (`?fila=`) | Diálogo de solo lectura: los campos se editan en la grilla y las medidas en la ficha. El riesgo #25, Importante y con 0 medidas, dice "exige al menos una" y no ofrece agregarla en el mismo lugar. |
| Franja de resumen | "Medidas sin responsable 0 · sin plazo 0" mientras 222 riesgos no tienen medidas: mide las medidas existentes, no los riesgos desprotegidos. |
| Importador del RE-04 | `re04-import.ts` lee "MEDIDA DE CONTROL", "RESPONSABLE" y "PLAZOS" (celdas 17, 19 y 20), pero `entryColumns` (`lib/services/miper/import.ts`) no los guarda. Las medidas del Excel se pierden y el prevencionista tiene que volver a escribirlas. |
| Defectos ya existentes (lectura de código) | "Completar antecedentes" del programa vacío no hace nada (`program-panel.tsx:225` vs `:593`). El filtro "Responsable" de "Todas" no filtra (`listMipers` no lo recibe). Los enlaces de los tiles borran los filtros activos (`dashboard.ts:159-162`). Borrar una medida no pide confirmación (`entry-sheet.tsx:83`). Una edición que falla no se revierte y los selects no muestran su error. La evidencia no se puede abrir ni descargar (`evidence-sheet.tsx`). No hay UI para vincular o desvincular medidas del programa, aunque las acciones existen. |

### 1.2 Diagnóstico por heurística

- **H8 (minimalismo):** las 19 columnas tienen el mismo peso visual. Lo que decide la acción
  (clasificación, controlado, medidas) pesa lo mismo que F/M/Otro.
- **H6 (reconocer en vez de recordar):** con scroll horizontal, la persona tiene que recordar a qué
  peligro pertenece la celda de medidas que está viendo. Los mensajes de validación sólo viven en
  tooltips `title`, que no existen en pantallas táctiles ni con teclado.
- **H1 (estado del sistema):** el guardado por celda no muestra "guardando" ni "guardado". El
  "222 pendientes" no dice qué falta ni cuál es el siguiente paso.
- **H4 (consistencia):** hay tres modelos de guardado (celda automática, botón de la medida y botón
  del formulario de antecedentes) y dos familias de controles (`<select>` nativo y `Select` de Radix).
- **H5 / H9 (errores):** una edición rechazada queda en pantalla como si se hubiera guardado, y
  borrar una medida no pide confirmación.
- **H7 (eficiencia):** no hay forma de recorrer los pendientes uno tras otro ni de aplicar la
  misma medida a varios riesgos. Tampoco se importan las medidas que ya están escritas en el Excel.

---

## 2. Decisiones

### 2.1 Tomadas por el usuario (2026-10-02)

| Tema | Decisión |
|---|---|
| Captura | Importación del RE-04 y captura en la plataforma **pesan igual**. |
| Usuario prioritario | **Prevencionista de faena**. La Jefa y Legal y RRHH usan la misma pantalla en modo revisión o lectura. |
| Distribución | La del mockup `miper-web-mockup-3.html`: portada por faena → matriz por actividad y tarea → vista de la tarea → editor del riesgo a página completa, con pasos y panel de chequeo. |
| Importar medidas | **Sí**: el importador crea las medidas, el responsable y el plazo del Excel. |
| Alcance | **Todo el módulo**. |
| Acciones masivas | **Sí, en una fase propia**. |

### 2.2 Valores por defecto que este diseño propone (confirmar antes de ejecutar)

| # | Tema | Propuesta | Motivo |
|---|---|---|---|
| D1 | "Riesgo residual" del mockup | **No se implementa.** La evaluación es una sola (P×C del RE-04) más "¿Está controlado?". | El RE-04 no tiene evaluación residual, y el F1 la eliminó a propósito (brecha B1). Agregarla exigiría cambiar el esquema y el formato exportado. |
| D2 | Escala del mockup (1–4, "Bajo / Moderado / Alto") | Se usa la del RE-04: P y C ∈ {1, 2, 4}; MR → Tolerable / Moderado / Importante / Intolerable. | Así lo definen la metodología `RE-04-CHOME` y las columnas generadas, que son la autoridad. |
| D3 | Jerarquía "Proceso › Actividad › Tarea" | **Actividad › Tarea**. Puesto y lugar se muestran en cada riesgo. | Son los dos niveles del RE-04. En el RE-04 real la misma tarea aparece con varios puestos (F1 §4.2). |
| D4 | Guardado | **Automático por campo**, con estado visible ("Guardando…", "Guardado", "No se guardó: …") y reversión si falla. No hay botón global "Guardar cambios". | Así un solo modelo de guardado sirve para todo el editor. Usa el contrato existente: parche parcial con `expectedVersion`. |
| D5 | Medidas "Existente / Pendiente" del mockup | Se usa la columna **ya existente** `prevention_risk_controls.is_existing`, que el flujo actual no ocupa. **El plazo pasa a ser obligatorio sólo para medidas por implementar**; una medida existente pide tipo, descripción y responsable (salvo en Tolerable). | En el RE-04 real, la columna de medidas lista mayormente controles **ya en operación** (167 de 230 filas dicen "PARCIALMENTE CONTROLADO"). Pedirles fecha de plazo inventa datos. Es un **cambio de regla de negocio**: va al inicio de la Fase C y necesita confirmación. |
| D6 | Columna "PLAZOS" del Excel | En la vista previa, cada valor distinto se mapea una vez. Por defecto, "TRIMESTRAL" y similares → medida existente, con ese texto como frecuencia de verificación. "INMEDIATO…" → medida por implementar, con la fecha que se elija en la vista previa (por defecto, el día de la importación). | En el RE-04 de Biodiversa hay 5 valores distintos: TRIMESTRAL (178), INMEDIATO / ANTES DE CONTINUAR LA TAREA (46) y otros tres de 2 filas cada uno. Ninguno es una fecha. |
| D7 | Estética del mockup (barra lateral oscura, topbar propio) | **No se adopta.** Rige el estándar visual de la plataforma (`AGENTS.md` §7, `DESIGN.md`). Se adopta la estructura, la jerarquía y los componentes de contenido. | Cambiar el shell afectaría a toda la plataforma. |
| D8 | Buscador propio de la portada (mockup) | **No se adopta**: la portada usa la búsqueda del TopBar a través de `DataTable` (regla 1 de layout). El espacio de trabajo sí tiene buscador propio (ya está en `OWN_SEARCH_PATTERNS`). | Reglas de layout y de búsqueda del repo. |
| D9 | Antecedentes | Salen de las pestañas y pasan a **"Ficha del documento"**, una acción de cabecera que abre un `Sheet` (`?ficha=1`). | Así lo propone el mockup, y deja la matriz como vista por defecto. |
| D10 | Cuarto paso del editor | En lugar de "Riesgo residual": **"Seguimiento"**, con las actividades del programa vinculadas, las observaciones y los cambios contra la ronda anterior. | Es la trazabilidad del F1 §7.3, que hoy está escondida en la ficha. |

### 2.3 Del mockup a la plataforma

| Mockup | Implementación |
|---|---|
| Portada "MIPER por faena": filas por faena (incluidas las que no tienen MIPER) con estado, dotación, actualización y avance | Fase B, con `DataTable` (`renderRow` + `renderMobileCard`). Avance = riesgos sin pendientes ÷ riesgos. La pestaña "Por hacer" pasa a un segmento "Requieren mi acción (n)". |
| Franja de 4 cifras en la portada | `SummaryBar`. Cada cifra filtra la lista (regla A1). |
| Barra de contexto (volver, cambio de faena, versión, responsable, estado) | Migas + cabecera. El selector de faena se agrega en la Fase B. |
| Pestañas Resumen · Matriz · Historial | Resumen (Fase B) · **Matriz** · Programa · Revisión · Historial. El Programa se queda: es el RE-04.1 propio de esta MIPER (decisión F1). |
| Franja del documento (centro, trabajadores, tareas, peligros, actualización) | `SummaryStrip` en texto (A1), con otro alcance (§5.3). |
| Búsqueda + "Filtros (2)" en un cajón + "Contraer todo" + "Añadir tarea" | Buscador propio, `FilterToolbar` (cajón con contador y chips) y "Contraer todo". "Nueva tarea" va en `PageHeader.actions` (regla 5). |
| Tarjeta de proceso → actividad → fila de tarea con chips por nivel y "2/3 completos" | Tarjeta de **actividad** → fila de **tarea** con chips por clasificación y "x/y completos". |
| Vista de la tarea: franja de contexto + lista de peligros con puntaje inicial y residual | Vista de la tarea. Cada fila muestra MR + clasificación (una sola evaluación), ¿controlado?, medidas y estado. |
| Editor del riesgo con 4 pasos fijos, panel de chequeo y "Guardado automáticamente" | Editor del riesgo con pasos **Identificación · Evaluación · Medidas · Seguimiento** (D10), panel lateral (contexto, chequeo, nivel) y estado de guardado (D4). |
| Selección por tarjetas para P y C, puntaje grande y leyenda | `PcChoice`, construido sobre `SelectableCard` con `role="radiogroup"` y los textos del RE-04. |
| Lista de medidas con tipo, "Existente / Pendiente", responsable, plazo y estado | Tarjetas de medida; "Existente" a partir de la Fase C (D5). |
| Diálogo "Nueva actividad / tarea" | Diálogo "Nueva tarea", que crea el **primer riesgo** de la tarea y abre su editor. Una tarea sin riesgos no existe en el RE-04. |

---

## 3. Arquitectura de información

Las rutas no cambian. Las vistas viven en la URL del espacio de trabajo, así los enlaces de
notificaciones (`?fila=`, `?tab=revision`, `?tab=programa`) siguen funcionando.

| Parámetro | Valores | Navegación |
|---|---|---|
| `tab` | `resumen` (Fase B) · `matriz` (por defecto; no se escribe) · `programa` · `revision` · `historial`. `antecedentes` es un alias heredado que abre la ficha. | `router.replace(…, { scroll: false })` |
| `buscar`, `clasificacion` (lista separada por coma), `completitud` (`pendientes`\|`completos`), `controlado` (`yes`\|`partial`\|`no`), `factor` (id), `marca` (`observados`,`modificados`) | Filtros de la matriz. Viven en la URL y sobreviven a una recarga. No chocan con `q` / `estado` / `frecuencia` del programa. | `useUrlFilters` (replace, sin scroll) |
| `tarea` | Clave estable de (actividad, tarea): FNV-1a de los nombres normalizados (§5.2) | `<Link>` (push): "atrás" vuelve a la matriz con sus filtros |
| `fila` | id del riesgo: abre el editor | `<Link>` / `router.push` |
| `paso` | `identificacion` · `evaluacion` · `medidas` · `seguimiento` | replace |
| `ficha` | `1`: abre la "Ficha del documento" | replace |

Prioridad de render: `fila` > `tarea` > `tab`. Con `fila`, la vista de la tarea a la que se
vuelve es la de ese riesgo.

**Navegación dentro del espacio de trabajo.** Tarea, riesgo, paso, ficha, pestañas y filtros
cambian la URL con `window.history.pushState` / `replaceState` (Next.js lo integra con
`useSearchParams`; ver "Native History API" en la documentación), no con `<Link>` ni
`router.push`. Motivo, medido en la verificación: cada cambio por el router costaba un viaje RSC
de 195–257 ms y reiniciaba el estado de las filas del cliente. Con la API nativa el cambio es
inmediato, no hay petición `_rsc` y "atrás" sigue funcionando porque cada `push` deja su entrada.

---

## 4. Espacio de trabajo (`/prevencion/miper/[id]`)

- **`PageHeader`**:
  - Título "MIPER {faena} {período}"; la descripción es el rótulo de estado (`miperStatusLabel`).
  - Acciones, en este orden: **"Ficha del documento"** (secundaria), la **decisión principal**
    del flujo (Enviar / Reenviar a revisión, Devolver, Aprobar…, de `WorkflowBar`) y un menú
    **"Más"** (`DropdownMenu`) con "Descargar vN (Excel)" y "Descartar borrador".
  - El botón de envío deja de mostrar "(222 pendientes)". Si hay bloqueos sigue abriendo el
    diálogo que los lista, con un enlace por fila al editor y por campo de cabecera a la ficha.
  - **"Nueva tarea"** también va en las acciones de cabecera, sólo con `canEdit` y sin revisión
    en curso.
- **Tarjeta "Siguiente paso"** (`NextStepCard`):
  - Una sola tarjeta bajo la cabecera. Dice qué hacer ahora, según el modo, el estado y los
    pendientes.
  - Reemplaza al texto suelto de `WorkflowBar` (`readOnlyReason`, "Enviaste esta ronda…").
  - Lo decide una función pura, `nextStepFor()` (§5.6).
- **Callouts que se conservan:** "Intolerable" (`role="alert"`) y "Estás revisando la versión
  enviada".
- **Contenedor:** `PageContainer width="workbench"` (1408 px). El ancho ya no lo impone una tabla.

## 5. Matriz

### 5.1 Vista de estructura (por defecto)

- `SummaryStrip`, franja de texto (A1):
  - Muestra: centro de trabajo · dotación · tareas · riesgos · **completos x/y**.
  - El conteo por clasificación filtra; "No controlados" también filtra.
  - Sale "Medidas sin responsable / sin plazo", porque medía lo que no importa (§1.1).
- `FilterToolbar`:
  - Barra visible: el buscador "Buscar en la matriz" (texto de actividad, tarea, puesto, lugar,
    peligro, riesgo, daño y medidas) y "Contraer todo / Expandir todo".
  - Cajón "Filtros (N)": clasificación (4 casillas), completitud, ¿controlado?, factor y marcas
    (observados, modificados).
  - Bajo la barra, chips removibles y "Quitar filtros".
- **Tarjeta por actividad** (`<section aria-labelledby>`):
  - Botón con `aria-expanded`, nombre, "N tareas · M riesgos" y conteo por clasificación con
    `RiskClassificationBadge` en tamaño `sm`.
  - Debajo, una **fila por tarea** (`<Link href="?tarea=…">`). Muestra: nombre; los puestos y
    lugares distintos ("Conductor de camión ampliroll · +1"); "N riesgos"; chips por
    clasificación; "x/y completos"; marcas de observado y modificado; un chevron.
  - El orden es el del RE-04: actividades y tareas por el menor `rowNumber` de sus riesgos, no
    alfabético.
- **Con algún filtro de riesgo activo** (búsqueda o cualquier filtro):
  - Las tarjetas se expanden y bajo cada tarea aparecen **sólo los riesgos que coinciden**, como
    filas de riesgo (§5.3) que llevan directo al editor.
  - Las tareas y actividades sin coincidencias se ocultan.
  - Los conteos pasan a "x de y".
- **Matriz vacía:** `EmptyState` "Esta MIPER todavía no tiene riesgos", con CTA "Nueva tarea".
- **Responsive:** un solo árbol que se reacomoda (grid/flex). **No hay doble árbol**
  `md:hidden` / `hidden md:block`, así que los localizadores de E2E no necesitan `textoVisible()`
  para esta vista.

### 5.2 Clave de tarea

- `taskKeyOf(entry)` = FNV-1a 32 bits, en base 36, de
  `normalizeMiperName(activity ?? "") + "\u001f" + normalizeMiperName(task ?? "")`.
- Es estable mientras no cambie el nombre, igual que la unicidad del diccionario por nombre
  normalizado.
- Los riesgos sin actividad o sin tarea caen en "Sin actividad" / "Sin tarea". Esa tarea también
  es navegable.

### 5.3 Vista de la tarea (`?tarea=`)

- **Encabezado:**
  - Enlace "Volver a la matriz", que conserva los filtros.
  - Título = tarea; subtítulo = actividad.
  - Acción **"Agregar peligro"** (con `canEdit`): crea un riesgo que hereda actividad, tarea,
    puesto (el más frecuente de la tarea), lugar y rutinaria, insertado después del último
    `rowNumber` de la tarea, y abre su editor en "Identificación".
- **Franja de contexto:** puestos, lugares, personas expuestas (máximo F+M+Otro de un riesgo de
  la tarea; sumar contaría dos veces a las mismas personas) y "x/y completos".
- **Lista de riesgos.** Cada fila es un `<Link href="?fila=…">` y muestra:
  - peligro en negrita, "riesgo · daño probable";
  - el puesto, si la tarea tiene más de uno;
  - `RiskClassificationBadge` con MR;
  - "¿Controlado?" con rótulo;
  - "N medidas";
  - el estado: "Completo" o "N pendientes", en tono de advertencia;
  - las marcas "Observado", "Nueva" y "Modificada".
- **Sin riesgos** (todos borrados): `EmptyState` con "Agregar peligro".

### 5.4 Editor del riesgo (`?fila=`)

- **Encabezado:**
  - "Volver a la tarea".
  - Título = peligro ("Peligro sin describir" si está vacío); subtítulo "Riesgo #N · tarea ·
    puesto".
  - Estado de guardado, en vivo con `aria-live="polite"`.
  - Menú "Más": "Duplicar riesgo" y "Eliminar riesgo" (`ConfirmDialog` destructivo).
- **Pasos** (`Tabs` con apariencia de pasos numerados, en `?paso=`; cada paso indica ✓ o
  "N pendientes"). Al abrir el editor se entra **al primer paso con errores**; si no hay, a
  "Identificación".
  1. **Identificación**:
     - Factor de riesgo (`OptionSelect`).
     - ¿Rutinaria? (dos `SelectableCard`).
     - Peligro, Riesgo y Daño probable (`Combobox` con `allowCustomValue`, §6.1).
     - Fieldset "Dónde ocurre": Puesto y Lugar (`Combobox` con valor libre) y Expuestos F / M /
       Otro (`Input` numérico).
     - `<details>` "Mover a otra actividad o tarea", con Actividad y Tarea.
  2. **Evaluación**:
     - `PcChoice`: tres tarjetas de Probabilidad y tres de Consecuencia, con el texto del RE-04.
     - Bloque de resultado: MR grande, `RiskClassificationBadge` y el criterio
       (`CLASSIFICATION_CRITERIA`).
     - Leyenda de bandas.
  3. **Medidas de control**:
     - ¿Está controlado? (tres `SelectableCard`).
     - Tarjetas de medida: tipo I–V, descripción, responsable, plazo y "En el programa: Actividad
       #N" si está vinculada.
     - "Agregar medida" abre en línea el formulario de la medida (§6.2).
     - Eliminar una medida pide confirmación.
  4. **Seguimiento**:
     - Actividades del programa vinculadas, con enlace a `?tab=programa`.
     - Observaciones del riesgo: responder o, si es revisor, observar.
     - Cambios contra la foto de comparación (diff campo por campo, el que hoy está en `EntrySheet`).
     - Enlace "Verificar eficacia del control" en una MIPER vigente.
- **Panel lateral** (sticky a partir de `xl`; debajo del contenido en pantallas menores):
  - **Contexto:** actividad, tarea, puesto, lugar, expuestos.
  - **Chequeo del riesgo:**
    - Un ítem por bloque: peligro y daño, evaluación P×C, ¿controlado?, medidas suficientes y
      vínculo al programa (sólo si es Intolerable).
    - Cada ítem queda en ✓, o en ! con el mensaje del validador como enlace a su paso.
  - **Nivel:** clasificación y MR.
- **Navegación** (pie fijo del editor):
  - "‹ Anterior" y "Siguiente ›" recorren los riesgos de la tarea.
  - **"Siguiente pendiente"** lleva al próximo riesgo con errores por `rowNumber`, dando la vuelta
    al final. Si hay filtros activos, recorre sólo el conjunto filtrado.
- **Modo lectura** (sin `canEdit`, o revisor viendo la foto de la ronda): los mismos pasos, con
  los valores como texto (`DetailItem`). El revisor tiene "Observar este riesgo" en el panel.
- **Riesgo recién creado que aún no llegó:** si el `fila` no está en `rows`, se muestra un
  esqueleto y se llama una vez a `router.refresh()`. Si después sigue sin aparecer: "Este riesgo
  ya no existe" y un enlace a la matriz.

### 5.5 Guardado del editor

- **Hook `useEntryAutosave`**, sobre `useRowSaver`:
  1. `commit(entryId, values)` aplica el cambio de forma optimista y reclasifica con
     `classify()` / `magnitudeOf()`.
  2. Guarda con la cola por fila existente.
  3. Si falla, **revierte esos campos** a su último valor guardado y deja el mensaje en
     `fieldErrors[campo]`, que el `Field` muestra bajo el control.
- **Estado de guardado:** `saving | saved | error`, con la hora del último guardado.
- **Conflicto de versión:** muestra el mensaje del servicio ("La fila cambió mientras la
  editabas…") con un botón "Recargar riesgo" (`router.refresh()`).
- **Cuándo guarda cada control:** los textos, al perder el foco; las selecciones (tarjetas,
  selects, combobox), al elegir.

### 5.6 Función `nextStepFor`

Recibe `mode`, `matrix.status`, `matrix.reviewState`, `issues`, `openObservations` y `rows`, y
devuelve `{ tone, title, description, action: { kind: "ficha" | "riesgo" | "filtro" | "tab";
target } | null }`. Las reglas, en orden:

1. **Solo lectura** (`readOnlyReason`): tono info y el motivo, sin acción.
2. **Revisor con ronda abierta:** "Revisa la versión enviada: N riesgos, X Importantes e
   Intolerables" → primer riesgo Intolerable o Importante, o el primero.
3. **`canRespond` con observaciones abiertas:** "Responde N observaciones" → `tab=revision`.
4. **`canEdit` con errores de cabecera:** "Completa la ficha del documento (N datos)" → `ficha`.
5. **`canEdit` con errores en riesgos:** "Faltan datos en N riesgos" → al primer pendiente, por
   gravedad (intolerable > importante > el resto) y luego por `rowNumber`. Acción secundaria:
   filtro `completitud=pendientes`.
6. **`canEdit` sin errores, en borrador u observada:** "Lista para enviar a revisión", sin acción
   propia (la decisión está en la cabecera).
7. **Vigente con cambios pendientes:** "Hay cambios sin revisar desde vN", sin acción.
8. En otro caso, `null` (no se muestra tarjeta).

Reglas añadidas durante la implementación:

- **Matriz vacía:** no muestra tarjeta. Ahí el `EmptyState` de la matriz ya trae la acción.
- **"La matriz no tiene registros" no bloquea la ficha.** El diálogo de bloqueos lo muestra como
  texto, sin botón, porque no se arregla en la ficha.
- **El motivo de sólo lectura se muestra en todas las vistas** (estructura, tarea y editor). Los
  demás pasos se muestran sólo en la raíz de la matriz, y la acción "Ir a Revisión" se oculta
  cuando ya se está en esa pestaña.

### 5.7 Ficha del documento (`?ficha=1`)

`Sheet` (`sm:max-w-3xl`) con el `AntecedentesForm` existente. Al guardar, el `Sheet` se cierra
con un toast "Antecedentes guardados" (el texto que ya usa la acción). Si hay cambios sin guardar,
cerrar pide confirmación. La ficha la abren los bloqueos de cabecera, la tarjeta "Siguiente paso"
y la creación de una MIPER nueva (`new-miper-dialog.tsx` navega a `?ficha=1`).

---

## 6. Primitivas

### 6.1 `Combobox` con valor libre (capa compartida)

`components/ui/combobox.tsx` gana una prop opcional `allowCustomValue?: boolean` (por defecto
`false`):

- Mientras se escribe aparece una primera opción "Usar «texto»", y Enter sobre ella hace
  `onChange(texto)`.
- Si el valor no coincide con ninguna opción, el input lo muestra igual.
- Los consumidores actuales (8 archivos) no cambian.

Reemplaza al `<datalist>`, que en el editor no permite ver la lista ni filtrarla bien.

### 6.2 Formulario de medida

Sale de `entry-sheet.tsx` a `control-form.tsx`:

- Tipo de control (`OptionSelect` con los rótulos I–V de `CONTROL_HIERARCHY_LABEL`).
- Descripción (`Textarea`, porque la mediana del Excel es de 199 caracteres), con un
  `Combobox` "Usar una medida ya escrita" que la completa desde `dictionaries.measures`.
- Responsable: `OptionSelect` de `responsibleOptions` + "Otra persona o cargo…" → `Input`.
- Plazo (`DatePicker`).
- Se conservan los `aria-label` actuales ("Tipo de control", "Descripción de la medida",
  "Nombre o cargo responsable", "Plazo de la medida") para que no cambien los localizadores E2E
  que no tienen por qué cambiar.

### 6.3 `PcChoice`

`components/prevention/pc-choice.tsx`:

- Dos `role="radiogroup"` ("Probabilidad", "Consecuencia") con tres `SelectableCard` cada uno.
- Cada tarjeta lleva el rótulo y el valor ("Alta (4)") como título y el texto del RE-04 como
  descripción.
- Las flechas mueven la selección dentro del grupo (patrón radio).
- Reemplaza a `PcSelect` (`pc-select.tsx`), que existía por rendimiento en la grilla; al quedar
  sin consumidores se borra junto con su prueba.

---

## 7. Fase B: portada y Resumen

- **`listMiperPortfolio(access)`** (`lib/services/miper/queries.ts`):
  - Devuelve una fila por faena en alcance, con su MIPER no reemplazada (si existe): estado,
    versión, dotación, `updatedAt`, completitud (riesgos sin errores ÷ riesgos), Importantes e
    Intolerables y si `requiresMyAction`.
  - Las faenas sin MIPER también vienen, con `matrixId: null`.
- **Portada:**
  - `SummaryBar` con cuatro cifras accionables: faenas con MIPER x/y · en revisión · requieren
    mi acción · riesgos Importantes + Intolerables.
  - `SegmentedControl` "Todas las faenas" / "Requieren mi acción (n)".
  - Filtro de estado.
  - `DataTable` con fila y tarjeta móvil. Las faenas sin MIPER muestran "Crear MIPER", que abre
    `NewMiperDialog` con la faena ya elegida.
  - Desaparecen las pestañas Resumen / Por hacer / Todas.
  - Se retira el filtro "Responsable", que no filtraba.
  - La búsqueda la da el TopBar (D8).
- **Pestaña Resumen del espacio de trabajo:**
  - Cuatro tiles accionables (A1): riesgos completos x/y → `completitud=pendientes`; Importantes
    e Intolerables → filtro; no controlados → filtro; avance del programa → `tab=programa`.
  - Debajo, la completitud por actividad en barras (`Progress`), cada una enlazada a su tarjeta.
- **Arreglos:** el título de `loading.tsx` ("MIPER y controles") y el `dashboard.ts`, que reemplaza
  la query entera al enlazar.

## 8. Fase C: importación con medidas

- **D5 primero.** `is_existing` entra en:
  - `MiperControlSnapshot` (opcional en fotos antiguas: ausente = `false`);
  - `diffSnapshots` / `controlsKey`;
  - `miperControlSaveSchema`;
  - `saveMiperControl`;
  - la exportación;
  - el formulario de medida (dos tarjetas: "Ya está implementada" / "Por implementar");
  - `checkMiperCompleteness` (plazo sólo si `!isExisting`).
  No hay migración: la columna existe con `default false`.
- **Análisis del Excel** (puro, en `lib/prevention/miper/re04-measures.ts`):
  - `splitMeasures(texto)`: separa por saltos de línea y por las comas de primer nivel, sin
    cortar dentro de paréntesis ("EPP (CASCO, GUANTES)" queda entero).
  - `inferHierarchy(frase)`: reglas por palabra clave. EPP / "uso de" → V; capacitación,
    procedimiento, señalización, inspección, supervisión, pausas, rotación, charla → IV; barandas,
    bloqueo / LOTO, mantenimiento, demarcación física, protección de máquina → III; "sustituir" →
    II; "eliminar" → I; si no calza ninguna → IV, marcada "sugerida".
  - `distinctMeasures(filas)`: agrupa las frases por `normalizeMiperName` y cuenta las filas.
- **Vista previa:** paso "Medidas detectadas" en `import-dialog.tsx`, con tres tablas pequeñas y
  editables:
  1. Frases distintas, con su conteo y el tipo inferido (`OptionSelect`).
  2. Valores distintos de RESPONSABLE → usuario de la faena o texto.
  3. Valores distintos de PLAZOS → "Existente (frecuencia: texto)" o "Por implementar (fecha)".
  El usuario confirma una vez por valor distinto, no por fila.
- **Confirmación:** `commitRiskImport` recibe `measureMapping`, `responsibleMapping` y
  `deadlineMapping` y crea las medidas en la misma transacción que las filas. El Excel no trae
  tipo de control: siempre lo confirma una persona en la vista previa.

## 9. Fase D: acciones masivas

- **Servicio** (`lib/services/miper/bulk.ts`). Cada operación corre en **una transacción**, con
  `expectedVersion` por elemento, hasta **300 elementos**, y una entrada de historial por
  elemento. Si una versión no coincide, se aborta todo ("N riesgos cambiaron mientras editabas;
  recarga").
  - `bulkPatchMiperEntries(matrixId, items[{entryId, expectedVersion}], values)`: ¿controlado?,
    factor, puesto, lugar, actividad, tarea, rutinaria.
  - `bulkAddMiperControl(matrixId, entryIds[], values)`: la misma medida en N riesgos.
  - `bulkUpdateMiperControls(matrixId, items[{controlId, expectedVersion}], {responsible?, dueDate?, isExisting?})`.
- **Acciones:** acciones nuevas con permiso `prevention:risk:edit` y alcance por faena, igual que
  las existentes. Cada una tiene una prueba de rechazo sin permiso y fuera de la faena.
- **UI:**
  - Casillas en las filas de riesgo (vista de la tarea y modo filtrado), "Seleccionar los N
    resultados" y una barra de acción fija abajo: "Agregar medida a N", "Cambiar ¿controlado?",
    "Asignar responsable / plazo".
  - "Editar contexto" de la tarea (mockup) = `bulkPatchMiperEntries` sobre todos sus riesgos, con
    un diálogo de actividad, tarea, puesto y lugar.

## 10. Fase E: programa, revisión, historial y controles

- **Programa:**
  - Se carga en el servidor cuando `tab=programa`, en vez del `loadProgramWorkspaceAction` al
    montar.
  - Las actividades pasan a ser **tarjetas con estado y siguiente acción**, siguiendo el patrón
    `pdtp-obligations-workbench.tsx`: N°, descripción, responsable, frecuencia, próxima ocurrencia
    y su vencimiento, barra de avance y CTA "Registrar".
  - El detalle es una vista `?actividad=`, que reemplaza a los `Sheet` apilados. Cada ocurrencia
    abre un solo diálogo.
  - La evidencia se puede **abrir o descargar**.
  - Se pueden **vincular y desvincular medidas** con las acciones existentes.
  - Se arreglan "Completar antecedentes" y el rótulo "Encargado del programa".
  - El encabezado del programa deja de duplicar los datos de empresa: los toma de la ficha.
- **Revisión:**
  - El revisor recorre el mismo editor en modo lectura, con "Observar este riesgo" y filtros
    rápidos (Importantes / Intolerables / Modificados) que alimentan "Siguiente pendiente".
  - La pestaña Revisión queda como bandeja de observaciones con enlaces al editor.
- **Historial:** versiones selladas + `EntityTimeline` paginado.
- **`controles/[id]`:** usa la clasificación RE-04 en vez de `riskLevelLabel(… ?? "medium")` y
  completa las migas.

---

## 11. Lo que no cambia

- Tablas, migraciones, metodología, máquina de estados, permisos, segregación y avisos.
- Las acciones de servidor existentes y sus esquemas. Las únicas excepciones son
  `miperControlSaveSchema` (Fase C: `isExisting`) y las acciones nuevas de las Fases C y D.
- Los enlaces de notificaciones y de la cola de trabajo (`?fila=`, `?tab=revision`,
  `?tab=programa`).
- `/prevencion/miper/[id]` sigue en `OWN_SEARCH_PATTERNS` (`top-bar.tsx`): la matriz y el
  programa tienen buscadores propios y rotulados.
- La exportación Excel conserva el orden y el formato del RE-04: el Excel sigue siendo un
  **formato de salida**, no la interfaz.

## 12. Accesibilidad

- Las tarjetas de actividad usan `h2`. En la vista de la tarea, el título es el `PageHeader` y cada
  riesgo es un enlace con nombre accesible "Riesgo #N: {peligro}".
- Los pasos del editor son `Tabs` (`role="tablist"`). Las tarjetas de P, C, ¿controlado? y
  rutinaria son grupos de radio con flechas.
- El estado de guardado y los errores se anuncian con `aria-live="polite"`. Los mensajes de
  validación son **texto visible**, nunca sólo `title`.
- El color nunca es la única señal: rótulo + ícono, como en `RiskClassificationBadge`. El texto
  usa tokens `-ink`.
- En móvil el editor es un formulario de una columna con el pie de navegación fijo. Ya se puede
  **editar**, cosa que la grilla no permitía.

## 13. Pruebas y verificación

| Nivel | Qué cubre |
|---|---|
| Unitarias (`test:fast`) | `buildMatrixTree` (orden RE-04, conteos, filtro, "Sin actividad"); `taskKeyOf` (estable ante mayúsculas, tildes y espacios); `entryNavigation` (anterior, siguiente, siguiente pendiente con vuelta y con filtros); `parseMatrixFilters` / `serializeMatrixFilters`; `nextStepFor` (las 8 reglas); `Combobox` con `allowCustomValue`; `PcChoice`; `useEntryAutosave` (reversión al fallar, estado); `splitMeasures` / `inferHierarchy` con frases reales del RE-04 (Fase C); completitud con `isExisting` (Fase C). |
| PGlite (`test:pglite`) | Importación con medidas (Fase C); acciones masivas atómicas con conflicto de versión (Fase D); `listMiperPortfolio` con faenas sin MIPER y alcance (Fase B). |
| Acciones | Cada acción nueva rechaza a un usuario sin permiso o fuera de su faena. |
| E2E (`test:e2e`) | `interacciones` se reescribe (navegación por niveles, agregar peligro, duplicar, autoguardado persistente, conflicto entre dos pestañas, siguiente pendiente, filtros en la URL). `flujo`, `escenario` y `programa` cambian el helper de celdas por `e2e/miper-helpers.ts`. `matriz` y `controles` no cambian en la Fase A. |
| Navegador | Recorrido asistido de cada fase a 1440×900 y 390×844 sobre la MIPER de 222 riesgos, con informe en `qa/reports/2026-10-XX-miper-ui-fase-X.md`. Criterios de la Fase A: sin scroll horizontal en ninguna vista; el editor completo de un riesgo sin desplazamiento lateral; < 400 controles interactivos en la vista de estructura. |
| Puertas | `typecheck`, `lint`, `test:fast`, `test:pglite`, `test:e2e`, `doctor`, `check:secrets`; `db:verify-migrations` si alguna fase agrega una migración (ninguna lo prevé). |

## 14. Fases y criterio de aceptación

| Fase | Contenido | Se acepta cuando… |
|---|---|---|
| **A: Matriz sin planilla** | §3–§6: árbol, vista de la tarea, editor con pasos, autoguardado, `PcChoice`, `Combobox` con valor libre, ficha del documento, siguiente paso, retiro de la grilla y de `EntrySheet`, E2E migradas, manual §5. | Sobre la MIPER de 222 riesgos, un prevencionista llega desde la portada al riesgo #25, le agrega una medida y pasa al siguiente pendiente **sin scroll horizontal y sin salir del editor**. Las E2E MIPER pasan. |
| **B: Portada y Resumen** | §7 | La portada lista todas las faenas en alcance, incluidas las que no tienen MIPER, y cada cifra filtra. |
| **C: Importación con medidas** | §8 (D5 y D6 confirmadas) | Al importar el RE-04 de Biodiversa se crean sus medidas con tipo confirmado, responsable y plazo o frecuencia, y los pendientes bajan de 222 a sólo los que de verdad faltan. |
| **D: Acciones masivas** | §9 | Una medida se aplica a 40 riesgos en una sola operación atómica. |
| **E: Programa, revisión, historial** | §10 | El escenario §12 del F1 completo pasa en E2E sobre la UI nueva. |

Cada fase tiene su propio plan de implementación. El de la Fase A está en
`docs/superpowers/plans/2026-10-02-miper-ui-sin-planilla-fase-a.md`. Los de B a E se escriben al
integrar la fase anterior, como se hizo con F1→F2→F3.

## 15. Riesgos

- **Más clics para quien ya conoce la planilla.** Lo mitigan "Siguiente pendiente", el modo
  filtrado (los riesgos aparecen directamente bajo cada tarea) y las acciones masivas de la Fase D.
  El Excel exportado sigue disponible para quien quiera ver todo junto.
- **Cuatro specs E2E dependen del localizador de celdas.** La Fase A las migra en la misma rama;
  ninguna fase se integra con E2E MIPER en rojo.
- **El cambio de regla D5 afecta a MIPER ya enviadas.** Las fotos antiguas no traen `isExisting`,
  así que se leen como "por implementar", que es la regla de hoy. No se reabre nada.
