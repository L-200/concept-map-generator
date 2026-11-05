export interface DefaultInputPayload {
  fileName: string;
  content: string;
}

/**
 * Busca o arquivo `entrada.md` diretamente do diretório do projeto
 * através do endpoint local `/api/default-input` exposto pelo servidor Vite.
 */
export async function fetchDefaultWorkspaceInput(): Promise<DefaultInputPayload> {
  const response = await fetch('/api/default-input', {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = `Falha ao carregar entrada.md (HTTP ${response.status})`;
    try {
      const errorData = (await response.json()) as { error?: string };
      if (errorData?.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Ignora erro de parse JSON na resposta de erro
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as DefaultInputPayload;
}
