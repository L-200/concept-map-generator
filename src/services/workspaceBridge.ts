import rawExemplo from '../../exemplo.md?raw';
import rawFlowchart from '../../exemplo-fluxograma.md?raw';

export interface DefaultInputPayload {
  fileName: string;
  content: string;
}

export type WorkspaceExampleFile = 'exemplo.md' | 'exemplo-fluxograma.md';

const RAW_FALLBACKS: Record<string, string> = {
  'exemplo.md': rawExemplo,
  'exemplo-fluxograma.md': rawFlowchart,
};

/**
 * Busca um arquivo de exemplo do workspace local.
 * Prioriza a requisição ao servidor Vite (`/api/default-input?file=...`)
 * e recorre de forma transparente ao conteúdo embutido (`?raw`) caso a API não esteja acessível.
 */
export async function fetchWorkspaceInput(
  fileName: WorkspaceExampleFile | string = 'exemplo.md'
): Promise<DefaultInputPayload> {
  const sanitizedName = fileName.trim() || 'exemplo.md';

  try {
    const url = `/api/default-input?file=${encodeURIComponent(sanitizedName)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = (await response.json()) as DefaultInputPayload;
      if (data && typeof data.content === 'string') {
        return data;
      }
    }
  } catch {
    // Falha de rede ou servidor dev indisponível; prossegue para o fallback embutido
  }

  // Fallback estático embutido
  const fallback = RAW_FALLBACKS[sanitizedName];
  if (fallback !== undefined) {
    return {
      fileName: sanitizedName,
      content: fallback,
    };
  }

  throw new Error(
    `Arquivo '${sanitizedName}' não encontrado no servidor local e não possui fallback embutido.`
  );
}

/**
 * Busca o arquivo `exemplo.md` padrão (Mapa Conceitual Novak).
 * Mantém 100% de retrocompatibilidade com todas as chamadas existentes.
 */
export async function fetchDefaultWorkspaceInput(): Promise<DefaultInputPayload> {
  return fetchWorkspaceInput('exemplo.md');
}

/**
 * Busca o arquivo `exemplo-fluxograma.md` padrão (Fluxograma de Processos).
 */
export async function fetchFlowchartWorkspaceInput(): Promise<DefaultInputPayload> {
  return fetchWorkspaceInput('exemplo-fluxograma.md');
}
