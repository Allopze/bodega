# Mantención en la plataforma: guía breve

Para el Jefe de Mantención y los administradores de contrato. Explica dónde está cada cosa desde que la plataforma reemplaza los Google Forms y el tablero de Looker.

## Para la auditoría: el Panel de mantención

**Dónde:** Control operacional → Mantención → **Panel de mantención**. El Jefe de Mantención ve todas las faenas. El administrador de contrato ve y exporta sólo las suyas.

1. Arriba elija la **faena** (por ejemplo, Biodiversa) y el **período**. Para mostrar todo el historial, use de junio de 2025 a hoy.
2. La sección **Trabajos de mantención** muestra:
   - cuántos trabajos hubo;
   - el porcentaje de correctivas;
   - los días que los equipos pasaron en taller;
   - las horas hombre.
3. Los gráficos muestran:
   - los trabajos por tipo y por mes;
   - los días en taller y las horas por faena;
   - los equipos con más correctivas.
4. Para ver **un solo equipo**, elíjalo en «Equipo». Todo el Panel se acota a ese equipo y aparece el enlace a su hoja de vida.
5. **Pautas y disponibilidad** dice qué equipos están al día, próximos o vencidos, y cuáles están **«Sin pauta definida»**. Un equipo sin pauta nunca aparece como «al día».
6. **Pautas y hallazgos de formularios** tiene dos datos:
   - el cumplimiento del checklist de las pautas que se llenaron en el formulario;
   - los hallazgos «mal estado» de las inspecciones diarias que no tuvieron trabajo ni OT en los días siguientes. El plazo se ajusta en Parámetros operativos y parte en 7 días.
7. **Exportar PDF** arma un informe de la faena y el período elegidos, con portada, cifras y tablas, para entregar al auditor. **Exportar Excel** baja los mismos datos; la hoja «Trabajos» trae cada trabajo, uno por fila.

**De dónde salen las cifras.** El historial de los formularios anteriores (agosto de 2025 a noviembre de 2026) y las órdenes de trabajo de la plataforma. Las filas de prueba y las OT anuladas no cuentan.

**«Sin clasificar».** El formulario nuevo (desde junio de 2026) dejó de preguntar si el trabajo era preventivo o correctivo. Por eso esos trabajos aparecen como «sin clasificar» y no entran en el porcentaje de correctivas. Desde ahora, la OT de la plataforma lo pregunta.

## El historial anterior

**Dónde:** Mantención → Registros firmados → **Historial anterior**.

Cada trabajo de los formularios queda con su texto original, su tipo de acción, sus horas, su contrato (Residuos, Calymag, Rodantes) y las observaciones de calidad del consolidado. Si un trabajo no quedó ligado a un equipo, por ejemplo porque el equipo no está en la flota o porque el código y la patente no coinciden, se puede ligar a mano desde su detalle.

## Pedir y cerrar una orden de trabajo

**Dónde:** Mantención → **Órdenes de trabajo** → **Nueva orden**, o desde la ficha del equipo en Flota.

1. **Pedir la orden:**
   1. Elija el equipo. La **faena de imputación** es la del equipo y no se cambia: el costo va a ella.
   2. Elija el **tipo de acción**: preventiva, correctiva o predictiva. Al elegirlo se marca solo Reparación o Mantención, y puede ajustarlo.
   3. Marque las **especialidades** (mecánica, eléctrica, soldadura, hidráulica).
   4. Si el trabajo se hará en el taller de otra faena, indíquela en «Faena de ejecución».
2. **Cerrar el trabajo.** Al terminarlo se registra la **fecha de salida del taller**, el **trabajo realizado** y las **horas hombre** (sólo horas, sin pesos). Sin fecha de salida la orden no se termina: sigue «En taller».

Una orden que nace de un hallazgo de inspección llega ya marcada como correctiva.

Hoy el tipo de acción es opcional. El Jefe de Mantención puede hacerlo obligatorio en Parámetros operativos → Mantención.

## Faenas y equipos

- **Tipo y alias de una faena:** Administración → Faenas → «Tipo y alias». Flor del Laja es un **depósito**, no una operación. Los **alias** son otros nombres con que llega la faena en las planillas (por ejemplo, «Cholguan» para «Cholguan - Arauco»). Sirven para que los importadores la reconozcan.
- **Empresa propietaria y ubicación por confirmar:** ficha del equipo en Flota → «Propietario y ubicación».
  - La empresa (Chome, ASIR, Servimar, un banco, un tercero) es un dato del equipo: no cambia su faena ni a quién se le imputa el costo.
  - «Ubicación por confirmar» marca los equipos que nadie sabe dónde están. La tabla de Flota tiene un filtro para verlos.
- **Cambiar de faena un equipo:** sólo con «Trasladar equipos», que hoy está apagado. Ni el propietario ni la marca lo mueven.

## Lo que todavía no está

- **Trabajos sin equipo ligado.** Las grúas H-1, H-2 y H-13, las bateas KCB y otros equipos que faltaban se agregan a la flota en la carga. Quedan unos pocos trabajos con patentes que no están en ninguna planilla (WX-6495, GRDW-63, ZV-6852): se ven en el historial y se pueden ligar a mano.
- **Patentes cruzadas.** Las de KCH-133, KCH-135 y KCH-136 hay que confirmarlas contra el padrón. Mientras tanto, sus trabajos del formulario quedan en conflicto, sin equipo ligado, pero cuentan en la faena.
