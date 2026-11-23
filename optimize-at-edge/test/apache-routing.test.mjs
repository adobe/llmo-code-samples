import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const signatureNames = ['signature-agent', 'signature-input', 'signature'];
const opaque = 'opaque; untouched="yes"';
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname,
      headers: { host: 'enabled.example', 'user-agent': 'Mozilla/5.0', ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.setTimeout(1000, () => req.destroy(new Error('HTTP request timed out')));
    req.on('error', reject);
  });
}

test('native Apache routing fragment selects upstream and preserves signatures', { timeout: 30000 }, async (t) => {
  const executable = process.env.HTTPD;
  const moduleDir = process.env.HTTPD_MODULE_DIR;
  assert.ok(executable && moduleDir, 'Set HTTPD and HTTPD_MODULE_DIR explicitly');
  await access(executable, constants.X_OK);
  const modules = ['mpm_prefork', 'unixd', 'authz_core', 'setenvif', 'headers', 'rewrite', 'proxy', 'proxy_http'];
  await Promise.all(modules.map((name) => access(path.join(moduleDir, `mod_${name}.so`), constants.R_OK)));
  const directory = await mkdtemp(path.join(tmpdir(), 'oae-routing-'));
  const servers = [];
  let child;
  let exited;
  let output = '';
  try {
    const ports = {};
    for (const upstream of ['edge', 'origin']) {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'x-test-upstream': upstream, 'content-type': 'application/json' });
        res.end(JSON.stringify({ headers: req.headers, url: req.url }));
      });
      servers.push(server);
      ports[upstream] = await listen(server);
    }
    const reservation = http.createServer();
    const port = await listen(reservation);
    await new Promise((resolve) => reservation.close(resolve));
    const source = await readFile(new URL('../apache/oae/oae-routing.conf', import.meta.url), 'utf8');
    const lines = source.split('\n');
    const decisions = lines.filter((line) => line.startsWith('SetEnvIfExpr '));
    const metadata = lines.filter((line) => line.startsWith('RequestHeader '));
    const rewriteStart = lines.findIndex((line) => line === 'RewriteCond %{ENV:ADOBE_EDGE_OPTIMIZE} 1');
    assert.equal(decisions.length, 2);
    assert.equal(metadata.length, 8);
    assert.ok(rewriteStart >= 0);
    const rewrite = lines.slice(rewriteStart, rewriteStart + 3).join('\n')
      .replace('https://${ADOBE_EO_HOST}', `http://127.0.0.1:${ports.edge}`);
    const proxy = source.match(/<Proxy "https:\/\/\$\{ADOBE_EO_HOST\}\/\*">[\s\S]*?<\/Proxy>/)?.[0]
      .replace('https://${ADOBE_EO_HOST}', `http://127.0.0.1:${ports.edge}`);
    assert.ok(proxy, 'Native EO proxy settings must be present');
    const config = [
      `ServerRoot "${directory}"`, `PidFile "${directory}/httpd.pid"`,
      `DefaultRuntimeDir "${directory}"`, `Mutex file:${directory} default`,
      `Listen 127.0.0.1:${port}`, 'ServerName localhost',
      ...modules.map((name) => `LoadModule ${name}_module "${path.join(moduleDir, `mod_${name}.so`)}"`),
      `ErrorLog "${directory}/error.log"`, 'LogLevel warn',
      `<VirtualHost 127.0.0.1:${port}>`, 'ServerName enabled.example',
      // Fixture substitutes only per-domain configuration, not the routing predicate.
      'SetEnvIf Host "^enabled\\.example$" OAE_DOMAIN_ENABLED=1 OAE_API_KEY=test-key',
      ...decisions, ...metadata, proxy, 'RewriteEngine On', rewrite,
      `ProxyPass "/" "http://127.0.0.1:${ports.origin}/"`, '</VirtualHost>', '',
    ].join('\n');
    const configPath = path.join(directory, 'httpd.conf');
    await writeFile(configPath, config);
    child = spawn(executable, ['-X', '-f', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    exited = once(child, 'exit');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const deadline = Date.now() + 10000;
    while (true) {
      if (child.exitCode !== null) throw new Error(`httpd exited ${child.exitCode}: ${output}\n${await readFile(path.join(directory, 'error.log'), 'utf8').catch(() => '')}`);
      try { await request(port, '/ready'); break; } catch (error) {
        if (Date.now() >= deadline) throw new Error(`httpd readiness failed: ${error.message}\n${output}`);
        await delay(50);
      }
    }
    const fixtures = [
      ...signatureNames.flatMap((name) => [
        { name: `${name} alone`, headers: { [name]: opaque }, edge: true },
        { name: `${name} without UA`, headers: { [name]: opaque, 'user-agent': '' }, edge: true },
      ]),
      { name: 'absent', edge: false },
      { name: 'empty', headers: Object.fromEntries(signatureNames.map((name) => [name, ''])), edge: false },
      { name: 'unrelated', headers: { 'signature-foo': opaque }, edge: false },
      { name: 'mixed', headers: { signature: '', 'signature-input': opaque }, edge: true },
      { name: 'existing bot case insensitive', headers: { 'user-agent': 'gPtBoT' }, edge: true },
      { name: 'static', headers: { signature: opaque }, pathname: '/asset.js', edge: false },
      { name: 'disabled domain', headers: { signature: opaque, host: 'disabled.example' }, edge: false },
      { name: 'callback', headers: { signature: opaque, 'x-edgeoptimize-request': '1' }, edge: false },
      { name: 'empty callback', headers: { signature: opaque, 'x-edgeoptimize-request': '' }, edge: true },
      { name: 'fallback exclusion', headers: { signature: opaque }, pathname: '/--adobe-eo-fallback', edge: false },
      { name: 'ingress whitespace normalized', headers: { signature: '   ' }, edge: false },
    ];
    for (const fixture of fixtures) await t.test(fixture.name, async () => {
      const pathname = fixture.pathname || '/page.html?q=1';
      const response = await request(port, pathname, fixture.headers);
      assert.equal(response.status, 200);
      assert.equal(response.headers['x-test-upstream'], fixture.edge ? 'edge' : 'origin');
      const received = JSON.parse(response.body);
      assert.equal(received.url, pathname);
      for (const name of signatureNames) {
        const value = fixture.headers?.[name];
        // HTTP ingress removes surrounding whitespace before the config sees it.
        assert.equal(received.headers[name], value === '   ' ? '' : value);
      }
      if (fixture.edge) {
        assert.equal(received.headers['x-edgeoptimize-api-key'], 'test-key');
        assert.equal(received.headers['x-edgeoptimize-config'], 'LLMCLIENT=TRUE;');
        assert.equal(received.headers['x-edgeoptimize-url'], pathname);
        assert.equal(received.headers['x-forwarded-host'], 'enabled.example');
      }
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});
