import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { useConceptMapStore } from '../../../store/useConceptMapStore';
import { parseConceptMapMarkdown } from '../../parser/markdownParser';
import {
  escapeXml,
  exportSemanticToMarkdown,
  generateStandaloneVectorSvg,
  parseAndValidateJsonDocument,
  serializeDocumentToJson,
} from '../fileExporter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entradaPath = path.resolve(__dirname, '../../../../entrada.md');
const rawMarkdown = fs.readFileSync(entradaPath, 'utf-8');

describe('FileExporter & Persistência Completa (Etapas 6 e 7)', () => {
  beforeEach(async () => {
    await useConceptMapStore.getState().loadFromMarkdown(rawMarkdown, 'entrada.md');
  });

  it('salva e reabre projeto JSON (.cmap.json) preservando 100% dos dados semânticos, posições manuais e pinos', () => {
    const store = useConceptMapStore.getState();

    // Realiza alterações manuais: move nó (marca pinned=true), redimensiona e edita frase
    store.moveNodes([
      { conceptId: 'concept-projeto-pop', position: { x: 777, y: 111 } },
    ]);
    store.resizeNode('concept-projeto-pop', { width: 260, height: 80 });
    store.updateRelation('rel-1', {
      linkingPhrase: 'propõe estrategicamente',
      type: 'cross-link',
    });

    const exportedDoc = useConceptMapStore.getState().exportDocument();
    const jsonString = serializeDocumentToJson(exportedDoc);

    // Valida e reimporta o JSON
    const validatedDoc = parseAndValidateJsonDocument(jsonString);
    useConceptMapStore.getState().loadFromDocument(validatedDoc);

    const restored = useConceptMapStore.getState();
    expect(restored.metrics.totalConcepts).toBe(32);
    expect(restored.metrics.totalRelations).toBe(46);
    expect(restored.visual.nodes['concept-projeto-pop'].position).toEqual({
      x: 777,
      y: 111,
    });
    expect(restored.visual.nodes['concept-projeto-pop'].pinned).toBe(true);
    expect(restored.visual.nodes['concept-projeto-pop'].dimensions).toEqual({
      width: 260,
      height: 80,
    });
    expect(restored.semantic.relations['rel-1'].linkingPhrase).toBe(
      'propõe estrategicamente'
    );
    expect(restored.semantic.relations['rel-1'].type).toBe('cross-link');
  });

  it('gera SVG vetorial autônomo contendo todos os 32 conceitos, 46 conexões e diferenciação hierárquica vs cruzada', () => {
    const state = useConceptMapStore.getState();
    const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('Projeto POP');
    expect(svg).toContain('Reserva Ducke');
    expect(svg).toContain('previsibilidade de');
    // Verifica que existem arestas tracejadas para ligações cruzadas
    expect(svg).toContain('stroke-dasharray="8 5"');

    const nodeMatches = svg.match(/class="concept-node"/g);
    const edgeMatches = svg.match(/id="edge-rel-/g);
    expect(nodeMatches).toHaveLength(32);
    expect(edgeMatches).toHaveLength(46);
  });

  it('escapa caracteres especiais XML (&, <, >, ", \') na exportação SVG sem corromper o documento', () => {
    const store = useConceptMapStore.getState();
    const id = store.addConcept('Fauna & Flora <Amazônica>', { x: 200, y: 200 });
    store.addRelation(id, 'concept-reserva-ducke', 'inclui "espécies" > 100');

    const state = useConceptMapStore.getState();
    const svg = generateStandaloneVectorSvg(state.semantic, state.visual);

    expect(svg).toContain('Fauna &amp; Flora');
    expect(svg).toContain('&lt;Amazônica&gt;');
    expect(svg).toContain('inclui &quot;espécies&quot; &gt;');
    expect(escapeXml(`A & B < C > "D" 'E'`)).toBe(
      'A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;'
    );
  });

  it('exporta tabela Markdown de 5 colunas refletindo edições manuais e mantendo compatibilidade round-trip', () => {
    const store = useConceptMapStore.getState();
    const newConceptId = store.addConcept('Monitoramento Satelital');
    store.addRelation(
      newConceptId,
      'concept-reserva-ducke',
      'vigia',
      'cross-link'
    );

    const md = exportSemanticToMarkdown(useConceptMapStore.getState().semantic);
    expect(md).toContain(
      '| 47 | Monitoramento Satelital | vigia | Reserva Ducke | ligação cruzada |'
    );

    const reparsed = parseConceptMapMarkdown(md);
    expect(reparsed.metrics.totalConcepts).toBe(33);
    expect(reparsed.metrics.totalRelations).toBe(47);
  });
});
