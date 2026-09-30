import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Public-directory HTML must bypass Vite's active-app HTML transform and SPA fallback.
export function archivePages() {
  return {
    name: 'archived-configurator-pages',
    configureServer(server) {
      const root = resolve(server.config.publicDir, 'versions');
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname !== '/versions' && !url.pathname.startsWith('/versions/')) return next();
        try {
          const path = resolve(server.config.publicDir, '.' + decodeURIComponent(url.pathname));
          if (path !== root && !path.startsWith(root + sep)) {
            res.statusCode = 404;
            return res.end('Not found');
          }
          const info = await stat(path);
          if (info.isDirectory() && !url.pathname.endsWith('/')) {
            res.statusCode = 302;
            res.setHeader('Location', url.pathname + '/' + url.search);
            return res.end();
          }
          const htmlPath = info.isDirectory() ? resolve(path, 'index.html') : path;
          if (!htmlPath.endsWith('.html')) return next(); // Assets use Vite's public-file middleware.
          const html = await readFile(htmlPath);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : html);
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof URIError) {
            res.statusCode = 404;
            res.end('Not found');
          } else next(error);
        }
      });
    },
  };
}
