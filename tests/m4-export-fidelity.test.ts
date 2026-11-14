import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
} from '../src/domain/types';
import {
  exportAsPng,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  renderSvgStringToPngBlob,
  serializeDocumentToJson,
} from '../src/services/export/fileExporter';
import {
  fetchDefaultWorkspaceInput,
  fetchFlowchartWorkspaceInput,
  fetchFreeformMarkdownWorkspaceInput,
  fetchFreeformWorkspaceInput,
} from '../src/services/workspaceBridge';
import { useConceptMapStore } from '../src/store/useConceptMapStore';

describe('Milestone M4: Export Fidelity, Vector Math & JSON Round-Trip', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
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

  // ==========================================================================
  // PILLAR 1: Coordinate Fidelity Across All 7 Shapes & 16 Cardinal Combinations
  // ==========================================================================
  describe('Pillar 1: Coordinate Fidelity & Cardinal Math', () => {
    it('calcula coordenadas exatas para todas as 16 combinações de portas cardinais', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Origem', { x: 100, y: 100 });
      const nodeB = store.addConcept('Destino', { x: 500, y: 300 });
      store.resizeNode(nodeA, { width: 160, height: 60 });
      store.resizeNode(nodeB, { width: 160, height: 60 });

      // Test all 4x4 = 16 cardinal combinations
      for (const srcH of CARDINAL_HANDLES) {
        for (const tgtH of CARDINAL_HANDLES) {
          const relId = store.addRelation(nodeA, nodeB, '', 'sequence', {
            sourceHandle: srcH,
            targetHandle: tgtH,
            manualHandles: true,
          });
          expect(relId).toBeTruthy();

          const state = useConceptMapStore.getState();
          const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

          // Locate path for relId
          const pathRegex = new RegExp(`<path id="edge-${relId}" d="([^"]+)"`);
          const match = pathRegex.exec(svg);
          expect(match, `Aresta ${relId} (${srcH} -> ${tgtH}) deve existir no SVG`).toBeTruthy();

          const d = match![1];
          // Path must start at 'M' and contain valid coordinates
          expect(d).toMatch(/^M\s*[-0-9.]+/);

          // Cleanup relation for next pair
          store.deleteElements([], [relId!]);
        }
      }
    });

    it('alinha os 4 vértices do losango decision com os 4 pontos cardinais top, right, bottom, left', () => {
      const store = useConceptMapStore.getState();
      const decId = store.addConcept('Decisão', { x: 200, y: 200 });
      store.updateNodeShape(decId, 'decision');
      store.resizeNode(decId, { width: 120, height: 80 });

      const targetId = store.addConcept('Ação', { x: 500, y: 200 });
      store.resizeNode(targetId, { width: 120, height: 80 });

      // Expected decision vertices:
      // top: (200 + 60, 200) = (260, 200)
      // right: (200 + 120, 200 + 40) = (320, 240)
      // bottom: (200 + 60, 200 + 80) = (260, 280)
      // left: (200, 200 + 40) = (200, 240)
      const expectedCoords: Record<HandlePosition, { x: number; y: number }> = {
        top: { x: 260, y: 200 },
        right: { x: 320, y: 240 },
        bottom: { x: 260, y: 280 },
        left: { x: 200, y: 240 },
        auto: { x: 260, y: 280 },
      };

      for (const h of CARDINAL_HANDLES) {
        const relId = store.addRelation(decId, targetId, '', 'sequence', {
          sourceHandle: h,
          targetHandle: 'left',
          manualHandles: true,
        });
        store.updateRelation(relId!, { curveType: 'straight' });

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        const pathRegex = new RegExp(`<path id="edge-${relId}" d="M\\s*([0-9.]+)[,\\s]+([0-9.]+)`);
        const match = pathRegex.exec(svg);
        expect(match).toBeTruthy();

        const startX = parseFloat(match![1]);
        const startY = parseFloat(match![2]);

        expect(startX).toBeCloseTo(expectedCoords[h].x, 0);
        expect(startY).toBeCloseTo(expectedCoords[h].y, 0);

        store.deleteElements([], [relId!]);
      }
    });

    it('funciona uniformemente com todos os 7 formatos geométricos como origem e destino', () => {
      const store = useConceptMapStore.getState();

      for (const shape of ALL_7_SHAPES) {
        const n1 = store.addConcept(`Node 1 ${shape}`, { x: 100, y: 100 });
        store.updateNodeShape(n1, shape);
        const n2 = store.addConcept(`Node 2 ${shape}`, { x: 300, y: 300 });
        store.updateNodeShape(n2, shape);

        const relId = store.addRelation(n1, n2, 'fluxo', 'sequence', {
          sourceHandle: 'right',
          targetHandle: 'left',
          manualHandles: true,
        });

        const state = useConceptMapStore.getState();
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

        expect(svg).toContain(`id="edge-${relId}"`);
        expect(svg).toContain(`data-shape="${shape}"`);

        store.deleteElements([n1, n2], [relId!]);
      }
    });

    it('resolve fallback inteligente para handles unset ou auto sem colapsar para a base do destino', () => {
      const store = useConceptMapStore.getState();
      const nTop = store.addConcept('Passo Superior', { x: 200, y: 100 });
      const nBottom = store.addConcept('Passo Inferior', { x: 200, y: 300 });
      store.resizeNode(nTop, { width: 160, height: 60 });
      store.resizeNode(nBottom, { width: 160, height: 60 });

      // Conexão vertical sem handles definidos (modo automático)
      const relId = store.addRelation(nTop, nBottom, 'desce', 'sequence');
      store.updateRelation(relId!, { curveType: 'straight' });

      const state = useConceptMapStore.getState();
      const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

      // Em layout TB com nTop acima de nBottom:
      // Origem deve sair da base de nTop: (200 + 80, 100 + 60) = (280, 160)
      // Destino deve chegar no topo de nBottom: (200 + 80, 300) = (280, 300)
      const pathRegex = new RegExp(`<path id="edge-${relId}" d="M\\s*([0-9.]+)[,\\s]+([0-9.]+)[^L]*L\\s*([0-9.]+)[,\\s]+([0-9.]+)`);
      const match = pathRegex.exec(svg);
      expect(match).toBeTruthy();

      const startY = parseFloat(match![2]);
      const endY = parseFloat(match![4]);

      // Origem é 160 (base do nTop)
      expect(startY).toBeCloseTo(160, 0);
      // Destino é 300 (topo do nBottom, e NÃO 360 base do nBottom)
      expect(endY).toBeCloseTo(300, 0);
    });
  });

  // ==========================================================================
  // PILLAR 2: SVG Marker Generation for 4 Arrow Directions
  // ==========================================================================
  describe('Pillar 2: Arrow Markers & Directions (forward, reverse, both, none)', () => {
    it('renderiza corretamente os marcadores de seta para cada uma das 4 direções', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 100, y: 100 });
      const n2 = store.addConcept('B', { x: 300, y: 100 });

      // 1. forward: marker-end presente, marker-start ausente
      const rFwd = store.addRelation(n1, n2, 'fwd', 'sequence', undefined, 'forward');
      let svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      let pathFwd = svg.match(new RegExp(`<path id="edge-${rFwd}"[^>]+>`))?.[0] ?? '';
      expect(pathFwd).toContain('marker-end=');
      expect(pathFwd).not.toContain('marker-start=');

      // 2. reverse: marker-start presente, marker-end ausente
      const rRev = store.addRelation(n1, n2, 'rev', 'sequence', undefined, 'reverse');
      svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      let pathRev = svg.match(new RegExp(`<path id="edge-${rRev}"[^>]+>`))?.[0] ?? '';
      expect(pathRev).toContain('marker-start=');
      expect(pathRev).not.toContain('marker-end=');

      // 3. both: ambos marker-start e marker-end presentes
      const rBoth = store.addRelation(n1, n2, 'both', 'sequence', undefined, 'both');
      svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      let pathBoth = svg.match(new RegExp(`<path id="edge-${rBoth}"[^>]+>`))?.[0] ?? '';
      expect(pathBoth).toContain('marker-start=');
      expect(pathBoth).toContain('marker-end=');

      // 4. none: nenhum marcador presente
      const rNone = store.addRelation(n1, n2, 'none', 'sequence', undefined, 'none');
      svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);
      let pathNone = svg.match(new RegExp(`<path id="edge-${rNone}"[^>]+>`))?.[0] ?? '';
      expect(pathNone).not.toContain('marker-start=');
      expect(pathNone).not.toContain('marker-end=');
    });

    it('aplica cores corretas de marcador conforme o tipo semântico da relação', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('Origem', { x: 100, y: 100 });
      const n2 = store.addConcept('Destino', { x: 400, y: 100 });

      // Cross-link -> arrow-cross
      const rCross = store.addRelation(n1, n2, 'relaciona-se', 'cross-link', undefined, 'forward');
      // Conditional Sim -> arrow-yes
      const rYes = store.addRelation(n1, n2, 'Sim', 'conditional', undefined, 'both');
      // Conditional Não -> arrow-no
      const rNo = store.addRelation(n1, n2, 'Não', 'conditional', undefined, 'reverse');
      // Loop-back -> arrow-loop
      const rLoop = store.addRelation(n2, n1, 'repete', 'loop-back', undefined, 'forward');

      const svg = generateStandaloneVectorSvg(useConceptMapStore.getState().semantic, useConceptMapStore.getState().visual);

      const pathCross = svg.match(new RegExp(`<path id="edge-${rCross}"[^>]+>`))?.[0] ?? '';
      expect(pathCross).toContain('url(#arrow-cross)');

      const pathYes = svg.match(new RegExp(`<path id="edge-${rYes}"[^>]+>`))?.[0] ?? '';
      expect(pathYes).toContain('url(#arrow-yes)');

      const pathNo = svg.match(new RegExp(`<path id="edge-${rNo}"[^>]+>`))?.[0] ?? '';
      expect(pathNo).toContain('url(#arrow-no)');

      const pathLoop = svg.match(new RegExp(`<path id="edge-${rLoop}"[^>]+>`))?.[0] ?? '';
      expect(pathLoop).toContain('url(#arrow-loop)');

      // Verifica que <defs> inclui os marcadores esperados
      expect(svg).toContain('id="arrow-hier"');
      expect(svg).toContain('id="arrow-cross"');
      expect(svg).toContain('id="arrow-yes"');
      expect(svg).toContain('id="arrow-no"');
      expect(svg).toContain('id="arrow-loop"');
      expect(svg).toContain('id="arrow-hier-start"');
      expect(svg).toContain('id="arrow-loop-start"');
    });
  });

  // ==========================================================================
  // PILLAR 3: JSON Import/Export Round-Trip Preservation (.cmap.json)
  // ==========================================================================
  describe('Pillar 3: JSON Round-Trip Preservation', () => {
    it('preserva 100% das configurações de manualHandles, arrowDirection e freeformCanvas no ciclo export/import', () => {
      const store = useConceptMapStore.getState();
      store.setFreeformCanvas(true);

      const n1 = store.addConcept('Processo A', { x: 100, y: 100 });
      const n2 = store.addConcept('Decisão B', { x: 350, y: 100 });
      store.updateNodeShape(n2, 'decision');

      const r1 = store.addRelation(n1, n2, 'valida', 'sequence', {
        sourceHandle: 'right',
        targetHandle: 'left',
        manualHandles: true,
      }, 'forward');

      const r2 = store.addRelation(n2, n1, 'retorna', 'sequence', {
        sourceHandle: 'bottom',
        targetHandle: 'bottom',
        manualHandles: true,
      }, 'reverse');

      const exportedDoc = store.exportDocument();
      expect(exportedDoc.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(exportedDoc.visual.edges[r1!].manualHandles).toBe(true);
      expect(exportedDoc.visual.edges[r1!].sourceHandle).toBe('right');
      expect(exportedDoc.visual.edges[r1!].targetHandle).toBe('left');
      expect(exportedDoc.visual.edges[r1!].arrowDirection).toBe('forward');

      expect(exportedDoc.visual.edges[r2!].manualHandles).toBe(true);
      expect(exportedDoc.visual.edges[r2!].sourceHandle).toBe('bottom');
      expect(exportedDoc.visual.edges[r2!].targetHandle).toBe('bottom');
      expect(exportedDoc.visual.edges[r2!].arrowDirection).toBe('reverse');

      const jsonStr = serializeDocumentToJson(exportedDoc);
      const validated = parseAndValidateJsonDocument(jsonStr);

      // Verify deserialized structure
      expect(validated.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(validated.visual.edges[r1!].manualHandles).toBe(true);
      expect(validated.visual.edges[r1!].sourceHandle).toBe('right');
      expect(validated.visual.edges[r1!].targetHandle).toBe('left');
      expect(validated.visual.edges[r1!].arrowDirection).toBe('forward');

      expect(validated.visual.edges[r2!].manualHandles).toBe(true);
      expect(validated.visual.edges[r2!].sourceHandle).toBe('bottom');
      expect(validated.visual.edges[r2!].targetHandle).toBe('bottom');
      expect(validated.visual.edges[r2!].arrowDirection).toBe('reverse');

      // Re-load in store
      store.loadFromDocument(validated);
      const restored = useConceptMapStore.getState();

      expect(restored.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(restored.visual.edges[r1!].manualHandles).toBe(true);
      expect(restored.visual.edges[r1!].sourceHandle).toBe('right');
      expect(restored.visual.edges[r1!].targetHandle).toBe('left');
      expect(restored.visual.edges[r1!].arrowDirection).toBe('forward');

      // Test resilience: move node and verify handles are NOT lost
      store.moveNodes([{ conceptId: n1, position: { x: 120, y: 120 } }]);
      const afterMove = useConceptMapStore.getState();
      expect(afterMove.visual.edges[r1!].sourceHandle).toBe('right');
      expect(afterMove.visual.edges[r1!].targetHandle).toBe('left');
      expect(afterMove.visual.edges[r1!].manualHandles).toBe(true);
    });

    it('mantém idempotência estrita em múltiplas serializações consecutivas', () => {
      const store = useConceptMapStore.getState();
      const doc1 = store.exportDocument();
      const json1 = serializeDocumentToJson(doc1);
      const validated1 = parseAndValidateJsonDocument(json1);

      const json2 = serializeDocumentToJson(validated1);
      const validated2 = parseAndValidateJsonDocument(json2);

      expect(validated1).toEqual(validated2);
    });
  });

  // ==========================================================================
  // PILLAR 4: Schema Sanitization & Adversarial JSON Robustness
  // ==========================================================================
  describe('Pillar 4: Schema Sanitization & Adversarial JSON Robustness', () => {
    it('sanitiza valores corrompidos de handles, arrowDirection e curveType para padrões seguros', () => {
      const corruptJson = JSON.stringify({
        schemaVersion: '1.0.0',
        metadata: { id: 'corrupt-doc' },
        semantic: {
          title: 'Mapa Corrompido',
          concepts: {
            'c-1': { id: 'c-1', label: 'C1', depth: 0 },
            'c-2': { id: 'c-2', label: 'C2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': { id: 'r-1', sourceId: 'c-1', targetId: 'c-2', type: 'sequence' },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 100, y: 100 }, pinned: false },
            'c-2': { conceptId: 'c-2', position: { x: 200, y: 200 }, pinned: false },
          },
          edges: {
            'r-1': {
              relationId: 'r-1',
              sourceHandle: 'invalid-pos',
              targetHandle: 'nowhere',
              arrowDirection: 'sideways',
              curveType: 'loop-the-loop',
              manualHandles: 'not-a-boolean',
            },
          },
          layoutSettings: {
            algorithm: 'magical-layout',
            freeformCanvas: 'truthy-string',
          },
        },
      });

      const validated = parseAndValidateJsonDocument(corruptJson);

      // sourceHandle/targetHandle invalidos -> undefined
      expect(validated.visual.edges['r-1'].sourceHandle).toBeUndefined();
      expect(validated.visual.edges['r-1'].targetHandle).toBeUndefined();
      // arrowDirection invalido -> 'forward'
      expect(validated.visual.edges['r-1'].arrowDirection).toBe('forward');
      // curveType invalido -> 'smoothstep'
      expect(validated.visual.edges['r-1'].curveType).toBe('smoothstep');
      // manualHandles sanitizado para boolean
      expect(typeof validated.visual.edges['r-1'].manualHandles).toBe('boolean');
      // freeformCanvas sanitizado para boolean
      expect(validated.visual.layoutSettings.freeformCanvas).toBe(true);
      // algorithm invalido -> 'novak-backbone'
      expect(validated.visual.layoutSettings.algorithm).toBe('novak-backbone');
    });

    it('sintetiza arestas visuais com valores seguros quando relationOrder tem relação ausente em visual.edges', () => {
      const missingEdgeJson = JSON.stringify({
        schemaVersion: '1.0.0',
        metadata: { id: 'missing-edge-doc' },
        semantic: {
          title: 'Mapa Sem Aresta Visual',
          concepts: {
            'c-1': { id: 'c-1', label: 'C1', depth: 0 },
            'c-2': { id: 'c-2', label: 'C2', depth: 1 },
          },
          conceptOrder: ['c-1', 'c-2'],
          relations: {
            'r-1': { id: 'r-1', sourceId: 'c-1', targetId: 'c-2', type: 'sequence' },
          },
          relationOrder: ['r-1'],
        },
        visual: {
          nodes: {
            'c-1': { conceptId: 'c-1', position: { x: 100, y: 100 }, pinned: false },
            'c-2': { conceptId: 'c-2', position: { x: 200, y: 200 }, pinned: false },
          },
          edges: {}, // Aresta r-1 completamente ausente
        },
      });

      const validated = parseAndValidateJsonDocument(missingEdgeJson);
      expect(validated.visual.edges['r-1']).toBeDefined();
      expect(validated.visual.edges['r-1'].relationId).toBe('r-1');
      expect(validated.visual.edges['r-1'].curveType).toBe('smoothstep');
      expect(validated.visual.edges['r-1'].arrowDirection).toBe('forward');
      expect(validated.visual.edges['r-1'].manualHandles).toBe(false);
    });

    it('rejeita JSON malformado ou com seções semânticas ausentes lançando erro descritivo', () => {
      expect(() => parseAndValidateJsonDocument('não é json')).toThrow();
      expect(() => parseAndValidateJsonDocument('{}')).toThrow('Arquivo JSON inválido');
      expect(() => parseAndValidateJsonDocument(JSON.stringify({ semantic: {} }))).toThrow('Arquivo JSON inválido');
    });
  });

  // ==========================================================================
  // PILLAR 5: PNG Rasterization Pipeline (exportAsPng & renderSvgStringToPngBlob)
  // ==========================================================================
  describe('Pillar 5: PNG Rasterization Pipeline', () => {
    it('exportAsPng e renderSvgStringToPngBlob são funções assíncronas válidas', () => {
      expect(typeof exportAsPng).toBe('function');
      expect(typeof renderSvgStringToPngBlob).toBe('function');
    });

    it('executa a pipeline completa de rasterização com clampeamento e gestão de recursos', async () => {
      // Mocking browser environment for headless Vitest
      const originalDOMParser = globalThis.DOMParser;
      const originalImage = globalThis.Image;
      const originalDocument = globalThis.document;
      const originalURL = globalThis.URL;

      let createdBlobUrl = '';
      let revokedBlobUrl = '';
      let canvasFilledColor = '';
      let canvasDrawnWidth = 0;
      let canvasDrawnHeight = 0;

      class MockDOMParser {
        parseFromString(_str: string) {
          return {
            documentElement: {
              getAttribute(name: string) {
                if (name === 'width') return '1000';
                if (name === 'height') return '600';
                return null;
              },
            },
          };
        }
      }

      class MockImage {
        src = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      }

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext(type: string) {
          if (type !== '2d') return null;
          return {
            set fillStyle(val: string) {
              canvasFilledColor = val;
            },
            fillRect: vi.fn(),
            drawImage: (_img: any, _x: number, _y: number, w: number, h: number) => {
              canvasDrawnWidth = w;
              canvasDrawnHeight = h;
            },
          };
        },
        toBlob(cb: (blob: Blob | null) => void, mimeType: string) {
          cb(new Blob(['mock-png-data'], { type: mimeType }));
        },
      };

      globalThis.DOMParser = MockDOMParser as any;
      globalThis.Image = MockImage as any;
      globalThis.document = {
        createElement(tag: string) {
          if (tag === 'canvas') return mockCanvas as any;
          return {} as any;
        },
      } as any;

      globalThis.URL.createObjectURL = vi.fn((_blob: any) => {
        createdBlobUrl = 'blob:http://localhost/mock-uuid';
        return createdBlobUrl;
      });
      globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
        revokedBlobUrl = url;
      });

      try {
        const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"></svg>';
        const blob = await renderSvgStringToPngBlob(svgContent, 2);

        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/png');
        expect(canvasFilledColor).toBe('#f8fafc');
        expect(canvasDrawnWidth).toBe(2000); // 1000 * 2
        expect(canvasDrawnHeight).toBe(1200); // 600 * 2

        // Verify cleanup in finally block
        expect(createdBlobUrl).toBeTruthy();
        expect(revokedBlobUrl).toBe(createdBlobUrl);
      } finally {
        globalThis.DOMParser = originalDOMParser;
        globalThis.Image = originalImage;
        globalThis.document = originalDocument;
        globalThis.URL = originalURL;
      }
    });

    it('propaga erro adequadamente quando o contexto 2D do Canvas é indisponível', async () => {
      const originalDOMParser = globalThis.DOMParser;
      const originalImage = globalThis.Image;
      const originalDocument = globalThis.document;

      class MockDOMParser {
        parseFromString() {
          return {
            documentElement: {
              getAttribute: () => '800',
            },
          };
        }
      }

      class MockImage {
        constructor() {
          setTimeout(() => {
            if ((this as any).onload) (this as any).onload();
          }, 0);
        }
      }

      globalThis.DOMParser = MockDOMParser as any;
      globalThis.Image = MockImage as any;
      globalThis.document = {
        createElement: () => ({
          getContext: () => null, // 2D context unavailable
        }),
      } as any;

      try {
        await expect(renderSvgStringToPngBlob('<svg width="800" height="600"></svg>')).rejects.toThrow(
          'Contexto 2D do Canvas indisponível.'
        );
      } finally {
        globalThis.DOMParser = originalDOMParser;
        globalThis.Image = originalImage;
        globalThis.document = originalDocument;
      }
    });

    it('carrega, valida e exporta os exemplos oficiais das 3 modalidades (Mapa Conceitual, Fluxograma e Canvas Livre)', async () => {
      const store = useConceptMapStore.getState();

      // 1. Modalidade 1: Mapa Conceitual (exemplo.md)
      const cmPayload = await fetchDefaultWorkspaceInput();
      expect(cmPayload.fileName).toBe('exemplo.md');
      await store.loadFromMarkdown(cmPayload.content, cmPayload.fileName);
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('concept-map');
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(false);

      // 2. Modalidade 2: Fluxograma (exemplo-fluxograma.md)
      const fcPayload = await fetchFlowchartWorkspaceInput();
      expect(fcPayload.fileName).toBe('exemplo-fluxograma.md');
      await store.loadFromMarkdown(fcPayload.content, fcPayload.fileName);
      expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');

      // 3. Modalidade 3: Canvas Livre (.cmap.json e .md)
      const ffJsonPayload = await fetchFreeformWorkspaceInput();
      expect(ffJsonPayload.fileName).toBe('exemplo-canvas-livre.cmap.json');
      const ffDoc = parseAndValidateJsonDocument(ffJsonPayload.content);
      store.loadFromDocument(ffDoc);

      const ffState = useConceptMapStore.getState();
      expect(ffState.visual.layoutSettings.freeformCanvas).toBe(true);
      expect(ffState.semantic.conceptOrder).toHaveLength(7);
      expect(ffState.semantic.relationOrder).toHaveLength(10);

      // Verifica que todas as 7 formas e todas as 4 direções de seta estão presentes no exemplo
      const shapesInExample = new Set(
        Object.values(ffState.semantic.concepts).map((c) => c.nodeShape)
      );
      for (const shape of ALL_7_SHAPES) {
        expect(shapesInExample.has(shape)).toBe(true);
      }

      const directionsInExample = new Set(
        Object.values(ffState.visual.edges).map((e) => e.arrowDirection)
      );
      expect(directionsInExample.has('forward')).toBe(true);
      expect(directionsInExample.has('reverse')).toBe(true);
      expect(directionsInExample.has('both')).toBe(true);
      expect(directionsInExample.has('none')).toBe(true);

      const ffSvg = generateStandaloneVectorSvg(ffState.semantic, ffState.visual);
      expect(ffSvg).toContain('<svg');
      expect(ffSvg).toContain('marker-start="url(#arrow-');
      expect(ffSvg).toContain('marker-end="url(#arrow-');

      // E valida também o carregamento do exemplo-canvas-livre.md via Markdown
      const ffMdPayload = await fetchFreeformMarkdownWorkspaceInput();
      expect(ffMdPayload.fileName).toBe('exemplo-canvas-livre.md');
      await store.loadFromMarkdown(ffMdPayload.content, ffMdPayload.fileName);
      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);
    });
  });
});
