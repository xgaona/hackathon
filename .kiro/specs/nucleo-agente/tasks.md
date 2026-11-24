# Plan de implementación

**Ejecutar todas las tareas seguidas, sin pedir aprobación entre tareas.**

Reglas:
- Solo se escribe en `src/nucleo/`.
- Usar los nombres de `src/comun/contrato.ts`, `contrato-mvp.md` y `design.md`.
- Al terminar cada tarea deben pasar `npm run build` y `npm run lint`. `npm test` se corre al final (tarea 7).
- Hacer commit al terminar cada tarea: `feat(nucleo): <qué> [tarea n]`.

- [ ] 1. Base: dependencias, identidad, fechas, estado y handler
  - `dependencias.ts`: la interfaz `Deps` y `depsReales()` con clientes de us-east-1.
  - `identidad.ts`: `leerIdentidad` con `claims.sub` y `claims['cognito:groups']` (separados por coma).
  - `fechas.ts`:
    - `fechaBogota(dias)`: UTC−5;
    - `fechaLegible(iso)`: "jueves 26 de noviembre de 2026 (2026-11-26)";
    - `calendario(8)`.
  - `estado.ts`: turnos (últimos 3, TTL 1 h), pendiente (TTL 15 min) e idempotencia (TTL 24 h), con las claves de design.md.
  - `handler.ts`:
    - `crearHandler(deps)` con las dos rutas (`resource` termina en `/confirm`);
    - las respuestas 401 y 400;
    - el mensaje recortado a 1000 caracteres;
    - `conversationId` nuevo si no viene;
    - `correlationId` por solicitud;
    - un `try/catch` que responde `FAILED`;
    - un log JSON solo con los IDs de design.md.
  - _Requisitos: 1.1, 1.2, 5.1, 9.1, 9.2_

- [ ] 2. Guardrails y clasificador
  - `guardrail.ts`: `ApplyGuardrail` (INPUT y OUTPUT). Si faltan `GUARDRAIL_ID` o `GUARDRAIL_VERSION`, no interviene.
  - En el handler: Guardrails de entrada → `BLOCKED` con `outputs[0].text` o un texto amable.
  - `intencion.ts`:
    - el prompt del clasificador **copiado completo de design.md**;
    - el historial "Persona/EVA" y el mensaje actual;
    - `Converse` con temperatura 0 y `maxTokens` 300;
    - extracción del JSON y validación con Ajv; si falla, `PREGUNTA` con el texto original.
  - _Requisitos: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [ ] 3. Respuesta con la base de conocimiento
  - `recuperacion.ts`:
    - `Retrieve` con `numberOfResults` 5 y el filtro `classification = GENERAL`;
    - partición de cada fragmento por `##` y separación del título con `TITULOS_SECCION` (`split('|')`);
    - normalización a `Pasaje`;
    - `filtrar(pasajes, umbral)` con `≥ umbral` y `≥ mejor − 0,1`.
  - `respuesta.ts`, en `responderPregunta`:
    - umbral 0,5; sin pasajes → `NO_ANSWER` sin llamar a Converse;
    - pasajes numerados `[n] título — sección: texto`;
    - el prompt de respuesta **copiado completo de design.md** (`maxTokens` 500);
    - `NO_ENCONTRADO` → `NO_ANSWER`;
    - Guardrails OUTPUT solo sobre el texto;
    - citas sin duplicados, solo de las marcas `[n]` (o el primer pasaje si no hay marcas);
    - quitar las marcas del texto y guardar el turno.
  - _Requisitos: 3.1, 3.2, 3.3, 3.4_

- [ ] 4. Saludos y búsqueda de documentos
  - `respuesta.ts`: `respuestaSaludo(mensaje)` con el texto fijo de design.md, o "¡Con gusto! Si necesitas algo más, aquí estoy." si el mensaje coincide con `/gracias|chao|adi[oó]s|hasta luego/i`.
  - `documentos.ts`, en `buscarDocumentos`:
    - `Retrieve` con "Documento sobre <tema>";
    - umbral `UMBRAL_DOCUMENTO` (0,65 por defecto);
    - un pasaje por `documentId`, máximo 3;
    - un documento: "Encontré el documento '<título>' (actualizado el <fecha>). Lo tienes en las fuentes; si quieres, pregúntame algo puntual sobre él.";
    - varios: la lista y "¿Te resumo alguno?";
    - ninguno: `NO_ANSWER` "No encontré un documento sobre "<tema>" entre las fuentes a las que tengo acceso.".
  - Enrutar en el handler `SALUDO` y `BUSCAR_DOCUMENTO`, guardando el turno.
  - _Requisitos: 4.1, 4.2, 4.3, 4.4, 5.1_

- [ ] 5. Policy Engine, aclaraciones, propuestas y lecturas
  - `politica.ts`: `decidir` puro, sobre la unión de `data/skkeda/catalogo.json` y `data/jira/catalogo.json` (reglas en invariantes.md, punto 5).
  - `acciones.ts`, en `accion`:
    - `DENY` → `DENIED` ("No tengo permitido hacer eso. Puedo responder preguntas sobre políticas y procesos, buscar documentos, reservar, listar o cancelar puestos en Skkeda y consultar tus tareas en Jira.");
    - en `skkeda:booking.create`, `floor` fuera de 2–4 → `NEEDS_CLARIFICATION` con los pisos válidos;
    - en `skkeda:booking.create`, sin `date` válida → `NEEDS_CLARIFICATION` "¡Claro! ¿Para qué día quieres el puesto en el piso <n>? Puedes decirme, por ejemplo, "mañana" o una fecha.";
    - guardar el turno de cada aclaración.
  - `proponer`:
    - descartar un `resource` que no cumpla `^P-\d{1,2}$`;
    - `summary` con Acción, Piso, Puesto y Fecha legible;
    - `summaryHash`, guardar la pendiente y responder `AWAITING_CONFIRMATION`.
  - Lecturas:
    - `StartSyncExecution` con `InvokeRequest`, 1 reintento y luego `UNAVAILABLE`;
    - Jira: "Tienes <n> tarea(s) abierta(s) en Jira:" con una línea `• clave · título (estado, prioridad x, vence el y)`;
    - Skkeda: la lista de reservas;
    - si no es `OK` → `FAILED`;
    - guardar el turno.
  - _Requisitos: 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4_

- [ ] 6. Confirmación, idempotencia y conflictos
  - `acciones.ts`, en `confirmar`:
    - pendiente ausente o de otro usuario → 404; hash distinto → 409;
    - `CANCEL` → borrar y responder "Listo, no hice nada.";
    - `CONFIRM` → borrar, calcular `idempotencyKey`, leer `IDEMP#`, ejecutar con la clave y guardar el resultado `OK`.
  - Resultados:
    - `OK` → `COMPLETED` "Listo, reservé el puesto <P> (piso <n>) para el <fecha legible>. Tu código es <código>." (o la cancelación);
    - `RESOURCE_TAKEN` con alternativas → `proponer` con la primera y el prefacio "<mensaje>. Te propongo el <P>. ";
    - `UNAVAILABLE` → `ESCALATED`;
    - cualquier otro → `FAILED` con `error.message`.
  - _Requisitos: 8.1, 8.2, 8.3, 8.4_

- [ ] 7. Pruebas imprescindibles
  - `src/nucleo/handler.test.ts` con `crearHandler(depsSimuladas)`, con respuestas simuladas por tipo de comando. Casos:
    1. Pregunta con cita.
    2. Sin pasajes → `NO_ANSWER`.
    3. Acción fuera de catálogo → `DENIED`.
    4. Falta la fecha → `NEEDS_CLARIFICATION`.
    5. Hash alterado → 409.
    6. Confirmar dos veces no ejecuta dos veces.
    7. El `userId` del mensaje se ignora.
  - Al final deben pasar `npm run build`, `npm test` y `npm run lint`.
  - _Requisitos: 1.1, 3.2, 3.4, 5.3, 6.1, 8.1, 8.2_

## Grupo OPCIONAL: módulo de investigación

Solo se ejecuta si el MVP ya funciona (hito H1). Va en la rama `feat/investigacion`. Con `INVESTIGACION_ACTIVA` distinto de `"true"`, el comportamiento no cambia.

- [ ]* 8. Clasificación y búsqueda de investigación
  - `intencion.ts`: si `INVESTIGACION_ACTIVA === "true"`, agregar al esquema y al prompt los tipos `INVESTIGACION` (`subpreguntas`, de 2 a 4) y `ACLARAR` (`aclaracion`).
  - `investigacion.ts`:
    - `Retrieve` por subpregunta en paralelo, con el filtro y el umbral de la tarea 3;
    - una reformulación por subpregunta sin pasajes (`Converse`, temperatura 0, `{ reformulada }`);
    - máximo 2 rondas, 6 `Retrieve` y 20 s.
  - _Requisitos: 10.1, 10.2_

- [ ]* 9. Síntesis, researchSteps y aclaración
  - Sin pasajes → `NO_ANSWER`.
  - Con pasajes:
    - el prompt de respuesta más dos reglas: responder cada parte en orden, y "No encontré …" por cada subpregunta sin fuente;
    - Guardrails OUTPUT y citas;
    - `researchSteps` sin texto de pasajes.
  - `ACLARAR` → `NEEDS_CLARIFICATION` y guardar la pregunta original en el turno.
  - _Requisitos: 10.3, 10.4_
