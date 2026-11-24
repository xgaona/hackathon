// Dependencias inyectadas del núcleo: clientes de AWS, reloj e identificadores.
import { randomUUID } from 'node:crypto';
import {
  BedrockRuntime,
  type ApplyGuardrailCommandInput,
  type ApplyGuardrailCommandOutput,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockAgentRuntime,
  type RetrieveCommandInput,
  type RetrieveCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { SFN, type StartSyncExecutionCommandInput, type StartSyncExecutionCommandOutput } from '@aws-sdk/client-sfn';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocument,
  type DeleteCommandInput,
  type GetCommandInput,
  type GetCommandOutput,
  type PutCommandInput,
  type QueryCommandInput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';

export interface ClienteBedrock {
  converse(entrada: ConverseCommandInput): Promise<ConverseCommandOutput>;
  applyGuardrail(entrada: ApplyGuardrailCommandInput): Promise<ApplyGuardrailCommandOutput>;
}

export interface ClienteAgente {
  retrieve(entrada: RetrieveCommandInput): Promise<RetrieveCommandOutput>;
}

export interface ClienteSfn {
  startSyncExecution(entrada: StartSyncExecutionCommandInput): Promise<StartSyncExecutionCommandOutput>;
}

export interface ClienteDdb {
  get(entrada: GetCommandInput): Promise<GetCommandOutput>;
  put(entrada: PutCommandInput): Promise<unknown>;
  query(entrada: QueryCommandInput): Promise<QueryCommandOutput>;
  delete(entrada: DeleteCommandInput): Promise<unknown>;
}

export interface Dependencias {
  bedrock: ClienteBedrock;
  agente: ClienteAgente;
  sfn: ClienteSfn;
  ddb: ClienteDdb;
  ahora(): Date;
  nuevoId(): string;
}

export interface Config {
  tabla: string;
  kbId: string;
  flujoArn: string;
  modelId: string;
  guardrailId: string;
  guardrailVersion: string;
  /** Títulos ## del corpus, del más largo al más corto. */
  titulosSeccion: string[];
  investigacionActiva: boolean;
  umbralDocumento: number;
}

type Entorno = Record<string, string | undefined>;

export function leerConfig(env: Entorno): Config {
  const umbral = Number(env.UMBRAL_DOCUMENTO);
  return {
    tabla: env.TABLA_ESTADO ?? '',
    kbId: env.KB_ID ?? '',
    flujoArn: env.FLUJO_TRANSACCIONAL_ARN ?? '',
    modelId: env.MODEL_ID || 'amazon.nova-pro-v1:0',
    guardrailId: env.GUARDRAIL_ID ?? '',
    guardrailVersion: env.GUARDRAIL_VERSION ?? '',
    titulosSeccion: (env.TITULOS_SECCION ?? '')
      .split('|')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .sort((a, b) => b.length - a.length),
    investigacionActiva: env.INVESTIGACION_ACTIVA === 'true',
    umbralDocumento: env.UMBRAL_DOCUMENTO && Number.isFinite(umbral) ? umbral : 0.65,
  };
}

export function crearDependenciasReales(): Dependencias {
  const bedrock = new BedrockRuntime({});
  const agente = new BedrockAgentRuntime({});
  const sfn = new SFN({});
  const ddb = DynamoDBDocument.from(new DynamoDB({}), { marshallOptions: { removeUndefinedValues: true } });
  return {
    bedrock: {
      converse: (e) => bedrock.converse(e),
      applyGuardrail: (e) => bedrock.applyGuardrail(e),
    },
    agente: { retrieve: (e) => agente.retrieve(e) },
    sfn: { startSyncExecution: (e) => sfn.startSyncExecution(e) },
    ddb: {
      get: (e) => ddb.get(e),
      put: (e) => ddb.put(e),
      query: (e) => ddb.query(e),
      delete: (e) => ddb.delete(e),
    },
    ahora: () => new Date(),
    nuevoId: () => randomUUID(),
  };
}
