# Corrección del módulo de mantención — 2026-11-05

Se ejecutó el plan de corrección derivado de la auditoría estática del 2026-11-04. El detalle completo, con archivo y prueba por hallazgo, está en [2026-11-04-auditoria-mantencion-codigo.md](2026-11-04-auditoria-mantencion-codigo.md).

- **PASS — Puertas:** typecheck sin errores; lint 0 errores (1 warning preexistente); `check:secrets` verde; PGlite 4.350 pruebas verdes; migraciones 372 entradas verificadas.
- **PASS — Navegador:** 57 pruebas E2E de mantención en Chromium (app, jefatura, equipos, pautas, permisos y OT), incluida la apertura de la OT desde la tarjeta de taller.
- **PASS — `test:fast`:** 18.446 pruebas verdes, 0 fallos. Se corrigieron además los cuatro fallos ajenos que dependían del entorno (lock de LibreOffice, variable `$image` del deploy, flags de Chipax y correo DTE del shell) y el warning de lint de `ot-model.ts`.
- **LÍMITES:** no se ejecutó la suite E2E completa, Safari/Android reales ni lector de pantalla; la migración 0371 no se aplicó en producción.

# Historial anterior de mantención — verificación dirigida, 3 de noviembre de 2026

## Alcance y ambiente

Se probó el importador y la consulta del módulo vigente `/mantencion/*`, en una base PostgreSQL E2E creada para esta prueba y una aplicación local. Se usaron respuestas y usuarios sintéticos para el recorrido de navegador. La base y el servidor temporales se eliminaron al finalizar. La base activa `bodega` de producción se consultó sólo en lectura para contrastar equipos y faenas; no se escribió en ella.

## Resultado y evidencias

- **PASS — Archivo real en memoria:** las cinco hojas aportaron 2.157 trabajos. La primera importación temporal guardó 2.157; una segunda reconoció 2.157 sin cambios y no generó filas en `mant_records`.
- **PASS — Conciliación sobre la flota de producción consultada:** 1.370 filas se asociaron inequívocamente; 771 no encontraron equipo, 16 tienen discrepancias y 9 tienen una faena no resuelta. Los resultados describen la instantánea consultada, no una importación a producción.
- **PASS — Integración PostgreSQL/PGlite:** 60 pruebas dirigidas entre importación histórica, hoja de vida y registros existentes. Se verificaron reimportación, auditoría, conflictos, asociaciones manuales y alcance por faena.
- **PASS — Validaciones de código:** typecheck del repositorio, ESLint de los archivos modificados, 24 pruebas unitarias y de componentes dirigidas y `git diff --check`.
- **PASS — Navegador Chromium:** una prueba recorrió vista previa, confirmación, búsqueda, detalle, conciliación manual, enlace desde la ficha del equipo y reimportación. También confirmó que un supervisor de Biodiversa no ve un antecedente sin faena y no puede importar.
- **PASS — Adaptación:** vista previa de escritorio 1280 × 720 y lista de supervisión 390 × 844. La lista móvil presenta tarjetas y no desborda horizontalmente. Capturas locales: [vista previa](evidencia-mantencion-historico-2026-11-03/vista-previa-desktop.png), [supervisión móvil](evidencia-mantencion-historico-2026-11-03/historial-supervision-movil.png).
- **PASS — Consola y red:** la última ejecución no detectó errores de consola, errores de página, respuestas HTTP 5xx ni solicitudes fallidas; se ignoraron únicamente precargas `_rsc` canceladas según el contrato del repositorio.
- **PASS — Migración:** verificación de la cadena y checksums; una segunda generación informó que no hay cambios pendientes en el esquema.

## Problemas encontrados y corregidos durante el recorrido

- El selector de archivo se podía mostrar habilitado antes de activarse en el cliente. Se mantiene deshabilitado hasta completar la hidratación.
- El listado móvil inicialmente sólo mostraba parte de la tabla. Se reemplazó por la representación móvil reutilizable de la plataforma.
- Al completar una asociación, una actualización de página redundante cancelaba la petición de guardado después de recibir respuesta. Se quitó la actualización duplicada y la ejecución final no reprodujo esa cancelación.

## Advertencias y límites

- **AUTOMATION WARNING:** una ejecución anterior encontró una petición cancelada; se investigó y corrigió antes de la ejecución final. No se trató el fallo del localizador de una iteración intermedia como un defecto del producto.
- **COVERAGE GAP:** no se ejecutó la suite E2E completa, ni pruebas en Safari/Android reales, ni lector de pantalla. No se verificaron descargas ni permisos de los enlaces a Drive del archivo original.
- **COVERAGE GAP:** no se aplicó la migración ni se desplegó o importó el archivo en producción. El módulo de producción no tenía perfiles de equipo de mantención en la consulta realizada; la preparación de equipos es independiente de importar el historial.
- **IMPROVEMENT OPPORTUNITY:** las asociaciones pendientes requieren revisión de jefatura; la carga conserva las respuestas y permite localizarlas con el filtro de vínculos.
- **Seguridad del ambiente de prueba:** durante el diagnóstico se mostró accidentalmente una cookie de una sesión E2E temporal. El servidor con su clave temporal se detuvo, la base E2E se eliminó y se borraron las trazas de la prueba. No correspondía a una sesión de producción.
- **React Doctor:** el ejecutable disponible revisó los cambios sin señalar archivos de esta implementación; reportó siete advertencias en otros archivos. No pudo calcular la puntuación por falta de conexión al servicio de puntaje.

## Ajuste posterior: fotos y hora de envío

- Por indicación del usuario se conservan las horas trabajadas, pero se omiten las columnas de fotos y stickers y sólo se guarda la fecha de envío. La hora de envío puede intervenir en la identificación interna de una respuesta, pero no se muestra ni se guarda como dato operativo.
- **PASS — Excel real:** 2.157 filas procesadas en memoria; ninguna conservó columnas de fotos ni hora de envío y las 2.157 conservaron las horas trabajadas. Al reimportar una copia sin fotos ni horas de envío, las 2.157 se reconocieron sin nuevas filas.
- **PASS — Regresión dirigida:** pruebas de lectura e importación cubren la ausencia o cambio de fotografías y hora, la verificación del origen y la detección de cambios reales del contenido.
- **PASS — Chromium:** en una base E2E desechable, el detalle mostró la fecha sin hora ni enlaces de fotos; se importó una respuesta sin hora y, al reimportarla con hora y enlaces cambiados, no se crearon duplicados. Se comprobó también el alcance por faena y la resolución manual. No se guardaron trazas de sesión; el servidor y la base temporal se retiraron.
- **AUTOMATION WARNING:** una primera tentativa de navegador se interrumpió durante la compilación inicial y otra alcanzó el tablero tras vencer el tiempo de espera del login. La ejecución final, con el servidor compilado, pasó.
- **COVERAGE GAP:** el ajuste sigue en el workspace; no se desplegó ni se importó el archivo en producción.
