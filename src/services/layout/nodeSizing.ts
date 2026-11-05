import type { Dimensions2D } from '../../domain/types';

export const DEFAULT_NODE_MIN_WIDTH = 140;
export const DEFAULT_NODE_MAX_WIDTH = 220;
export const DEFAULT_NODE_MIN_HEIGHT = 48;

/**
 * Estima as dimensões (largura e altura) de um nó de conceito com base no comprimento
 * do texto e nas regras de quebra de linha do componente visual.
 */
export function estimateConceptNodeDimensions(
  label: string,
  existingDimensions?: Dimensions2D,
  customSize?: boolean
): Dimensions2D {
  if (
    existingDimensions &&
    customSize &&
    existingDimensions.width >= 80 &&
    existingDimensions.height >= 36
  ) {
    return existingDimensions;
  }

  const clean = label.trim();
  const charCount = clean.length;

  // Largura adaptativa entre 140px e 220px (~8px por caractere + 36px de padding horizontal)
  const rawWidth = Math.min(
    DEFAULT_NODE_MAX_WIDTH,
    Math.max(DEFAULT_NODE_MIN_WIDTH, charCount * 8 + 36)
  );

  // Calcula quantas linhas o texto ocupará na largura estimada (~22 caracteres por linha em 220px)
  const charsPerLine = Math.max(12, Math.floor((rawWidth - 32) / 7.5));
  const estimatedLines = Math.max(1, Math.ceil(charCount / charsPerLine));

  const height = Math.max(
    DEFAULT_NODE_MIN_HEIGHT,
    26 + estimatedLines * 20
  );

  return {
    width: Math.round(rawWidth),
    height: Math.round(height),
  };
}

/**
 * Estima as dimensões da pílula da frase de ligação sobre a aresta,
 * alinhada à tipografia real (11.5px Inter + padding px-2 py-0.5) do canvas.
 */
export function estimateEdgeLabelDimensions(linkingPhrase: string): Dimensions2D {
  const clean = linkingPhrase.trim() || 'relaciona';
  const charCount = clean.length;

  const maxWidth = 156;
  const minWidth = 48;
  const width = Math.min(maxWidth, Math.max(minWidth, charCount * 5.6 + 16));
  const charsPerLine = Math.max(12, Math.floor((width - 14) / 5.5));
  const lines = Math.max(1, Math.ceil(charCount / charsPerLine));
  const height = 10 + lines * 14;

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

