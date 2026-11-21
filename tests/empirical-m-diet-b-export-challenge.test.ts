import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ArrowDirection,
  ConceptMapDocument,
  FlowchartNodeShape,
  HandlePosition,
  RelationType,
} from '../src/domain/types';
import {
  escapeXml,
  exportAsPng,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  renderNodeShapeSvg,
  serializeDocumentToJson,
} from '../src/services/export/fileExporter';
import {
  getDiamondPointsString,
  getDiamondVertices,
  getHandlePoint,
} from '../src/services/layout/geometry';
import { parseConceptMapMarkdown } from '../src/services/parser/markdownParser';
import { useConceptMapStore } from '../src/store/useConceptMapStore';

const rootDir = path.resolve(__dirname, '..');
const exemploMdPath = path.join(rootDir, 'exemplo.md');
const exemploFluxoMdPath = path.join(rootDir, 'exemplo-fluxograma.md');
const exemploCanvasLivreJsonPath = path.join(rootDir, 'exemplo-canvas-livre.cmap.json');
const exemploCanvasLivreMdPath = path.join(rootDir, 'exemplo-canvas-livre.md');

describe('Empirical Challenger: M-Diet-B Export Fidelity & Serialization Stress Suite', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ALL_4_DIRECTIONS: readonly ArrowDirection[] = [
    'forward',
    'reverse',
    'both',
    'none',
  ] as const;

  const ALL_7_SHAPES: readonly FlowchartNodeShape[] = [
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

  // =========================================================================
  // SECTION 1: All 10 SVG Marker IDs & Precise XML Specification
  // =========================================================================
  describe('1. All 10 SVG Marker IDs Verification', () => {
    const EXPECTED_MARKERS = [
      { id: 'arrow-hier', color: '#475569', isStart: false },
      { id: 'arrow-cross', color: '#d97706', isStart: false },
      { id: 'arrow-yes', color: '#059669', isStart: false },
      { id: 'arrow-no', color: '#e11d48', isStart: false },
      { id: 'arrow-loop', color: '#475569', isStart: false },
      { id: 'arrow-hier-start', color: '#475569', isStart: true },
      { id: 'arrow-cross-start', color: '#d97706', isStart: true },
      { id: 'arrow-yes-start', color: '#059669', isStart: true },
      { id: 'arrow-no-start', color: '#e11d48', isStart: true },
      { id: 'arrow-loop-start', color: '#475569', isStart: true },
    ];

    it('emite exatamente todos os 10 marcadores SVG com IDs, viewBox, refX, refY, orient e cores correspondentes', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 300, y: 100 });
      store.addRelation(n1, n2, 'teste');

      const svg = generateStandaloneVectorSvg(
        useConceptMapStore.getState().semantic,
        useConceptMapStore.getState().visual
      );

      // Extrai os blocos <marker>
      const markerRegex = /<marker\s+id="([^"]+)"\s+viewBox="([^"]+)"\s+refX="([^"]+)"\s+refY="([^"]+)"\s+markerWidth="([^"]+)"\s+markerHeight="([^"]+)"\s+orient="([^"]+)">\s*<path\s+d="([^"]+)"\s+fill="([^"]+)"\s*\/>\s*<\/marker>/g;
      const foundMarkers = new Map<string, {
        id: string;
        viewBox: string;
        refX: string;
        refY: string;
        markerWidth: string;
        markerHeight: string;
        orient: string;
        pathD: string;
        fill: string;
      }>();

      let match: RegExpExecArray | null;
      while ((match = markerRegex.exec(svg)) !== null) {
        foundMarkers.set(match[1], {
          id: match[1],
          viewBox: match[2],
          refX: match[3],
          refY: match[4],
          markerWidth: match[5],
          markerHeight: match[6],
          orient: match[7],
          pathD: match[8],
          fill: match[9],
        });
      }

      expect(foundMarkers.size).toBe(10);

      for (const expected of EXPECTED_MARKERS) {
        const marker = foundMarkers.get(expected.id);
        expect(marker, `Marker ${expected.id} deve existir`).toBeDefined();
        expect(marker!.viewBox).toBe('0 0 10 10');
        expect(marker!.markerWidth).toBe('7');
        expect(marker!.markerHeight).toBe('7');
        expect(marker!.fill.toLowerCase()).toBe(expected.color.toLowerCase());
        expect(marker!.refY).toBe('5');

        if (expected.isStart) {
          expect(marker!.refX).toBe('2');
          expect(marker!.orient).toBe('auto');
          expect(marker!.pathD).toBe('M 10 1 L 0 5 L 10 9 z');
        } else {
          expect(marker!.refX).toBe('8');
          expect(marker!.orient).toBe('auto-start-reverse');
          expect(marker!.pathD).toBe('M 0 1 L 10 5 L 0 9 z');
        }
      }
    });

    it('gera documento SVG limpo e robusto quando o grafo é vazio sem quebrar os marcadores', () => {
      const store = useConceptMapStore.getState();
      const emptyDoc = store.exportDocument();
      emptyDoc.semantic.conceptOrder = [];
      emptyDoc.semantic.concepts = {};
      emptyDoc.semantic.relationOrder = [];
      emptyDoc.semantic.relations = {};

      const emptySvg = generateStandaloneVectorSvg(emptyDoc.semantic, emptyDoc.visual);
      expect(emptySvg).toContain('<svg');
      expect(emptySvg).toContain('Mapa Conceitual Vazio');
    });
  });

  // =========================================================================
  // SECTION 2: Exact Diamond Polygon Vertex Geometry
  // =========================================================================
  describe('2. Exact Diamond Polygon Vertex Geometry Verification', () => {
    it('calcula os 4 vértices do losango decision com precisão idêntica entre renderNodeShapeSvg e getDiamondPointsString', () => {
      const testCases = [
        { x: 100, y: 100, w: 160, h: 80 },
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 50.5, y: 75.25, w: 200, h: 90 },
        { x: -120, y: -80, w: 140, h: 70 },
      ];

      for (const tc of testCases) {
        const diamondMarkup = renderNodeShapeSvg(
          'decision',
          tc.x,
          tc.y,
          tc.w,
          tc.h,
          '#fffbeb',
          '#d97706',
          2
        );

        const expectedPointsStr = getDiamondPointsString(tc.x, tc.y, tc.w, tc.h);
        expect(diamondMarkup).toContain(`points="${expectedPointsStr}"`);
        expect(diamondMarkup).toContain('fill="#fffbeb"');
        expect(diamondMarkup).toContain('stroke="#d97706"');

        // Parse points: "topX,topY rightX,rightY bottomX,bottomY leftX,leftY"
        const coords = expectedPointsStr.split(/\s+/).map((pair) => {
          const [px, py] = pair.split(',').map(Number);
          return { x: px, y: py };
        });

        expect(coords).toHaveLength(4);
        const [top, right, bottom, left] = coords;

        // Verify mathematical coordinates match toFixed(1) output
        expect(top.x).toBe(Number((tc.x + tc.w / 2).toFixed(1)));
        expect(top.y).toBe(Number(tc.y.toFixed(1)));

        expect(right.x).toBe(Number((tc.x + tc.w).toFixed(1)));
        expect(right.y).toBe(Number((tc.y + tc.h / 2).toFixed(1)));

        expect(bottom.x).toBe(Number((tc.x + tc.w / 2).toFixed(1)));
        expect(bottom.y).toBe(Number((tc.y + tc.h).toFixed(1)));

        expect(left.x).toBe(Number(tc.x.toFixed(1)));
        expect(left.y).toBe(Number((tc.y + tc.h / 2).toFixed(1)));
      }
    });

    it('alinha perfeitamente os pontos de ancoragem getHandlePoint com os vértices do losango', () => {
      const pos = { x: 250, y: 350 };
      const w = 180;
      const h = 90;

      const vertices = getDiamondVertices(pos.x, pos.y, w, h);

      expect(getHandlePoint(pos, w, h, 'top')).toEqual(vertices.top);
      expect(getHandlePoint(pos, w, h, 'right')).toEqual(vertices.right);
      expect(getHandlePoint(pos, w, h, 'bottom')).toEqual(vertices.bottom);
      expect(getHandlePoint(pos, w, h, 'left')).toEqual(vertices.left);
    });

    it('garante que arestas conectadas a nós decision no SVG começam e terminam exatamente nos vértices', () => {
      const store = useConceptMapStore.getState();
      const decA = store.addConcept('Decisão A', { x: 100, y: 100 });
      store.updateNodeShape(decA, 'decision');
      store.resizeNode(decA, { width: 140, height: 80 });

      const decB = store.addConcept('Decisão B', { x: 500, y: 100 });
      store.updateNodeShape(decB, 'decision');
      store.resizeNode(decB, { width: 140, height: 80 });

      // Conecta right de decA ao left de decB com reta (straight)
      const relId = store.addRelation(decA, decB, 'avalia', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      });
      store.updateRelation(relId!, { curveType: 'straight' });

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // Expected right of decA: (100 + 140, 100 + 40) = (240, 140)
      // Expected left of decB: (500, 100 + 40) = (500, 140)
      const match = new RegExp(`<path id="edge-${relId}" d="M\\s*([0-9.]+)[,\\s]+([0-9.]+)[^L]*L\\s*([0-9.]+)[,\\s]+([0-9.]+)`).exec(svg);
      expect(match).toBeTruthy();
      expect(parseFloat(match![1])).toBeCloseTo(240, 0);
      expect(parseFloat(match![2])).toBeCloseTo(140, 0);
      expect(parseFloat(match![3])).toBeCloseTo(500, 0);
      expect(parseFloat(match![4])).toBeCloseTo(140, 0);
    });
  });

  // =========================================================================
  // SECTION 3: 4 Arrow Directions x 16 Cardinal Handle Combinations
  // =========================================================================
  describe('3. Arrow Directions & 16 Cardinal Handle Combinations Stress Matrix', () => {
    it('valida exaustivamente todas as 4 direções de seta com todas as 16 combinações cardinais (64 testes combinatórios)', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Nó 1', { x: 150, y: 150 });
      const n2 = store.addConcept('Nó 2', { x: 450, y: 350 });
      store.resizeNode(n1, { width: 160, height: 60 });
      store.resizeNode(n2, { width: 160, height: 60 });

      const expectedSourcePoints: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 150 + 80, y: 150 },
        right: { x: 150 + 160, y: 150 + 30 },
        bottom: { x: 150 + 80, y: 150 + 60 },
        left: { x: 150, y: 150 + 30 },
        auto: { x: 150 + 80, y: 150 + 60 },
      };

      const expectedTargetPoints: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 450 + 80, y: 350 },
        right: { x: 450 + 160, y: 350 + 30 },
        bottom: { x: 450 + 80, y: 350 + 60 },
        left: { x: 450, y: 350 + 30 },
        auto: { x: 450 + 80, y: 350 },
      };

      for (const dir of ALL_4_DIRECTIONS) {
        for (const srcH of CARDINAL_HANDLES) {
          for (const tgtH of CARDINAL_HANDLES) {
            const relId = store.addRelation(n1, n2, `link-${dir}-${srcH}-${tgtH}`, 'sequence', {
              sourceHandle: srcH,
              targetHandle: tgtH,
              manualHandles: true,
            }, dir);
            store.updateRelation(relId!, { curveType: 'straight' });

            const state = useConceptMapStore.getState();
            const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

            const pathRegex = new RegExp(`<path id="edge-${relId}" d="M\\s*([0-9.]+)[,\\s]+([0-9.]+)[^L]*L\\s*([0-9.]+)[,\\s]+([0-9.]+)"[^>]*>`);
            const match = pathRegex.exec(svg);
            expect(match, `Edge ${relId} deve ter path válido no SVG`).toBeTruthy();

            const startX = parseFloat(match![1]);
            const startY = parseFloat(match![2]);
            const endX = parseFloat(match![3]);
            const endY = parseFloat(match![4]);

            expect(startX).toBeCloseTo(expectedSourcePoints[srcH].x, 0);
            expect(startY).toBeCloseTo(expectedSourcePoints[srcH].y, 0);
            expect(endX).toBeCloseTo(expectedTargetPoints[tgtH].x, 0);
            expect(endY).toBeCloseTo(expectedTargetPoints[tgtH].y, 0);

            const pathElement = match![0];
            if (dir === 'forward') {
              expect(pathElement).toContain('marker-end=');
              expect(pathElement).not.toContain('marker-start=');
            } else if (dir === 'reverse') {
              expect(pathElement).toContain('marker-start=');
              expect(pathElement).not.toContain('marker-end=');
            } else if (dir === 'both') {
              expect(pathElement).toContain('marker-start=');
              expect(pathElement).toContain('marker-end=');
            } else if (dir === 'none') {
              expect(pathElement).not.toContain('marker-start=');
              expect(pathElement).not.toContain('marker-end=');
            }

            store.deleteElements([], [relId!]);
          }
        }
      }
    });

    it('aplica corretamente os marcadores especializados por tipo de relação em qualquer direção', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Src', { x: 100, y: 100 });
      const n2 = store.addConcept('Tgt', { x: 300, y: 100 });

      const cases: Array<{
        type: RelationType;
        phrase: string;
        expectedMarker: string;
      }> = [
        { type: 'hierarchical', phrase: 'hier', expectedMarker: 'arrow-hier' },
        { type: 'cross-link', phrase: 'cross', expectedMarker: 'arrow-cross' },
        { type: 'conditional', phrase: 'Sim', expectedMarker: 'arrow-yes' },
        { type: 'conditional', phrase: 'Não', expectedMarker: 'arrow-no' },
        { type: 'loop-back', phrase: 'repete', expectedMarker: 'arrow-loop' },
      ];

      for (const c of cases) {
        const rBoth = store.addRelation(n1, n2, c.phrase, c.type, undefined, 'both');
        const svg = generateStandaloneVectorSvg(
          useConceptMapStore.getState().semantic,
          useConceptMapStore.getState().visual
        );

        const edgePath = svg.match(new RegExp(`<path id="edge-${rBoth}"[^>]+>`))?.[0] ?? '';
        expect(edgePath).toContain(`marker-start="url(#${c.expectedMarker})"`);
        expect(edgePath).toContain(`marker-end="url(#${c.expectedMarker})"`);

        store.deleteElements([], [rBoth!]);
      }
    });
  });

  // =========================================================================
  // SECTION 4: Complete JSON Import/Export Validation Stress Test
  // =========================================================================
  describe('4. Complete JSON Import/Export Validation Stress Test', () => {
    it('preserva completamente todos os nós, arestas, formas, direções e handles em roundtrip', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');
      store.setFreeformCanvas(true);

      const n1 = store.addConcept('Início', { x: 50, y: 50 });
      store.updateNodeShape(n1, 'terminal');
      store.resizeNode(n1, { width: 140, height: 50 });

      const n2 = store.addConcept('Decisão', { x: 250, y: 50 });
      store.updateNodeShape(n2, 'decision');
      store.resizeNode(n2, { width: 120, height: 70 });

      const n3 = store.addConcept('Documento', { x: 450, y: 50 });
      store.updateNodeShape(n3, 'document');

      const r1 = store.addRelation(n1, n2, 'vai para', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'forward');

      const r2 = store.addRelation(n2, n3, 'Sim', 'conditional', {
        sourceHandle: 'top',
        targetHandle: 'top',
        manualHandles: true,
      }, 'both');

      const r3 = store.addRelation(n3, n1, 'feedback', 'loop-back', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      }, 'reverse');

      const docBefore = store.exportDocument();
      const jsonStr = serializeDocumentToJson(docBefore);
      const docAfter = parseAndValidateJsonDocument(jsonStr);

      // Structural comparisons
      expect(docAfter.schemaVersion).toBe('1.0.0');
      expect(docAfter.semantic.diagramMode).toBe('flowchart');
      expect(docAfter.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(docAfter.semantic.conceptOrder).toHaveLength(3);
      expect(docAfter.semantic.relationOrder).toHaveLength(3);

      // Verify node shapes and dimensions
      expect(docAfter.visual.nodes[n1].nodeShape).toBe('terminal');
      expect(docAfter.visual.nodes[n1].dimensions).toEqual({ width: 140, height: 50 });
      expect(docAfter.visual.nodes[n2].nodeShape).toBe('decision');
      expect(docAfter.visual.nodes[n2].dimensions).toEqual({ width: 120, height: 70 });
      expect(docAfter.visual.nodes[n3].nodeShape).toBe('document');

      // Verify edge attributes
      expect(docAfter.visual.edges[r1!].sourceHandle).toBe('right');
      expect(docAfter.visual.edges[r1!].targetHandle).toBe('left');
      expect(docAfter.visual.edges[r1!].manualHandles).toBe(true);
      expect(docAfter.visual.edges[r1!].arrowDirection).toBe('forward');

      expect(docAfter.visual.edges[r2!].sourceHandle).toBe('top');
      expect(docAfter.visual.edges[r2!].targetHandle).toBe('top');
      expect(docAfter.visual.edges[r2!].manualHandles).toBe(true);
      expect(docAfter.visual.edges[r2!].arrowDirection).toBe('both');

      expect(docAfter.visual.edges[r3!].sourceHandle).toBe('bottom');
      expect(docAfter.visual.edges[r3!].targetHandle).toBe('bottom');
      expect(docAfter.visual.edges[r3!].manualHandles).toBe(true);
      expect(docAfter.visual.edges[r3!].arrowDirection).toBe('reverse');

      // Idempotence check
      const jsonStr2 = serializeDocumentToJson(docAfter);
      const docAfter2 = parseAndValidateJsonDocument(jsonStr2);
      expect(docAfter).toEqual(docAfter2);
    });

    it('sanitiza e recupera com resiliência extrema dados corruptos ou adversariais em parseAndValidateJsonDocument', () => {
      const adversarialJson = JSON.stringify({
        schemaVersion: '0.9.0',
        metadata: { id: 'adv-doc' },
        semantic: {
          title: 'Adversarial Test',
          concepts: {
            'c-alpha': { id: 'c-alpha', label: 'Alpha', depth: 0 },
            'c-beta': { id: 'c-beta', label: 'Beta', depth: 1 },
          },
          conceptOrder: ['c-alpha', 'c-beta'],
          relations: {
            'r-test': { id: 'r-test', sourceId: 'c-alpha', targetId: 'c-beta', type: 'sequence' },
          },
          relationOrder: ['r-test'],
        },
        visual: {
          nodes: {
            'c-alpha': { conceptId: 'c-alpha', position: { x: NaN, y: 'corrupt' }, dimensions: { width: 100, height: 50 } },
            // c-beta ausente intencionalmente em visual.nodes
          },
          edges: {
            'r-test': {
              relationId: 'r-test',
              sourceHandle: 'invalid-handle',
              targetHandle: 999,
              arrowDirection: 'upwards',
              curveType: 'crazy-bezier',
              manualHandles: 'false', // string invés de boolean
              labelOffset: { x: NaN, y: 'string', t: 0.8 },
              waypoints: [{ x: 10, y: 20 }, null, { x: NaN, y: 30 }, { x: 40, y: 50 }],
            },
          },
          layoutSettings: {
            algorithm: 'non-existent-algo',
            direction: 'invalid-dir',
            nodeSpacingX: 'not-a-number',
            freeformCanvas: true,
          },
          viewport: { x: 'invalid', y: null, zoom: -10 },
          crossLinkVisibility: 'invisible',
        },
      });

      const validated = parseAndValidateJsonDocument(adversarialJson);

      // Posicionamento fallback para NaN
      expect(validated.visual.nodes['c-alpha'].position.x).toBe(100);
      expect(validated.visual.nodes['c-alpha'].position.y).toBe(100);

      // Síntese de nó visual ausente c-beta
      expect(validated.visual.nodes['c-beta']).toBeDefined();
      expect(validated.visual.nodes['c-beta'].conceptId).toBe('c-beta');
      expect(validated.visual.nodes['c-beta'].position).toEqual({ x: 100, y: 100 });

      // Sanitização de aresta
      const edge = validated.visual.edges['r-test'];
      expect(edge.sourceHandle).toBeUndefined();
      expect(edge.targetHandle).toBeUndefined();
      expect(edge.arrowDirection).toBe('forward');
      expect(edge.curveType).toBe('smoothstep');
      expect(edge.manualHandles).toBe(false); // sem handles manuais válidos
      expect(edge.labelOffset?.t).toBe(0.8);
      expect(edge.labelOffset?.x).toBeUndefined();
      expect(edge.labelOffset?.y).toBeUndefined();
      expect(edge.waypoints).toEqual([
        { x: 10, y: 20 },
        { x: 40, y: 50 },
      ]);

      // Sanitização de layoutSettings e viewport
      expect(validated.visual.layoutSettings.algorithm).toBe('novak-backbone');
      expect(validated.visual.layoutSettings.direction).toBe('TB');
      expect(validated.visual.layoutSettings.nodeSpacingX).toBe(75);
      expect(validated.visual.layoutSettings.freeformCanvas).toBe(true);

      expect(validated.visual.viewport.x).toBe(0);
      expect(validated.visual.viewport.y).toBe(0);
      expect(validated.visual.viewport.zoom).toBe(1);
      expect(validated.visual.crossLinkVisibility).toBe('all');
    });

    it('rejeita com mensagem informativa entradas inválidas que não são documentos JSON', () => {
      expect(() => parseAndValidateJsonDocument('')).toThrow();
      expect(() => parseAndValidateJsonDocument('null')).toThrow('Arquivo JSON inválido');
      expect(() => parseAndValidateJsonDocument('42')).toThrow('Arquivo JSON inválido');
      expect(() => parseAndValidateJsonDocument('[]')).toThrow('Arquivo JSON inválido');
      expect(() => parseAndValidateJsonDocument('{"semantic": null}')).toThrow('Arquivo JSON inválido');
      expect(() => parseAndValidateJsonDocument('{"semantic": {}, "visual": {}}')).toThrow('Arquivo JSON inválido');
    });
  });

  // =========================================================================
  // SECTION 5: Verification of the 4 Example Files
  // =========================================================================
  describe('5. Verification of the 4 Example Files', () => {
    it('carrega e exporta exemplo.md (Mapa Conceitual Novak) com fidelidade total', async () => {
      expect(fs.existsSync(exemploMdPath)).toBe(true);
      const content = fs.readFileSync(exemploMdPath, 'utf-8');

      const parsed = parseConceptMapMarkdown(content);
      expect(parsed.metrics.totalConcepts).toBe(32);
      expect(parsed.metrics.totalRelations).toBe(46);
      expect(parsed.semantic.diagramMode).toBe('concept-map');

      const store = useConceptMapStore.getState();
      await store.loadFromMarkdown(content, 'exemplo.md');

      const state = useConceptMapStore.getState();
      expect(state.metrics.totalConcepts).toBe(32);
      expect(state.metrics.totalRelations).toBe(46);
      expect(state.visual.layoutSettings.freeformCanvas).toBe(false);

      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
      expect(svg).toContain('Projeto POP');
      expect(svg).toContain('Reserva Ducke');
      expect(svg).toContain('stroke-dasharray="8 5"'); // ligações cruzadas
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');

      // Roundtrip JSON
      const doc = store.exportDocument();
      const json = serializeDocumentToJson(doc);
      const validated = parseAndValidateJsonDocument(json);
      expect(validated.semantic.conceptOrder).toHaveLength(32);
      expect(validated.semantic.relationOrder).toHaveLength(46);
    });

    it('carrega e exporta exemplo-fluxograma.md (Fluxograma ISO/ANSI 5807) com fidelidade total', async () => {
      expect(fs.existsSync(exemploFluxoMdPath)).toBe(true);
      const content = fs.readFileSync(exemploFluxoMdPath, 'utf-8');

      const parsed = parseConceptMapMarkdown(content);
      expect(parsed.semantic.diagramMode).toBe('flowchart');

      const store = useConceptMapStore.getState();
      await store.loadFromMarkdown(content, 'exemplo-fluxograma.md');

      const state = useConceptMapStore.getState();
      expect(state.semantic.diagramMode).toBe('flowchart');

      // Verifica presença de todas as formas de fluxograma no exemplo
      const shapes = new Set(Object.values(state.semantic.concepts).map((c) => c.nodeShape));
      expect(shapes.has('terminal')).toBe(true);
      expect(shapes.has('process')).toBe(true);
      expect(shapes.has('decision')).toBe(true);
      expect(shapes.has('io')).toBe(true);
      expect(shapes.has('subroutine')).toBe(true);
      expect(shapes.has('document')).toBe(true);

      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
      expect(svg).toContain('Abertura de Pull Request');
      expect(svg).toContain('marker-end="url(#arrow-yes)"');
      expect(svg).toContain('marker-end="url(#arrow-no)"');
      expect(svg).toContain('data-shape="decision"');
      expect(svg).not.toContain('NaN');

      const doc = store.exportDocument();
      const json = serializeDocumentToJson(doc);
      const validated = parseAndValidateJsonDocument(json);
      expect(validated.semantic.diagramMode).toBe('flowchart');
    });

    it('carrega e exporta exemplo-canvas-livre.cmap.json com fidelidade total', () => {
      expect(fs.existsSync(exemploCanvasLivreJsonPath)).toBe(true);
      const rawJson = fs.readFileSync(exemploCanvasLivreJsonPath, 'utf-8');

      const validated = parseAndValidateJsonDocument(rawJson);
      expect(validated.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(validated.semantic.conceptOrder).toHaveLength(7);
      expect(validated.semantic.relationOrder).toHaveLength(10);

      const store = useConceptMapStore.getState();
      store.loadFromDocument(validated);

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);

      // Verifica as 7 formas
      const shapes = new Set(Object.values(state.semantic.concepts).map((c) => c.nodeShape));
      for (const s of ALL_7_SHAPES) {
        expect(shapes.has(s), `Forma ${s} deve estar no exemplo-canvas-livre`).toBe(true);
      }

      // Verifica as 4 direções de seta presentes nas arestas
      const directions = new Set(Object.values(state.visual.edges).map((e) => e.arrowDirection));
      for (const d of ALL_4_DIRECTIONS) {
        expect(directions.has(d), `Direção ${d} deve estar no exemplo-canvas-livre`).toBe(true);
      }

      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
      expect(svg).toContain('API Gateway');
      expect(svg).toContain('Orquestrador de Agentes de');
      expect(svg).toContain('Cluster de Inferência GPU');
      expect(svg).toContain('marker-start="url(#arrow-');
      expect(svg).toContain('marker-end="url(#arrow-');
      expect(svg).not.toContain('NaN');

      // Teste de movimentação de nó: não deve sobrescrever handles manuais
      const firstRel = Object.values(state.visual.edges).find((e) => e.manualHandles)!;
      const originalSourceHandle = firstRel.sourceHandle;
      const originalTargetHandle = firstRel.targetHandle;

      store.moveNodes([{ conceptId: 'concept-cliente-web', position: { x: 333, y: 444 } }]);
      const afterMoveRel = useConceptMapStore.getState().visual.edges[firstRel.relationId];
      expect(afterMoveRel.sourceHandle).toBe(originalSourceHandle);
      expect(afterMoveRel.targetHandle).toBe(originalTargetHandle);
      expect(afterMoveRel.manualHandles).toBe(true);
    });

    it('carrega e exporta exemplo-canvas-livre.md com fidelidade total', async () => {
      expect(fs.existsSync(exemploCanvasLivreMdPath)).toBe(true);
      const content = fs.readFileSync(exemploCanvasLivreMdPath, 'utf-8');

      const parsed = parseConceptMapMarkdown(content);
      expect(parsed.semantic.diagramMode).toBe('concept-map');

      const store = useConceptMapStore.getState();
      await store.loadFromMarkdown(content, 'exemplo-canvas-livre.md');

      const state = useConceptMapStore.getState();
      expect(state.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(state.semantic.conceptOrder.length).toBeGreaterThanOrEqual(7);

      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
      expect(svg).toContain('Aplicação Cliente');
      expect(svg).not.toContain('NaN');
    });
  });
});
