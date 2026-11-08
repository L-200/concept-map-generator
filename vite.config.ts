import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Plugin do servidor Vite que expõe a leitura de `exemplo.md` e `exemplo-fluxograma.md` diretamente
 * do diretório do projeto no Linux, quando solicitado pelo usuário.
 */
function workspaceBridgePlugin(): Plugin {
  return {
    name: 'workspace-bridge-plugin',
    configureServer(server) {
      server.middlewares.use('/api/default-input', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        const url = new URL(req.url ?? '', 'http://localhost');
        const requestedFile = url.searchParams.get('file') || 'exemplo.md';

        const ALLOWED_FILES: Record<string, string> = {
          'exemplo.md': 'exemplo.md',
          'exemplo-fluxograma.md': 'exemplo-fluxograma.md',
        };

        const targetFile = ALLOWED_FILES[path.basename(requestedFile)];
        if (!targetFile) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: `Arquivo '${requestedFile}' não autorizado. Arquivos permitidos: ${Object.keys(ALLOWED_FILES).join(', ')}`,
            })
          );
          return;
        }

        const filePath = path.resolve(__dirname, targetFile);
        try {
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: `Arquivo ${targetFile} não encontrado no diretório do projeto.`,
              })
            );
            return;
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              fileName: targetFile,
              content,
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error:
                err instanceof Error
                  ? err.message
                  : `Erro ao ler arquivo ${targetFile}`,
            })
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), workspaceBridgePlugin()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          xyflow: ['@xyflow/react'],
          layout: ['@dagrejs/dagre', 'd3-force'],
          elk: ['elkjs/lib/elk.bundled.js'],
        },
      },
    },
  },
});
