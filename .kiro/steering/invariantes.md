---
inclusion: always
---

# Invariantes de seguridad (no romper)

Antes de escribir código, verifica cada punto. Si una tarea obliga a romper alguno, detente y avisa en lugar de seguir.

1. **La IA propone, el Policy Engine autoriza, los conectores ejecutan.** El modelo no recibe herramientas, URLs, secretos ni tokens, y no invoca conectores. Su salida es una propuesta JSON con esquema cerrado que se valida antes de usarla.
2. **Solo Step Functions invoca las Lambdas de conectores.** La Lambda del orquestador no tiene `lambda:InvokeFunction` sobre ellas.
3. **Identidad solo del token.** `userId` = `sub` y grupos = `cognito:groups` de los claims del autorizador de API Gateway. Nunca del mensaje ni de la propuesta del modelo.
4. **Escrituras con confirmación e idempotencia.** Toda capacidad `WRITE` produce primero una acción pendiente con `summaryHash = sha256(JSON del resumen)`. Al confirmar se comprueba el hash y se calcula `idempotencyKey = sha256(userId + pendingActionId + summaryHash)`. La misma clave nunca ejecuta dos veces.
5. **Policy Engine determinístico:** capacidad que no está en un catálogo o está `INACTIVE` → `DENY`; grupos sin permiso → `DENY`; `READ` → `ALLOW`; `WRITE` → `ALLOW_WITH_CONFIRMATION`.
6. **Contenido restringido nunca se indexa:** solo `data/conocimiento/documentos/general/` llega al bucket de la base de conocimiento, y además toda consulta `Retrieve` lleva el filtro `classification = GENERAL` (doble barrera).
7. **Respuestas fundamentadas:** el modelo responde solo con los pasajes recuperados, cita su fuente y, si no hay pasajes, no responde (estado `NO_ANSWER`). Los saludos, las aclaraciones y los resultados de acciones no son respuestas de conocimiento: no necesitan pasajes. Guardrails revisa la entrada y la respuesta.
8. **Logs sin PII ni contenido:** solo `correlationId`, `conversationId`, `capabilityId`, `status`, códigos y `documentId` citados. Nunca el texto de la pregunta ni de la respuesta.
9. **Un rol IAM por Lambda** y uno para la Knowledge Base, mínimo privilegio; DynamoDB y Secrets Manager con cifrado; buckets con `blockPublicAccess` y `enforceSSL`. Bedrock invocation logging desactivado.
10. **Datos sintéticos.** Nada de datos reales de personas o de Redeban.
