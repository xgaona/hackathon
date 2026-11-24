// Policy Engine determinístico: la IA propone, este módulo autoriza (invariante 5).
import type { Capability, Connector, Veredicto } from '../comun/contrato';
import skkedaJson from '../../data/skkeda/catalogo.json';
import jiraJson from '../../data/jira/catalogo.json';

export interface EntradaCatalogo {
  capability: Capability;
  connector: Connector;
}

export type Catalogo = Map<string, EntradaCatalogo>;

export function construirCatalogo(conectores: Connector[]): Catalogo {
  const catalogo: Catalogo = new Map();
  for (const connector of conectores) {
    for (const capability of connector.capabilities) {
      catalogo.set(capability.capabilityId, { capability, connector });
    }
  }
  return catalogo;
}

/** Une los catálogos de los conectores. Sumar un conector es agregar su JSON a esta lista. */
export function cargarCatalogo(): Catalogo {
  return construirCatalogo([skkedaJson as unknown as Connector, jiraJson as unknown as Connector]);
}

/** Función pura: sin red, reloj ni entorno. Cerrada por defecto. */
export function evaluar(capabilityId: string, grupos: string[], catalogo: Catalogo): Veredicto {
  const entrada = catalogo.get(capabilityId);
  if (!entrada) return 'DENY';
  const { capability, connector } = entrada;
  if (capability.status !== 'ACTIVE' || connector.status !== 'ACTIVE') return 'DENY';
  if (capability.permissions.length > 0 && !capability.permissions.some((p) => grupos.includes(p))) return 'DENY';
  if (capability.mode === 'READ') return 'ALLOW';
  if (capability.mode === 'WRITE') return 'ALLOW_WITH_CONFIRMATION';
  return 'DENY';
}
