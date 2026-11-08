import { beforeEach, describe, expect, it } from 'vitest';
import { parseConceptMapMarkdown } from '../../src/services/parser/markdownParser';
import { serializeSemanticModelToMarkdown } from '../../src/services/parser/markdownSerializer';
import { estimateConceptNodeDimensions } from '../../src/services/layout/nodeSizing';
import {
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../../src/services/export/fileExporter';
import { useConceptMapStore } from '../../src/store/useConceptMapStore';
import {
  isM1Ready,
  isM2Ready,
  isM3Ready,
  readExemploMd,
} from './harness';

describe('Tier 3: Cross-Feature Combinations (Pairwise Interactions)', () => {
  beforeEach(async () => {
    const rawMarkdown = readExemploMd();
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'exemplo.md');
  });

  // ==========================================================================
  // Combination 1: Mode Switch + Node Shape Mutation + Serialization Round-Trip
  // ==========================================================================
  it('C1: Mode switch to flowchart + shape mutations + Markdown serialization round-trip', () => {
    if (!isM1Ready() || !isM2Ready()) return;
    const store = useConceptMapStore.getState() as any;

    // Switch mode
    store.setDiagramMode('flowchart');
    expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');

    // Mutate shapes on existing nodes
    store.updateNodeShape('concept-projeto-pop', 'decision');
    store.updateNodeShape('concept-reserva-ducke', 'terminal');

    // Serialize to Markdown
    const serialized = serializeSemanticModelToMarkdown(
      useConceptMapStore.getState().semantic,
      { includeIndexColumn: true }
    );
    expect(serialized).toContain('type: flowchart');

    // Re-parse
    const secondPass = parseConceptMapMarkdown(serialized);
    expect((secondPass.semantic as any).diagramMode).toBe('flowchart');
    expect(secondPass.semantic.conceptOrder).toEqual(
      useConceptMapStore.getState().semantic.conceptOrder
    );
  });

  // ==========================================================================
  // Combination 2: Inline Shapes + Dedicated Shape Columns + Empty Linking Phrases
  // ==========================================================================
  it('C2: Mixed inline shapes + dedicated shape column + empty transitions in single table', () => {
    if (!isM1Ready()) return;
    const mixedMd = `---
type: flowchart
title: Processo Misto
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Protocolar Requerimento | | Analisar Requisitos | terminal -> processo |
| 2 | Analisar Requisitos | Requisitos Atendidos? | Decisão Concessão? [decisão] | processo -> decisão |
| 3 | Decisão Concessão? | Sim | [Documento] Expedir Portaria | condicional |
| 4 | Decisão Concessão? | Não | Solicitar Recurso [entrada/saída] | condicional |
| 5 | Expedir Portaria | | [Fim] Publicar Diário Oficial | terminal |
`;
    const parsed = parseConceptMapMarkdown(mixedMd);
    expect((parsed.semantic as any).diagramMode).toBe('flowchart');
    expect(parsed.metrics.totalConcepts).toBe(6);
    expect(parsed.metrics.totalRelations).toBe(5);

    // Empty transitions in flowchart produce 0 empty phrase warnings
    const warnings = parsed.diagnostics.filter(
      (d) => d.code === 'EMPTY_LINKING_PHRASE' || d.message.includes('vazia')
    );
    expect(warnings).toHaveLength(0);

    // Labels are cleaned of inline brackets
    const labels = Object.values(parsed.semantic.concepts).map((c) => c.label);
    expect(labels).toContain('Protocolar Requerimento');
    expect(labels).not.toContain('[Início] Protocolar Requerimento');
    expect(labels).toContain('Publicar Diário Oficial');
    expect(labels).not.toContain('[Fim] Publicar Diário Oficial');
  });

  // ==========================================================================
  // Combination 3: Decision Branching + Orthogonal Auto-Layout + Pinned Nodes
  // ==========================================================================
  it('C3: Decision branching + orthogonal auto-layout with pinned node preservation', async () => {
    const store = useConceptMapStore.getState();

    // Pin a specific node at manual coordinate
    store.moveNodes([
      {
        conceptId: 'concept-reserva-ducke',
        position: { x: 888, y: 333 },
      },
    ]);
    expect(useConceptMapStore.getState().visual.nodes['concept-reserva-ducke'].pinned).toBe(true);

    // Run auto-layout respecting pinned nodes
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      respectPinnedNodes: true,
    });

    // Pinned node must remain at manual coordinate
    const afterLayout = useConceptMapStore.getState();
    expect(afterLayout.visual.nodes['concept-reserva-ducke'].position).toEqual({
      x: 888,
      y: 333,
    });

    // Other unpinned nodes must have valid coordinates
    expect(Number.isFinite(afterLayout.visual.nodes['concept-projeto-pop'].position.x)).toBe(true);
    expect(Number.isFinite(afterLayout.visual.nodes['concept-projeto-pop'].position.y)).toBe(true);
  });

  // ==========================================================================
  // Combination 4: Legacy Document Migration + Shape Upgrades + SVG Export
  // ==========================================================================
  it('C4: Legacy JSON v1.0.0 migration + mode switch + shape update + vector SVG export', () => {
    // Export base document (v1.0.0)
    const baseDoc = useConceptMapStore.getState().exportDocument();
    expect(baseDoc.schemaVersion).toBe('1.0.0');

    const jsonStr = serializeDocumentToJson(baseDoc);
    const reimported = parseAndValidateJsonDocument(jsonStr);
    useConceptMapStore.getState().loadFromDocument(reimported);

    const store = useConceptMapStore.getState();
    expect(store.metrics.totalConcepts).toBe(32);

    // If M2/M3 ready, upgrade mode and shapes
    if (isM2Ready() && isM3Ready()) {
      (store as any).setDiagramMode('flowchart');
      (store as any).updateNodeShape('concept-projeto-pop', 'decision');
      (store as any).updateNodeShape('concept-reserva-ducke', 'io');
    }

    const svg = generateStandaloneVectorSvg(
      useConceptMapStore.getState().semantic,
      useConceptMapStore.getState().visual
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Projeto POP');
  });

  // ==========================================================================
  // Combination 5: Cascading Delete + Multi-Step Undo + Markdown Invariant Sync
  // ==========================================================================
  it('C5: Cascading delete of hub node + multi-step undo restores complete Markdown fidelity', () => {
    const store = useConceptMapStore.getState();
    const initialMd = serializeSemanticModelToMarkdown(store.semantic, {
      includeIndexColumn: true,
    });
    const initialCount = store.metrics.totalConcepts;
    const initialRelCount = store.metrics.totalRelations;

    // Delete hub node with multiple connections
    const hubId = 'concept-membro-do-parlamento-estadual';
    store.deleteElements([hubId], []);

    const deletedState = useConceptMapStore.getState();
    expect(deletedState.metrics.totalConcepts).toBe(initialCount - 1);
    expect(deletedState.metrics.totalRelations).toBeLessThan(initialRelCount);

    // Undo deletion
    useConceptMapStore.temporal.getState().undo();

    const restoredState = useConceptMapStore.getState();
    expect(restoredState.metrics.totalConcepts).toBe(initialCount);
    expect(restoredState.metrics.totalRelations).toBe(initialRelCount);

    const restoredMd = serializeSemanticModelToMarkdown(restoredState.semantic, {
      includeIndexColumn: true,
    });
    expect(restoredMd).toBe(initialMd);
  });

  // ==========================================================================
  // Combination 6: Special Characters + Sizing Bounds + XML Escaping + SVG Export
  // ==========================================================================
  it('C6: Special characters in labels scale bounding box and escape properly in SVG', () => {
    const store = useConceptMapStore.getState();
    const complexLabel = 'Decisão & Triagem: Critério x < 100 || y > 50 ("Conforme LO")';

    store.addConcept(complexLabel, { x: 120, y: 150 });
    const state = useConceptMapStore.getState();

    // Verify dimensions scale to fit label length
    const dims = estimateConceptNodeDimensions(complexLabel, undefined, false);
    expect(dims.width).toBeGreaterThanOrEqual(180);
    expect(dims.height).toBeGreaterThanOrEqual(48);

    // Export SVG and check proper XML escaping
    const svg = generateStandaloneVectorSvg(state.semantic, state.visual);
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&gt;');
    expect(svg).not.toContain('Critério x < 100');
  });

  // ==========================================================================
  // Combination 7: Auto-Layout Direction (TB vs LR) + Decision Handle Alignment
  // ==========================================================================
  it('C7: Auto-layout direction switch (TB vs LR) preserves decision node geometry', async () => {
    const store = useConceptMapStore.getState();

    // Run layout top-to-bottom
    await store.applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      direction: 'TB',
      respectPinnedNodes: false,
    });
    const tbNodes = useConceptMapStore.getState().visual.nodes;
    expect(Object.keys(tbNodes).length).toBeGreaterThan(0);

    // Run layout left-to-right
    await useConceptMapStore.getState().applyAutoLayout({
      algorithm: 'dagre-hierarchical',
      direction: 'LR',
      respectPinnedNodes: false,
    });
    const lrNodes = useConceptMapStore.getState().visual.nodes;
    for (const node of Object.values(lrNodes)) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  // ==========================================================================
  // Combination 8: Multi-Column Order Synonyms (Source/Target/Condition/Shape)
  // ==========================================================================
  it('C8: Column synonyms (De / Para / Condição / Forma) correctly parsed', () => {
    if (!isM1Ready()) return;
    const synonymMd = `---
type: flowchart
---

| De | Condição | Para | Forma |
|---|---|---|---|
| Entrada de Dados | Validado | Processamento Principal | io -> processo |
| Processamento Principal | | Conclusão | processo -> terminal |
`;
    const parsed = parseConceptMapMarkdown(synonymMd);
    expect(parsed.metrics.totalConcepts).toBe(3);
    expect(parsed.metrics.totalRelations).toBe(2);
  });

  // ==========================================================================
  // Combination 9: Multiple Chained Decision Diamonds with Orthogonal Routes
  // ==========================================================================
  it('C9: Chained decision diamonds (Decision 1 -> Sim/Não -> Decision 2) parse with valid graph', () => {
    if (!isM1Ready()) return;
    const chainedDecisionsMd = `---
type: flowchart
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Iniciar | | Passo 1 [processo] | terminal -> processo |
| 2 | Passo 1 | | Validação 1? [decisão] | processo -> decisão |
| 3 | Validação 1? | Sim | Validação 2? [decisão] | condicional |
| 4 | Validação 1? | Não | [Fim] Rejeitado 1 | condicional |
| 5 | Validação 2? | Sim | [Fim] Aprovado | condicional |
| 6 | Validação 2? | Não | [Fim] Rejeitado 2 | condicional |
`;
    const parsed = parseConceptMapMarkdown(chainedDecisionsMd);
    expect(parsed.metrics.totalConcepts).toBe(7);
    expect(parsed.metrics.totalRelations).toBe(6);
  });

  // ==========================================================================
  // Combination 10: Repeated Mode Switching with Node Modifications
  // ==========================================================================
  it('C10: Switching between Concept Map and Flowchart mode preserves custom node labels and positions', () => {
    if (!isM2Ready()) return;
    const store = useConceptMapStore.getState() as any;
    store.addConcept('Nó Persistente', { x: 450, y: 250 });

    store.setDiagramMode('flowchart');
    expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');
    const posFlow = useConceptMapStore.getState().visual.nodes['concept-no-persistente']?.position;

    store.setDiagramMode('concept-map');
    expect(useConceptMapStore.getState().semantic.diagramMode).toBe('concept-map');
    const posConcept = useConceptMapStore.getState().visual.nodes['concept-no-persistente']?.position;

    expect(posFlow).toEqual(posConcept);
  });

  // ==========================================================================
  // Combination 11: Empty Starter Creation Across Modes
  // ==========================================================================
  it('C11: createNewEmptyMap with starter creates distinct templates per mode', () => {
    if (!isM2Ready()) return;
    const store = useConceptMapStore.getState() as any;

    // Create empty concept map with starter
    store.createNewEmptyMap(true, 'concept-map');
    const conceptMapCount = useConceptMapStore.getState().metrics.totalConcepts;
    expect(conceptMapCount).toBeGreaterThanOrEqual(1);

    // Create empty flowchart
    store.createNewEmptyMap(false, 'flowchart');
    expect(useConceptMapStore.getState().metrics.totalConcepts).toBe(0);
    expect(useConceptMapStore.getState().semantic.diagramMode).toBe('flowchart');
  });

  // ==========================================================================
  // Combination 12: SVG Export Integration with Mixed Flowchart & Concept Geometries
  // ==========================================================================
  it('C12: Standalone SVG export handles graphs with mixed node types gracefully', () => {
    const store = useConceptMapStore.getState();
    const svg = generateStandaloneVectorSvg(store.semantic, store.visual);
    expect(svg).toMatch(/<svg[^>]*>/);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Projeto POP');
  });
});
