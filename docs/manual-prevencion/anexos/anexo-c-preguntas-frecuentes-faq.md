# Anexo C: Preguntas Frecuentes (FAQ) y Resolución de Problemas en Terreno

> **Propósito:** Respuestas directas a las dudas y situaciones complejas más habituales que enfrentan los Prevencionistas de Faena, Jefes de Terreno y Supervisores durante el turno.

---

### 1. "¿Qué hago si en la faena no hay señal de internet o es muy inestable?"
*   **Modo Offline Nativo de la Plataforma:**
    *   Tanto el formulario de **Inspecciones en Terreno** (`/prevencion/inspecciones/nueva`) como el de **Reporte Inmediato de Incidentes** (`/prevencion/incidentes/reportar`) cuentan con soporte offline automático mediante base de datos local en tu navegador (**IndexedDB** `chome-prevention-offline`).
    *   Si pierdes la conexión en plena faena forestal o en ruta, puedes seguir completando las respuestas y hallazgos con normalidad.
    *   El sistema guardará localmente los datos con una advertencia en amarillo (*"Sin conexión: guardado en cola local"*).
    *   En cuanto tu dispositivo recupere señal 4G o Wi-Fi, la plataforma sincronizará automáticamente la cola pendiente contra el servidor sin perder ningún dato.
*   **Para otros submódulos:** Toma las fotografías de los hallazgos y llena los respaldos físicos con hora y fecha claras. Al llegar a la oficina con señal, sube los antecedentes a la plataforma indicando la fecha y hora real del acto en terreno.

---

### 2. "¿Por qué completé una inspección y la celda en el PDTP sigue en amarillo?"
*   **Causa más común:** La inspección quedó en estado **`pendiente de revisión`**.
*   **Solución:** Recuerda que por la regla de segregación, las inspecciones deben ser revisadas y aprobadas por una segunda persona (otro prevencionista, el Jefe de Terreno o la Jefa de Prevención). Pídele a tu colega que ingrese a `/prevencion/inspecciones`, abra el registro y presione **"Aprobar y Cerrar Inspección"**. En ese instante la celda del PDTP pasará a verde.

---

### 3. "¿Qué hago si un trabajador no aparece en el sistema para agregarlo a una capacitación o entrega de EPP?"
*   **Causa:** El trabajador aún no ha sido enrolado formalmente en el maestro de personal por la oficina de Recursos Humanos / Administración de Faena.
*   **Solución:** Contacta al encargado de personal de tu faena y solicita el alta inmediata del trabajador indicando: RUT, Nombre Completo, Cargo exacto y Faena asignada. Una vez creado en el sistema, aparecerá de inmediato en tus listas desplegables.

---

### 4. "¿Cómo corrijo las estadísticas de horas trabajadas (HHT) o días perdidos si el mes ya fue cerrado?"
*   **En `/prevencion/indicadores`:**
    1. Abre el período cerrado.
    2. Haz clic en el botón **"Solicitar rectificación de período"**.
    3. Escribe el motivo formal del ajuste (ejemplo: *Se recepciona dictamen de Mutual que rebaja 4 días de licencia médica*).
    4. Corrige el valor y vuelve a cerrar el período. El sistema mantendrá la bitácora auditable de quién y por qué se realizó el cambio.

---

### 5. "¿Por qué el botón 'Autorizar reinicio' aparece bloqueado en un accidente grave?"
*   **Causa:** Por exigencia de la **Circular SUSESO 3331**, si un accidente fue clasificado como grave o fatal (con suspensión de operaciones), quien reportó o investigó el accidente **tiene prohibición legal de autorizar el reinicio de la faena sobre sí mismo**.
*   **Solución:** La verificación de que las condiciones son seguras y la firma de reinicio en plataforma debe ser realizada por la Jefa del Departamento de Prevención o por la Administración de Contrato, dejando constancia de las medidas implementadas.

---

### 6. "¿Qué hago si el resultado del control de alcotest marca positivo?"
*   **Protocolo DO-48 de Emergencia:**
    1. Retira al trabajador de forma inmediata y respetuosa de la conducción o de la máquina.
    2. Infórmale que conforme al Reglamento Interno se realizará una **contraprueba después de 15 minutos**.
    3. Realiza la segunda prueba en presencia del Jefe de Terreno o de un representante del Comité Paritario.
    4. Si la contraprueba vuelve a marcar positivo (> 0.0 g/l), suspende sus labores del día, regístralo en `/prevencion/alcotest` indicando el valor en g/l y activa el procedimiento disciplinario y de derivación médica de la empresa.

---

### 7. "¿Cómo demuestro la validez de estos registros ante un fiscalizador de la Inspección del Trabajo (DT) o SEREMI?"
*   **Respaldo Jurídico:**
    *   La plataforma cumple con las exigencias de la **Ley 19.799 sobre Documentos Electrónicos y Firma Electrónica** y la **Circular 3331 de la SUSESO**.
    *   Cada inspección, charla y constancia guarda un identificador único, fecha/hora exacta inmutable (timestamp) y el usuario responsable con su rol formal.
    *   Puedes descargar en cualquier momento el informe en Excel o PDF desde `/prevencion/pdtp` o desde el expediente del caso para entregarlo directamente al fiscalizador.

---

### 8. "¿Puedo marcar una actividad del PDTP como cumplida si no tengo la evidencia todavía?"
*   **Respuesta categórica: NO.**
*   Si una actividad de enganche (como una inspección o curso) se forzara sin su respaldo en el submódulo, el sistema la detectará como un cumplimiento no acreditado en las auditorías internas del SG-SST. Si la actividad se ejecutó en terreno pero no tiene submódulo propio, regístrala con su acta firmada en `/prevencion/constancias`.

---

### 9. "¿Cómo imprimo el cartel con código QR para que los conductores hagan su PPA desde el celular o cabina?"
*   **Pasos en Plataforma:**
    1. Ingresa a `/prevencion/ppa`.
    2. Abre el **"Panel de Acceso PPA"** (ubicado en la cabecera de la pantalla).
    3. Elige el alcance: puedes generar un acceso específico para tu faena (ej. *Cholguán - Arauco*) o un acceso general por RUT.
    4. Presiona el botón **"Generar Cartel QR para Impresión"**.
    5. El sistema abrirá el cuadro de diálogo con un código QR de alta resolución respaldado por una firma criptográfica HMAC que asegura la autenticidad del enlace.
    6. Descarga o imprime directamente la lámina en formato PDF normalizado, plastifícala y pégala en la cabina del camión, en el tablero de control de pañol o en la garita de ingreso a faena.

---

### 10. "¿Qué ocurre si la cámara del celular no reconoce una pauta física en la ingesta OCR de report diario?"
*   **Recomendaciones para una captura OCR exitosa en `/prevencion/inspecciones/[runId]`:**
    *   Asegúrate de que la hoja física esté sobre una superficie plana, sin arrugas ni sombras pronunciadas sobre las casillas de verificación.
    *   Verifica que las 4 marcas de esquina (marcas de registro) de la pauta física se encuentren dentro del encuadre de la foto.
    *   Si una casilla marcada a mano con lápiz pasta o grafito no es detectada con alta confianza por el motor de visión, la plataforma te mostrará la alerta de ambigüedad en pantalla para que el Prevencionista o Jefe de Terreno verifique visualmente la casilla antes de confirmar la subida definitiva.

