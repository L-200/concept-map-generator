import {
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from '@xyflow/react';
import type {
  ArrowDirection,
  ConceptId,
  ConceptMapDocument,
  ConceptRelationVisual,
  CrossLinkVisibilityMode,
  EdgeCurveType,
  FlowchartNodeShape,
  HandlePosition,
  LayoutAlgorithmType,
  LayoutSettings,
  Point2D,
  RelationId,
  RelationType,
  SemanticModel,
  ViewportState,
  VisualModel,
} from '../../domain/types';
import { computeSmartEdgeHandles } from '../layout/layoutEngine';
import { estimateEdgeLabelDimensions } from '../layout/nodeSizing';
import { serializeSemanticModelToMarkdown } from '../parser/markdownSerializer';
import {
  getHandlePoint,
  toFlowPosition,
  classifyCondition,
  getDiamondPointsString,
  computeParallelOffset,
} from '../layout/geometry';
import { useConceptMapStore } from '../../store/useConceptMapStore';

/**
 * Escapa caracteres especiais XML/SVG (&, <, >, ", ') para garantir XML válido.
 */
export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Quebra um texto em múltiplas linhas respeitando um limite aproximado de caracteres por linha.
 */
function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return [''];

  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

interface PreparedEdgeLabel {
  relId: string;
  phrase: string;
  isCross: boolean;
  relType: RelationType;
  lx: number;
  ly: number;
  srcPt: Point2D;
  tgtPt: Point2D;
  width: number;
  height: number;
  lines: string[];
}

/**
 * Renderiza elementos SVG vetoriais autênticos para as 6 formas de nós de fluxograma e conceitos Novak.
 */
export function renderNodeShapeSvg(
  shape: FlowchartNodeShape,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: string,
  border: string,
  strokeW: number
): string {
  const attrs = `fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="${strokeW}"`;
  const fx = x.toFixed(1);
  const fy = y.toFixed(1);

  switch (shape) {
    case 'terminal': {
      const r = (h / 2).toFixed(1);
      return `<rect x="${fx}" y="${fy}" width="${w}" height="${h}" rx="${r}" ry="${r}" ${attrs} />`;
    }
    case 'process':
      return `<rect x="${fx}" y="${fy}" width="${w}" height="${h}" rx="6" ry="6" ${attrs} />`;
    case 'decision':
      return `<polygon points="${getDiamondPointsString(x, y, w, h)}" ${attrs} />`;
    case 'io': {
      const skew = Math.min(24, Math.max(14, Math.round(w * 0.12)));
      const pts = `${(x + skew).toFixed(1)},${fy} ${(x + w).toFixed(1)},${fy} ${(x + w - skew).toFixed(1)},${(y + h).toFixed(1)} ${fx},${(y + h).toFixed(1)}`;
      return `<polygon points="${pts}" ${attrs} />`;
    }
    case 'subroutine': {
      const x1 = (x + 12).toFixed(1);
      const x2 = (x + w - 12).toFixed(1);
      return `<rect x="${fx}" y="${fy}" width="${w}" height="${h}" rx="6" ry="6" ${attrs} />
      <line x1="${x1}" y1="${fy}" x2="${x1}" y2="${(y + h).toFixed(1)}" stroke="${escapeXml(border)}" stroke-width="${strokeW}" />
      <line x1="${x2}" y1="${fy}" x2="${x2}" y2="${(y + h).toFixed(1)}" stroke="${escapeXml(border)}" stroke-width="${strokeW}" />`;
    }
    case 'document': {
      const d = `M ${fx} ${fy} L ${(x + w).toFixed(1)} ${fy} L ${(x + w).toFixed(1)} ${(y + h - 10).toFixed(1)} C ${(x + w * 0.75).toFixed(1)} ${(y + h + 8).toFixed(1)}, ${(x + w * 0.6).toFixed(1)} ${(y + h + 8).toFixed(1)}, ${(x + w * 0.5).toFixed(1)} ${(y + h - 2).toFixed(1)} C ${(x + w * 0.4).toFixed(1)} ${(y + h - 15).toFixed(1)}, ${(x + w * 0.25).toFixed(1)} ${(y + h - 15).toFixed(1)}, ${fx} ${(y + h - 10).toFixed(1)} Z`;
      return `<path d="${d}" ${attrs} />`;
    }
    case 'concept':
    default:
      return `<rect x="${fx}" y="${fy}" width="${w}" height="${h}" rx="12" ${attrs} />`;
  }
}

const EDGE_LABEL_PALETTES = {
  affirmative: { bg: '#f0fdf4', border: '#22c55e', text: '#15803d', fontWeight: '600' },
  negative: { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c', fontWeight: '600' },
  conditional: { bg: '#fefce8', border: '#eab308', text: '#854d0e', fontWeight: '600' },
  'loop-back': { bg: '#f8fafc', border: '#94a3b8', text: '#334155', fontWeight: '500' },
  cross: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e', fontWeight: '500' },
  default: { bg: '#ffffff', border: '#cbd5e1', text: '#1e293b', fontWeight: '500' },
};

/**
 * Retorna paleta de cores para pílulas de aresta em SVG exportado.
 */
function getEdgeLabelPalette(
  phrase: string,
  relType: RelationType,
  isFlowchart: boolean
): { bg: string; border: string; text: string; fontWeight: string } {
  if (!isFlowchart) {
    return relType === 'cross-link' ? EDGE_LABEL_PALETTES.cross : EDGE_LABEL_PALETTES.default;
  }

  const cond = classifyCondition(phrase);
  if (cond === 'affirmative') return EDGE_LABEL_PALETTES.affirmative;
  if (cond === 'negative') return EDGE_LABEL_PALETTES.negative;
  if (relType === 'conditional') return EDGE_LABEL_PALETTES.conditional;
  if (relType === 'loop-back') return EDGE_LABEL_PALETTES['loop-back'];

  return EDGE_LABEL_PALETTES.default;
}

/**
 * Resolve sobreposições entre caixas de frases de ligação (edge labels)
 * deslocando-as ao longo da própria aresta (verticalmente/diagonalmente) e lateralmente
 * para que duas frases nunca fiquem mescladas na imagem exportada.
 */
function resolveEdgeLabelOverlaps(labels: PreparedEdgeLabel[]): void {
  if (labels.length <= 1) return;

  const padX = 14;
  const padY = 8;
  const bounds = labels.map((l) => ({
    halfW: (l.width + padX) / 2,
    halfH: (l.height + padY) / 2,
  }));

  for (let iter = 0; iter < 20; iter++) {
    let moved = false;

    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];

        const overlapX = bounds[i].halfW + bounds[j].halfW - Math.abs(b.lx - a.lx);
        const overlapY = bounds[i].halfH + bounds[j].halfH - Math.abs(b.ly - a.ly);

        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          // Se as duas pílulas estão praticamente na mesma altura Y (ex: dois ramos saindo do mesmo pai),
          // escalona verticalmente uma para cima e outra para baixo ao longo de suas arestas + afasta em X
          if (Math.abs(b.ly - a.ly) < 18) {
            const signY = i < j ? -1 : 1;
            const shiftY = Math.min(18, overlapY / 2 + 4);
            a.ly += signY * shiftY;
            b.ly -= signY * shiftY;

            const signX = b.lx >= a.lx ? 1 : -1;
            const shiftX = overlapX / 2 + 2;
            a.lx -= signX * shiftX;
            b.lx += signX * shiftX;
          } else if (overlapX < overlapY) {
            const signX = b.lx >= a.lx ? 1 : -1;
            a.lx -= (signX * overlapX) / 2;
            b.lx += (signX * overlapX) / 2;
          } else {
            const signY = b.ly >= a.ly ? 1 : -1;
            a.ly -= (signY * overlapY) / 2;
            b.ly += (signY * overlapY) / 2;
          }
        }
      }
    }

    if (!moved) break;
  }
}

const SHAPE_PALETTES: Record<string, { bg: string; border: string; text: string; strokeW: number }> = {
  decision: { bg: '#fffbeb', border: '#d97706', text: '#78350f', strokeW: 2 },
  io: { bg: '#f0f9ff', border: '#0284c7', text: '#082f49', strokeW: 1.75 },
  subroutine: { bg: '#ffffff', border: '#6366f1', text: '#1e1b4b', strokeW: 1.75 },
  document: { bg: '#fffbeb', border: '#d97706', text: '#78350f', strokeW: 1.75 },
  process: { bg: '#ffffff', border: '#64748b', text: '#1e293b', strokeW: 1.5 },
  terminal_start: { bg: '#ecfdf5', border: '#10b981', text: '#064e3b', strokeW: 2 },
  terminal_end: { bg: '#fff1f2', border: '#f43f5e', text: '#881337', strokeW: 2 },
};

/**
 * Gera um documento SVG vetorial completo, autônomo e independente de resolução
 * enquadrando 100% dos conceitos e proposições do mapa (mesmo os que estão fora da tela).
 */
export function generateStandaloneVectorSvg(
  semantic: SemanticModel,
  visual: VisualModel
): string {
  const conceptIds = semantic.conceptOrder.filter(
    (id) => Boolean(semantic.concepts[id] && visual.nodes[id])
  );

  if (conceptIds.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><rect width="100%" height="100%" fill="#f8fafc"/><text x="200" y="100" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="14">Mapa Conceitual Vazio</text></svg>`;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const id of conceptIds) {
    const n = visual.nodes[id];
    const w = n.dimensions?.width ?? 180;
    const h = n.dimensions?.height ?? 52;
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.x + w > maxX) maxX = n.position.x + w;
    if (n.position.y + h > maxY) maxY = n.position.y + h;
  }

  // Agrupa arestas paralelas entre o mesmo par de nós
  const pairCounts: Record<string, string[]> = {};
  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    if (!rel) continue;
    const key =
      rel.sourceId < rel.targetId
        ? `${rel.sourceId}--${rel.targetId}`
        : `${rel.targetId}--${rel.sourceId}`;
    if (!pairCounts[key]) pairCounts[key] = [];
    pairCounts[key].push(relId);
  }

  const edgePathsSvg: string[] = [];
  const preparedLabels: PreparedEdgeLabel[] = [];

  const smartHandles = computeSmartEdgeHandles(
    semantic,
    visual.nodes,
    visual.layoutSettings?.direction ?? 'TB'
  );

  for (const relId of semantic.relationOrder) {
    const rel = semantic.relations[relId];
    const edgeVis = visual.edges[relId];
    if (!rel || !edgeVis) continue;

    if (visual.crossLinkVisibility === 'hide-cross' && rel.type === 'cross-link') {
      continue;
    }

    const srcNode = visual.nodes[rel.sourceId];
    const tgtNode = visual.nodes[rel.targetId];
    if (!srcNode || !tgtNode) continue;

    const srcW = srcNode.dimensions?.width ?? 180;
    const srcH = srcNode.dimensions?.height ?? 52;
    const tgtW = tgtNode.dimensions?.width ?? 180;
    const tgtH = tgtNode.dimensions?.height ?? 52;

    const smart = smartHandles[relId];
    const resolvedSourceHandle: HandlePosition =
      edgeVis.sourceHandle && edgeVis.sourceHandle !== 'auto'
        ? edgeVis.sourceHandle
        : (smart?.sourceHandle ?? 'bottom');

    const resolvedTargetHandle: HandlePosition =
      edgeVis.targetHandle && edgeVis.targetHandle !== 'auto'
        ? edgeVis.targetHandle
        : (smart?.targetHandle ?? 'top');

    const srcPt = getHandlePoint(
      srcNode.position,
      srcW,
      srcH,
      resolvedSourceHandle
    );
    const tgtPt = getHandlePoint(
      tgtNode.position,
      tgtW,
      tgtH,
      resolvedTargetHandle
    );

    const sourcePosition = toFlowPosition(resolvedSourceHandle, true);
    const targetPosition = toFlowPosition(resolvedTargetHandle, false);

    const pairKey =
      rel.sourceId < rel.targetId
        ? `${rel.sourceId}--${rel.targetId}`
        : `${rel.targetId}--${rel.sourceId}`;
    const siblings = pairCounts[pairKey] ?? [relId];
    const pIdx = Math.max(0, siblings.indexOf(relId));
    const parallelOffset = computeParallelOffset(pIdx, siblings.length);

    const isCross = rel.type === 'cross-link';
    const curveType =
      edgeVis.curveType ?? (isCross ? 'bezier' : 'smoothstep');

    // Usa exatamente os mesmos geradores geométricos do React Flow (PropositionEdge.tsx)
    let path = '';
    let baseLabelX = (srcPt.x + tgtPt.x) / 2;
    let baseLabelY = (srcPt.y + tgtPt.y) / 2;

    if (curveType === 'straight' && parallelOffset === 0) {
      const [p, lx, ly] = getStraightPath({
        sourceX: srcPt.x,
        sourceY: srcPt.y,
        targetX: tgtPt.x,
        targetY: tgtPt.y,
      });
      path = p;
      baseLabelX = lx;
      baseLabelY = ly;
    } else if (curveType === 'smoothstep' && !isCross && parallelOffset === 0) {
      const [p, lx, ly] = getSmoothStepPath({
        sourceX: srcPt.x,
        sourceY: srcPt.y,
        sourcePosition,
        targetX: tgtPt.x,
        targetY: tgtPt.y,
        targetPosition,
        borderRadius: 12,
      });
      path = p;
      baseLabelX = lx;
      baseLabelY = ly;
    } else {
      const curvature = isCross ? 0.38 : 0.25;
      const [p, lx, ly] = getBezierPath({
        sourceX: srcPt.x,
        sourceY: srcPt.y,
        sourcePosition,
        targetX: tgtPt.x,
        targetY: tgtPt.y,
        targetPosition,
        curvature,
      });
      path = p;
      baseLabelX = lx;
      baseLabelY = ly;
    }

    const isFlowchart = semantic.diagramMode === 'flowchart';
    const isLoop = rel.type === 'loop-back';
    const cond = isFlowchart ? classifyCondition(rel.linkingPhrase || '') : 'neutral';
    const edgeKind = isCross ? 'cross' : cond === 'affirmative' ? 'yes' : cond === 'negative' ? 'no' : isLoop ? 'loop' : 'hier';
    const stroke = edgeKind === 'cross' ? '#d97706' : edgeKind === 'yes' ? '#059669' : edgeKind === 'no' ? '#e11d48' : '#475569';
    const markerBase = `arrow-${edgeKind}`;

    const dir: ArrowDirection = edgeVis.arrowDirection ?? rel.arrowDirection ?? 'forward';
    const markerStartAttr = dir === 'reverse' || dir === 'both' ? ` marker-start="url(#${markerBase})"` : '';
    const markerEndAttr = dir === 'forward' || dir === 'both' ? ` marker-end="url(#${markerBase})"` : '';
    const dashAttr = isCross || isLoop ? ' stroke-dasharray="8 5"' : '';

    edgePathsSvg.push(
      `    <path id="edge-${escapeXml(rel.id)}" d="${path}" fill="none" stroke="${stroke}" stroke-width="2"${dashAttr}${markerStartAttr}${markerEndAttr} />`
    );

    const t = edgeVis.labelOffset?.t ?? 0.5;
    const tDelta = t - 0.5;
    const lx =
      baseLabelX + (tgtPt.x - srcPt.x) * tDelta * 0.55 + parallelOffset;
    const ly = baseLabelY + (tgtPt.y - srcPt.y) * tDelta * 0.55;

    const phrase = rel.linkingPhrase || '';
    const hasLabel = phrase.trim().length > 0;

    // Em modo fluxograma, transições sem texto não geram pílula
    if (!isFlowchart || hasLabel) {
      const labelDim = estimateEdgeLabelDimensions(phrase);
      const lines = wrapTextLines(phrase, 22);

      preparedLabels.push({
        relId: rel.id,
        phrase,
        isCross,
        relType: rel.type,
        lx,
        ly,
        srcPt,
        tgtPt,
        width: labelDim.width,
        height: labelDim.height,
        lines,
      });
    }
  }

  // Resolve qualquer sobreposição residual entre pílulas de frases de ligação
  resolveEdgeLabelOverlaps(preparedLabels);

  const edgeLabelsSvg: string[] = [];
  for (const item of preparedLabels) {
    const isFlowchart = semantic.diagramMode === 'flowchart';
    const palette = getEdgeLabelPalette(item.phrase, item.relType, isFlowchart);

    const rectX = item.lx - item.width / 2;
    const rectY = item.ly - item.height / 2;

    if (rectX < minX) minX = rectX;
    if (rectY < minY) minY = rectY;
    if (rectX + item.width > maxX) maxX = rectX + item.width;
    if (rectY + item.height > maxY) maxY = rectY + item.height;

    const tspans = item.lines
      .map((line, i) => {
        const lineY =
          rectY +
          14 +
          i * 14 +
          (item.height - item.lines.length * 14) / 2 -
          3;
        return `<tspan x="${item.lx.toFixed(1)}" y="${lineY.toFixed(1)}">${escapeXml(line)}</tspan>`;
      })
      .join('');

    edgeLabelsSvg.push(
      `    <g class="edge-label" data-relation-id="${escapeXml(item.relId)}">
      <rect x="${rectX.toFixed(1)}" y="${rectY.toFixed(1)}" width="${item.width}" height="${item.height}" rx="6" fill="${palette.bg}" stroke="${palette.border}" stroke-width="1" />
      <text text-anchor="middle" fill="${palette.text}" font-family="Inter, system-ui, Ubuntu, sans-serif" font-size="11.5" font-weight="${palette.fontWeight}">${tspans}</text>
    </g>`
    );
  }

  const padding = 64;
  const viewBoxX = Math.floor(minX - padding);
  const viewBoxY = Math.floor(minY - padding);
  const viewBoxW = Math.ceil(maxX - minX + padding * 2);
  const viewBoxH = Math.ceil(maxY - minY + padding * 2);

  const isFlowchart = semantic.diagramMode === 'flowchart';
  const nodesSvg: string[] = [];
  let liveNodes: Record<string, any> | undefined;
  try {
    liveNodes = useConceptMapStore.getState()?.visual?.nodes;
  } catch {
    // useConceptMapStore not available in isolated test environments
  }

  for (const id of conceptIds) {
    const concept = semantic.concepts[id];
    const nodeVis = visual.nodes[id];
    const w = nodeVis.dimensions?.width ?? 180;
    const h = nodeVis.dimensions?.height ?? 52;
    const x = nodeVis.position.x;
    const y = nodeVis.position.y;

    let shape: FlowchartNodeShape =
      nodeVis.nodeShape ??
      concept?.nodeShape ??
      (liveNodes?.[id]?.nodeShape && liveNodes[id].nodeShape !== 'concept'
        ? liveNodes[id].nodeShape
        : undefined) ??
      (isFlowchart ? 'process' : 'concept');

    const isRoot = (nodeVis.computedLayer ?? 1) === 0;

    let style = isRoot
      ? { bg: '#eff6ff', border: '#2563eb', text: '#0f172a', strokeW: 2.5 }
      : { bg: '#ffffff', border: '#cbd5e1', text: '#0f172a', strokeW: 1.5 };

    if (isFlowchart || shape !== 'concept') {
      if (shape === 'terminal') {
        const isStart =
          /in[ií]cio|start|come[çc]o/i.test(concept.label) || isRoot;
        const isEnd = /fim|end|conclus|termin/i.test(concept.label);
        if (isStart) style = SHAPE_PALETTES.terminal_start;
        else if (isEnd) style = SHAPE_PALETTES.terminal_end;
      } else if (SHAPE_PALETTES[shape]) {
        style = SHAPE_PALETTES[shape];
      }
    }

    const bg = nodeVis.style?.backgroundColor ?? style.bg;
    const border = nodeVis.style?.borderColor ?? style.border;
    const textColor = nodeVis.style?.textColor ?? style.text;
    const strokeW = style.strokeW;

    // Ajuste de largura útil e quebra de linha de acordo com a geometria da forma
    let usableWidth = w - 24;
    if (shape === 'decision') {
      usableWidth = w * 0.65;
    } else if (shape === 'terminal') {
      usableWidth = w - h * 0.6 - 16;
    } else if (shape === 'io') {
      usableWidth = w - 48;
    } else if (shape === 'subroutine') {
      usableWidth = w - 44;
    }
    const maxChars = Math.max(10, Math.floor(usableWidth / 7.5));
    const lines = wrapTextLines(concept.label, maxChars);
    const centerX = x + w / 2;

    const lineHeight = shape === 'decision' ? 16 : 17;
    const totalTextH = lines.length * lineHeight;
    let startY = y + 18 + (h - lines.length * 17) / 2 - 4;
    if (shape === 'decision') {
      startY = y + (h - totalTextH) / 2 + 13;
    } else if (shape === 'document') {
      startY = y + (h - 10 - totalTextH) / 2 + 12;
    }

    const tspans = lines
      .map((line, i) => {
        const lineY =
          shape === 'concept'
            ? y + 18 + i * 17 + (h - lines.length * 17) / 2 - 4
            : startY + i * lineHeight;
        return `<tspan x="${centerX.toFixed(1)}" y="${lineY.toFixed(1)}">${escapeXml(line)}</tspan>`;
      })
      .join('');

    const shapeMarkup = renderNodeShapeSvg(
      shape,
      x,
      y,
      w,
      h,
      bg,
      border,
      strokeW
    );

    nodesSvg.push(
      `    <g class="concept-node" id="node-${escapeXml(id)}" data-shape="${escapeXml(shape)}">
      ${shapeMarkup}
      <text text-anchor="middle" fill="${escapeXml(textColor)}" font-family="Inter, system-ui, Ubuntu, sans-serif" font-size="13" font-weight="${isRoot ? '700' : '600'}">${tspans}</text>
    </g>`
    );
  }

const MARKER_CONFIGS: [string, string][] = [
  ['hier', '#475569'],
  ['cross', '#d97706'],
  ['yes', '#059669'],
  ['no', '#e11d48'],
  ['loop', '#475569'],
];
const SVG_MARKERS_DEF = [false, true]
  .flatMap((isStart) =>
    MARKER_CONFIGS.map(
      ([name, color]) =>
        `    <marker id="arrow-${name}${isStart ? '-start' : ''}" viewBox="0 0 10 10" refX="${isStart ? 2 : 8}" refY="5" markerWidth="7" markerHeight="7" orient="${isStart ? 'auto' : 'auto-start-reverse'}">\n      <path d="${isStart ? 'M 10 1 L 0 5 L 10 9 z' : 'M 0 1 L 10 5 L 0 9 z'}" fill="${color}" />\n    </marker>`
    )
  )
  .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}" width="${viewBoxW}" height="${viewBoxH}">
  <defs>
${SVG_MARKERS_DEF}
  </defs>
  <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxW}" height="${viewBoxH}" fill="#f8fafc" />
  <g id="edges-layer">
${edgePathsSvg.join('\n')}
  </g>
  <g id="nodes-layer">
${nodesSvg.join('\n')}
  </g>
  <g id="labels-layer">
${edgeLabelsSvg.join('\n')}
  </g>
</svg>`;
}

/**
 * Função de conveniência para exportar diagrama diretamente como PNG Blob de alta resolução (2x DPI).
 */
export async function exportAsPng(
  semantic: SemanticModel,
  visual: VisualModel,
  requestedScale = 2
): Promise<Blob> {
  const svg = generateStandaloneVectorSvg(semantic, visual);
  return renderSvgStringToPngBlob(svg, requestedScale);
}

/**
 * Converte a string SVG vetorial do mapa inteiro em um arquivo PNG de alta resolução (2x/3x DPI)
 * com clamping automático de dimensões máximas de textura HTML5 Canvas.
 */
export async function renderSvgStringToPngBlob(
  svgString: string,
  requestedScale = 2
): Promise<Blob> {
  let baseWidth = 1200;
  let baseHeight = 800;
  const dimMatch = /width="([0-9.]+)"\s+height="([0-9.]+)"/.exec(svgString);
  if (dimMatch) {
    baseWidth = Number.parseFloat(dimMatch[1]);
    baseHeight = Number.parseFloat(dimMatch[2]);
  } else {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgEl = doc.documentElement;
      baseWidth = Number.parseFloat(svgEl.getAttribute('width') || '1200');
      baseHeight = Number.parseFloat(svgEl.getAttribute('height') || '800');
    } catch {}
  }

  // Limite seguro de textura em navegadores Linux (12288px)
  const maxCanvasDim = 12288;
  const clampedScale = Math.min(
    requestedScale,
    maxCanvasDim / Math.max(baseWidth, baseHeight, 1)
  );

  const targetWidth = Math.max(1, Math.round(baseWidth * clampedScale));
  const targetHeight = Math.max(1, Math.round(baseHeight * clampedScale));

  const svgBlob = new Blob([svgString], {
    type: 'image/svg+xml;charset=utf-8',
  });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error('Falha ao rasterizar imagem SVG para PNG.'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexto 2D do Canvas indisponível.');
    }

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Falha ao codificar Blob PNG.'));
      }, 'image/png');
    });

    return pngBlob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Serializa o documento completo (Semântico + Visual) em JSON formatado.
 */
export function serializeDocumentToJson(doc: ConceptMapDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const VALID_HANDLES: ReadonlySet<string> = new Set([
  'top',
  'right',
  'bottom',
  'left',
  'auto',
]);

const VALID_ARROW_DIRECTIONS: ReadonlySet<string> = new Set([
  'forward',
  'reverse',
  'both',
  'none',
]);

const VALID_CURVE_TYPES: ReadonlySet<string> = new Set([
  'bezier',
  'smoothstep',
  'straight',
]);

const VALID_LAYOUT_ALGORITHMS: ReadonlySet<string> = new Set([
  'novak-backbone',
  'elk-layered',
  'dagre-hierarchical',
  'force-directed',
  'radial-tree',
]);

const VALID_CROSS_LINK_VISIBILITY: ReadonlySet<string> = new Set([
  'all',
  'hover-only',
  'highlight-cross',
  'hide-cross',
]);

/**
 * Faz o parse e valida a integridade estrutural de um arquivo JSON de mapa conceitual importado.
 */
export function parseAndValidateJsonDocument(
  rawJson: string
): ConceptMapDocument {
  const parsed = JSON.parse(rawJson) as Partial<ConceptMapDocument>;

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.semantic ||
    typeof parsed.semantic.concepts !== 'object' ||
    !Array.isArray(parsed.semantic.conceptOrder) ||
    typeof parsed.semantic.relations !== 'object' ||
    !Array.isArray(parsed.semantic.relationOrder) ||
    !parsed.visual ||
    typeof parsed.visual.nodes !== 'object' ||
    typeof parsed.visual.edges !== 'object'
  ) {
    throw new Error(
      'Arquivo JSON inválido: estrutura de dados semânticos ou visuais ausente.'
    );
  }

  // 1. Validação de Nós Visuais
  const allConceptIds = Array.from(
    new Set([
      ...(parsed.semantic.conceptOrder || []),
      ...Object.keys(parsed.semantic.concepts || {}),
    ])
  );
  const validatedNodes: Record<ConceptId, VisualModel['nodes'][string]> = {};
  for (const id of allConceptIds) {
    const n = parsed.visual.nodes[id];
    validatedNodes[id] = {
      conceptId: id,
      position: {
        x: Number.isFinite(n?.position?.x) ? n.position.x : 100,
        y: Number.isFinite(n?.position?.y) ? n.position.y : 100,
      },
      dimensions: n?.dimensions,
      pinned: Boolean(n?.pinned),
      customSize: Boolean(n?.customSize),
      computedLayer: n?.computedLayer ?? 0,
      style: n?.style,
      nodeShape: n?.nodeShape,
    };
  }

  // 2. Validação e Sanitização de Arestas Visuais (visual.edges)
  const allRelationIds = Array.from(
    new Set([
      ...(parsed.semantic.relationOrder || []),
      ...Object.keys(parsed.semantic.relations || {}),
      ...Object.keys(parsed.visual.edges || {}),
    ])
  );

  const valSet = <T>(val: unknown, set: ReadonlySet<string>, fallback: T): T =>
    typeof val === 'string' && set.has(val) ? (val as T) : fallback;
  const numOr = (val: unknown, fallback: number): number =>
    typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  const finiteNum = (val: unknown): number | undefined =>
    typeof val === 'number' && Number.isFinite(val) ? val : undefined;

  const validatedEdges: Record<RelationId, ConceptRelationVisual> = {};
  for (const id of allRelationIds) {
    const e = parsed.visual.edges[id] as Partial<ConceptRelationVisual> | undefined;
    const sourceHandle = valSet<HandlePosition | undefined>(e?.sourceHandle, VALID_HANDLES, undefined);
    const targetHandle = valSet<HandlePosition | undefined>(e?.targetHandle, VALID_HANDLES, undefined);
    const arrowDirection = valSet<ArrowDirection>(e?.arrowDirection, VALID_ARROW_DIRECTIONS, 'forward');
    const curveType = valSet<EdgeCurveType>(e?.curveType, VALID_CURVE_TYPES, 'smoothstep');
    const manualHandles = typeof e?.manualHandles === 'boolean'
      ? e.manualHandles
      : Boolean((sourceHandle && sourceHandle !== 'auto') || (targetHandle && targetHandle !== 'auto'));

    validatedEdges[id] = {
      relationId: id,
      curveType,
      sourceHandle,
      targetHandle,
      manualHandles,
      arrowDirection,
      labelOffset: e?.labelOffset
        ? {
            x: finiteNum(e.labelOffset.x),
            y: finiteNum(e.labelOffset.y),
            t: finiteNum(e.labelOffset.t),
          }
        : undefined,
      waypoints: Array.isArray(e?.waypoints)
        ? e.waypoints.filter(
            (pt): pt is Point2D =>
              pt !== null && typeof pt === 'object' && Number.isFinite(pt.x) && Number.isFinite(pt.y)
          )
        : undefined,
      style: e?.style && typeof e.style === 'object' ? e.style : undefined,
      flowKind: e?.flowKind,
    };
  }

  // 3. Validação de Layout Settings (incluindo freeformCanvas)
  const rawLayout = parsed.visual.layoutSettings;
  const validatedLayoutSettings: LayoutSettings = {
    algorithm: valSet<LayoutAlgorithmType>(rawLayout?.algorithm, VALID_LAYOUT_ALGORITHMS, 'novak-backbone'),
    direction: rawLayout?.direction === 'LR' ? 'LR' : 'TB',
    nodeSpacingX: numOr(rawLayout?.nodeSpacingX, 75),
    nodeSpacingY: numOr(rawLayout?.nodeSpacingY, 110),
    layerSpacing: numOr(rawLayout?.layerSpacing, 115),
    respectPinnedNodes: rawLayout?.respectPinnedNodes !== undefined ? Boolean(rawLayout.respectPinnedNodes) : true,
    freeformCanvas: Boolean(rawLayout?.freeformCanvas),
  };

  // 4. Validação de Viewport e CrossLinkVisibility
  const rawViewport = parsed.visual.viewport;
  const validatedViewport: ViewportState = {
    x: numOr(rawViewport?.x, 0),
    y: numOr(rawViewport?.y, 0),
    zoom: typeof rawViewport?.zoom === 'number' && Number.isFinite(rawViewport.zoom) && rawViewport.zoom > 0
      ? rawViewport.zoom
      : 1,
  };

  const rawCross = parsed.visual.crossLinkVisibility;
  const validatedCrossLinkVisibility: CrossLinkVisibilityMode =
    valSet<CrossLinkVisibilityMode>(rawCross, VALID_CROSS_LINK_VISIBILITY, 'all');

  const diagramMode = parsed.metadata?.diagramMode ?? parsed.semantic.diagramMode;
  const validatedSemantic: SemanticModel = {
    ...parsed.semantic,
    diagramMode: diagramMode ?? parsed.semantic.diagramMode,
  };

  return {
    schemaVersion: '1.0.0',
    metadata: {
      id: parsed.metadata?.id ?? 'imported-doc',
      sourceFileName: parsed.metadata?.sourceFileName ?? 'mapa.cmap.json',
      createdAt: parsed.metadata?.createdAt ?? new Date().toISOString(),
      updatedAt: parsed.metadata?.updatedAt ?? new Date().toISOString(),
      originalColumnCount: parsed.metadata?.originalColumnCount ?? 5,
      diagramMode,
    },
    semantic: validatedSemantic,
    visual: {
      nodes: validatedNodes,
      edges: validatedEdges,
      layoutSettings: validatedLayoutSettings,
      viewport: validatedViewport,
      crossLinkVisibility: validatedCrossLinkVisibility,
    },
    parseDiagnostics: parsed.parseDiagnostics ?? [],
  };
}

/**
 * Exporta o modelo semântico para tabela Markdown de 5 colunas (padrão `entrada.md`).
 */
export function exportSemanticToMarkdown(semantic: SemanticModel): string {
  return serializeSemanticModelToMarkdown(semantic, {
    includeIndexColumn: true,
  });
}

/**
 * Dispara o download de um arquivo de texto no navegador.
 */
export function downloadTextFile(
  content: string,
  fileName: string,
  mimeType = 'text/plain;charset=utf-8'
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, fileName);
}

/**
 * Dispara o download de um Blob binário no navegador.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
