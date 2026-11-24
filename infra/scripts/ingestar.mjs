#!/usr/bin/env node
// Lanza la ingesta de la base de conocimiento y espera a que termine.
// La ingesta no es automática: hay que correrla después de cada despliegue que cambie el corpus.
// Uso (operadora de AWS): node infra/scripts/ingestar.mjs
// Variables opcionales: STACK (por defecto eva-dev), AWS_PROFILE, AWS_REGION (por defecto us-east-1).
import { execFileSync } from 'node:child_process';
import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  StartIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';

const STACK = process.env.STACK ?? 'eva-dev';
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';
const ESPERA_MS = 5_000;
const LIMITE_MS = 10 * 60_000;

function salida(clave) {
  const valor = execFileSync(
    'aws',
    [
      'cloudformation', 'describe-stacks', '--stack-name', STACK, '--region', REGION,
      '--query', `Stacks[0].Outputs[?OutputKey=='${clave}'].OutputValue | [0]`,
      '--output', 'text',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (!valor || valor === 'None') {
    throw new Error(`El stack ${STACK} no tiene la salida ${clave}`);
  }
  return valor;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const knowledgeBaseId = salida('KbId');
  const dataSourceId = salida('DataSourceId');
  const cliente = new BedrockAgentClient({ region: REGION });

  const inicio = await cliente.send(new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId }));
  const ingestionJobId = inicio.ingestionJob?.ingestionJobId;
  console.log(`Ingesta ${ingestionJobId} iniciada en la KB ${knowledgeBaseId} (fuente ${dataSourceId}).`);

  const limite = Date.now() + LIMITE_MS;
  let estadoAnterior;
  for (;;) {
    const { ingestionJob } = await cliente.send(
      new GetIngestionJobCommand({ knowledgeBaseId, dataSourceId, ingestionJobId }),
    );
    const estado = ingestionJob?.status;
    if (estado !== estadoAnterior) {
      console.log(`Estado: ${estado}`);
      estadoAnterior = estado;
    }

    if (estado === 'COMPLETE') {
      const e = ingestionJob.statistics ?? {};
      const indexados = (e.numberOfNewDocumentsIndexed ?? 0) + (e.numberOfModifiedDocumentsIndexed ?? 0);
      console.log(`Documentos indexados: ${indexados}`);
      console.log(`  revisados: ${e.numberOfDocumentsScanned ?? 0}`);
      console.log(`  nuevos: ${e.numberOfNewDocumentsIndexed ?? 0}`);
      console.log(`  modificados: ${e.numberOfModifiedDocumentsIndexed ?? 0}`);
      console.log(`  sin cambios: ${(e.numberOfDocumentsScanned ?? 0) - indexados - (e.numberOfDocumentsFailed ?? 0) - (e.numberOfDocumentsDeleted ?? 0)}`);
      console.log(`  borrados: ${e.numberOfDocumentsDeleted ?? 0}`);
      console.log(`  fallidos: ${e.numberOfDocumentsFailed ?? 0}`);
      return (e.numberOfDocumentsFailed ?? 0) > 0 ? 1 : 0;
    }
    if (estado === 'FAILED' || estado === 'STOPPED') {
      console.error(`La ingesta terminó en ${estado}.`);
      for (const motivo of ingestionJob?.failureReasons ?? []) {
        console.error(`  - ${motivo}`);
      }
      return 1;
    }
    if (Date.now() > limite) {
      console.error('La ingesta no terminó en 10 minutos.');
      return 1;
    }
    await dormir(ESPERA_MS);
  }
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error(`No pude completar la ingesta: ${error.message}`);
    process.exit(1);
  });
