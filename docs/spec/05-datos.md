# 05 — Modelo de datos

EVA no es fuente de verdad de los terceros: guarda estado mínimo, referencias verificables, evidencia y su propio contenido (`eva-native`). Nunca almacena contenido restringido (CP-08, CP-10).

## Tabla única DynamoDB `eva-<env>-core`

Cifrada con KMS (CMK), point-in-time recovery activo y TTL en ítems efímeros.

| Entidad | PK | SK | Atributos | TTL |
|---------|----|----|-----------|-----|
| ConnectorCatalog | `CONNECTOR#<id>` | `V#<version>` | domain, contractVersion, integrationMode, authMode, capabilities, knowledgeSource, secretRef, baseUrlRef, limits | No |
| ConnectorPointer | `CONNECTOR#<id>` | `CURRENT` | activeVersion, status (`INACTIVE`/`ACTIVE`/`DISABLED`), changedByHash | No |
| Policy | `POLICY#<domain>` | `V#<version>` | rules, allowedParams, writeRequiresConfirm, requiredGroups, knowledgeSources | No |
| Conversation | `CONV#<correlationId>` | `META` | userIdHash, status, intent, connectorId, createdAt | Sí |
| PendingAction | `CONV#<correlationId>` | `PENDING` | pendingActionId, connectorId, capability, params normalizados, summaryHash, options[], expiresAt (10 min) | Sí |
| Turn | `CONV#<correlationId>` | `TURN#<ts>` | role, mensaje minimizado, citationIds (sin texto restringido) | Sí |
| TraceEvent | `CONV#<correlationId>` | `EVT#<ts>#<type>` | actor, connectorId, capability, integrationMode, origin, decision, resultRef | Sí |
| ConfirmationEvidence | `CONV#<correlationId>` | `CONFIRM#<ts>` | summaryHash, userIdHash, decision | Según retención de auditoría |
| Idempotency | `IDEMP#<key>` | `LOCK` | status, resultRef, expiresAt | Sí |
| IngestState | `INGEST#<connectorId>` | `STATE` | cursor, lastSyncAt, lastStatus, indexedCount, removedCount | No |
| IngestItem | `INGEST#<connectorId>` | `ITEM#<itemId>` | contentHash, s3Key, updatedAt (solo ítems `GENERAL` indexados) | No |
| KnowledgeItem | `KNOWLEDGE#<id>` | `V#<n>` | type, subtype, title, s3Key, owner, validUntil, status, validationResult | No |
| KnowledgePointer | `KNOWLEDGE#<id>` | `CURRENT` | publishedVersion, status, validUntil, publishedByHash | No |
| OAuthToken | `OAUTH#<connectorId>#<userIdHash>` | `TOKEN` | ciphertext (KMS del conector), scopes, expiresAt | Sí |
| OAuthState | `OAUTHSTATE#<state>` | `META` | userIdHash, connectorId, conversationId, codeVerifier cifrado (PKCE), expiresAt (10 min), uso único | Sí |
| CircuitState | `CB#<connectorId>` | `STATE` | failures, windowStart, openUntil | Sí |

### Índices

| Índice | PK | SK | Uso |
|--------|----|----|-----|
| GSI1 | `USER#<userIdHash>` | `createdAt` | Conversaciones del propio usuario (RS-09) |
| GSI2 | `KSTATUS#<status>` | `validUntil` | Job diario de vencimiento de `eva-native` |

### Reglas

- `idempotencyKey = sha256(userId + pendingActionId + summaryHash)`: reintentos de la misma confirmación se deduplican; una nueva propuesta idéntica obtiene clave nueva.
- `/confirm` solo es válido si existe `PENDING` vigente del mismo `userIdHash` y el `summaryHash` coincide; tras ejecutar, `PENDING` se elimina.
- La elección de una opción (`OPTIONS`) se valida contra `options[]` guardadas; un id no ofrecido se rechaza.
- `Turn` nunca guarda texto de documentos restringidos; solo `citationIds`.
- El `LOCK` usa `attribute_not_exists(PK)` (CP-04).
- La evidencia de confirmación se exporta a S3 con Object Lock.
- `OAuthToken` se cifra del lado del cliente con la llave del conector; solo `eva-connector-jira` puede descifrarlo.
- `IngestItem` nunca guarda texto; solo hash y ubicación del objeto `GENERAL`.

## Almacenamiento de conocimiento

| Recurso | Contenido | Protección |
|---------|-----------|------------|
| S3 `eva-<env>-kb-connectors/<connectorId>/<itemId>.txt` + `.metadata.json` | Contenido `GENERAL` de conectores | KMS, sin acceso público, escritura solo `eva-ingestion` |
| S3 `eva-<env>-kb-native/published/<knowledgeId>.md` + `.metadata.json` | Contenido propio publicado | KMS, versionado, escritura solo `eva-knowledge-admin` |
| S3 `eva-<env>-kb-native/drafts/` y `media/` | Borradores e imágenes | KMS, no indexado (solo `published/` es data source) |
| Knowledge Base `eva-<env>-kb` (S3 Vectors) | Vectores y metadatos | KMS; lectura solo `eva-knowledge-router` |

### Metadatos del índice (`.metadata.json`)

| Atributo | Tipo | Ejemplo | Uso en filtro |
|----------|------|---------|---------------|
| `source` | string | `eva-native` / `connector` | Prioridad y vigencia |
| `connectorId` | string | `daruma` | Solo conectores activos |
| `classification` | string | `GENERAL` | Siempre `= GENERAL` (CP-10) |
| `title`, `sourceUri` | string | — | Citas |
| `updatedAt` | number (epoch) | 1790000000 | Frescura |
| `type`, `subtype` | string | `ROUTE` / `PHYSICAL` | Rutas tras reserva |
| `status` | string | `PUBLISHED` | `eva-native` vigente (CP-12) |
| `validUntil` | number (epoch) | 1814400000 | `eva-native` vigente |
| `relatedSiteId` | string | `SITE-BOG-01` | Ruta física por sede |
| `lang` | string | `es` | Idioma |

## Clasificación de datos

| Dato | Clase | Dónde vive | Tratamiento |
|------|-------|------------|-------------|
| Credenciales de conectores | Secreto | Secrets Manager | Nunca en prompts, logs ni código (RS-07, RS-10) |
| Tokens OAuth de usuario | Secreto | DynamoDB cifrado con KMS del conector | Nunca al modelo ni al navegador (RS-18) |
| Aserción de usuario | Secreto efímero | Memoria del conector (60 s) | No se registra |
| Token de sesión | Sensible | Memoria del navegador | No persistido en localStorage |
| UPN, grupos | Personal | Claims, `userIdHash` en DynamoDB | Solo lo necesario para autorizar |
| Mensaje del usuario | Personal posible | Tránsito hacia Bedrock | Minimización y filtro PII (RS-08) |
| Contenido restringido de Daruma | Restringido | Solo en Daruma | En memoria durante la respuesta; solo `documentId` en trazas (RF-15.4) |
| Contenido general de conectores | Interno general | S3 + índice | Indexable; se retira si se reclasifica |
| Contenido propio `eva-native` | Interno general | S3 versionado + índice | Validado sin PII ni secretos (RS-19) |
| Reservas, issues, documentos | Negocio | Tercero | EVA guarda solo referencia |
| Trazas | Operativo | DynamoDB, CloudWatch | Sin secretos, tokens ni contenido restringido |
