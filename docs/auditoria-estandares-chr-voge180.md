# Auditoría de estándares CHR y VOGE 180

## Alcance y seguridad

Esta revisión se hizo sobre los archivos Excel suministrados. No se importaron tareas en producción, no se cargaron catálogos en producción y no se desplegó Railway. Los cambios permanecen en la rama `feature/estandares-chr-voge-180`.

## CHR

El lector actual reconoce las hojas con encabezados compatibles:

- `VELEZ`: 36 filas de referencias y 36 imágenes incrustadas.
- `BRYAN`: 19 filas de referencias y 19 imágenes incrustadas.
- `ARLEY`: 30 filas de referencias y 30 imágenes incrustadas.
- También reconoce `LADO IZQUIERDO`, `FINAL DE LINEA` y `LADO DER` como hojas de puestos/resumen.

Las hojas nominadas se priorizan antes que las hojas de puestos, y el importador deduplica por EAN + puesto. El catálogo CHR requiere además `numeroReferencia` numérico y el puesto normalizado. Las imágenes de estas hojas están en columnas de galería (K en adelante), no dentro de la fila de la tabla; por tanto, el conteo de imágenes por hoja no prueba por sí solo la asociación de cada imagen con una referencia. No se debe construir el ZIP definitivo hasta confirmar visualmente la secuencia de cada grupo de fotos.

## VOGE 180

El lector reconoce encabezados de 43 hojas, incluidas `BOM`, hojas de puestos, `Carro Canasta`, `Kitting 02`, `PRE01` a `PRE27` y `Pre28` a `Pre35`. Las hojas de puesto se leen antes que `BOM`; las repeticiones idénticas se deduplican por EAN + puesto.

El libro no define un lote base numérico uniforme en los encabezados de las hojas de VOGE 180. No se debe asignar una cantidad de lote por inferencia; se conserva la cantidad de la fila cuando exista y, si no, la cantidad unitaria leída por el importador.

La revisión de imágenes encontró hojas con más fotos grandes que filas de referencia (por ejemplo, `19 Izquierdo`, `PRE08`, `PRE11`, `PRE14`, `PRE17` y `PRE18`), y `Pre35` tiene menos fotos grandes que filas. En otras hojas, varias fotos están ancladas a la misma celda o fila. Por ello no es seguro asignar fotos automáticamente solo por orden de archivo o proximidad de ancla. Se deben conservar las fotos sobrantes como complementarias únicamente después de validar a qué referencia pertenecen; las referencias sin foto deben quedar explícitamente pendientes.

## Próximos pasos antes de publicar

1. Validar visualmente la secuencia de fotos de las tres hojas CHR.
2. Resolver las asociaciones adicionales y faltantes de VOGE 180 contra EAN + puesto.
3. Generar los ZIP con `manifest.json` y fotos WebP, validando el límite de 15 MB por paquete.
4. Probar la vista previa del Excel y el catálogo en un entorno de prueba.
5. Solicitar autorización explícita antes de cualquier escritura de estándares o fotos en producción.

## Corrección de identidad y estado real (16-nov-2026)

El usuario confirmó que **VOGE 180 corresponde a 180BES y no a XRS-180**. En los artefactos de trabajo recuperables aparece un libro con encabezado `Moto XRS 180 Bla 27PT` y referencias que identifican XRS/180ADV. Ese material no se debe reutilizar ni renombrar como VOGE 180BES, ni compartir sus fotos con el catálogo XRS-180. La fuente inequívoca de VOGE 180BES y sus fotos debe cotejarse por separado antes de crear el manifiesto definitivo.

Por tanto, la auditoría anterior de imágenes del libro XRS-180 no constituye una validación del catálogo VOGE 180BES. Las cifras de fotos, referencias y pendientes anotadas en la sección VOGE describen únicamente ese libro XRS-180 y no deben interpretarse como resultado final de VOGE 180BES.

## Estado de entrega

- La rama incorpora el selector y el slug independiente `voge180`; se corrigió además una opción duplicada de VOGE 180 en el selector de continuidad.
- La compatibilidad de nombres VOGE/VOGUE 180BES no autoriza a mezclar los catálogos XRS-180 y VOGE 180BES.
- No se certifica ningún ZIP final de fotos CHR o VOGE 180BES con esta revisión. Las fotos de Patinadores deben permanecer disponibles y asociadas a su referencia; ninguna foto se elimina para simplificar el catálogo.
- No se cargaron estándares ni fotografías en producción, no se desplegó Railway y el PR sigue separado de `main`.
- La publicación queda pendiente de validar el archivo fuente inequívoco de VOGE 180BES y de completar la asociación visual de fotos CHR por referencia y puesto.

### Revisión de artefactos históricos recuperados

Se recuperó el paquete histórico `Paquete_fotos_CHR_CORREGIDO_NUMERO_PUESTO.zip` y se inspeccionó su manifiesto contra `DISTRIBUCION_CHR_PATINADORES_LISTO.xlsx`:
- 83 archivos de imagen únicos y 84 asociaciones.
- 18 claves de referencia en el manifiesto; 2 registros tienen EAN `0`.
- El manifiesto declara 0 pendientes, pero esa cifra no demuestra cobertura total del libro ni resuelve por sí sola las discrepancias de EAN/puesto.
- Se detectó al menos una diferencia que requiere revisión antes de cargarlo como catálogo completo: EAN `7701023378215` aparece con puesto `06 Derecho` en el manifiesto, mientras las filas localizadas en el libro recuperado lo muestran en `03 Izquierdo`. No se debe certificar la asociación hasta resolverla.

También se recuperó `ESTANDAR_VOGE_180_BORRADOR_VALIDADO.xlsx`; su BOM etiqueta explícitamente el modelo como `XRS-180` y las referencias incluyen denominaciones `180ADV`. Este archivo y el ZIP `VOGE_180_XRS180_FOTOS_VALIDADO.zip` son artefactos XRS-180, no evidencia válida para VOGE 180BES. No se reasignan ni se renombran como VOGE.
