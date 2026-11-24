import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Identidad } from './tipos';

function normalizarGrupos(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map((g) => String(g).trim()).filter((g) => g.length > 0);
  if (typeof valor === 'string') {
    return valor
      .split(',')
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
  }
  return [];
}

/** Identidad solo de los claims del autorizador; nunca del cuerpo ni del modelo. Sin claims devuelve null. */
export function extraerIdentidad(event: APIGatewayProxyEvent): Identidad | null {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  const sub = claims?.sub;
  if (typeof sub !== 'string' || sub.trim().length === 0) return null;
  return { userId: sub, grupos: normalizarGrupos(claims?.['cognito:groups']) };
}
