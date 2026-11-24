// Boilerplate del kit: nombres de recursos con la convención eva-<ambiente>-<recurso>.
const MAXIMO = 63;

export function nombre(ambiente: string, recurso: string): string {
  const resultado = `eva-${ambiente}-${recurso}`.toLowerCase();
  if (resultado.length > MAXIMO) {
    throw new Error(`El nombre ${resultado} supera ${MAXIMO} caracteres`);
  }
  return resultado;
}
