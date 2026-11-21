import { Position } from '@xyflow/react';
import type { HandlePosition, Point2D } from '../../domain/types';

/**
 * Computes exact cardinal anchor point on a node's bounding box.
 */
export function getHandlePoint(
  position: Point2D,
  width: number,
  height: number,
  handle?: HandlePosition
): Point2D {
  switch (handle) {
    case 'top':
      return { x: position.x + width / 2, y: position.y };
    case 'right':
      return { x: position.x + width, y: position.y + height / 2 };
    case 'left':
      return { x: position.x, y: position.y + height / 2 };
    case 'bottom':
    default:
      return { x: position.x + width / 2, y: position.y + height };
  }
}

/**
 * Maps a cardinal handle position to React Flow Position enum.
 */
export function toFlowPosition(
  handle: HandlePosition | string | undefined | null,
  isSource = true
): Position {
  switch (handle) {
    case 'top':
      return Position.Top;
    case 'right':
      return Position.Right;
    case 'left':
      return Position.Left;
    case 'bottom':
      return Position.Bottom;
    default:
      return isSource ? Position.Bottom : Position.Top;
  }
}

/**
 * Backwards-compatible alias for toFlowPosition.
 */
export const handleToFlowPosition = toFlowPosition;

/**
 * Computes parallel edge offset along perpendicular axis.
 */
export function computeParallelOffset(index: number, total: number, step = 34): number {
  return total > 1 ? (index - (total - 1) / 2) * step : 0;
}

/**
 * Condition phrase normalization and classification.
 */
export function normalizeConditionText(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export const AFFIRMATIVE_CONDITION_KEYS = new Set([
  'sim',
  'yes',
  'true',
  'verdadeiro',
  's',
  'y',
  'v',
  'positivo',
  'ok',
  'sucesso',
  'aprovado',
  'valido',
]);

export const NEGATIVE_CONDITION_KEYS = new Set([
  'nao',
  'no',
  'false',
  'falso',
  'n',
  'f',
  'negativo',
  'rejeitado',
  'reprovado',
  'erro',
  'falha',
  'invalido',
]);

export const RETURN_KEYWORD_REGEX =
  /(retorno|voltar|repetir|loop|refazer|reenviar|reprocessar|retroagir|novamente)/i;

export type ConditionClassification = 'affirmative' | 'negative' | 'neutral';

export function classifyCondition(phrase: string): ConditionClassification {
  const norm = normalizeConditionText(phrase);
  if (AFFIRMATIVE_CONDITION_KEYS.has(norm)) return 'affirmative';
  if (NEGATIVE_CONDITION_KEYS.has(norm)) return 'negative';
  return 'neutral';
}

export function isAffirmativeCondition(linkingPhrase: string): boolean {
  return classifyCondition(linkingPhrase) === 'affirmative';
}

export function isNegativeCondition(linkingPhrase: string): boolean {
  return classifyCondition(linkingPhrase) === 'negative';
}

export function isReturnCondition(linkingPhrase: string): boolean {
  return RETURN_KEYWORD_REGEX.test(linkingPhrase.trim());
}

/**
 * Rhombus / diamond vertex coordinate calculations.
 */
export interface DiamondVertices {
  top: Point2D;
  right: Point2D;
  bottom: Point2D;
  left: Point2D;
}

export function getDiamondVertices(
  x: number,
  y: number,
  w: number,
  h: number
): DiamondVertices {
  return {
    top: { x: x + w / 2, y },
    right: { x: x + w, y: y + h / 2 },
    bottom: { x: x + w / 2, y: y + h },
    left: { x, y: y + h / 2 },
  };
}

export function getDiamondPointsString(
  x: number,
  y: number,
  w: number,
  h: number
): string {
  const topX = (x + w / 2).toFixed(1);
  const topY = y.toFixed(1);
  const rightX = (x + w).toFixed(1);
  const rightY = (y + h / 2).toFixed(1);
  const bottomX = (x + w / 2).toFixed(1);
  const bottomY = (y + h).toFixed(1);
  const leftX = x.toFixed(1);
  const leftY = (y + h / 2).toFixed(1);
  return `${topX},${topY} ${rightX},${rightY} ${bottomX},${bottomY} ${leftX},${leftY}`;
}
