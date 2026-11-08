import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateStandaloneVectorSvg } from '../../src/services/export/fileExporter';
import { parseConceptMapMarkdown } from '../../src/services/parser/markdownParser';
import { useConceptMapStore } from '../../src/store/useConceptMapStore';
import type { DiagramMode, FlowchartNodeShape } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../../');
export const EXEMPLO_MD_PATH = path.resolve(PROJECT_ROOT, 'exemplo.md');
export const EXEMPLO_FLUXOGRAMA_PATH = path.resolve(PROJECT_ROOT, 'exemplo-fluxograma.md');

/**
 * Checks whether full strict E2E mode is active (for M5 acceptance verification).
 */
export function isFullMode(): boolean {
  return process.env.E2E_FULL === '1' || process.env.CI_E2E === '1';
}

/**
 * Inspects whether Milestone 1 (Domain & Parser) features are implemented.
 */
export function isM1Ready(): boolean {
  if (isFullMode()) return true;
  try {
    const testMd = `---\ntype: flowchart\n---\n| # | Origem | Transição | Destino | Tipo |\n|---|---|---|---|---|\n| 1 | Início | | Fim | terminal |\n`;
    const res = parseConceptMapMarkdown(testMd);
    return (res.semantic as any)?.diagramMode === 'flowchart';
  } catch {
    return false;
  }
}

/**
 * Inspects whether Milestone 2 (Geometry, Layout & Store) features are implemented.
 */
export function isM2Ready(): boolean {
  if (isFullMode()) return true;
  try {
    const store = useConceptMapStore.getState() as any;
    return typeof store.setDiagramMode === 'function' || typeof store.updateNodeShape === 'function';
  } catch {
    return false;
  }
}

/**
 * Inspects whether Milestone 3 (Canvas Shapes & SVG Export) features are implemented.
 */
export function isM3Ready(): boolean {
  if (isFullMode()) return true;
  if (!isM1Ready() || !isM2Ready()) return false;
  try {
    const testSemantic = {
      title: 'Probe',
      concepts: {
        'probe-node': {
          id: 'probe-node',
          label: 'Decisão',
          normalizedKey: 'decisao',
          nodeShape: 'decision' as FlowchartNodeShape,
        },
      },
      conceptOrder: ['probe-node'],
      relations: {},
      relationOrder: [],
    };
    const testVisual = {
      nodes: {
        'probe-node': {
          conceptId: 'probe-node',
          position: { x: 0, y: 0 },
          nodeShape: 'decision' as FlowchartNodeShape,
          pinned: false,
        },
      },
      edges: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      layoutSettings: {
        algorithm: 'dagre-hierarchical',
        direction: 'TB',
        nodeSpacingX: 50,
        nodeSpacingY: 50,
        layerSpacing: 50,
        respectPinnedNodes: true,
      } as any,
      crossLinkVisibility: 'all' as any,
    };
    const svg = generateStandaloneVectorSvg(testSemantic, testVisual);
    return svg.includes('<polygon');
  } catch {
    return false;
  }
}

/**
 * Helper to read exemplo.md verbatim.
 */
export function readExemploMd(): string {
  if (fs.existsSync(EXEMPLO_MD_PATH)) {
    return fs.readFileSync(EXEMPLO_MD_PATH, 'utf-8');
  }
  throw new Error(`exemplo.md not found at ${EXEMPLO_MD_PATH}`);
}

/**
 * Helper to read exemplo-fluxograma.md if available.
 */
export function readExemploFluxogramaMd(): string | null {
  if (fs.existsSync(EXEMPLO_FLUXOGRAMA_PATH)) {
    return fs.readFileSync(EXEMPLO_FLUXOGRAMA_PATH, 'utf-8');
  }
  return null;
}

// ----------------------------------------------------------------------------
// AUTHORITATIVE FIXTURES
// ----------------------------------------------------------------------------

export const FIXTURE_FLOWCHART_FRONTMATTER = `---
type: flowchart
title: Processo de Atendimento ao Cliente
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Receber Chamado | | Registrar no Sistema | início -> processo |
| 2 | Registrar no Sistema | | Classificar Urgência | processo |
| 3 | Classificar Urgência | É Urgente? | Urgência Alta? [decisão] | processo -> decisão |
| 4 | Urgência Alta? | Sim | Encaminhar Plantão | condicional |
| 5 | Urgência Alta? | Não | Fila Normal | condicional |
| 6 | Encaminhar Plantão | | [Fim] Encerrar Registro | processo -> fim |
| 7 | Fila Normal | | [Fim] Encerrar Registro | processo -> fim |
`;

export const FIXTURE_FLOWCHART_HTML_COMMENT = `<!-- type: flowchart -->
# Fluxo de Aprovação Financeira

| # | Origem | Transição | Destino | Tipo |
|---|---|---|---|---|
| 1 | [Início] Solicitar Compra | | Validar Saldo | terminal -> processo |
| 2 | Validar Saldo | Saldo Suficiente? | Saldo OK? [decisão] | processo -> decisão |
| 3 | Saldo OK? | Sim | Efetuar Pagamento [processo] | condicional |
| 4 | Saldo OK? | Não | Solicitar Crédito [entrada/saída] | condicional |
| 5 | Solicitar Crédito | | Validar Saldo | loop-back |
| 6 | Efetuar Pagamento | Concluído | [Fim] Arquivar Recibo | processo -> fim |
`;

export const FIXTURE_FLOWCHART_DIRECTIVE = `@type: flowchart
# Protocolo de Triagem Médica

| Origem | Condição | Destino | Tipo de Nó |
|---|---|---|---|
| [Início] Chegada do Paciente | | Triagem e Sinais Vitais | início -> processo |
| Triagem e Sinais Vitais | Emergência? | Paciente Crítico? [decisão] | processo -> decisão |
| Paciente Crítico? | Sim | Atendimento Imediato [processo] | condicional |
| Paciente Crítico? | Não | Aguardar Consulta [processo] | condicional |
| Atendimento Imediato | | [Fim] Estabilizado | processo -> fim |
| Aguardar Consulta | | [Fim] Estabilizado | processo -> fim |
`;

export const FIXTURE_FLOWCHART_HEURISTIC_HEADERS = `| Origem | Condição / Transição | Destino | Forma |
|---|---|---|---|
| Receber Pedido | | Emitir Nota Fiscal | processo |
| Emitir Nota Fiscal | Pagamento Confirmado? | Despachar Mercadoria | processo |
`;

export const FIXTURE_FLOWCHART_ALL_6_SHAPES = `---
type: flowchart
title: Demonstração das 6 Formas Geométricas de Fluxograma
---

| # | Origem | Condição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] Ponto de Partida | | Ler Dados de Entrada [entrada/saída] | terminal -> io |
| 2 | Ler Dados de Entrada | | Executar Operação [processo] | io -> processo |
| 3 | Executar Operação | | Chamar Módulo Externo [subprocesso] | processo -> subroutine |
| 4 | Chamar Módulo Externo | Dados Válidos? | Decisão Crítica? [decisão] | subroutine -> decisão |
| 5 | Decisão Crítica? | Sim | Gerar Relatório Final [documento] | condicional |
| 6 | Decisão Crítica? | Não | Ler Dados de Entrada | loop-back |
| 7 | Gerar Relatório Final | Concluído | [Fim] Ponto de Chegada | documento -> terminal |
`;

export const FIXTURE_FLOWCHART_EMPTY_TRANSITIONS = `---
type: flowchart
title: Fluxo com Transições sem Rótulo
---

| # | Origem | Transição | Destino | Forma |
|---|---|---|---|---|
| 1 | Etapa Alfa | | Etapa Beta | processo |
| 2 | Etapa Beta | | Etapa Gama | processo |
| 3 | Etapa Gama | | Etapa Delta | processo |
`;

export const FIXTURE_CONCEPT_MAP_EMPTY_TRANSITION = `| Conceito A | Frase de Ligação | Conceito B | Tipo |
|---|---|---|---|
| Fotossíntese | | Luz Solar | hierárquica |
| Luz Solar | gera | Energia | hierárquica |
`;

export const FIXTURE_SPECIAL_CHARACTERS = `---
type: flowchart
title: Teste de Escapamento <XML> & "HTML" 'Safe'
---

| # | Origem | Transição | Destino | Forma |
|---|---|---|---|---|
| 1 | [Início] <Entrada & Dados> | Condição: x < 10 && y > 20 | Processar "String" 'A' | terminal -> processo |
| 2 | Processar "String" 'A' | Retorno <= 0 | [Fim] <Saída Final> | processo -> terminal |
`;
