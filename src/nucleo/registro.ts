// Logger JSON sin contenido: solo identificadores y códigos (invariante 8).
const CAMPOS_PERMITIDOS = new Set([
  'correlationId',
  'conversationId',
  'capabilityId',
  'status',
  'codigo',
  'documentIds',
  'usuarioHash',
  'etapa',
  'duracionMs',
]);

export type CamposLog = Record<string, string | number | string[] | undefined>;

export function filtrarCampos(campos: CamposLog): Record<string, unknown> {
  const limpio: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(campos)) {
    if (CAMPOS_PERMITIDOS.has(clave) && valor !== undefined) limpio[clave] = valor;
  }
  return limpio;
}

export function log(nivel: 'INFO' | 'ERROR', evento: string, campos: CamposLog = {}): void {
  const linea = JSON.stringify({ nivel, evento, ...filtrarCampos(campos) });
  if (nivel === 'ERROR') console.error(linea);
  else console.log(linea);
}

/** Código seguro de una excepción: nunca su mensaje, que puede traer contenido. */
export function codigoDeError(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'ERROR_DESCONOCIDO';
}
