import type { Dimensions2D, FlowchartNodeShape } from '../../domain/types';

export const DEFAULT_NODE_MIN_WIDTH = 140;
export const DEFAULT_NODE_MAX_WIDTH = 220;
export const DEFAULT_NODE_MIN_HEIGHT = 48;

/** Constantes de dimensionamento para o Losango de Decisão */
export const DECISION_MIN_WIDTH = 160;
export const DECISION_MIN_HEIGHT = 85;
export const DECISION_WIDTH_FACTOR = 1.45;
export const DECISION_HEIGHT_FACTOR = 1.55;

/** Constantes de dimensionamento para o Terminal (Pílula/Estádio) */
export const TERMINAL_MIN_WIDTH = 130;
export const TERMINAL_MIN_HEIGHT = 44;
export const TERMINAL_EXTRA_WIDTH = 28;

/** Constantes de dimensionamento para Entrada/Saída (Paralelogramo) */
export const IO_MIN_WIDTH = 150;
export const IO_MIN_HEIGHT = 48;
export const IO_EXTRA_WIDTH = 32;

/** Constantes de dimensionamento para Sub-rotina (Processo Pré-definido) */
export const SUBROUTINE_MIN_WIDTH = 160;
export const SUBROUTINE_MIN_HEIGHT = 48;
export const SUBROUTINE_EXTRA_WIDTH = 28;

/** Constantes de dimensionamento para Documento (Base Ondulada) */
export const DOCUMENT_MIN_WIDTH = 140;
export const DOCUMENT_MIN_HEIGHT = 56;
export const DOCUMENT_EXTRA_HEIGHT = 14;

/** Constantes de dimensionamento para Processo Operacional */
export const PROCESS_MIN_WIDTH = 140;
export const PROCESS_MIN_HEIGHT = 48;

/**
 * Estima as dimensões (largura e altura) de um nó com base no comprimento do texto,
 * na quebra de linhas e na forma geométrica especificada (`FlowchartNodeShape`).
 *
 * Se `shape` for indefinido ou `'concept'`, mantém 100% de compatibilidade retroativa
 * com a fórmula original de nós de mapa conceitual.
 */
export function estimateConceptNodeDimensions(
  label: string,
  existingDimensions?: Dimensions2D,
  customSize?: boolean,
  shape?: FlowchartNodeShape
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

  // Largura adaptativa base entre 140px e 220px (~8px por caractere + 36px de padding horizontal)
  const rawWidth = Math.min(
    DEFAULT_NODE_MAX_WIDTH,
    Math.max(DEFAULT_NODE_MIN_WIDTH, charCount * 8 + 36)
  );

  // Calcula quantas linhas o texto ocupará na largura estimada (~22 caracteres por linha em 220px)
  const charsPerLine = Math.max(12, Math.floor((rawWidth - 32) / 7.5));
  const explicitLines = clean.split(/\r?\n/).length;
  const estimatedLines = Math.max(
    explicitLines,
    Math.ceil(charCount / charsPerLine)
  );

  const baseHeight = Math.max(
    DEFAULT_NODE_MIN_HEIGHT,
    26 + estimatedLines * 20
  );

  // Se a forma for indefinida ou 'concept', preserva o cálculo canônico legado
  if (!shape || shape === 'concept') {
    return {
      width: Math.round(rawWidth),
      height: Math.round(baseHeight),
    };
  }

  switch (shape) {
    case 'decision': {
      // Losango (rhombus): bounding box ampliada (W * 1.45, H * 1.55, min 160x85)
      // para que a pergunta de decisão inscrita nunca colida com os vértices inclinados
      const width = Math.max(
        DECISION_MIN_WIDTH,
        Math.round(rawWidth * DECISION_WIDTH_FACTOR)
      );
      const height = Math.max(
        DECISION_MIN_HEIGHT,
        Math.round(baseHeight * DECISION_HEIGHT_FACTOR)
      );
      return { width, height };
    }

    case 'terminal': {
      // Pílula/estádio (border-radius: 9999px): folga lateral para não colidir
      // com as calotas circulares nas extremidades esquerda e direita
      const width = Math.max(
        TERMINAL_MIN_WIDTH,
        Math.round(rawWidth + TERMINAL_EXTRA_WIDTH)
      );
      const height = Math.max(TERMINAL_MIN_HEIGHT, baseHeight);
      return { width, height };
    }

    case 'io': {
      // Paralelogramo inclinado (~15°): folga horizontal adicional
      // compensando a redução de largura útil causada pelo chanfro lateral
      const width = Math.max(
        IO_MIN_WIDTH,
        Math.round(rawWidth + IO_EXTRA_WIDTH)
      );
      const height = Math.max(IO_MIN_HEIGHT, baseHeight);
      return { width, height };
    }

    case 'subroutine': {
      // Sub-rotina: processo com barras verticais duplas internas a 12px de cada borda
      const width = Math.max(
        SUBROUTINE_MIN_WIDTH,
        Math.round(rawWidth + SUBROUTINE_EXTRA_WIDTH)
      );
      const height = Math.max(SUBROUTINE_MIN_HEIGHT, baseHeight);
      return { width, height };
    }

    case 'document': {
      // Documento com base ondulada (~14px de curva senoidal inferior)
      const width = Math.max(DOCUMENT_MIN_WIDTH, Math.round(rawWidth));
      const height = Math.max(
        DOCUMENT_MIN_HEIGHT,
        Math.round(baseHeight + DOCUMENT_EXTRA_HEIGHT)
      );
      return { width, height };
    }

    case 'process': {
      // Retângulo de processo clássico
      const width = Math.max(PROCESS_MIN_WIDTH, Math.round(rawWidth));
      const height = Math.max(PROCESS_MIN_HEIGHT, Math.round(baseHeight));
      return { width, height };
    }

    default: {
      return {
        width: Math.round(rawWidth),
        height: Math.round(baseHeight),
      };
    }
  }
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
