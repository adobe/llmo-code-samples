import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const signatureNames = ['signature-agent', 'signature-input', 'signature'];
const opaque = 'opaque; untouched="yes"';
const quiet = { log() {} };
const cases = [
  ...signatureNames.flatMap((name) => [
    { name: `${name} alone`, headers: { [name]: opaque }, route: true },
    { name: `${name} without UA`, headers: { [name]: opaque }, noUa: true, route: true },
  ]),
  { name: 'absent', headers: {}, route: false },
  { name: 'empty', headers: Object.fromEntries(signatureNames.map((name) => [name, ''])), route: false },
  { name: 'unrelated', headers: { 'signature-foo': opaque }, route: false },
  { name: 'mixed empty and nonempty', headers: { signature: '', 'signature-input': opaque }, route: true },
  { name: 'existing bot case insensitive', headers: { 'user-agent': 'gPtBoT' }, route: true },
  { name: 'static', headers: { signature: opaque }, path: '/asset.js', route: false },
  { name: 'callback', headers: { signature: opaque, 'x-edgeoptimize-request': '1' }, route: false },
  { name: 'empty callback', headers: { signature: opaque, 'x-edgeoptimize-request': '' }, route: true, viewerRoute: false },
];

async function load(kind, targetedPaths = null, edgeResult = 200) {
  const calls = [];
  const groups = [];
  const file = kind === 'worker'
    ? '../cloudflare/automation/src/worker.js' : '../cloudfront/cloudfront-function/viewer-request.js';
  let source = await readFile(new URL(file, import.meta.url), 'utf8');
  if (targetedPaths !== null) source = source.replace('TARGETED_PATHS = null;', `TARGETED_PATHS = ${JSON.stringify(targetedPaths)};`);
  if (kind === 'viewer') source += '\nexport { handler };';
  const context = vm.createContext({ URL, Headers, Request, Response, console: quiet,
    fetch: async (request, options) => {
      calls.push({ request, options });
      if (new URL(request.url).hostname === 'live.edgeoptimize.net') {
        if (edgeResult === 'network') throw new Error('test network error');
        return new Response('edge', { status: edgeResult, headers: { location: '/redirect' } });
      }
      return new Response('origin', { headers: { 'x-test-origin': '1' } });
    },
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => {
    assert.equal(specifier, 'cloudfront');
    return new vm.SyntheticModule(['default'], function initialize() {
      this.setExport('default', { createRequestOriginGroup(group) { groups.push(JSON.parse(JSON.stringify(group))); } });
    }, { context });
  });
  await module.evaluate();
  return { calls, groups, namespace: module.namespace };
}

for (const kind of ['worker', 'viewer']) {
  test(`${kind}: actual routing matrix`, async (t) => {
    for (const fixture of cases) await t.test(fixture.name, async () => {
      const runtime = await load(kind);
      const values = { ...(fixture.noUa ? {} : { 'user-agent': 'Mozilla/5.0' }), ...fixture.headers };
      const path = fixture.path || '/page.html';
      const expected = kind === 'viewer' ? fixture.viewerRoute ?? fixture.route : fixture.route;
      if (kind === 'worker') {
        // Native Fetch normalizes ingress values; compare the platform-exposed values.
        const request = new Request(`https://enabled.example${path}?q=1`, { headers: values });
        const before = [...request.headers];
        await runtime.namespace.default.fetch(request, { EDGE_OPTIMIZE_API_KEY: 'test-key', EDGE_OPTIMIZE_TARGET_HOST: 'origin.example' }, {});
        assert.equal(runtime.calls.length, 1);
        const upstream = runtime.calls[0].request;
        assert.equal(new URL(upstream.url).hostname, expected ? 'live.edgeoptimize.net' : 'enabled.example');
        assert.equal(new URL(upstream.url).search, '?q=1');
        for (const name of signatureNames) assert.equal(upstream.headers.get(name), request.headers.get(name));
        assert.deepEqual([...request.headers], before);
        if (expected) {
          assert.equal(upstream.redirect, 'manual');
          assert.equal(upstream.headers.get('x-edgeoptimize-config'), 'LLMCLIENT=TRUE;');
          assert.equal(upstream.headers.get('x-edgeoptimize-url'), `${path}?q=1`);
          assert.equal(upstream.headers.get('x-edgeoptimize-api-key'), 'test-key');
          assert.equal(upstream.headers.get('x-forwarded-host'), 'origin.example');
          assert.equal(runtime.calls[0].options.cf.cacheEverything, true);
        } else assert.equal(upstream, request);
      } else {
        const headers = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
        const originalSignatures = signatureNames.map((name) => headers[name]);
        const request = { uri: path, headers };
        assert.equal(runtime.namespace.handler({ request }), request);
        assert.equal(runtime.groups.length, Number(expected));
        signatureNames.forEach((name, index) => assert.equal(headers[name], originalSignatures[index]));
        if (expected) {
          assert.deepEqual(runtime.groups[0], {
            originIds: [{ originId: 'EdgeOptimize_Origin' }, { originId: 'YOUR_DEFAULT_ORIGIN' }],
            failoverCriteria: { statusCodes: [400, 403, 404, 416, 500, 502, 503, 504] },
          });
          assert.equal(headers['x-edgeoptimize-config'].value, 'LLMCLIENT=true');
          assert.equal(headers['x-edgeoptimize-url'].value, path);
        }
      }
    });
  });
  test(`${kind}: configured paths retain HTML restriction`, async () => {
    for (const [path, expected] of [['/page.html', true], ['/other.html', false], ['/asset.js', false]]) {
      const runtime = await load(kind, ['/page.html', '/asset.js']);
      if (kind === 'viewer') {
        runtime.namespace.handler({ request: { uri: path, headers: { signature: { value: opaque } } } });
        assert.equal(runtime.groups.length, Number(expected));
      } else {
        await runtime.namespace.default.fetch(new Request(`https://enabled.example${path}`, { headers: { Signature: opaque } }), {}, {});
        assert.equal(new URL(runtime.calls[0].request.url).hostname, expected ? 'live.edgeoptimize.net' : 'enabled.example');
      }
    }
  });
  test(`${kind}: platform-exposed whitespace is not trimmed by routing`, async () => {
    const runtime = await load(kind);
    if (kind === 'viewer') {
      const header = { value: '   ' };
      runtime.namespace.handler({ request: { uri: '/page.html', headers: { signature: header } } });
      assert.equal(runtime.groups.length, 1);
      assert.equal(header.value, '   ');
    } else {
      const request = new Request('https://enabled.example/page.html', { headers: { Signature: '   ' } });
      await runtime.namespace.default.fetch(request, {}, {});
      assert.equal(new URL(runtime.calls[0].request.url).hostname, request.headers.get('signature') ? 'live.edgeoptimize.net' : 'enabled.example');
    }
  });
}

for (const result of [400, 404, 499, 500, 503, 599, 'network']) {
  test(`worker preserves signatures on ${result} fallback`, async () => {
    const runtime = await load('worker', null, result);
    const request = new Request('https://enabled.example/page.html?q=1', {
      headers: { ...Object.fromEntries(signatureNames.map((name) => [name, opaque])),
        'x-edgeoptimize-api-key': 'spoof', 'x-edgeoptimize-config': 'spoof', 'x-edgeoptimize-url': 'spoof' },
    });
    const response = await runtime.namespace.default.fetch(request, { EDGE_OPTIMIZE_TARGET_HOST: 'origin.example', EDGE_OPTIMIZE_API_KEY: 'real' }, {});
    assert.equal(runtime.calls.length, 2);
    assert.equal(runtime.calls[1].request.url, 'https://origin.example/page.html?q=1');
    for (const { request: upstream } of runtime.calls) for (const name of signatureNames) assert.equal(upstream.headers.get(name), opaque);
    const fallback = runtime.calls[1].request;
    assert.equal(fallback.headers.get('x-edgeoptimize-request'), 'fo');
    for (const name of ['x-edgeoptimize-api-key', 'x-edgeoptimize-config', 'x-edgeoptimize-url', 'x-forwarded-host']) assert.equal(fallback.headers.get(name), null);
    assert.equal(response.headers.get('x-edgeoptimize-fo'), '1');
    assert.equal(await response.text(), 'origin');
  });
}
test('worker returns redirects without origin fallback', async () => {
  const runtime = await load('worker', null, 302);
  const response = await runtime.namespace.default.fetch(new Request('https://enabled.example/page.html', { headers: { signature: opaque } }), {}, {});
  assert.equal(runtime.calls.length, 1);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/redirect');
});
