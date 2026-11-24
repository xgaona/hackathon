// STUB del kit: punto de entrada de la API /v1. Xio reemplaza este contenido con el spec nucleo-agente.
// No mover ni renombrar: el CDK de infra/ apunta a este archivo.
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 501,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'NOT_IMPLEMENTED', message: 'EVA todavía no está lista' }),
  };
}
