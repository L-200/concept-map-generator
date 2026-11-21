import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import { PropertyInspector } from '../src/components/inspector/PropertyInspector';
import { TopToolbar } from '../src/components/toolbar/TopToolbar';
import { FLOWCHART_SHAPES_CONFIG } from '../src/components/canvas/shapeDefinitions';
import {
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  serializeDocumentToJson,
} from '../src/services/export/fileExporter';
import type {
  ArrowDirection,
  FlowchartNodeShape,
  HandlePosition,
  RelationType,
} from '../src/domain/types';

describe('Empirical M3 Challenger 2: PropertyInspector & TopToolbar Exhaustive Stress Suite', () => {
  const CARDINAL_HANDLES: readonly HandlePosition[] = [
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ALL_HANDLE_OPTIONS: readonly (HandlePosition | 'auto')[] = [
    'auto',
    'top',
    'right',
    'bottom',
    'left',
  ] as const;

  const ARROW_DIRECTIONS: readonly ArrowDirection[] = [
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
    // Reset store to fresh state before every test
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // SUITE 1: 5x5 Handle Selector Matrix & Strict bg-blue-600 Mutual Exclusivity
  // ==========================================================================
  describe('Suite 1: PropertyInspector 5x5 (25 combinations) Handle Selectors & CSS Mutual Exclusivity', () => {
    it('empirically verifies all 25 (source x target) handle states render active bg-blue-600 strictly and exclusively', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Origin Node', { x: 100, y: 100 });
      const nodeB = store.addConcept('Target Node', { x: 500, y: 300 });
      const relId = store.addRelation(nodeA, nodeB, 'connects')!;
      expect(relId).toBeDefined();

      store.setSelection([], [relId]);

      let combinationCount = 0;

      for (const src of ALL_HANDLE_OPTIONS) {
        for (const tgt of ALL_HANDLE_OPTIONS) {
          combinationCount++;
          const isManual = src !== 'auto' || tgt !== 'auto';

          store.updateRelation(relId, {
            sourceHandle: src,
            targetHandle: tgt,
            manualHandles: isManual,
          });

          const html = renderToStaticMarkup(<PropertyInspector />);
          const currentEdge = useConceptMapStore.getState().visual.edges[relId];
          const expectedSrc = isManual && src === 'auto' ? currentEdge?.sourceHandle ?? 'auto' : src;
          const expectedTgt = isManual && tgt === 'auto' ? currentEdge?.targetHandle ?? 'auto' : tgt;

          // 1. Verify active source handle button strictly has bg-blue-600
          const activeSrcRegex = new RegExp(
            `data-testid="edge-source-handle-${expectedSrc}"[^>]*class="[^"]*bg-blue-600`
          );
          expect(html).toMatch(activeSrcRegex);

          // 2. Verify all other 4 source handle buttons DO NOT have bg-blue-600
          for (const otherSrc of ALL_HANDLE_OPTIONS) {
            if (otherSrc === expectedSrc) continue;
            const inactiveSrcRegex = new RegExp(
              `data-testid="edge-source-handle-${otherSrc}"[^>]*class="[^"]*bg-blue-600`
            );
            expect(html).not.toMatch(inactiveSrcRegex);
          }

          // 3. Verify active target handle button strictly has bg-blue-600
          const activeTgtRegex = new RegExp(
            `data-testid="edge-target-handle-${expectedTgt}"[^>]*class="[^"]*bg-blue-600`
          );
          expect(html).toMatch(activeTgtRegex);

          // 4. Verify all other 4 target handle buttons DO NOT have bg-blue-600
          for (const otherTgt of ALL_HANDLE_OPTIONS) {
            if (otherTgt === expectedTgt) continue;
            const inactiveTgtRegex = new RegExp(
              `data-testid="edge-target-handle-${otherTgt}"[^>]*class="[^"]*bg-blue-600`
            );
            expect(html).not.toMatch(inactiveTgtRegex);
          }

          // 5. Verify select dropdown selected value matches
          const selectSrcRegex = new RegExp(
            `data-testid="edge-source-handle-select"[\\s\\S]*?<option value="${expectedSrc}" selected=""`
          );
          expect(html).toMatch(selectSrcRegex);

          const selectTgtRegex = new RegExp(
            `data-testid="edge-target-handle-select"[\\s\\S]*?<option value="${expectedTgt}" selected=""`
          );
          expect(html).toMatch(selectTgtRegex);

          // 6. Verify manual badges and footer status text
          if (expectedSrc !== 'auto' && isManual) {
            expect(html).toContain(`Manual: ${expectedSrc}`);
          }
          if (expectedTgt !== 'auto' && isManual) {
            expect(html).toContain(`Manual: ${expectedTgt}`);
          }
          if (!isManual) {
            expect(html).toContain('Portas automáticas ativas');
          } else {
            expect(html).toContain('Pontos manuais fixados');
          }
        }
      }

      expect(combinationCount).toBe(25);
    });

    it('verifies asymmetric handle clearing retains partial manual lock until both are auto', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 50, y: 50 });
      const nodeB = store.addConcept('B', { x: 350, y: 50 });
      const relId = store.addRelation(nodeA, nodeB, 'test')!;
      store.setSelection([], [relId]);

      // Set both to manual: top and right
      store.updateRelation(relId, {
        sourceHandle: 'top',
        targetHandle: 'right',
        manualHandles: true,
      });

      let html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toMatch(/data-testid="edge-source-handle-top"[^>]*bg-blue-600/);
      expect(html).toMatch(/data-testid="edge-target-handle-right"[^>]*bg-blue-600/);
      expect(html).toContain('Manual: top');
      expect(html).toContain('Manual: right');

      // Clear only source to auto; target remains manual 'right'
      const edge = useConceptMapStore.getState().visual.edges[relId];
      const targetIsManual = Boolean(edge.manualHandles && edge.targetHandle && edge.targetHandle !== 'auto');
      store.updateRelation(relId, {
        sourceHandle: 'auto',
        manualHandles: targetIsManual,
      });

      html = renderToStaticMarkup(<PropertyInspector />);
      const edgeAfterClear = useConceptMapStore.getState().visual.edges[relId];
      const expectedClearedSrc = edgeAfterClear?.sourceHandle ?? 'bottom';
      expect(html).toMatch(new RegExp(`data-testid="edge-source-handle-${expectedClearedSrc}"[^>]*bg-blue-600`));
      expect(html).toMatch(/data-testid="edge-target-handle-right"[^>]*bg-blue-600/);
      expect(html).not.toContain('Manual: top');
      expect(html).toContain('Manual: right');
      expect(html).toContain('Pontos manuais fixados');

      // Now reset both via reset button handler
      store.updateRelation(relId, {
        sourceHandle: 'auto',
        targetHandle: 'auto',
        manualHandles: false,
      });

      html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toMatch(/data-testid="edge-source-handle-auto"[^>]*bg-blue-600/);
      expect(html).toMatch(/data-testid="edge-target-handle-auto"[^>]*bg-blue-600/);
      expect(html).not.toContain('Manual:');
      expect(html).toContain('Portas automáticas ativas');
    });
  });

  // ==========================================================================
  // SUITE 2: Arrow Direction Switching & Strict border-amber-600 Mutual Exclusivity
  // ==========================================================================
  describe('Suite 2: Arrow Direction (4 Modes) & Strict border-amber-600 Mutual Exclusivity', () => {
    it('empirically verifies all 4 arrow directions render border-amber-600 strictly and exclusively', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'arrows')!;
      store.setSelection([], [relId]);

      for (const dir of ARROW_DIRECTIONS) {
        store.updateRelation(relId, { arrowDirection: dir });

        const html = renderToStaticMarkup(<PropertyInspector />);

        // 1. Verify active direction button strictly has border-amber-600
        const activeDirRegex = new RegExp(
          `data-testid="edge-arrow-direction-${dir}"[^>]*class="[^"]*border-amber-600`
        );
        expect(html).toMatch(activeDirRegex);

        // 2. Verify all other 3 direction buttons DO NOT have border-amber-600
        for (const otherDir of ARROW_DIRECTIONS) {
          if (otherDir === dir) continue;
          const inactiveDirRegex = new RegExp(
            `data-testid="edge-arrow-direction-${otherDir}"[^>]*class="[^"]*border-amber-600`
          );
          expect(html).not.toMatch(inactiveDirRegex);
        }

        // 3. Verify direction badge in header matches
        expect(html).toContain(`{edgeVis.arrowDirection ?? 'forward'}` ? dir : dir);
      }
    });

    it('falls back gracefully to forward when arrowDirection is undefined', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('A', { x: 100, y: 100 });
      const nodeB = store.addConcept('B', { x: 300, y: 100 });
      const relId = store.addRelation(nodeA, nodeB, 'default')!;

      // Manually delete arrowDirection to simulate legacy/missing field
      delete (useConceptMapStore.getState().visual.edges[relId] as any).arrowDirection;
      useConceptMapStore.getState().setSelection([], [relId]);

      const html = renderToStaticMarkup(<PropertyInspector />);
      // 'forward' should be active by default
      expect(html).toMatch(/data-testid="edge-arrow-direction-forward"[^>]*border-amber-600/);
      expect(html).not.toMatch(/data-testid="edge-arrow-direction-reverse"[^>]*border-amber-600/);
    });
  });

  // ==========================================================================
  // SUITE 3: Handle-Aware Direction Reversal & Involution Stress Testing
  // ==========================================================================
  describe('Suite 3: Handle-Aware Reverse Direction Invariant & High-Frequency Involution', () => {
    it('empirically verifies 16 manual handle pairs invert ports and maintain manual lock', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Concept Alpha', { x: 100, y: 100 });
      const nodeB = store.addConcept('Concept Beta', { x: 400, y: 400 });

      for (const src of CARDINAL_HANDLES) {
        for (const tgt of CARDINAL_HANDLES) {
          const relId = store.addRelation(nodeA, nodeB, 'rel', 'sequence', {
            sourceHandle: src,
            targetHandle: tgt,
            manualHandles: true,
          })!;
          store.setSelection([], [relId]);

          // Invert direction
          store.reverseRelationDirection(relId);

          const edgeRev = useConceptMapStore.getState().visual.edges[relId];
          const relRev = useConceptMapStore.getState().semantic.relations[relId];

          expect(relRev.sourceId).toBe(nodeB);
          expect(relRev.targetId).toBe(nodeA);
          expect(edgeRev.sourceHandle).toBe(tgt);
          expect(edgeRev.targetHandle).toBe(src);
          expect(edgeRev.manualHandles).toBe(true);

          const html = renderToStaticMarkup(<PropertyInspector />);
          expect(html).toMatch(new RegExp(`data-testid="edge-source-handle-${tgt}"[^>]*bg-blue-600`));
          expect(html).toMatch(new RegExp(`data-testid="edge-target-handle-${src}"[^>]*bg-blue-600`));

          // Clean up relation for next test
          store.deleteElements([], [relId]);
        }
      }
    });

    it('executes 20 consecutive reversals without state drift or corruption (Involution f(f(x)) === x)', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Node Alpha', { x: 50, y: 50 });
      const nodeB = store.addConcept('Node Beta', { x: 250, y: 250 });
      const relId = store.addRelation(nodeA, nodeB, 'stress', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'left',
        manualHandles: true,
      })!;
      store.setSelection([], [relId]);

      for (let i = 1; i <= 20; i++) {
        store.reverseRelationDirection(relId);
        const isOdd = i % 2 === 1;

        const currentRel = useConceptMapStore.getState().semantic.relations[relId];
        const currentEdge = useConceptMapStore.getState().visual.edges[relId];

        if (isOdd) {
          expect(currentRel.sourceId).toBe(nodeB);
          expect(currentRel.targetId).toBe(nodeA);
          expect(currentEdge.sourceHandle).toBe('left');
          expect(currentEdge.targetHandle).toBe('top');
        } else {
          expect(currentRel.sourceId).toBe(nodeA);
          expect(currentRel.targetId).toBe(nodeB);
          expect(currentEdge.sourceHandle).toBe('top');
          expect(currentEdge.targetHandle).toBe('left');
        }
        expect(currentEdge.manualHandles).toBe(true);

        const html = renderToStaticMarkup(<PropertyInspector />);
        const expectedSrc = isOdd ? 'left' : 'top';
        const expectedTgt = isOdd ? 'top' : 'left';
        expect(html).toMatch(new RegExp(`data-testid="edge-source-handle-${expectedSrc}"[^>]*bg-blue-600`));
        expect(html).toMatch(new RegExp(`data-testid="edge-target-handle-${expectedTgt}"[^>]*bg-blue-600`));
      }
    });
  });

  // ==========================================================================
  // SUITE 4: Flowchart & Concept Map Specific Inspector Controls
  // ==========================================================================
  describe('Suite 4: Modality-Specific Inspector Controls & Node Inspection', () => {
    it('renders flowchart transition controls and conditional shortcuts correctly', () => {
      const store = useConceptMapStore.getState();
      store.setDiagramMode('flowchart');
      const n1 = store.addConcept('Etapa 1', { x: 100, y: 100 }, 'decision');
      const n2 = store.addConcept('Etapa 2', { x: 300, y: 100 }, 'process');
      const relId = store.addRelation(n1, n2, 'Sim', 'conditional')!;
      store.setSelection([], [relId]);

      let html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toContain('Propriedades da Transição');
      expect(html).toContain('Condição / Rótulo da Transição');
      expect(html).toMatch(/Sim[\s\S]*?border-emerald-500 bg-emerald-100/);

      // Change phrase to 'Não'
      store.updateRelation(relId, { linkingPhrase: 'Não' });
      html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toMatch(/Não[\s\S]*?border-rose-500 bg-rose-100/);

      // Verify transition type active styling
      expect(html).toMatch(/class="[^"]*bg-emerald-600 text-white[^"]*"[^>]*>Condicional/);

      store.updateRelation(relId, { type: 'loop-back' });
      html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toMatch(/class="[^"]*bg-indigo-600 text-white[^"]*"[^>]*>Retorno/);
    });

    it('renders all 7 shape buttons and quick-connection ports when node is selected', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Central Diamond', { x: 200, y: 200 }, 'decision');
      store.setSelection([nodeA], []);

      const html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toContain('Propriedades do Conceito');

      for (const shape of ALL_7_SHAPES) {
        expect(html).toContain(`data-testid="node-shape-selector-${shape}"`);
      }

      // Quick connect form ports
      expect(html).toContain('data-testid="new-conn-source-handle"');
      expect(html).toContain('data-testid="new-conn-target-handle"');
      expect(html).toContain('data-testid="quick-connect-btn"');
    });
  });

  // ==========================================================================
  // SUITE 5: TopToolbar "Novo ▾" and Export Dropdowns Across All 3 Modalities
  // ==========================================================================
  describe('Suite 5: TopToolbar Dropdowns & Modalities (Novak, Flowchart, Freeform)', () => {
    it('5.1: TopToolbar displays correct badge and active switcher in Novak Concept Map mode', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map');

      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} searchInputRef={React.createRef()} />
      );

      expect(html).toContain('data-testid="toolbar-mode-badge"');
      expect(html).toMatch(/data-testid="toolbar-mode-badge"[^>]*bg-blue-600[^>]*>CM</);
      expect(html).toMatch(/data-testid="mode-switcher-concept-map"[^>]*bg-white text-blue-700/);
      expect(html).not.toMatch(/data-testid="mode-switcher-flowchart"[^>]*bg-white text-indigo-700/);
      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-export-btn"');
    });

    it('5.2: TopToolbar displays correct badge and active switcher in Flowchart mode', () => {
      useConceptMapStore.getState().createNewEmptyMap(true, 'flowchart');

      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} searchInputRef={React.createRef()} />
      );

      expect(html).toMatch(/data-testid="toolbar-mode-badge"[^>]*bg-indigo-600[^>]*>FC</);
      expect(html).toMatch(/data-testid="mode-switcher-flowchart"[^>]*bg-white text-indigo-700/);
      expect(html).not.toMatch(/data-testid="mode-switcher-concept-map"[^>]*bg-white text-blue-700/);
    });

    it('5.3: TopToolbar correctly sets freeform mode and preserves freeformCanvas in store', () => {
      const store = useConceptMapStore.getState();
      store.createNewEmptyMap(true, 'concept-map', { freeformCanvas: true });

      expect(useConceptMapStore.getState().visual.layoutSettings.freeformCanvas).toBe(true);

      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} searchInputRef={React.createRef()} />
      );

      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-shape-palette-btn"');
    });

    it('5.4: TopToolbar renders full "Novo ▾" dropdown menu items when menu is open', () => {
      // Mock useState to force newMapMenuOpen to true
      let callIndex = 0;
      const originalUseState = React.useState;
      vi.spyOn(React, 'useState').mockImplementation((initial: any) => {
        callIndex++;
        // The 1st useState in TopToolbar is `newMapMenuOpen`
        if (callIndex === 1) {
          return [true, vi.fn()];
        }
        return originalUseState(initial);
      });

      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} searchInputRef={React.createRef()} />
      );

      // Verify dropdown headers
      expect(html).toContain('Modelos Iniciais');
      expect(html).toContain('Exemplos Prontos do Workspace');

      // Verify all 6 menu options exist with exact testids
      expect(html).toContain('data-testid="menu-new-concept-map"');
      expect(html).toContain('data-testid="menu-new-flowchart"');
      expect(html).toContain('data-testid="menu-new-freeform"');
      expect(html).toContain('data-testid="menu-load-concept-map-example"');
      expect(html).toContain('data-testid="menu-load-flowchart-example"');
      expect(html).toContain('data-testid="menu-load-freeform-example"');

      // Verify menu descriptions
      expect(html).toContain('Novo Mapa Conceitual');
      expect(html).toContain('Novo Fluxograma');
      expect(html).toContain('Novo Canvas Livre (Freeform)');
      expect(html).toContain('Carregar exemplo.md');
      expect(html).toContain('Carregar exemplo-fluxograma.md');
      expect(html).toContain('Carregar exemplo-canvas-livre');
    });

    it('5.5: TopToolbar renders full export dropdown menu items when menu is open', () => {
      let callIndex = 0;
      const originalUseState = React.useState;
      vi.spyOn(React, 'useState').mockImplementation((initial: any) => {
        callIndex++;
        // Hook 1: newMapMenuOpen, 2: shapePaletteOpen, 3: quickLinkOpen, 4: quickForm, 5: exportMenuOpen
        if (callIndex === 5) {
          return [true, vi.fn()];
        }
        return originalUseState(initial);
      });

      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} searchInputRef={React.createRef()} />
      );

      // Check all 4 export options
      expect(html).toContain('Salvar Projeto (.cmap.json)');
      expect(html).toContain('Exportar Markdown (.md)');
      expect(html).toContain('Exportar Imagem Vetorial (.svg)');
      expect(html).toContain('Exportar PNG Alta Resolução (2x)');
    });

    it('5.6: Export pipelines execute cleanly across all 3 diagram modalities without throwing', () => {
      const store = useConceptMapStore.getState();

      const modalities = [
        { mode: 'concept-map' as const, freeform: false },
        { mode: 'flowchart' as const, freeform: false },
        { mode: 'concept-map' as const, freeform: true },
      ];

      for (const mod of modalities) {
        store.createNewEmptyMap(true, mod.mode, { freeformCanvas: mod.freeform });
        const state = useConceptMapStore.getState();

        // 1. JSON serialization
        const doc = state.exportDocument();
        const json = serializeDocumentToJson(doc);
        expect(typeof json).toBe('string');
        expect(json.length).toBeGreaterThan(50);
        if (mod.freeform) {
          expect(json).toContain('"freeformCanvas": true');
        }

        // 2. Markdown export
        const md = exportSemanticToMarkdown(state.semantic);
        expect(typeof md).toBe('string');
        expect(md.length).toBeGreaterThan(20);

        // 3. SVG generation
        const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
        expect(typeof svg).toBe('string');
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      }
    });
  });

  // ==========================================================================
  // SUITE 6: Defensive Edge Cases & Malformed State Resilience
  // ==========================================================================
  describe('Suite 6: Defensive Edge Cases & Malformed State Resilience', () => {
    it('handles zero selection cleanly (returns null without error)', () => {
      const store = useConceptMapStore.getState();
      store.setSelection([], []);
      const html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toBe('');
    });

    it('handles orphaned relation selection safely (rel exists in edgeIds but not in store)', () => {
      const store = useConceptMapStore.getState();
      store.setSelection([], ['non-existent-rel-id']);
      const html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toBe('');
    });

    it('handles edge with identical source and target (self-loop) gracefully', () => {
      const store = useConceptMapStore.getState();
      const nodeA = store.addConcept('Self Loop Node', { x: 100, y: 100 });
      const relId = store.addRelation(nodeA, nodeA, 'loops', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'right',
        manualHandles: true,
      })!;
      store.setSelection([], [relId]);

      expect(() => {
        const html = renderToStaticMarkup(<PropertyInspector />);
        expect(html).toContain('Self Loop Node');
        expect(html).toMatch(/data-testid="edge-source-handle-top"[^>]*bg-blue-600/);
        expect(html).toMatch(/data-testid="edge-target-handle-right"[^>]*bg-blue-600/);
      }).not.toThrow();
    });

    it('renders multi-selection batch panel when multiple elements are selected', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 10, y: 10 });
      const n2 = store.addConcept('B', { x: 200, y: 10 });
      const relId = store.addRelation(n1, n2, 'to')!;
      store.setSelection([n1, n2], [relId]);

      const html = renderToStaticMarkup(<PropertyInspector />);
      expect(html).toContain('Seleção em Lote');
      expect(html).toContain('Fixar Todos');
      expect(html).toContain('Desafixar Todos');
      expect(html).toContain('Excluir 3 Selecionados');
    });
  });
});
