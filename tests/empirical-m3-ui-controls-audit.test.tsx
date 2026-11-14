import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useConceptMapStore } from '../src/store/useConceptMapStore';
import { FLOWCHART_SHAPES_CONFIG } from '../src/components/canvas/shapeDefinitions';
import { PropertyInspector } from '../src/components/inspector/PropertyInspector';
import { TopToolbar } from '../src/components/toolbar/TopToolbar';
import { ConceptMapCanvas } from '../src/components/canvas/ConceptMapCanvas';
import { ReactFlowProvider } from '@xyflow/react';
import type { FlowchartNodeShape, HandlePosition, ArrowDirection } from '../src/domain/types';

describe('Auditor Empirical Stress Test: Milestone M3 UI Controls & Freeform Mechanics', () => {
  beforeEach(() => {
    useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
  });

  describe('Forensic Check 1: Asymmetric Handle Disablement and Latch Logic', () => {
    it('preserva manualHandles: true se apenas uma das portas for redefinida para auto', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 0, y: 0 });
      const n2 = store.addConcept('B', { x: 200, y: 0 });
      const relId = store.addRelation(n1, n2, 'liga', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      // Captura o estado atualizado da aresta
      const edgeVis = useConceptMapStore.getState().visual.edges[relId];
      const targetIsManual =
        Boolean(edgeVis.manualHandles) &&
        Boolean(edgeVis.targetHandle) &&
        edgeVis.targetHandle !== 'auto';

      store.updateRelation(relId, {
        sourceHandle: 'auto',
        manualHandles: targetIsManual,
      });

      const updated = useConceptMapStore.getState().visual.edges[relId];
      // sourceHandle foi recalculado via smartHandles (físico válido)
      expect(['top', 'right', 'bottom', 'left']).toContain(updated.sourceHandle);
      expect(updated.targetHandle).toBe('bottom');
      expect(updated.manualHandles).toBe(true); // target ainda é manual
    });

    it('limpa manualHandles: false quando ambas as portas são restauradas para auto', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 0, y: 0 });
      const n2 = store.addConcept('B', { x: 200, y: 0 });
      const relId = store.addRelation(n1, n2, 'liga', 'sequence', {
        sourceHandle: 'top',
        targetHandle: 'bottom',
        manualHandles: true,
      })!;

      // Reset total via botão "Restaurar portas automáticas"
      store.updateRelation(relId, {
        sourceHandle: 'auto',
        targetHandle: 'auto',
        manualHandles: false,
      });

      const updated = useConceptMapStore.getState().visual.edges[relId];
      // Handles físicos válidos atribuídos pelo smart routing
      expect(['top', 'right', 'bottom', 'left']).toContain(updated.sourceHandle);
      expect(['top', 'right', 'bottom', 'left']).toContain(updated.targetHandle);
      // Trava manual devidamente desativada
      expect(updated.manualHandles).toBe(false);

      // No PropertyInspector, exibe 'auto' quando manualHandles é false
      const displaySource = updated.manualHandles && updated.sourceHandle ? updated.sourceHandle : 'auto';
      const displayTarget = updated.manualHandles && updated.targetHandle ? updated.targetHandle : 'auto';
      expect(displaySource).toBe('auto');
      expect(displayTarget).toBe('auto');
    });
  });

  describe('Forensic Check 2: Direction Reversal Handle Swapping Invariant', () => {
    it('inverte sourceId e targetId trocando rigorosamente sourceHandle e targetHandle quando manual', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('A', { x: 50, y: 50 });
      const n2 = store.addConcept('B', { x: 250, y: 250 });
      const relId = store.addRelation(n1, n2, 'fluxo', 'sequence', {
        sourceHandle: 'left',
        targetHandle: 'top',
        manualHandles: true,
      })!;

      store.reverseRelationDirection(relId);

      const rel = useConceptMapStore.getState().semantic.relations[relId];
      const edge = useConceptMapStore.getState().visual.edges[relId];

      expect(rel.sourceId).toBe(n2);
      expect(rel.targetId).toBe(n1);
      expect(edge.sourceHandle).toBe('top');
      expect(edge.targetHandle).toBe('left');
      expect(edge.manualHandles).toBe(true);

      // Invertendo novamente restaura o estado original
      store.reverseRelationDirection(relId);
      const rel2 = useConceptMapStore.getState().semantic.relations[relId];
      const edge2 = useConceptMapStore.getState().visual.edges[relId];

      expect(rel2.sourceId).toBe(n1);
      expect(rel2.targetId).toBe(n2);
      expect(edge2.sourceHandle).toBe('left');
      expect(edge2.targetHandle).toBe('top');
      expect(edge2.manualHandles).toBe(true);
    });
  });

  describe('Forensic Check 3: Freeform Multi-Shape Creation & Cardinal Interoperability', () => {
    it('permite conectar os 7 formatos geométricos em quaisquer combinações de portas cardeais sem erro', () => {
      const store = useConceptMapStore.getState();
      const shapes: FlowchartNodeShape[] = [
        'terminal',
        'process',
        'decision',
        'io',
        'subroutine',
        'document',
        'concept',
      ];

      const nodeIds = shapes.map((shape, i) =>
        store.addConcept(`Bloco ${shape}`, { x: i * 80, y: i * 60 }, shape)
      );

      expect(nodeIds).toHaveLength(7);

      const handles: HandlePosition[] = ['top', 'right', 'bottom', 'left'];

      // Conecta consecutivamente os nós usando combinações distintas de portas
      for (let i = 0; i < nodeIds.length - 1; i++) {
        const srcH = handles[i % 4];
        const tgtH = handles[(i + 1) % 4];
        const relId = store.addRelation(
          nodeIds[i],
          nodeIds[i + 1],
          `passo ${i}`,
          'sequence',
          {
            sourceHandle: srcH,
            targetHandle: tgtH,
            manualHandles: true,
            arrowDirection: i % 2 === 0 ? 'forward' : 'both',
          }
        );
        expect(relId).toBeDefined();

        const edgeVis = useConceptMapStore.getState().visual.edges[relId!];
        expect(edgeVis.sourceHandle).toBe(srcH);
        expect(edgeVis.targetHandle).toBe(tgtH);
        expect(edgeVis.manualHandles).toBe(true);
      }
    });
  });

  describe('Forensic Check 4: Markup & TestID Integrity in Rendered Components', () => {
    it('PropertyInspector renderiza todos os seletores de portas, direções e formas', () => {
      const store = useConceptMapStore.getState();
      const n1 = store.addConcept('N1', { x: 0, y: 0 }, 'decision');
      const n2 = store.addConcept('N2', { x: 100, y: 100 }, 'process');
      const relId = store.addRelation(n1, n2, 'rel')!;

      // Testa markup com Nó selecionado
      store.setSelection([n1], []);
      const nodeHtml = renderToStaticMarkup(<PropertyInspector />);
      for (const shape of FLOWCHART_SHAPES_CONFIG) {
        expect(nodeHtml).toContain(`data-testid="node-shape-selector-${shape.shape}"`);
      }
      expect(nodeHtml).toContain('data-testid="new-conn-source-handle"');
      expect(nodeHtml).toContain('data-testid="new-conn-target-handle"');
      expect(nodeHtml).toContain('data-testid="quick-connect-btn"');

      // Testa markup com Aresta selecionada
      store.setSelection([], [relId]);
      const edgeHtml = renderToStaticMarkup(<PropertyInspector />);
      expect(edgeHtml).toContain('data-testid="edge-source-handle-select"');
      expect(edgeHtml).toContain('data-testid="edge-target-handle-select"');
      expect(edgeHtml).toContain('data-testid="edge-invert-direction-btn"');
      expect(edgeHtml).toContain('data-testid="edge-reset-auto-handles-btn"');

      const directions: ArrowDirection[] = ['forward', 'reverse', 'both', 'none'];
      for (const dir of directions) {
        expect(edgeHtml).toContain(`data-testid="edge-arrow-direction-${dir}"`);
      }
    });

    it('TopToolbar renderiza acesso ao menu novo e paleta rápida de formas', () => {
      const html = renderToStaticMarkup(
        <TopToolbar onOpenTableDrawer={() => {}} />
      );
      expect(html).toContain('data-testid="toolbar-new-menu-btn"');
      expect(html).toContain('data-testid="toolbar-shape-palette-btn"');
    });

    it('ConceptMapCanvas Welcome Panel apresenta os 3 caminhos e card de Canvas Livre', () => {
      useConceptMapStore.getState().createNewEmptyMap(false, 'concept-map');
      const html = renderToStaticMarkup(
        <ReactFlowProvider>
          <ConceptMapCanvas />
        </ReactFlowProvider>
      );
      expect(html).toContain('data-testid="welcome-panel"');
      expect(html).toContain('data-testid="create-freeform-btn"');
      expect(html).toContain('data-testid="load-freeform-blank-btn"');
      expect(html).toContain('sm:grid-cols-3');
      expect(html).toContain('max-w-4xl');
    });
  });
});
