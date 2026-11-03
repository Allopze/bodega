# Historial de mantención importado

## Objetivo

Incorporar el consolidado histórico de formularios al módulo vigente de mantención sin convertirlo en registros firmados ni afectar lecturas, alertas o indicadores operacionales. El archivo real contiene cinco hojas, trabajos preventivos, correctivos y predictivos, y datos que no siempre identifican inequívocamente un equipo o faena.

## Alternativas

Se descartó insertar en `mant_records`: exige firma, lecturas y detalles que no siempre existen y cambiaría el estado operacional. El seed existente prepara equipos y pautas, pero no importa estos trabajos. Se utilizará una tabla de historial separada, una carga con vista previa y una consulta de antecedentes claramente identificados como históricos.

## Reglas

- Conservar los datos de cada trabajo, el archivo, hoja y número de fila de origen, y el usuario que realizó la importación. Omitir fotos y stickers; de la marca de envío conservar sólo la fecha.
- Resolver automáticamente un equipo sólo con identificadores inequívocos; mantener las filas no resueltas. La faena procede de la columna del registro, no del nombre de la hoja.
- Reimportar sin duplicar; ante una identidad de origen igual con contenido distinto se detiene la carga y no se sobrescribe el antecedente.
- Recalcular vínculos pendientes al volver a importar, sin reemplazar vínculos ya guardados.
- Permitir importar sólo a jefatura autorizada; limitar la lectura por las faenas permitidas y no mostrar como propios registros cuya autoría no pueda probarse.
- Una importación escribe todo en una transacción y deja una auditoría. La vista previa no escribe.
- El historial no crea OT, fotos, firmas, lecturas iniciales ni estados de taller. Los enlaces a fotos no se importan.
