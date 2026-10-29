# QA focalizada: espera del navegador de Copec

Fecha: 2026-10-28. Alcance: apertura de la página del navegador, cierre de la
corrida, manejo del error de comunicación en el componente y uso compartido del
navegador por PDF. No es una auditoría completa de la aplicación.

## Hallazgo confirmado

- Una sincronización manual de Copec iniciada a las 16:53:56 quedó abierta más
  de 19 minutos, con cero archivos y filas registrados y el lock activo.
- El renderer de Chromium iniciado con la corrida consumía aproximadamente un
  núcleo. Al detener únicamente ese renderer, la excepción identificó
  `browserContext.newPage`, la aplicación cerró la corrida y la bitácora de cron
  como fallidas y liberó el lock a las 17:13:28.
- En un navegador aislado dentro del mismo contenedor se reprodujo una apertura
  de página en blanco que no terminó en diez segundos. Seis intentos posteriores
  abrieron normalmente. No se identificó la causa interna intermitente de Chromium.
- Una prueba del componente reprodujo el mensaje genérico al rechazar la acción
  de sincronización: la excepción escapaba a la pantalla de error.

## Verificación

- Las pruebas controladas comprueban plazos de 30 segundos para la cola, la
  creación del contexto y la apertura de página. Si el cierre del contexto
  también se bloquea, se espera la detención del proceso aislado antes de
  liberar el turno; una página o turno que llega tarde no inicia sesión.
- Chromium real abrió y cerró un contexto supervisado local sin visitar el
  proveedor. La imagen de producción también abrió y cerró un navegador
  supervisado sobre loopback, sin conectarse a Copec. La separación evita
  interrumpir los PDF del navegador compartido.
- Las pruebas del componente comprueban la pérdida de respuesta durante un mes,
  la preservación de resultados anteriores y los errores de lectura del estado
  posteriores a una corrida confirmada.
- La corrida se registra como fallida sin avanzar el cursor. Las pruebas de la
  bitácora de cron verifican el tratamiento de una excepción y del lock.
- En el worktree aislado de `main` pasaron la suite general (13.506 pruebas;
  274 omitidas), la prueba de bitácora contra PGlite (ocho pruebas), el
  typecheck completo, ESLint completo y los chequeos de archivos de entorno y
  alias Drizzle. La primera ejecución de la suite general detectó una prueba
  que no esperaba la actualización de estado; se corrigió y la suite completa
  volvió a pasar.
- React Doctor, alcance `changed`: 92/100, con una advertencia de mantenimiento
  por el tamaño del componente de Copec. La puntuación coincide con la de la
  primera revisión; no se evaluó una puntuación previa al cambio.
- En Chromium se montó el componente con acciones simuladas. En 1440×900 y
  390×844 se verificaron la pérdida de respuesta de un mes, el resumen de meses
  anteriores y el fallo de lectura del estado posterior a un resultado confirmado.
  El botón se habilitó y no hubo errores JavaScript de página en los cuatro casos.
  Se comprobó la llamada al reporte con un doble; no se verificó una entrega real
  a Sentry.

## Límites

- El servidor Next de desarrollo existente no respondió. Se inició otro en un
  directorio temporal independiente, pero `/login` tampoco respondió; por eso
  no se verificó la pantalla autenticada de la aplicación completa.
- El typecheck global encontró errores en cambios concurrentes de mantenimiento;
  se comprobó por separado el alcance de esta reparación.
- No se ejecutó una sincronización real nueva ni se comprobó el acceso o la
  descarga de Copec con la contraseña recién cambiada.
- Al momento del diagnóstico, producción seguía ejecutando la imagen anterior.
  La corrida atascada quedó cerrada por la aplicación y el lock quedó libre.
- La liberación del lock depende de que el sistema operativo confirme que el
  proceso aislado terminó. Si no consigue terminarlo, la aplicación conserva el
  lock para evitar una segunda importación concurrente; no hay plazo absoluto.
- Limitación anterior a este cambio: si TCT ya confirmó lotes y una falla ocurre
  después durante TAE, los contadores de la corrida fallida pueden quedar en cero.
  No se verificó pérdida de datos; esos contadores no demuestran qué lotes existen.
