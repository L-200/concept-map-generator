import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Plugin do servidor Vite que expõe a leitura de `entrada.md` diretamente
 * do diretório do projeto no Linux, sem exigir upload manual inicial.
 */
function workspaceBridgePlugin(): Plugin {
  return {
    name: 'workspace-bridge-plugin',
    configureServer(server) {
      server.middlewares.use('/api/default-input', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        const entradaPath = path.resolve(__dirname, 'entrada.md');
        try {
          if (!fs.existsSync(entradaPath)) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Arquivo entrada.md não encontrado no diretório.' }));
            return;
          }
          const content = fs.readFileSync(entradaPath, 'utf-8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              fileName: 'entrada.md',
              content,
            })
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : 'Erro ao ler entrada.md',
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
