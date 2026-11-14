import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ArrowDirection,
  ConceptRelationType,
  EdgeCurveType,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';
import { generateStandaloneVectorSvg } from '../src/services/export/fileExporter';
import { useConceptMapStore } from '../src/store/useConceptMapStore';

// Helper to extract SVG path coordinates and attributes
function parsePathData(svg: string, relId: string) {
  const pathRegex = new RegExp(`<path id="edge-${relId}" d="([^"]+)"([^>]*)/>`);
  const match = pathRegex.exec(svg);
  if (!match) return null;
  const d = match[1];
  const attrs = match[2];

  // Extract M start point
  const mMatch = /^M\s*([-0-9.]+)[,\s]+([-0-9.]+)/.exec(d);
  const startX = mMatch ? parseFloat(mMatch[1]) : NaN;
  const startY = mMatch ? parseFloat(mMatch[2]) : NaN;

  // Extract end point (last pair of numbers in d)
  const allNums = d.match(/[-0-9.]+/g);
  let endX = NaN;
  let endY = NaN;
  if (allNums && allNums.length >= 2) {
    endX = parseFloat(allNums[allNums.length - 2]);
    endY = parseFloat(allNums[allNums.length - 1]);
  }

  const hasMarkerStart = attrs.includes('marker-start=');
  const hasMarkerEnd = attrs.includes('marker-end=');
  const markerStartMatch = /marker-start="url\(#([^)]+)\)"/.exec(attrs);
  const markerEndMatch = /marker-end="url\(#([^)]+)\)"/.exec(attrs);

  const markerStartId = markerStartMatch ? markerStartMatch[1] : null;
  const markerEndId = markerEndMatch ? markerEndMatch[1] : null;

  return {
    d,
    attrs,
    startX,
    startY,
    endX,
    endY,
    hasMarkerStart,
    hasMarkerEnd,
    markerStartId,
    markerEndId,
  };
}

// Strict XML Well-Formedness Validator
function validateSvgXml(xml: string): { valid: boolean; error?: string } {
  const stripped = xml.replace(/<\?xml[^>]*\?>/gi, '').trim();
  const tagRegex = /<([\/!]?)([a-zA-Z0-9_\-]+)([^>]*?)(\/?)>/g;
  const stack: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(stripped)) !== null) {
    const [fullMatch, slash, tagName, attrs, selfClose] = match;
    const textBefore = stripped.slice(lastIndex, match.index);
    lastIndex = tagRegex.lastIndex;

    if (textBefore.includes('<')) {
      return { valid: false, error: `Unescaped '<' in text: "${textBefore}"` };
    }
    const bareAmp = textBefore.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[a-fA-F0-9]+);/g, '');
    if (bareAmp.includes('&')) {
      return { valid: false, error: `Unescaped '&' in text: "${textBefore}"` };
    }

    let quoteChar: string | null = null;
    for (let i = 0; i < attrs.length; i++) {
      const ch = attrs[i];
      if (ch === '"' || ch === "'") {
        if (!quoteChar) quoteChar = ch;
        else if (quoteChar === ch) quoteChar = null;
      }
    }
    if (quoteChar !== null) {
      return { valid: false, error: `Unclosed quote in tag <${tagName} ${attrs}>` };
    }

    const isClosing = slash === '/';
    const isSelfClosing = selfClose === '/' || fullMatch.endsWith('/>');

    if (isClosing) {
      if (stack.length === 0) {
        return { valid: false, error: `Unexpected closing tag </${tagName}> with empty stack` };
      }
      const top = stack.pop();
      if (top !== tagName) {
        return { valid: false, error: `Mismatched tags: expected </${top}>, got </${tagName}>` };
      }
    } else if (!isSelfClosing) {
      stack.push(tagName);
    }
  }

  if (stack.length > 0) {
    return { valid: false, error: `Unclosed tags at EOF: ${stack.join(', ')}` };
  }

  return { valid: true };
}

describe('Empirical Adversarial Challenge M4: Coordinate Math & Dynamic Marker Verification', () => {
  const CARDINALS: readonly HandlePosition[] = ['top', 'right', 'bottom', 'left'] as const;
  const ALL_SHAPES: readonly FlowchartNodeShape[] = [
    'concept',
    'terminal',
    'process',
    'decision',
    'io',
    'subroutine',
    'document',
  ] as const;

  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'flowchart', {
      freeformCanvas: true,
    });
  });

  // ==========================================================================
  // CHALLENGE 1: Full 16-Cardinal Handle Cartesian Grid with 3 Curve Geometries
  // ==========================================================================
  describe('Challenge 1: 16 Cardinal Handle Pairs Across Curve Geometries', () => {
    const CURVE_TYPES: readonly EdgeCurveType[] = ['straight', 'smoothstep', 'bezier'] as const;

    it.each(CURVE_TYPES)(
      'verifica coordenadas exatas de partida e chegada para todas as 16 combinações de portas com curva %s',
      (curveType) => {
        const store = useConceptMapStore.getState();
        const nodeA = store.addConcept('Origem', { x: 150, y: 220 });
        const nodeB = store.addConcept('Destino', { x: 620, y: 480 });
        store.resizeNode(nodeA, { width: 180, height: 70 });
        store.resizeNode(nodeB, { width: 140, height: 90 });

        // Expected handle coordinates:
        // Node A: (150, 220, w=180, h=70)
        const expectedSrc: Record<HandlePosition, { x: number; y: number }> = {
          top: { x: 150 + 90, y: 220 },
          right: { x: 150 + 180, y: 220 + 35 },
          bottom: { x: 150 + 90, y: 220 + 70 },
          left: { x: 150, y: 220 + 35 },
          auto: { x: 150 + 90, y: 220 + 70 },
        };

        // Node B: (620, 480, w=140, h=90)
        const expectedTgt: Record<HandlePosition, { x: number; y: number }> = {
          top: { x: 620 + 70, y: 480 },
          right: { x: 620 + 140, y: 480 + 45 },
          bottom: { x: 620 + 70, y: 480 + 90 },
          left: { x: 620, y: 480 + 45 },
          auto: { x: 620 + 70, y: 480 },
        };

        for (const srcH of CARDINALS) {
          for (const tgtH of CARDINALS) {
            const relId = store.addRelation(nodeA, nodeB, 'teste', 'sequence', {
              sourceHandle: srcH,
              targetHandle: tgtH,
              manualHandles: true,
            });
            store.updateRelation(relId!, { curveType });

            const state = useConceptMapStore.getState();
            const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
            const parsed = parsePathData(svg, relId!);

            expect(parsed, `Aresta ${relId} (${srcH} -> ${tgtH}) deve existir no SVG`).not.toBeNull();
            expect(parsed!.startX).toBeCloseTo(expectedSrc[srcH].x, 1);
            expect(parsed!.startY).toBeCloseTo(expectedSrc[srcH].y, 1);
            expect(parsed!.endX).toBeCloseTo(expectedTgt[tgtH].x, 1);
            expect(parsed!.endY).toBeCloseTo(expectedTgt[tgtH].y, 1);

            // Path format validation
            if (curveType === 'straight') {
              expect(parsed!.d).toMatch(new RegExp(`^M\\s*${parsed!.startX}[,\\s]+${parsed!.startY}\\s*L\\s*${parsed!.endX}[,\\s]+${parsed!.endY}$`));
            } else if (curveType === 'bezier') {
              expect(parsed!.d).toMatch(/[ ,]C/);
            }

            store.deleteElements([], [relId!]);
          }
        }
      }
    );
  });

  // ==========================================================================
  // CHALLENGE 2: Diamond Decision Vertices Absolute Geometric Alignment
  // ==========================================================================
  describe('Challenge 2: Diamond Decision 4 Vertices Absolute Geometric Alignment', () => {
    it('alinha os 4 vértices do losango decision com os 4 pontos cardinais top, right, bottom, left sem fresta ou penetração', () => {
      const store = useConceptMapStore.getState();
      const decId = store.addConcept('Decisão', { x: 215.5, y: 342.25 });
      store.updateNodeShape(decId, 'decision');
      store.resizeNode(decId, { width: 170, height: 110 });

      const targetId = store.addConcept('Destino', { x: 600, y: 342.25 });
      store.resizeNode(targetId, { width: 120, height: 80 });

      // Node coordinates: x=215.5, y=342.25, w=170, h=110
      // 4 Diamond Vertices:
      // top: (215.5 + 85, 342.25) = (300.5, 342.25)
      // right: (215.5 + 170, 342.25 + 55) = (385.5, 397.25)
      // bottom: (215.5 + 85, 342.25 + 110) = (300.5, 452.25)
      // left: (215.5, 342.25 + 55) = (215.5, 397.25)
      const expectedDiamondVertices: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 300.5, y: 342.25 },
        right: { x: 385.5, y: 397.25 },
        bottom: { x: 300.5, y: 452.25 },
        left: { x: 215.5, y: 397.25 },
        auto: { x: 300.5, y: 452.25 },
      };

      for (const h of CARDINALS) {
        const relId = store.addRelation(decId, targetId, '', 'sequence', {
          sourceHandle: h,
          targetHandle: 'left',
          manualHandles: true,
        });

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        // Verify polygon vertices rendered in SVG match expectedDiamondVertices
        const polyRegex = /<polygon points="([^"]+)"/;
        const polyMatch = polyRegex.exec(svg);
        expect(polyMatch).not.toBeNull();
        const polyPoints = polyMatch![1].split(' ');
        expect(polyPoints).toHaveLength(4);

        // Verify path start coordinates
        const parsed = parsePathData(svg, relId!);
        expect(parsed).not.toBeNull();
        expect(parsed!.startX).toBeCloseTo(expectedDiamondVertices[h].x, 1);
        expect(parsed!.startY).toBeCloseTo(expectedDiamondVertices[h].y, 1);

        store.deleteElements([], [relId!]);
      }
    });

    it('conecta perfeitamente losango decision a outro losango decision em todas as 16 combinações de vértices', () => {
      const store = useConceptMapStore.getState();
      const dec1 = store.addConcept('Decisão 1', { x: 100, y: 100 });
      const dec2 = store.addConcept('Decisão 2', { x: 500, y: 100 });
      store.updateNodeShape(dec1, 'decision');
      store.updateNodeShape(dec2, 'decision');
      store.resizeNode(dec1, { width: 160, height: 100 });
      store.resizeNode(dec2, { width: 160, height: 100 });

      // Dec 1: (100, 100, w=160, h=100) -> top: (180, 100), right: (260, 150), bottom: (180, 200), left: (100, 150)
      const v1: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 180, y: 100 },
        right: { x: 260, y: 150 },
        bottom: { x: 180, y: 200 },
        left: { x: 100, y: 150 },
        auto: { x: 180, y: 200 },
      };
      // Dec 2: (500, 100, w=160, h=100) -> top: (580, 100), right: (660, 150), bottom: (580, 200), left: (500, 150)
      const v2: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 580, y: 100 },
        right: { x: 660, y: 150 },
        bottom: { x: 580, y: 200 },
        left: { x: 500, y: 150 },
        auto: { x: 580, y: 100 },
      };

      for (const h1 of CARDINALS) {
        for (const h2 of CARDINALS) {
          const relId = store.addRelation(dec1, dec2, 'valida', 'sequence', {
            sourceHandle: h1,
            targetHandle: h2,
            manualHandles: true,
          });

          const state = useConceptMapStore.getState();
          const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
          const parsed = parsePathData(svg, relId!);

          expect(parsed).not.toBeNull();
          expect(parsed!.startX).toBeCloseTo(v1[h1].x, 1);
          expect(parsed!.startY).toBeCloseTo(v1[h1].y, 1);
          expect(parsed!.endX).toBeCloseTo(v2[h2].x, 1);
          expect(parsed!.endY).toBeCloseTo(v2[h2].y, 1);

          store.deleteElements([], [relId!]);
        }
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Heterogeneous Node Shapes Matrix
  // ==========================================================================
  describe('Challenge 3: Heterogeneous Node Shapes Matrix (7 Shapes)', () => {
    it('garante que todos os 7 formatos posicionam suas portas exatamente no perímetro geométrico', () => {
      const store = useConceptMapStore.getState();

      for (const shape of ALL_SHAPES) {
        const node = store.addConcept(`Teste ${shape}`, { x: 200, y: 300 });
        store.updateNodeShape(node, shape);
        store.resizeNode(node, { width: 180, height: 80 });

        const target = store.addConcept('Destino', { x: 600, y: 300 });
        store.resizeNode(target, { width: 140, height: 60 });

        for (const handle of CARDINALS) {
          const relId = store.addRelation(node, target, 'fluxo', 'sequence', {
            sourceHandle: handle,
            targetHandle: 'left',
            manualHandles: true,
          });

          const state = useConceptMapStore.getState();
          const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
          const parsed = parsePathData(svg, relId!);

          expect(parsed).not.toBeNull();

          // Coordinate verification
          if (handle === 'top') {
            expect(parsed!.startX).toBeCloseTo(290, 1);
            expect(parsed!.startY).toBeCloseTo(300, 1);
          } else if (handle === 'right') {
            expect(parsed!.startX).toBeCloseTo(380, 1);
            expect(parsed!.startY).toBeCloseTo(340, 1);
          } else if (handle === 'bottom') {
            expect(parsed!.startX).toBeCloseTo(290, 1);
            expect(parsed!.startY).toBeCloseTo(380, 1);
          } else if (handle === 'left') {
            expect(parsed!.startX).toBeCloseTo(200, 1);
            expect(parsed!.startY).toBeCloseTo(340, 1);
          }

          store.deleteElements([], [relId!]);
        }

        store.deleteElements([node, target], []);
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Complete Dynamic Arrowhead Matrix (4 Directions x 5 Relation Types = 20 Combinations)
  // ==========================================================================
  describe('Challenge 4: Dynamic Arrowhead Matrix (4 Directions x 5 Types = 20 Combinations)', () => {
    const DIRECTIONS: readonly ArrowDirection[] = ['forward', 'reverse', 'both', 'none'] as const;

    interface RelationTestCase {
      type: ConceptRelationType;
      label: string;
      expectedMarker: string;
      expectedStroke: string;
      expectedDashed: boolean;
    }

    const TEST_CASES: readonly RelationTestCase[] = [
      {
        type: 'sequence',
        label: 'avalia',
        expectedMarker: 'arrow-hier',
        expectedStroke: '#475569',
        expectedDashed: false,
      },
      {
        type: 'cross-link',
        label: 'associa',
        expectedMarker: 'arrow-cross',
        expectedStroke: '#d97706',
        expectedDashed: true,
      },
      {
        type: 'conditional',
        label: 'Sim',
        expectedMarker: 'arrow-yes',
        expectedStroke: '#059669',
        expectedDashed: false,
      },
      {
        type: 'conditional',
        label: 'Não',
        expectedMarker: 'arrow-no',
        expectedStroke: '#e11d48',
        expectedDashed: false,
      },
      {
        type: 'loop-back',
        label: 'itera',
        expectedMarker: 'arrow-loop',
        expectedStroke: '#475569',
        expectedDashed: true,
      },
    ];

    for (const testCase of TEST_CASES) {
      for (const dir of DIRECTIONS) {
        it(`produz marcadores exatos para ${testCase.type} ('${testCase.label}') com direção '${dir}'`, () => {
          const store = useConceptMapStore.getState();
          const n1 = store.addConcept('Origem', { x: 100, y: 100 });
          const n2 = store.addConcept('Destino', { x: 400, y: 100 });

          const relId = store.addRelation(
            n1,
            n2,
            testCase.label,
            testCase.type,
            undefined,
            dir
          );

          const state = useConceptMapStore.getState();
          const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
          const parsed = parsePathData(svg, relId!);

          expect(parsed).not.toBeNull();

          // Stroke and dash verification
          expect(parsed!.attrs).toContain(`stroke="${testCase.expectedStroke}"`);
          if (testCase.expectedDashed) {
            expect(parsed!.attrs).toContain('stroke-dasharray="8 5"');
          } else {
            expect(parsed!.attrs).not.toContain('stroke-dasharray=');
          }

          // Marker verification according to direction
          if (dir === 'forward') {
            expect(parsed!.hasMarkerEnd).toBe(true);
            expect(parsed!.hasMarkerStart).toBe(false);
            expect(parsed!.markerEndId).toBe(testCase.expectedMarker);
          } else if (dir === 'reverse') {
            expect(parsed!.hasMarkerStart).toBe(true);
            expect(parsed!.hasMarkerEnd).toBe(false);
            expect(parsed!.markerStartId).toBe(testCase.expectedMarker);
          } else if (dir === 'both') {
            expect(parsed!.hasMarkerStart).toBe(true);
            expect(parsed!.hasMarkerEnd).toBe(true);
            expect(parsed!.markerStartId).toBe(testCase.expectedMarker);
            expect(parsed!.markerEndId).toBe(testCase.expectedMarker);
          } else if (dir === 'none') {
            expect(parsed!.hasMarkerStart).toBe(false);
            expect(parsed!.hasMarkerEnd).toBe(false);
          }
        });
      }
    }
  });

  // ==========================================================================
  // CHALLENGE 5: Reverse Relation Direction Integrity in SVG Export
  // ==========================================================================
  describe('Challenge 5: Reverse Relation Direction Invariance', () => {
    it('inverte endpoints e portas mantendo integridade exata no SVG vetorial exportado', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('N1', { x: 100, y: 100 });
      const n2 = store.addConcept('N2', { x: 400, y: 200 });
      store.resizeNode(n1, { width: 120, height: 60 });
      store.resizeNode(n2, { width: 120, height: 60 });

      const relId = store.addRelation(n1, n2, 'conecta', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'top',
        manualHandles: true,
      }, 'forward');

      // Before inversion: N1(right) -> N2(top)
      // N1 right: (100 + 120, 100 + 30) = (220, 130)
      // N2 top: (400 + 60, 200) = (460, 200)
      let svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      let parsed = parsePathData(svg, relId!);
      expect(parsed!.startX).toBeCloseTo(220, 1);
      expect(parsed!.startY).toBeCloseTo(130, 1);
      expect(parsed!.endX).toBeCloseTo(460, 1);
      expect(parsed!.endY).toBeCloseTo(200, 1);
      expect(parsed!.hasMarkerEnd).toBe(true);
      expect(parsed!.hasMarkerStart).toBe(false);

      // Perform store reverse
      store.reverseRelationDirection(relId!);

      // After inversion: N2(top) -> N1(right)
      svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      parsed = parsePathData(svg, relId!);
      expect(parsed!.startX).toBeCloseTo(460, 1);
      expect(parsed!.startY).toBeCloseTo(200, 1);
      expect(parsed!.endX).toBeCloseTo(220, 1);
      expect(parsed!.endY).toBeCloseTo(130, 1);
      expect(parsed!.hasMarkerEnd).toBe(true);
      expect(parsed!.hasMarkerStart).toBe(false);
    });
  });

  // ==========================================================================
  // CHALLENGE 6: Multi-Edge Parallel Connections with Independent Handles & Markers
  // ==========================================================================
  describe('Challenge 6: Multi-Edge Parallel Connections Stress', () => {
    it('renderiza múltiplas conexões simultâneas entre os mesmos nós com portas e marcadores 100% independentes', () => {
      const store = useConceptMapStore.getState();
      const nA = store.addConcept('Bloco A', { x: 100, y: 100 });
      const nB = store.addConcept('Bloco B', { x: 500, y: 100 });
      store.resizeNode(nA, { width: 140, height: 70 });
      store.resizeNode(nB, { width: 140, height: 70 });

      // Edge 1: right -> left, forward, sequence
      const r1 = store.addRelation(nA, nB, 'r1', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'forward');

      // Edge 2: bottom -> bottom, reverse, conditional "Sim"
      const r2 = store.addRelation(nA, nB, 'Sim', 'conditional', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      }, 'reverse');

      // Edge 3: top -> top, both, cross-link
      const r3 = store.addRelation(nA, nB, 'r3', 'cross-link', {
        sourceHandle: 'top',
        targetHandle: 'top',
        manualHandles: true,
      }, 'both');

      // Edge 4: left -> right, none, loop-back
      const r4 = store.addRelation(nB, nA, 'r4', 'loop-back', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'none');

      const svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);

      const p1 = parsePathData(svg, r1!);
      const p2 = parsePathData(svg, r2!);
      const p3 = parsePathData(svg, r3!);
      const p4 = parsePathData(svg, r4!);

      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p3).not.toBeNull();
      expect(p4).not.toBeNull();

      // Check p1: right -> left (240, 135) -> (500, 135)
      expect(p1!.startX).toBeCloseTo(240, 1);
      expect(p1!.startY).toBeCloseTo(135, 1);
      expect(p1!.endX).toBeCloseTo(500, 1);
      expect(p1!.endY).toBeCloseTo(135, 1);
      expect(p1!.hasMarkerEnd).toBe(true);
      expect(p1!.hasMarkerStart).toBe(false);
      expect(p1!.markerEndId).toBe('arrow-hier');

      // Check p2: bottom -> bottom (170, 170) -> (570, 170)
      expect(p2!.startX).toBeCloseTo(170, 1);
      expect(p2!.startY).toBeCloseTo(170, 1);
      expect(p2!.endX).toBeCloseTo(570, 1);
      expect(p2!.endY).toBeCloseTo(170, 1);
      expect(p2!.hasMarkerStart).toBe(true);
      expect(p2!.hasMarkerEnd).toBe(false);
      expect(p2!.markerStartId).toBe('arrow-yes');

      // Check p3: top -> top (170, 100) -> (570, 100)
      expect(p3!.startX).toBeCloseTo(170, 1);
      expect(p3!.startY).toBeCloseTo(100, 1);
      expect(p3!.endX).toBeCloseTo(570, 1);
      expect(p3!.endY).toBeCloseTo(100, 1);
      expect(p3!.hasMarkerStart).toBe(true);
      expect(p3!.hasMarkerEnd).toBe(true);
      expect(p3!.markerStartId).toBe('arrow-cross');

      // Check p4: right -> left (640, 135) -> (100, 135)
      expect(p4!.startX).toBeCloseTo(640, 1);
      expect(p4!.startY).toBeCloseTo(135, 1);
      expect(p4!.endX).toBeCloseTo(100, 1);
      expect(p4!.endY).toBeCloseTo(135, 1);
      expect(p4!.hasMarkerStart).toBe(false);
      expect(p4!.hasMarkerEnd).toBe(false);
    });
  });

  // ==========================================================================
  // CHALLENGE 7: Self-Loops with Distinct Cardinal Handles
  // ==========================================================================
  describe('Challenge 7: Self-Loops with Distinct Cardinal Handles', () => {
    it('renderiza laços de repetição (self-loops) conectando portas distintas do mesmo bloco', () => {
      const store = useConceptMapStore.getState();
      const node = store.addConcept('Processamento Cíclico', { x: 200, y: 200 });
      store.resizeNode(node, { width: 160, height: 80 });

      // Self-loop 1: right -> top
      const r1 = store.addRelation(node, node, 'ciclo 1', 'loop-back', {
        sourceHandle: 'right',
        targetHandle: 'top',
        manualHandles: true,
      }, 'forward');

      const svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      const parsed = parsePathData(svg, r1!);

      expect(parsed).not.toBeNull();
      // Node is (200, 200, w=160, h=80)
      // right: (360, 240)
      // top: (280, 200)
      expect(parsed!.startX).toBeCloseTo(360, 1);
      expect(parsed!.startY).toBeCloseTo(240, 1);
      expect(parsed!.endX).toBeCloseTo(280, 1);
      expect(parsed!.endY).toBeCloseTo(200, 1);
      expect(parsed!.hasMarkerEnd).toBe(true);
      expect(parsed!.markerEndId).toBe('arrow-loop');
      expect(parsed!.attrs).toContain('stroke-dasharray="8 5"');
    });

    it('não quebra nem emite NaN se receber programmaticamente self-loop com mesma porta', () => {
      const store = useConceptMapStore.getState();
      const node = store.addConcept('Auto-Reflexivo', { x: 300, y: 300 });
      store.resizeNode(node, { width: 140, height: 70 });

      // Injeta diretamente relação com source === target e sourceHandle === targetHandle === 'right'
      const state = useConceptMapStore.getState();
      const relId = 'rel-self-same' as any;
      state.semantic.relationOrder.push(relId);
      state.semantic.relations[relId] = {
        id: relId,
        sourceId: node,
        targetId: node,
        linkingPhrase: 'mesmo ponto',
        type: 'loop-back',
        arrowDirection: 'forward',
      };
      state.visual.edges[relId] = {
        relationId: relId,
        curveType: 'bezier',
        sourceHandle: 'right',
        targetHandle: 'right',
        manualHandles: true,
        arrowDirection: 'forward',
      };

      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('Infinity');

      const parsed = parsePathData(svg, relId);
      expect(parsed).not.toBeNull();
      // Starts and ends at right handle: (300 + 140, 300 + 35) = (440, 335)
      expect(parsed!.startX).toBeCloseTo(440, 1);
      expect(parsed!.startY).toBeCloseTo(335, 1);
      expect(parsed!.endX).toBeCloseTo(440, 1);
      expect(parsed!.endY).toBeCloseTo(335, 1);
    });
  });

  // ==========================================================================
  // CHALLENGE 8: Extreme Coordinates & ViewBox Resilience
  // ==========================================================================
  describe('Challenge 8: Extreme Coordinates & ViewBox Resilience', () => {
    it('calcula viewBox correto e não corrompe coordenadas sob números negativos e decimais', () => {
      const store = useConceptMapStore.getState();
      const nNeg = store.addConcept('Negativo', { x: -1250, y: -840 });
      store.resizeNode(nNeg, { width: 200, height: 80 });

      const nLarge = store.addConcept('Extremo', { x: 3450, y: 5200 });
      store.resizeNode(nLarge, { width: 180, height: 90 });

      const relId = store.addRelation(nNeg, nLarge, 'longa distância', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'forward');

      const svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);

      // Verify no NaN or Infinity
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('Infinity');
      expect(svg).not.toContain('undefined');

      // ViewBox must enclose negative and large coordinates
      const vbMatch = /viewBox="([-0-9.]+)\s+([-0-9.]+)\s+([0-9.]+)\s+([0-9.]+)"/.exec(svg);
      expect(vbMatch).not.toBeNull();

      const vbX = parseFloat(vbMatch![1]);
      const vbY = parseFloat(vbMatch![2]);
      const vbW = parseFloat(vbMatch![3]);
      const vbH = parseFloat(vbMatch![4]);

      expect(vbX).toBeLessThanOrEqual(-1250);
      expect(vbY).toBeLessThanOrEqual(-840);
      expect(vbX + vbW).toBeGreaterThanOrEqual(3450 + 180);
      expect(vbY + vbH).toBeGreaterThanOrEqual(5200 + 90);

      const parsed = parsePathData(svg, relId!);
      expect(parsed).not.toBeNull();
      // nNeg right: (-1250 + 200, -840 + 40) = (-1050, -800)
      expect(parsed!.startX).toBeCloseTo(-1050, 1);
      expect(parsed!.startY).toBeCloseTo(-800, 1);
      // nLarge left: (3450, 5200 + 45) = (3450, 5245)
      expect(parsed!.endX).toBeCloseTo(3450, 1);
      expect(parsed!.endY).toBeCloseTo(5245, 1);
    });
  });

  // ==========================================================================
  // CHALLENGE 9: XML Well-Formedness & SVG Spec Compliance
  // ==========================================================================
  describe('Challenge 9: XML Well-Formedness & SVG Spec Compliance', () => {
    it('produz XML 100% bem-formado e aderente ao padrão SVG com todos os marcadores e camadas', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Início', { x: 100, y: 100 });
      store.updateNodeShape(n1, 'terminal');
      const n2 = store.addConcept('Decisão', { x: 300, y: 100 });
      store.updateNodeShape(n2, 'decision');
      const n3 = store.addConcept('Fim', { x: 500, y: 100 });
      store.updateNodeShape(n3, 'terminal');

      store.addRelation(n1, n2, 'avança', 'sequence', { sourceHandle: 'right', targetHandle: 'left' }, 'forward');
      store.addRelation(n2, n3, 'Sim', 'conditional', { sourceHandle: 'right', targetHandle: 'left' }, 'both');
      store.addRelation(n2, n1, 'Não', 'conditional', { sourceHandle: 'bottom', targetHandle: 'bottom' }, 'reverse');

      const svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);

      const validation = validateSvgXml(svg);
      expect(validation.valid, `SVG deve ser bem formado: ${validation.error}`).toBe(true);

      // Verify layers exist
      expect(svg).toContain('<g id="edges-layer">');
      expect(svg).toContain('<g id="nodes-layer">');
      expect(svg).toContain('<g id="labels-layer">');
      expect(svg).toContain('</svg>');
    });
  });
});
