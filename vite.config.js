import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

const STATIC_DIRS = ['data', 'photos', 'textures'];

function staticDirsPlugin() {
  return {
    name: 'static-dirs',

    // dev: data/, photos/, textures/ 를 직접 서빙
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const matched = STATIC_DIRS.some(d => url.startsWith('/' + d + '/') || url === '/' + d);
        if (!matched) return next();

        const filePath = path.join(import.meta.dirname, url);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

        const mime = {
          '.json': 'application/json', '.geojson': 'application/json',
          '.png': 'image/png', '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        }[path.extname(filePath)] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        fs.createReadStream(filePath).pipe(res);
      });
    },

    // build: 빌드 후 dist/ 에 복사
    closeBundle() {
      for (const dir of STATIC_DIRS) {
        const src  = path.join(import.meta.dirname, dir);
        const dest = path.join(import.meta.dirname, 'dist', dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
          console.log(`copied ${dir}/ → dist/${dir}/`);
        }
      }
    },
  };
}

export default defineConfig({
  base: '/quantum-brain-map/',
  publicDir: false,
  plugins: [staticDirsPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: { input: 'index.html' },
  },
  server: { fs: { allow: ['.'] } },
});
