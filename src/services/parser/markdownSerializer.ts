import type { RelationType, SemanticModel } from '../../domain/types';

export interface MarkdownSerializeOptions {
  /**
   * Incluir coluna numérica `#` (padrão: `true`, gerando 5 colunas idênticas ao `entrada.md`).
   * Se `false`, gera 4 colunas (`| Conceito A | Frase de ligação | Conceito B | Tipo |`).
   */
  includeIndexColumn?: boolean;
}

/**
 * Escapa caracteres `|` e quebras de linha para não corromper células da tabela Markdown.
 */
function escapeMarkdownCell(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Converte o tipo canônico da relação para o texto em português esperado na tabela.
 */
export function formatRelationTypeLabel(type: RelationType): string {
  return type === 'cross-link' ? 'ligação cruzada' : 'hierárquica';
}

/**
 * Serializa o Modelo Semântico de volta para uma tabela Markdown compatível com `entrada.md`.
 */
export function serializeSemanticModelToMarkdown(
  semantic: SemanticModel,
  options: MarkdownSerializeOptions = {}
): string {
  const includeIndex = options.includeIndexColumn ?? true;
  const rows: string[] = [];

  if (includeIndex) {
    rows.push('| # | Conceito A | Frase de ligação | Conceito B | Tipo |');
    rows.push('|---|---|---|---|---|');
  } else {
    rows.push('| Conceito A | Frase de ligação | Conceito B | Tipo |');
    rows.push('|---|---|---|---|');
  }

  const orderedRelations = semantic.relationOrder
    .map((id) => semantic.relations[id])
    .filter((rel): rel is NonNullable<typeof rel> => Boolean(rel));

  orderedRelations.forEach((rel, index) => {
    const sourceNode = semantic.concepts[rel.sourceId];
    const targetNode = semantic.concepts[rel.targetId];
    if (!sourceNode || !targetNode) {
      return;
    }

    const colSource = escapeMarkdownCell(sourceNode.label);
    const colPhrase = escapeMarkdownCell(rel.linkingPhrase);
    const colTarget = escapeMarkdownCell(targetNode.label);
    const colType = escapeMarkdownCell(formatRelationTypeLabel(rel.type));

    if (includeIndex) {
      rows.push(
        `| ${index + 1} | ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`
      );
    } else {
      rows.push(`| ${colSource} | ${colPhrase} | ${colTarget} | ${colType} |`);
    }
  });

  return `${rows.join('\n')}\n`;
}
