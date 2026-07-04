import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// data/, photos/, textures/ 를 dev 서버에서 직접 서빙
function serveStaticDirs(dirs) {
  return {
    name: 'serve-static-dirs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        for (const dir of dirs) {
          if (req.url.startsWith('/' + dir + '/') || req.url === '/' + dir) {
            const filePath = path.join(import.meta.dirname, decodeURIComponent(req.url));
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              const ext = path.extname(filePath);
              const mime = {
                '.json': 'application/json',
                '.geojson': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.webp': 'image/webp',
              }[ext] || 'application/octet-stream';
              res.setHeader('Content-Type', mime);
              fs.createReadStream(filePath).pipe(res);
              return;
            }
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [serveStaticDirs(['data', 'photos', 'textures'])],
  build: {
    outDir: 'dist',
    rollupOptions: { input: 'index.html' },
  },
  server: { fs: { allow: ['.'] } },
});
