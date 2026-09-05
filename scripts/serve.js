const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/config') {
    res.status = n => { res.statusCode = n; return res; }; res.json = d => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); };
    return require('../api/config')(req, res);
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || pathname.split('/').some(s => s.startsWith('.')) || !['/index.html', '/sw.js', '/manifest.webmanifest'].includes(pathname) && pathname !== '/' && !/^\/(css|js|icons)\//.test(pathname)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    res.writeHead(err ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(err ? 'Not found' : data);
  });
}).listen(4173, '127.0.0.1', () => console.log('Income Farm: http://127.0.0.1:4173'));
