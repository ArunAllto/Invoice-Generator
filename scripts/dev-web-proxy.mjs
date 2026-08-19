/**
 * Development proxy that makes the web target cross-origin isolated.
 *
 * Why this exists: `expo-sqlite`'s browser implementation runs wa-sqlite in a worker that needs
 * `SharedArrayBuffer` to reach OPFS. Browsers only expose that in a cross-origin-isolated
 * context, which requires `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` on
 * the *document*. Metro's `enhanceMiddleware` sets them on bundle responses, but Expo serves
 * the HTML shell outside that middleware, so the document itself never gets them — and the
 * symptom is nasty: reads appear to work and the first write hangs for ever.
 *
 * So this sits in front of the dev server and adds the headers to everything, including the
 * HTML. The served markup references its assets by relative path, which is what makes a plain
 * port-forward sufficient.
 *
 * Android never touches any of this. The web target exists only so screens can be reviewed on
 * a desktop; the product is the Android app.
 *
 *   npx expo start --web --port 8095      # terminal 1
 *   node scripts/dev-web-proxy.mjs        # terminal 2, then open http://localhost:8099
 */

import http from 'node:http';
import net from 'node:net';

const UPSTREAM_HOST = process.env.UPSTREAM_HOST ?? '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 8095);
const LISTEN_PORT = Number(process.env.PORT ?? 8099);

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Lets the isolated document load its own subresources through this proxy.
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const server = http.createServer((clientRequest, clientResponse) => {
  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: clientRequest.method,
      path: clientRequest.url,
      headers: { ...clientRequest.headers, host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}` },
    },
    (upstreamResponse) => {
      clientResponse.writeHead(upstreamResponse.statusCode ?? 502, {
        ...upstreamResponse.headers,
        ...ISOLATION_HEADERS,
      });
      upstreamResponse.pipe(clientResponse);
    },
  );

  upstream.on('error', (error) => {
    clientResponse.writeHead(502, { 'Content-Type': 'text/plain' });
    clientResponse.end(`Dev server unreachable on ${UPSTREAM_HOST}:${UPSTREAM_PORT}\n${error.message}\n`);
  });

  clientRequest.pipe(upstream);
});

/** Metro's HMR and the dev-tools channel are websockets, so upgrades have to be tunnelled. */
server.on('upgrade', (request, clientSocket, head) => {
  const upstreamSocket = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const headerLines = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\r\n');
    upstreamSocket.write(`${request.method} ${request.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head && head.length > 0) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  const drop = () => {
    upstreamSocket.destroy();
    clientSocket.destroy();
  };
  upstreamSocket.on('error', drop);
  clientSocket.on('error', drop);
});

server.listen(LISTEN_PORT, () => {
  console.log(`Cross-origin-isolated proxy: http://localhost:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
