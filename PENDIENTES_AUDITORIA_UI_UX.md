# Pendientes de la auditoría UI/UX

Estado al **4 de agosto de 2026**, tras la pasada 66 de `AUDITORIA_UI_UX_CAPTURAS.md`.

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
| Suite E2E | **345 aprobados, 4 saltados, 0 fallos**, 15,3 min | `npm run test:e2e` (2 workers) |
| Suite E2E, un worker | **334 aprobados, 0 fallos**, 25,6 min | `npm run test:e2e -- --workers=1` |
| Safari móvil | **17 de 18** (el TAE salta por límite del entorno) | `E2E_MOBILE_BROWSERS=1 … --project=mobile-safari` |
| Chrome móvil | **18 de 18** | `… --project=mobile-chrome` |
| Reflow 320 / 768 / 1024 px | 0 desbordamiento en 8 pantallas, ambos motores | `e2e/reflow-anchos.spec.ts` |
| Payload RSC de las listas grandes | **136–326 ms**, 94–481 KB | `e2e/rsc-payload.spec.ts` |
| Bundle | 160 rutas, peor caso **2,41 MB**, mediana 1,37 MB (presupuesto 3 MB) | `npm run check:bundle-budget` |
| Captura completa | 163/163, 0 errores de cliente, 0 scroll horizontal, 0 inválidas/huérfanas; **1 hash duplicado** (§4.2) | `npm run screenshots` |
| Gráficos con lectura equivalente | 14 de 14 | `chart-equivalent-reading.test.ts` |
| Enums visibles en pantallas | 0, con control positivo | `vocabulario-visible.test.ts` |
| Typecheck y lint | Verdes; 4 avisos preexistentes | `npx tsc --noEmit`, `npx eslint` |
| Árbol de trabajo | **352 archivos sin commit** | `git status --porcelain` |

---

## 3. Decisiones bloqueadas — esperan una respuesta

### 3.1 TASK-UI-017 · Minimización de RUT
No iniciado, por tu decisión. Verificado: no existe `maskRut` en el repositorio y el RUT completo aparece en listados, selectores y detalle. Su criterio de aceptación empieza por *"matriz aprobada"*, y no existe.

**Para desbloquearlo:** una matriz por rol y superficie. Riesgo conocido a resolver en ella: enmascarar crea homónimos, hay que acordar el identificador alternativo.

### 3.2 Salud por módulo — qué señal es honesta
`/admin/modulos` ya antepone la salud **de plataforma** que se mide ejecutando algo: consulta a PostgreSQL, escritura en el volumen y espacio en disco. Y dice explícitamente que los interruptores no miden salud.

No existe sonda **por módulo**: uno activo cuyo backend falla se ve igual que uno sano. No se inventó una a propósito. Definir esa señal —¿qué significa que "Recepción" está sano?— es decisión de producto.

### 3.3 PPA sin JavaScript
Abierta desde la pasada 57. Si debe funcionar con JavaScript deshabilitado, hay que diseñar el fallback; si no, decirlo y cerrar el criterio.

### 3.4 Cargas TAE offline al cerrar sesión
Se promete borrado local de la cola sin haber decidido qué debe pasar en un dispositivo compartido.

### 3.5 Consolidación en git
**~352 archivos sin commit**, en un checkout que otro proceso edita a la vez. Diez pasadas de trabajo viven sólo en el árbol. Sigue siendo el riesgo más barato de eliminar.

---

## 4. Defectos abiertos con diagnóstico parcial

### 4.1 Latencia bajo carga paralela — medida, no cerrada
**Prioridad: media** (baja desde alta: ya no bloquea, y se sabe qué es y qué no).

Lo que ahora se sabe con cifras:

- **No es el payload.** Las cinco listas grandes van de 136 a 326 ms y de 94 a 481 KB. A un orden de magnitud del margen de 5 s de Playwright.
- **Es contención.** Correr tres proyectos a la vez sobre la misma base degradó los mismos escenarios de 6 s a 2,6 min. La presión es sobre base de datos y servidor compartidos.
- **El costo del determinismo son 10,5 minutos.** Un worker: 25,6 min y cero fallos. Dos: 15,3 min y un fallo intermitente ocasional — que en las dos últimas corridas completas **no apareció**.

**Decisión tomada:** se conserva `workers: 2`. CI ya tiene `retries: 1`, que lo absorbe, y +69 % de tiempo en cada corrida local es peor negocio. `--workers=1` queda documentado para cuando se necesite una corrida determinista.

**Lo que queda:** "Mis pendientes" pesa 481 KB, cuatro veces el resto de listas. No incumple el presupuesto hoy, pero es la que primero lo hará. `rsc-payload.spec.ts` lo vigila.

### 4.2 Un duplicado en el manifest — cambió de causa dos veces
**Prioridad: baja.** Es cosmético: no afecta a la aplicación, sólo impide que el gate de capturas cierre en verde.

Las dos causas anteriores están cerradas y confirmadas por corrida limpia:

- El barrido select/dropdown fotografiando el mismo control dos veces.
- El detector de "modal abierto" resolviendo contra un acordeón ya abierto, y —después— fotografiando el diálogo **antes de que terminara su animación**, con el overlay a opacidad cero. Se corrigió esperando a `document.getAnimations()`; `mobile-prevencion-campanas` salió limpio en la corrida siguiente.

**Lo que queda es distinto:** `mobile-compras-detalle-avance.png` es idéntico a `mobile-compras-detalle-tab-avance.png`. La pestaña "Avance" está declarada **a la vez** como ruta propia (`/compras/po-audit-1?tab=avance`) y como pestaña del detalle, así que se fotografía dos veces.

`isDeclaredElsewhere` ya existe para esto, pero compara la **URL** tras el clic, y esta pestaña no la cambia: es estado de cliente. Por texto tampoco casa —el rótulo es "Avance por ítem" y el query es `avance`—, así que la solución por nombre sería frágil.

**Arreglo correcto:** comparar el hash de la captura de interacción contra el de las rutas base al reconciliar, y descartar la redundante conservando la canónica. Resuelve esta y cualquier futura de la misma forma sin adivinar URLs. **No implementado.**

### 4.3 PPA offline sin certificar en WebKit
`ppa-offline` queda fuera del alcance móvil, con el motivo escrito en `playwright.config.ts`: prueba fontanería de Service Worker, IndexedDB y permisos de notificación con APIs que sólo Chromium expone. Sus escenarios de formulario **sí** pasaron en Safari; los de plumbing no están certificados ahí.

---

## 5. Código por escribir

### 5.1 TASK-UI-012 · Lo que queda del glosario
Cerrados: PDTP, incidentes, inventario ARCO, evidencia CAPA, slugs de `/admin/modulos`, enums en los XLSX, pluralización (`countOf`), snapshots de formato y el barrido estático con control positivo.

**Queda:**
- **Estados de valor ausente, desconocido, legacy y timezone.** Declarados en la tarea, no diseñados. `formatDateSafe` cubre el ausente; los otros tres no tienen tratamiento.
- **Tooltips por foco y tacto.** El rail colapsado ya los tiene; falta el barrido del resto y la verificación en dispositivo real (§7).
- **Una rareza anotada, no resuelta:** `es-CL` escribe los negativos como **`$-4.500`**, con el signo dentro del símbolo. Aparece en notas de crédito y ajustes. Congelado en el snapshot; cambiarlo es decisión de producto.

### 5.2 TASK-UI-011 · El ejercicio de respaldo
Acto operativo, no código: ejecutar un respaldo y **restaurarlo** en un entorno desechable, para que la pantalla pueda afirmar recuperabilidad con evidencia. Hoy sólo puede afirmar que se ejecutó una copia.

### 5.3 TASK-UI-002 · Estado "eliminado" en el resto de entidades
Resuelto donde hay borrado lógico —OC y documentos SST—. Para las demás, "eliminado" e "inexistente" son el mismo caso. Si se añade borrado lógico a otra entidad, hay que añadirle su estado; hoy no hay deuda ni prueba que lo obligue.

---

## 6. Certificación ejecutable

| Tarea | Qué falta ejecutar |
|---|---|
| **TASK-UI-016** | La matriz cubre carga, error recuperable, sin permiso, sesión expirada, doble envío y offline sobre flujos P1. Falta **extenderla al resto de flujos P1** —OC, recepción, incidentes— y el estado *dirty* (salir de un formulario con cambios sin guardar), que no tiene tratamiento. |
| **TASK-UI-009** | E2E de ida y vuelta del editor PDTP conservando año, faena, período, vista y filtro; y la prueba por rol del KPI de HH faltantes. |
| **TASK-UI-010** | E2E de roles con principal y excepciones, POST manipulado y accesibilidad del diff de permisos. |
| **TASK-UI-003** | Cubierta la entrada por ruta en dos viewports. Falta **revisar las solicitudes históricas potencialmente mal tipadas antes de migrar datos** — eso es una consulta a producción, no una prueba. |
| **TASK-UI-004 / 014** | Reflow certificado en cinco anchos y dos motores. Falta el **recorrido por teclado y el foco visible** en 320/768/1024, que hoy sólo se comprueban a 960 (zoom 200 %). |
| **TASK-UI-001** | Recaptura en los tres anchos del gate selectivo (`small`, `tablet`, `laptop`), que existen pero no se han ejercitado. |

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
| Recaptura canónica before/after | Recaptura limpia y reproducible; falta el *before/after* comparado |
| Prueba E2E de flujos completos | **345 escenarios, 0 fallos.** Estados de borde cubiertos en flujos P1; falta extenderlos (§6) |
| Auditoría WCAG automatizada + manual | Automática ampliada y ejecutada: axe, teclado, zoom, reflow en cinco anchos, dos motores. **Manual sin empezar** |
| Pruebas de usabilidad por rol | Sin empezar |
| Medición de rendimiento percibido | **Payload y bundle medidos.** Falta LCP, INP y CLS reales |
| Revisión final go/no-go | Bloqueada por las anteriores |

El veredicto original —*"no recomendable para producción sin corregir problemas importantes"*— ya no describe el código. Lo que falta es demostración con personas y dispositivos, no corrección.

---

## 9. Orden sugerido

1. **Commitear** (§3.5). Minutos, y elimina el único riesgo de pérdida.
2. **Cerrar el último duplicado del manifest** (§4.2) comparando hashes al reconciliar. Media hora, y deja el gate de capturas en verde.
3. **Extender la matriz de estados** al resto de flujos P1 y añadir el estado *dirty* (§6).
4. **Teclado y foco visible en 320/768/1024** (§6). El harness ya está.
5. **Los E2E de PDTP y roles** (§6).
6. **Decidir la señal de salud por módulo** (§3.2) y **la matriz de RUT** (§3.1).
7. **Agendar lo no automatizable** (§7): personas, dispositivos físicos y lector de pantalla.

---

## 10. Advertencias para quien retome esto

- **Antes de acusar a la aplicación, comprobar que la prueba puede medirla.** Tres diagnósticos equivocados en dos pasadas, uno de ellos publicado como el pendiente más caro del proyecto. El síntoma era real las tres veces; la explicación no estaba comprobada ninguna.
- **Ejecutar encuentra lo que leer no encuentra.** Y ejecutar en un motor nuevo encuentra lo que el motor viejo esconde — en ambas direcciones.
- **Una prueba verde puede estar protegiendo el defecto.** La prueba unitaria de exportes afirmaba `"sent"`: fijaba el comportamiento incorrecto.
- **Un barrido que no encuentra nada no distingue "limpio" de "roto".** Por eso `vocabulario-visible.test.ts` lleva control positivo.
- **No correr el capturador y la suite E2E a la vez.** Ambos reconstruyen `.next`; hacerlo produjo un build a medias, 90 pantallas de error idénticas y una corrida entera perdida. Dos veces.
- **Cuidado al relajar un gate.** La primera versión de la excepción de hashes compartidos habría dado por buenas esas 90 pantallas de error.
