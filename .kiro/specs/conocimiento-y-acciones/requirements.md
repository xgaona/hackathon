# Documento de requisitos

## Introducción

Este spec define el frente **conocimiento-y-acciones** del MVP de EVA. El alcance comprende:

- **Parte A:** corpus corporativo sintético y conjunto de evaluación.
- **Parte B:** conector mock persistente de Skkeda para puestos de trabajo.
- **Parte B2:** conector mock de Jira de solo lectura.
- **Parte C:** evaluador de recuperación contra la Knowledge Base desplegada.

Las fuentes normativas son todos los archivos de `.kiro/steering/`, en especial `contrato-mvp.md`, `producto.md`, `invariantes.md`, `tecnologia.md` y `estructura.md`. Los contratos `docs/contratos/skkeda-v1.yaml`, `docs/contratos/jira-v1.yaml` y `docs/contratos/escenarios-mock.md`, los catálogos y los artículos de `data/conocimiento/semilla/` se interpretan dentro de ese marco. Los artículos semilla son solo una referencia inicial; el corpus Markdown es la fuente de verdad.

Quedan fuera del alcance Jira real, OAuth, escrituras en Jira, reservas ejecutables de salas, integraciones con Teams o correo, datos reales, cambios a `src/comun/contrato.ts` y cambios en carpetas pertenecientes a otros frentes. Los escenarios HTTP seleccionados mediante `X-Mock-Scenario` tampoco aplican a estos conectores Lambda porque `InvokeRequest` no incluye esa cabecera; sus respuestas de conflicto e indisponibilidad son solo referencia funcional. El desarrollo DEBE ejecutarse en este orden: Parte A, Parte B, Parte B2 y Parte C. Este documento contiene únicamente requisitos; el diseño, las tareas y la implementación requieren aprobación posterior.

## Requisitos

### Requisito 1: Composición y formato del corpus general

**Historia de usuario:** Como colaboradora de Redeban, quiero consultar documentos corporativos sintéticos con aspecto real, para obtener respuestas precisas y demostrables sin usar información de la empresa.

#### Criterios de aceptación

1. CUANDO se complete la Parte A, ENTONCES el sistema DEBE contener entre 12 y 15 documentos generales en `data/conocimiento/documentos/general/`.
2. CUANDO se cree un documento general, ENTONCES su primera línea DEBE ser exactamente `Documento sintético para demostración`.
3. CUANDO se cree un documento general, ENTONCES el documento DEBE estar escrito en Markdown, DEBE tener un título de nivel `#` y DEBE contener entre 3 y 6 secciones identificadas con títulos de nivel `##`.
4. CUANDO se redacte un documento general, ENTONCES el documento DEBE tener estructura y lenguaje propios de una política, un procedimiento, una guía o unas preguntas frecuentes corporativas.
5. CUANDO un documento describa plazos, topes, ventanas, vigencias o condiciones operativas, ENTONCES el documento DEBE incluir cifras y fechas concretas que permitan verificar las respuestas.
6. El corpus DEBE usar exclusivamente organizaciones, personas, dominios, identificadores, cifras y situaciones sintéticas, y NO DEBE incluir datos reales de personas ni información real o confidencial de Redeban.
7. SI un artículo de `data/conocimiento/semilla/` contradice el corpus Markdown, ENTONCES el sistema DEBE considerar el corpus Markdown como fuente de verdad.
8. SI un dato se repite en más de un documento general, ENTONCES todos los documentos DEBEN expresar una regla y una cifra compatibles.

### Requisito 2: Cobertura temática del corpus general

**Historia de usuario:** Como colaboradora de Redeban, quiero encontrar políticas y procedimientos de uso frecuente, para resolver consultas corporativas desde EVA.

#### Criterios de aceptación

1. El corpus general DEBE incluir una política de viajes nacionales e internacionales que defina anticipación, topes de viáticos en COP, aprobaciones y reglas diferenciadas por tipo de viaje.
2. El corpus general DEBE incluir una guía o política de Skkeda que establezca un puesto por persona por día, el procedimiento y plazo de cancelación y una sección titulada exactamente `## Pisos y puestos`.
3. CUANDO se describan los pisos en el documento de Skkeda, ENTONCES el sistema DEBE indicar que el piso 2 contiene `P-1` a `P-14`, el piso 3 contiene `P-15` a `P-27` y el piso 4 contiene `P-28` a `P-40`.
4. El corpus general DEBE incluir contenido sobre reserva de salas en Skkeda como conocimiento consultable, aunque la ejecución de reservas de salas permanezca fuera del alcance del conector mock.
5. El corpus general DEBE incluir una política de trabajo híbrido con reglas, frecuencias, condiciones y fechas concretas.
6. El corpus general DEBE incluir una guía de soporte de TI con canales de atención y tiempos de respuesta diferenciados por prioridad.
7. El corpus general DEBE incluir un procedimiento de gestión de cambios de TI que defina tipos de cambio, Comité de Cambios, ventanas de ejecución y congelamiento de diciembre.
8. El corpus general DEBE incluir una política de vacaciones y permisos con saldos, anticipaciones, aprobaciones o duraciones concretas.
9. El corpus general DEBE incluir una guía de onboarding con actividades, responsables y plazos concretos.
10. El corpus general DEBE incluir una política de seguridad de la información con obligaciones y periodicidades concretas.
11. El corpus general DEBE incluir una política o procedimiento de gastos y reembolsos con topes, aprobaciones, soportes y plazo de legalización.
12. El corpus general DEBE incluir contenido sobre beneficios corporativos con montos, condiciones o vigencias concretas.
13. El corpus general DEBE incluir una guía de uso de Teams y correo corporativo como conocimiento consultable, con prácticas permitidas, canales y tiempos concretos cuando corresponda; este documento NO DEBE habilitar integraciones con Teams ni correo.
14. CUANDO el número de temas mínimos no alcance el total definido en el Requisito 1, ENTONCES el sistema DEBE agregar documentos corporativos sintéticos complementarios sin duplicar ni contradecir las reglas existentes.
15. CUANDO se redacten la política de viajes y el procedimiento de gastos y reembolsos, ENTONCES la política de viajes DEBE indicar la anticipación y el tope diario de viáticos en COP para una visita nacional de tres días, y el procedimiento de gastos DEBE indicar soportes, aprobación y plazo de legalización aplicables al mismo caso.

### Requisito 3: Metadatos y separación de contenido restringido

**Historia de usuario:** Como responsable de seguridad, quiero separar físicamente el conocimiento general del restringido, para impedir que información sensible llegue a la Knowledge Base.

#### Criterios de aceptación

1. CUANDO exista un documento `x.md`, ENTONCES el sistema DEBE incluir a su lado un archivo `x.md.metadata.json` con la estructura `{"metadataAttributes":{"classification":"<clasificación>","documentId":"<identificador>","title":"<título>","area":"<área>","updatedAt":"<fecha>"}}`.
2. CUANDO el documento esté en `general/`, ENTONCES su metadato `classification` DEBE ser `GENERAL`.
3. CUANDO se complete la Parte A, ENTONCES el sistema DEBE contener exactamente dos documentos en `data/conocimiento/documentos/restringido/`: una tabla salarial por cargo y un plan de reestructuración.
4. CUANDO el documento esté en `restringido/`, ENTONCES su metadato `classification` DEBE ser `RESTRICTED`.
5. CUANDO se asignen identificadores al corpus, ENTONCES cada `documentId` DEBE ser único y DEBE seguir la secuencia `DOC-SYN-0001` en adelante sin reutilizaciones.
6. CUANDO se despliegue o ingeste el corpus, ENTONCES el sistema DEBE considerar únicamente `data/conocimiento/documentos/general/` y DEBE excluir todos los archivos de `data/conocimiento/documentos/restringido/`.
7. El sistema NO DEBE copiar ni resumir contenido de los dos documentos restringidos dentro de un documento general.
8. CUANDO se consulten documentos generales mediante `Retrieve`, ENTONCES la consulta DEBE aplicar el filtro `classification = GENERAL` como segunda barrera de seguridad.

### Requisito 4: Conjunto de evaluación del conocimiento

**Historia de usuario:** Como equipo del hackathon, quiero un conjunto de preguntas trazable al corpus, para medir recuperación, ausencia de respuesta e investigación multidocumento.

#### Criterios de aceptación

1. CUANDO se complete la Parte A, ENTONCES `data/conocimiento/evaluacion.json` DEBE contener 23 casos: 20 preguntas de evaluación individual y 3 preguntas adicionales de tipo `INVESTIGACION`.
2. CUANDO una de las 15 preguntas individuales tenga respuesta en el corpus general, ENTONCES el caso DEBE contener `pregunta`, `documentId` y `fraseClave`, y los dos últimos valores DEBEN coincidir con el documento general esperado y con una frase verificable de ese documento.
3. CUANDO una de las 5 preguntas individuales no deba responderse con el corpus general, ENTONCES el caso DEBE contener `pregunta` y `esperado: "NO_ANSWER"`, y NO DEBE declarar `documentId` ni `fraseClave`.
4. Las 5 preguntas `NO_ANSWER` DEBEN incluir consultas cuya única respuesta esté en los documentos restringidos y consultas sobre información externa o ajena a la empresa.
5. El conjunto individual DEBE incluir las preguntas de conocimiento de la demo descrita en `.kiro/steering/producto.md`, incluidas las consultas sobre anticipación de viajes, el seguimiento sobre viajes internacionales, salario gerencial y precio del dólar.
6. CUANDO se defina una pregunta de búsqueda de documentos para la demo, ENTONCES el conjunto DEBE permitir verificar el hallazgo del procedimiento de gestión de cambios de TI por su `documentId` y una frase clave.
7. CUANDO se defina una pregunta `INVESTIGACION`, ENTONCES el caso DEBE contener `pregunta`, `tipo: "INVESTIGACION"` y `documentosEsperados` con al menos dos `documentId` generales distintos.
8. Las 3 preguntas `INVESTIGACION` DEBEN exigir combinar información de al menos dos documentos y NO DEBEN poder responderse completamente con un solo documento.
9. Una de las 3 preguntas `INVESTIGACION` DEBE ser `Voy a Cartagena tres días a visitar un cliente: ¿con cuánta anticipación lo pido, cuánto me dan de viáticos y cómo legalizo los gastos?` y DEBE esperar los documentos de viajes y de gastos y reembolsos.
10. SI una pregunta positiva cambia por una modificación aprobada del corpus, ENTONCES su `documentId` y su `fraseClave` DEBEN actualizarse en la misma tarea para conservar la trazabilidad.

### Requisito 5: Contrato y alcance del conector Skkeda

**Historia de usuario:** Como núcleo de EVA, quiero invocar un conector mock determinístico de Skkeda, para ejecutar reservas de puestos mediante el flujo transaccional autorizado.

#### Criterios de aceptación

1. CUANDO Step Functions invoque `src/conectores/skkeda/handler.ts`, ENTONCES el conector DEBE recibir un `InvokeRequest` y devolver un `InvokeResult` conforme a `src/comun/contrato.ts` y `contrato-mvp.md` §1.
2. CUANDO el conector devuelva cualquier resultado exitoso o fallido, ENTONCES DEBE conservar el `correlationId` recibido y DEBE establecer `origin: "mock"`.
3. El conector DEBE admitir únicamente las capacidades activas `skkeda:booking.create`, `skkeda:booking.list` y `skkeda:booking.cancel` de `data/skkeda/catalogo.json`.
4. SI el conector recibe una capacidad distinta, ENTONCES DEBE devolver `DENIED` con `error.code: "UNKNOWN_CAPABILITY"` y NO DEBE modificar datos.
5. CUANDO `skkeda:booking.create` reciba `kind`, ENTONCES el único valor admitido DEBE ser `puesto`.
6. SI `skkeda:booking.create` recibe `kind: "sala"` o cualquier valor diferente de `puesto`, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"` y NO DEBE crear una reserva.
7. El conector DEBE usar exclusivamente el `userId` del `InvokeRequest` como identidad y NO DEBE aceptar ni sustituir la identidad mediante `params`.
8. El conector DEBE recibir su cliente de DynamoDB mediante inyección para permitir pruebas sin llamadas reales a AWS.
9. CUANDO el conector acceda al estado persistente, ENTONCES DEBE usar la tabla indicada por `TABLA_ESTADO` y las claves `SKKEDA#<fecha>`/`<recurso>`, `SKKEDA-USR#<userId>`/`<fecha>` y `SKKEDA-BK#<código>`/`BK` definidas en `contrato-mvp.md` §6.
10. El conector NO DEBE invocar el modelo, el núcleo ni otros conectores, y NO DEBE recibir herramientas, URLs, secretos ni tokens.

### Requisito 6: Creación y asignación de puestos

**Historia de usuario:** Como colaboradora, quiero reservar un puesto específico o el primer puesto disponible de un piso, para trabajar cerca de mi equipo.

#### Criterios de aceptación

1. CUANDO llegue `skkeda:booking.create` con una fecha válida y un `resource` libre entre `P-1` y `P-40`, ENTONCES el conector DEBE crear la reserva y devolver `status: "OK"` y `data` con `code`, `resource`, `floor` y `date`.
2. CUANDO llegue `floor` sin `resource`, ENTONCES el conector DEBE asignar el primer puesto libre de ese piso en orden numérico ascendente.
3. CUANDO se asigne un puesto por piso, ENTONCES el conector DEBE usar los rangos piso 2 `P-1`–`P-14`, piso 3 `P-15`–`P-27` y piso 4 `P-28`–`P-40`.
4. CUANDO llegue un `resource`, ENTONCES el conector DEBE calcular `floor` a partir del rango del puesto y DEBE incluirlo en `data`.
5. SI llegan `resource` y `floor` y no corresponden al mismo piso, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"` sin escribir datos.
6. SI falta tanto `resource` como `floor`, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"` sin asignar un puesto global por defecto.
7. SI `date` no es una fecha calendario válida en formato `AAAA-MM-DD`, `resource` no pertenece a `P-1`–`P-40`, `floor` no es 2, 3 o 4 o llegan parámetros adicionales no admitidos, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"` sin escribir datos.
8. CUANDO se cree una reserva, ENTONCES su código DEBE seguir el formato `BK-SYN-<AAAAMMDD>-<puesto sin guion interno>`, por ejemplo `BK-SYN-20261126-P15` para `P-15`.
9. CUANDO se creen simultáneamente reservas para el mismo puesto y fecha, ENTONCES como máximo una solicitud DEBE devolver `OK` y ninguna solicitud DEBE sobrescribir una reserva existente.

### Requisito 7: Conflictos, alternativas, límite diario e idempotencia

**Historia de usuario:** Como colaboradora, quiero recibir alternativas ante conflictos y evitar reservas duplicadas, para completar la reserva sin resultados inconsistentes.

#### Criterios de aceptación

1. CUANDO se solicite `P-12` para cualquier fecha, ENTONCES el conector DEBE tratarlo como ocupado por `SYN-USR-0099`.
2. SI el puesto solicitado está ocupado, ENTONCES el conector DEBE devolver `CONFLICT`, `error.code: "RESOURCE_TAKEN"` y `data.alternatives` con hasta 5 puestos libres para la fecha solicitada.
3. CUANDO el conector construya alternativas, ENTONCES DEBE ordenar primero los puestos libres del mismo piso y después los puestos libres de otros pisos, manteniendo orden numérico ascendente dentro de cada grupo.
4. CUANDO el conector devuelva una alternativa, ENTONCES cada alternativa DEBE incluir al menos `resource` y `floor`.
5. SI no hay puestos libres en el piso pedido, ENTONCES el conector DEBE devolver `RESOURCE_TAKEN` con hasta 5 alternativas de otros pisos.
6. SI la persona ya tiene un puesto reservado para la fecha solicitada, ENTONCES el conector DEBE devolver `CONFLICT` con `error.code: "DAILY_LIMIT"` y NO DEBE incluir alternativas.
7. SI una capacidad `WRITE` llega sin `idempotencyKey`, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "MISSING_IDEMPOTENCY"` sin cambiar datos.
8. CUANDO el conector reciba nuevamente la misma `idempotencyKey`, ENTONCES DEBE devolver el mismo resultado original y NO DEBE crear, cancelar ni modificar una reserva por segunda vez.
9. CUANDO dos solicitudes concurrentes intenten crear una segunda reserva para la misma persona y fecha, ENTONCES como máximo una solicitud DEBE devolver `OK` y la otra DEBE devolver `DAILY_LIMIT`.

### Requisito 8: Listado, cancelación y fallas de Skkeda

**Historia de usuario:** Como colaboradora, quiero consultar y cancelar únicamente mis reservas, para gestionar mis puestos sin afectar a otras personas.

#### Criterios de aceptación

1. CUANDO llegue `skkeda:booking.list`, ENTONCES el conector DEBE devolver en `data.bookings` únicamente las reservas activas del `userId` recibido.
2. CUANDO `skkeda:booking.list` reciba `date`, ENTONCES el conector DEBE devolver únicamente las reservas activas de esa fecha.
3. CUANDO el conector liste una reserva, ENTONCES cada elemento DEBE incluir `date`, `resource`, `floor` y `code`.
4. CUANDO llegue `skkeda:booking.cancel` con el código de una reserva activa perteneciente al `userId`, ENTONCES el conector DEBE liberar el puesto, liberar el límite diario de la persona y devolver `status: "OK"`.
5. SI el código no existe, la reserva ya no está activa o pertenece a otra persona, ENTONCES el conector DEBE devolver `NOT_FOUND` sin revelar cuál condición ocurrió y sin modificar datos.
6. SI DynamoDB falla durante cualquier operación, ENTONCES el conector DEBE devolver `UNAVAILABLE` con `error.code: "SOURCE_UNAVAILABLE"`.
7. CUANDO el conector registre una operación o un error, ENTONCES el log DEBE limitarse a `correlationId`, `capabilityId`, `status` y códigos técnicos, y NO DEBE incluir `userId`, parámetros, nombre o mensaje de excepciones ni contenido de la solicitud o respuesta.

### Requisito 9: Pruebas del conector Skkeda

**Historia de usuario:** Como equipo del hackathon, quiero pruebas determinísticas de cada regla de Skkeda, para demostrar que el mock conserva seguridad y consistencia.

#### Criterios de aceptación

1. CUANDO se pruebe `skkeda:booking.create`, ENTONCES las pruebas DEBEN cubrir reserva por recurso, asignación por cada piso, cálculo de `floor`, formato del código y rechazo de fechas, puestos, pisos, combinaciones y propiedades inválidas.
2. CUANDO se prueben conflictos, ENTONCES las pruebas DEBEN cubrir `P-12`, un puesto ya reservado, un piso lleno, orden y límite de 5 alternativas, ausencia total de alternativas y `DAILY_LIMIT`.
3. CUANDO se pruebe idempotencia, ENTONCES las pruebas DEBEN demostrar que repetir la clave en creación y cancelación devuelve el mismo resultado y no duplica efectos.
4. CUANDO se pruebe concurrencia, ENTONCES las pruebas DEBEN demostrar que no se puede sobrescribir un puesto ni superar el límite de un puesto por persona y día.
5. CUANDO se prueben listado y cancelación, ENTONCES las pruebas DEBEN cubrir filtro por fecha, aislamiento por `userId`, liberación de las claves de ocupación y respuesta indistinguible para códigos ajenos, inexistentes o inactivos.
6. CUANDO se prueben errores, ENTONCES las pruebas DEBEN cubrir capacidad desconocida, ausencia de `idempotencyKey`, `kind` distinto de `puesto` y falla inyectada de DynamoDB.
7. Las pruebas DEBEN usar un cliente de DynamoDB simulado o inyectado y NO DEBEN realizar llamadas reales a AWS.

### Requisito 10: Datos y contrato del mock de Jira

**Historia de usuario:** Como colaboradora, quiero consultar mis tareas sintéticas de Jira, para ver pendientes sin abrir una herramienta externa.

#### Criterios de aceptación

1. CUANDO Step Functions invoque `src/conectores/jira/handler.ts`, ENTONCES el conector DEBE recibir un `InvokeRequest` y devolver un `InvokeResult` conforme a `src/comun/contrato.ts` y `contrato-mvp.md` §1.
2. El conector DEBE admitir únicamente la capacidad activa y de lectura `jira:issue.search` definida en `data/jira/catalogo.json`.
3. SI el conector recibe otra capacidad, ENTONCES DEBE devolver `DENIED` con `error.code: "UNKNOWN_CAPABILITY"`.
4. CUANDO el conector devuelva cualquier resultado exitoso o fallido, ENTONCES DEBE conservar el `correlationId` recibido y DEBE establecer `origin: "mock"`.
5. El mock DEBE contener exactamente estas cuatro tareas sintéticas fijas, todas asignadas al `userId` recibido: `EVA-SYN-101` con estado `En curso` y prioridad `alta`; `EVA-SYN-104` con estado `En revisión` y prioridad `media`; `TI-SYN-220` con estado `Por hacer` y prioridad `media`; y `EVA-SYN-099` con estado `Hecho` y prioridad `baja`.
6. CUANDO el conector devuelva una tarea, ENTONCES el elemento DEBE incluir `key`, `summary`, `status`, `priority` y una fecha de vencimiento sintética fija en `due`.
7. El conector DEBE mantener las cuatro tareas fijas en el código del mock y NO DEBE usar DynamoDB, secretos, OAuth, Jira real ni servicios externos.
8. El conector NO DEBE ofrecer ni aceptar capacidades de creación, transición, comentario o cualquier otra escritura en Jira.

### Requisito 11: Filtros y pruebas del mock de Jira

**Historia de usuario:** Como colaboradora, quiero filtrar mis tareas abiertas o por proyecto, para recibir una lista pertinente y predecible.

#### Criterios de aceptación

1. CUANDO llegue `jira:issue.search` sin `status` o con `status: "OPEN"`, ENTONCES el conector DEBE devolver las tres tareas cuyo estado no es `Hecho` y DEBE excluir `EVA-SYN-099`.
2. CUANDO llegue `jira:issue.search` con `status: "ALL"`, ENTONCES el conector DEBE devolver las cuatro tareas sintéticas.
3. CUANDO llegue el filtro `project` con `EVA` o `TI`, ENTONCES el conector DEBE devolver únicamente las tareas cuyo prefijo anterior a `-SYN-` coincida exactamente con el proyecto solicitado.
4. SI `status` no es `OPEN` ni `ALL`, `project` no es una cadena válida o llegan propiedades adicionales, ENTONCES el conector DEBE devolver `FAILED` con `error.code: "INVALID_PARAMETER"`.
5. CUANDO la consulta sea válida, ENTONCES el conector DEBE devolver `status: "OK"` y `data.items` con la lista filtrada, incluida una lista vacía cuando no existan coincidencias.
6. CUANDO se pruebe el valor predeterminado o `OPEN`, ENTONCES las pruebas DEBEN verificar que se devuelven exactamente tres tareas y ninguna tiene estado `Hecho`.
7. CUANDO se pruebe `ALL`, ENTONCES las pruebas DEBEN verificar que se devuelven exactamente cuatro tareas, incluida `EVA-SYN-099`.
8. CUANDO se pruebe `project`, ENTONCES las pruebas DEBEN cubrir los proyectos `EVA` y `TI` y un proyecto sin resultados.
9. CUANDO se prueben errores, ENTONCES las pruebas DEBEN cubrir capacidad desconocida, filtros inválidos y propiedades adicionales.
10. Las pruebas del mock de Jira NO DEBEN realizar llamadas reales a AWS ni depender de credenciales, secretos o recursos desplegados.

### Requisito 12: Evaluador de la Knowledge Base desplegada

**Historia de usuario:** Como equipo del hackathon, quiero medir la recuperación del corpus desplegado, para reportar top-1, top-3 y rechazos correctos sin exponer los pasajes.

#### Criterios de aceptación

1. CUANDO la operadora ejecute `infra/scripts/evaluar-conocimiento.mjs`, ENTONCES el script DEBE leer el identificador `KbId` de las salidas del stack `eva-dev` y DEBE usarlo para consultar la Knowledge Base desplegada.
2. SI el stack `eva-dev` no existe, no expone `KbId` o la salida no puede leerse, ENTONCES el script DEBE indicar cuál de esas condiciones falló y DEBE finalizar con un código de salida distinto de cero.
3. CUANDO la operadora inicie la evaluación, ENTONCES la ingesta del corpus general DEBE haber alcanzado el estado `COMPLETE`; el script NO DEBE iniciar una ingesta ni modificar la Knowledge Base.
4. CUANDO el script procese `data/conocimiento/evaluacion.json`, ENTONCES DEBE evaluar las 20 preguntas individuales y DEBE omitir explícitamente las 3 preguntas cuyo `tipo` sea `INVESTIGACION`, porque estas corresponden a la prueba de humo.
5. CUANDO el script consulte una pregunta individual, ENTONCES DEBE usar la operación `Retrieve`, solicitar 5 resultados y aplicar el filtro exacto `classification = GENERAL`.
6. CUANDO un caso declare `documentId`, ENTONCES el script DEBE registrar un acierto top-1 si el primer resultado corresponde al documento esperado y un acierto top-3 si el documento esperado aparece entre los tres primeros resultados.
7. CUANDO un caso declare `esperado: "NO_ANSWER"`, ENTONCES el script DEBE aplicar el umbral de preguntas de 0,5 y DEBE registrar un acierto si `Retrieve` no devuelve pasajes o si ningún pasaje recuperado alcanza ese umbral.
8. CUANDO termine la evaluación, ENTONCES el script DEBE reportar cantidades y porcentajes separados de aciertos top-1, aciertos top-3 y casos `NO_ANSWER` correctos, además del número de casos `INVESTIGACION` omitidos.
9. SI cualquier resultado recuperado contiene un `documentId` asociado al corpus restringido, ENTONCES el script DEBE reportar una falla de seguridad y finalizar con un código de salida distinto de cero.
10. CUANDO el script produzca su reporte, ENTONCES NO DEBE imprimir el texto de los pasajes ni respuestas generadas; solo PUEDE mostrar identificadores de caso, métricas, puntajes y `documentId` recuperados o esperados.
11. SI una llamada `Retrieve` falla, ENTONCES el script DEBE identificar el caso por su posición en `evaluacion.json`, DEBE continuar con los casos restantes y DEBE finalizar con un código de salida distinto de cero.
12. El script DEBE usar la región `us-east-1`, credenciales suministradas por el entorno de la operadora y NO DEBE incluir secretos ni credenciales en el código o en la salida.
