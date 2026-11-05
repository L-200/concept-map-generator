import { useEffect, useState } from 'react';
import type { ParseResult } from './domain/types';
import { parseConceptMapMarkdown } from './services/parser/markdownParser';
import { fetchDefaultWorkspaceInput } from './services/workspaceBridge';

export default function App() {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [sourceFile, setSourceFile] = useState<string>('entrada.md');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDefaultWorkspaceInput()
      .then((payload) => {
        setSourceFile(payload.fileName);
        setParseResult(parseConceptMapMarkdown(payload.content));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Erro ao carregar entrada.md');
      });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <header className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Gerador e Editor de Mapas Conceituais
          </h1>
          <p className="text-sm text-slate-600">
            Fonte ativa: <span className="font-mono font-medium">{sourceFile}</span>
          </p>
        </div>
        {parseResult && (
          <div className="flex gap-3 text-sm">
            <span className="rounded-full bg-blue-100 px-3 py-1 font-medium text-blue-800">
              {parseResult.metrics.totalConcepts} Conceitos
            </span>
            <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-800">
              {parseResult.metrics.hierarchicalCount} Hierárquicas
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">
              {parseResult.metrics.crossLinkCount} Ligações Cruzadas
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {parseResult && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Proposições Extraídas ({parseResult.metrics.totalRelations})
          </h2>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Conceito A</th>
                  <th className="px-3 py-2">Frase de ligação</th>
                  <th className="px-3 py-2">Conceito B</th>
                  <th className="px-3 py-2">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parseResult.semantic.relationOrder.map((relId) => {
                  const rel = parseResult.semantic.relations[relId];
                  const source = parseResult.semantic.concepts[rel.sourceId];
                  const target = parseResult.semantic.concepts[rel.targetId];
                  return (
                    <tr key={rel.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {rel.orderIndex}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {source?.label}
                      </td>
                      <td className="px-3 py-2 italic text-slate-600">
                        {rel.linkingPhrase}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {target?.label}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                            rel.type === 'hierarchical'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {rel.type === 'hierarchical'
                            ? 'hierárquica'
                            : 'ligação cruzada'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
