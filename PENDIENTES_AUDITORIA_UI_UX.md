# Pendientes de la auditoría UI/UX

Estado al **4 de agosto de 2026**, tras la pasada 69 de `AUDITORIA_UI_UX_CAPTURAS.md`.

Este documento es el inventario de lo que **falta**. Lo ya resuelto vive en el registro de ejecución de la auditoría; aquí sólo se nombra cuando hace falta para entender un pendiente.

---

## 1. Corrección: tres cosas que este documento daba por defectos y no lo eran

La versión anterior encabezaba su lista con *"el TAE offline no funciona en Safari"* y lo llamaba el pendiente más caro. **Era falso.** Como es el tipo de error que manda a alguien a buscar un fallo inexistente en el flujo más crítico del producto, conviene que quede escrito antes que nada.

| Lo que decía | Lo que era |
|---|---|
| **El TAE offline no funciona en Safari** | En el binario de WebKit que Playwright instala aquí, `setOffline(true)` deja los `Blob` ilegibles: `await new Blob(["hola"]).text()` lanza `NotReadableError`. Ninguna aplicación que adjunte fotos puede funcionar bajo esa condición. **`mobile-chrome`, ejecutado por primera vez, pasa 18 de 18 incluido ese escenario.** |
| **Entregas falla en móvil** | Las aserciones usaban `getByRole("row")` y a 390 px `DataTable` muestra tarjetas: el contrato de TASK-UI-004 funcionando. Con `listRecord`, **4 de 4 en Safari**. |
| *(descubierto y corregido dentro de la misma pasada)* **El banner offline no se retira al recuperar red** | La aserción usaba `getByText(/Sin conexión/i)` y coincidía con el copy estático del PPA: *"Funciona sin conexión a internet"*. Se llegó a modificar `useOnlineStatus` sobre esa premisa; **el cambio se revirtió**. |

Tres veces en dos pasadas, el mismo patrón: una prueba roja leída como aplicación rota. La regla contraria quedó escrita en el código, en `blobStorageWorks` y en `listRecord`: **antes de acusar a la aplicación, comprobar que la prueba puede medirla**.

---

## 2. Estado verificado hoy

Cifras medidas, no estimadas:

| Señal | Valor | Cómo se obtuvo |
|---|---|---|
| Suite E2E | **367 aprobados, 4 saltados**, 16,9 min; 1 fallo intermitente que pasa en aislamiento (§4.1) | `npm run test:e2e` (2 workers) |
| Suite E2E, un worker | **334 aprobados, 0 fallos**, 25,6 min | `npm run test:e2e -- --workers=1` |
| Safari móvil | **22 de 23** (el TAE salta por límite del entorno); incluye 5 del formulario PPA | `E2E_MOBILE_BROWSERS=1 … --project=mobile-safari` |
| Chrome móvil | **18 de 18** | `… --project=mobile-chrome` |
| Reflow 320 / 768 / 1024 px | 0 desbordamiento en 8 pantallas, ambos motores | `e2e/reflow-anchos.spec.ts` |
| Payload RSC de las listas grandes | **136–326 ms**, 94–481 KB | `e2e/rsc-payload.spec.ts` |
| Bundle | 160 rutas, peor caso **2,41 MB**, mediana 1,37 MB (presupuesto 3 MB) | `npm run check:bundle-budget` |
| Captura completa | **163/163, gate en verde** en desktop+móvil | `npm run screenshots` |
| Captura en 320 / 768 / 1366 px | **163 rutas cada uno**, 0 errores de cliente, **0 scroll horizontal**, integridad limpia | `npm run ss -- small\|tablet\|laptop` |
| Controles cuyo nombre depende de `title` | **0**, con control positivo | `tooltip-por-foco.test.ts` |
| Gráficos con lectura equivalente | 14 de 14 | `chart-equivalent-reading.test.ts` |
| Enums visibles en pantallas | 0, con control positivo | `vocabulario-visible.test.ts` |
| Pruebas unitarias | **3406 aprobadas** | `npm run test:fast` |
| Typecheck y lint | Verdes; 4 avisos preexistentes | `npx tsc --noEmit`, `npx eslint` |
| Árbol de trabajo | **4 archivos sin commit** — otro proceso commiteó el resto (§3.5) | `git status --porcelain` |

---

## 3. Decisiones — todas resueltas

Las seis que llevaban pasadas esperando dueño se cerraron el 4 de agosto. Se dejan escritas con su consecuencia, porque una decisión sin registrar vuelve a aparecer como pendiente.

| Decisión | Respuesta | Estado |
|---|---|---|
| **TASK-UI-017 · Minimización de RUT** | No es necesario enmascarar | **Descartada.** No es un pendiente: es una decisión tomada. |
| **TASK-UI-011 · Salud por módulo** | Se deja como está | **Cerrada.** La banda de plataforma es la única salud demostrable y la pantalla ya dice que los interruptores miden visibilidad, no salud. |
| **TASK-UI-007 · PPA** | Debe funcionar sin red | **Cerrada.** Ya funciona, certificado por E2E. Y como la cola offline **es** JavaScript, el fallback sin JavaScript queda descartado por incompatible con el requisito. |
| **TASK-UI-008 · Cola TAE en dispositivo compartido** | Bloquear "Finalizar" mientras haya pendientes | **Implementada** (§5.1). |
| **Montos negativos** | Cambiar a `-$4.500` | **Implementada** (§5.1). |
| **Historia de git** | No rehacerla | **Cerrada.** El commit `docs(audit)` con 349 archivos de código se queda como está. |

## 4. Defectos abiertos con diagnóstico parcial

### 4.1 Latencia bajo carga paralela — medida, no cerrada
**Prioridad: media** (baja desde alta: ya no bloquea, y se sabe qué es y qué no).

Lo que ahora se sabe con cifras:

- **No es el payload.** Las cinco listas grandes van de 136 a 326 ms y de 94 a 481 KB. A un orden de magnitud del margen de 5 s de Playwright.
- **Es contención.** Correr tres proyectos a la vez sobre la misma base degradó los mismos escenarios de 6 s a 2,6 min. La presión es sobre base de datos y servidor compartidos.
- **El costo del determinismo son 10,5 minutos.** Un worker: 25,6 min y cero fallos. Dos: 15,3 min y un fallo intermitente ocasional — que en las dos últimas corridas completas **no apareció**.

**Decisión tomada:** se conserva `workers: 2`. CI ya tiene `retries: 1`, que lo absorbe, y +69 % de tiempo en cada corrida local es peor negocio. `--workers=1` queda documentado para cuando se necesite una corrida determinista.

**Los 481 KB de "Mis pendientes" están explicados:** la cola sirve **50 registros** por página (`DEFAULT_PAGE_SIZE`) mientras Compras y Solicitudes sirven 25, y cada elemento arrastra más campos. No es una fuga, es el doble de filas más ricas. No se recorta: a 277 ms está a un orden de magnitud del margen, y bajar el tamaño de página cambia cuántas tareas ve un usuario antes de paginar, que es decisión de producto. `rsc-payload.spec.ts` avisará si deja de ser proporcionado.

**Lo que queda:** un fallo por corrida completa, siempre en `oc-reconciliation` o `ppa-flow`, siempre verde en aislamiento. Es contención, está medida y CI la absorbe con `retries: 1`.

### 4.2 El duplicado del manifest — cerrado tras cambiar de causa tres veces
**Cerrado.** Cada arreglo destapaba la causa siguiente:

- El barrido select/dropdown fotografiando el mismo control dos veces.
- El detector de "modal abierto" resolviendo contra un acordeón ya abierto, y —después— fotografiando el diálogo **antes de que terminara su animación**, con el overlay a opacidad cero. Se corrigió esperando a `document.getAnimations()`; `mobile-prevencion-campanas` salió limpio en la corrida siguiente.

La tercera y última era la pestaña "Avance", declarada **a la vez** como ruta propia y como pestaña del detalle. Cualquier heurística por nombre o URL falla en algún caso —el rótulo es "Avance por ítem" y el query es `avance`—, así que la comparación se hace donde la respuesta es exacta: **el hash del PNG**. Si una captura de interacción produce el mismo byte que una de ruta, se borra la interacción y se conserva la canónica. Sólo se poda la interacción; dos vistas idénticas siguen rompiendo el gate.

**Cerrado.** La corrida completa de la pasada 67 imprime «Integridad de capturas: sin URL inválida, huérfano, referencia o hash duplicado ✓».

### 4.3 Fontanería PWA sin certificar en WebKit
**Reducido.** Los escenarios de **formulario** —verificación de RUT y progresión por pasos— quedaban fuera sólo por compartir archivo con los de plumbing. Viven ahora en `ppa-formulario.spec.ts` y están certificados en Safari: **5 de 5**.

Lo que sigue sin certificar en WebKit es exactamente lo que ese motor no puede ejecutar: Service Worker, IndexedDB y permisos de notificación, que `ppa-offline.spec.ts` prueba con `context.grantPermissions(["notifications"])` y `Object.defineProperty(Notification, …)`. Sólo un dispositivo real lo cubre (§7).

---

## 5. Código por escribir

### 5.1 Decisiones implementadas en la pasada 69
- **Cola TAE en dispositivo compartido.** "Finalizar" se bloquea mientras haya cargas sin enviar, y dice cuántas. Se reconsulta la cola dentro del manejador —entre el refresco y el clic pueden encolarse cargas— y un fallo al leerla se trata como "hay pendientes".
- **Montos negativos.** `-$4.500` en vez de `$-4.500`. El cambio destapó que `-0 < 0` es falso en JavaScript, así que el cero negativo salía como `$-0`: un saldo cuadrado con signo, en el caso normal de restar dos montos iguales. Normalizado.

### 5.2 Lo que sigue sin escribir
- **El ejercicio de respaldo y restauración.** Acto operativo, no código: ejecutar un respaldo y **restaurarlo** en un entorno desechable, para que la pantalla pueda afirmar recuperabilidad con evidencia. Hoy sólo puede afirmar que se ejecutó una copia.
- **Estado "eliminado" en el resto de entidades.** Resuelto donde hay borrado lógico —OC y documentos SST—. Para las demás, "eliminado" e "inexistente" son el mismo caso. Si se añade borrado lógico a otra entidad, hay que añadirle su estado; hoy no hay deuda ni prueba que lo obligue.

## 6. Certificación ejecutable

| Tarea | Qué falta ejecutar |
|---|---|
| **TASK-UI-016** | Las siete celdas están cubiertas, ahora también sobre OC, recepción e incidentes. Falta el **recorrido completo por teclado de cada flujo** —hoy se comprueba el foco visible, no que la tarea se pueda terminar sin ratón—. |
| **TASK-UI-003** | **Cerrado.** Ejecutado contra producción el 4 de agosto: **cero solicitudes mal tipadas**. El vocabulario completo de `request_item_attributes` en producción son seis nombres —Color, Modelo, Talla, Presentación, Tipo, Gramaje—, todos del catálogo de productos; ninguno de los cuatro que sólo escriben los editores de repuestos y servicios existe en la base. No hay deuda histórica. |
| **TASK-UI-001** | **Ejecutado.** Los tres anchos del gate selectivo, 163 rutas cada uno, sin scroll horizontal ni errores de cliente. Se repite cuando cambien rutas o fixtures. |

---

## 7. Certificación no automatizable

- **Lector de pantalla real** sobre navegación, overlays y formularios largos. Es lo que queda de TASK-UI-005 y buena parte de 004, 014 y 016.
- **Tooltip del rail colapsado con tacto**, en dispositivo real.
- **Prueba de cinco segundos** con personas y el **before/after visual**: lo último de TASK-UI-006.
- **Comprensión de las once tablas equivalentes.** Escritas de una vez, sin validar con nadie si la frase de "lectura rápida" dice lo que el usuario venía a buscar.
- **Pruebas de usabilidad por rol**, incluidos usuarios con baja alfabetización digital y trabajo en terreno.
- **iPhone y Android físicos.** Los proyectos móviles emulan; el teclado virtual, las safe areas y el `Blob` real de Safari sólo se ven en el dispositivo — y §1 muestra lo que cuesta confundir un emulador con el aparato.
- **Volúmenes y datos reales**: textos largos, homónimos, montos extremos.
- **Paridad entre el ambiente sembrado y producción.**
- **Métricas de línea base**: las 16 métricas de la sección 17 no tienen baseline, así que sus objetivos no son verificables.

---

## 8. Fase 5 y go/no-go

| Acción | Estado |
|---|---|
| Recaptura canónica before/after | **Gate en verde** por primera vez; falta el *before/after* comparado |
| Prueba E2E de flujos completos | **367 escenarios.** Siete estados de borde cubiertos, incluidos OC, recepción e incidentes |
| Auditoría WCAG automatizada + manual | Automática ampliada y ejecutada: axe, teclado, zoom, reflow en cinco anchos, dos motores. **Manual sin empezar** |
| Pruebas de usabilidad por rol | Sin empezar |
| Medición de rendimiento percibido | **Payload y bundle medidos.** Falta LCP, INP y CLS reales |
| Revisión final go/no-go | Bloqueada por las anteriores |

El veredicto original —*"no recomendable para producción sin corregir problemas importantes"*— ya no describe el código. Lo que falta es demostración con personas y dispositivos, no corrección.

---

## 9. Orden sugerido

1. **Commitear** (§3.5). Minutos, y elimina el único riesgo de pérdida.
2. **El ejercicio de respaldo y restauración** (§5.2). Acto operativo sobre un entorno desechable.
3. **Agendar lo no automatizable** (§7): personas, dispositivos físicos y lector de pantalla. **Es la partida más grande que queda, y ninguna parte de ella se puede automatizar.**

Con las seis decisiones cerradas y la consulta a producción ejecutada, **ya no queda nada bloqueado por falta de respuesta ni por falta de acceso a datos**. Lo que resta necesita un entorno desechable, o personas y dispositivos reales.

---

## 10. Advertencias para quien retome esto

- **Antes de acusar a la aplicación, comprobar que la prueba puede medirla.** Tres diagnósticos equivocados en dos pasadas, uno de ellos publicado como el pendiente más caro del proyecto. El síntoma era real las tres veces; la explicación no estaba comprobada ninguna.
- **Ejecutar encuentra lo que leer no encuentra.** Y ejecutar en un motor nuevo encuentra lo que el motor viejo esconde — en ambas direcciones.
- **Una prueba verde puede estar protegiendo el defecto.** La prueba unitaria de exportes afirmaba `"sent"`: fijaba el comportamiento incorrecto.
- **Un barrido que no encuentra nada no distingue "limpio" de "roto".** Por eso `vocabulario-visible.test.ts` lleva control positivo.
- **No correr el capturador y la suite E2E a la vez.** Ambos reconstruyen `.next`; hacerlo produjo un build a medias, 90 pantallas de error idénticas y una corrida entera perdida. Dos veces.
- **Cuidado al relajar un gate.** La primera versión de la excepción de hashes compartidos habría dado por buenas esas 90 pantallas de error.
- **Los defectos que quedan no están en las pantallas, están en lo que todas comparten.** El de la pasada 67 eran cuatro formateadores: `formatDate(null)` devolvía `31-12-1969` y `formatDate("basura")` tumbaba la página. Ninguno aparece jamás con datos sembrados, que es por qué sobrevivieron a sesenta y seis pasadas.
- **Playwright sigue redirecciones por defecto.** Una aserción sobre el estado de un POST sin `maxRedirects: 0` da por buena una barrera que no comprobó.
- **Enumerar el vocabulario real antes de buscar en él.** La consulta que listaba los seis nombres de atributo que existen en producción es la que salvó la conclusión: el detector buscaba dos nombres equivocados —copió los rótulos del formulario, no lo que la aplicación persiste— y sin esa lista un "cero filas" habría sido indistinguible de una consulta rota.
- **Contar antes de barrer.** El inventario decía 444 `title=`; medirlos dejó 3 defectos y 441 falsos positivos, y 58 de esos habrían empeorado la navegación por teclado si se migraban. Media hora de contar bien cambió por completo la decisión.
- **Una prueba verde puede fijar el defecto — ya van tres.** El enum `"sent"` en los exportes, `comprador@e2e` que la semilla hace administrador, y un test que exigía el atributo `title` justo donde el criterio dice que no debe estar. Distinto es un **snapshot** que congela un formato: los dos que afirmaban `$-5.000` y `$-4.500` estaban haciendo su trabajo, y por eso el cambio de formato no pudo pasar inadvertido.
- **Responder a la pregunta que se hizo.** Se preguntó por JavaScript deshabilitado y la respuesta llegó sobre red. No son lo mismo; darlo por equivalente habría cerrado un criterio con la respuesta a otra cosa.
