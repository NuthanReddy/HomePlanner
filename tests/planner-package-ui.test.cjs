const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const UI = require('../planner-package-ui.js');
const { createFixture, controllerFor } = require('./fixtures/drawing-fixtures.cjs');

const defaults = () => ({ version: 1, title: '', paper: 'A3', orientation: 'landscape',
  scaleDenominator: 100, units: 'metric', pngDpi: 150 });
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function analysis(result = null) {
  const listeners = new Set();
  return { listeners, getState: () => ({ result }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    change(value, emit = true) { result = value; if (emit) listeners.forEach(fn => fn()); },
    visualChange() { listeners.forEach(fn => fn()); } };
}
function setup(options = {}) {
  let project = { id: 'one', revision: 0, name: 'House', activeFloorId: 'ground',
    floors: [{ id: 'ground' }, { id: 'upper' }] };
  const calls = [], captures = [], listeners = new Set(), commands = [], urls = [], revoked = [];
  const airflow = analysis(), light = analysis(), hosts = {
    workspaceAirflow: { homePlannerAirflow: airflow }, workspaceLightStudy: { homePlannerLight: light }
  };
  const bridge = options.bridge || {
    getProject: () => project,
    inputFingerprint: () => JSON.stringify([project.name, project.floors, project.documentation]),
    getDrawingScene() {
      const scene = freeze({ projectId: project.id, revision: project.revision, documentation: clone(project.documentation || {}) });
      captures.push(scene); return scene;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    execute(command) {
      commands.push(command);
      if (command.type === 'set-documentation') project = { ...project, revision: project.revision + 1, documentation: clone(command.value) };
      else if (command.type === 'select-floor') project = { ...project, activeFloorId: command.id };
      else throw new Error('Unexpected edit');
      listeners.forEach(fn => fn());
    },
    getScene: () => ({ rooms: [{ id: 'upper:living' }], walls: [], furniture: [], openings: [] }),
    select(ref) { commands.push({ type: 'select', ...ref }); listeners.forEach(fn => fn()); }
  };
  const runtime = {
    Blob, AbortController,
    URL: { createObjectURL(blob) { const url = `blob:package-${urls.length}`; urls.push({ url, blob }); return url; },
      revokeObjectURL(url) { revoked.push(url); } },
    HomePlannerPackage: {
      defaults, normalizeSettings: value => ({ ...value }),
      build(scene, settings, evidence) {
        calls.push({ scene, settings, evidence });
        return freeze({ version: 1, sheets: [0, 1, 2].map(index => ({
          version: 1, widthMm: 420, heightMm: 297, primitives: [],
          metadata: { revision: scene.revision, title: settings.title, index }
        })), manifest: { projectId: scene.projectId, revision: scene.revision, settings: { ...settings }, orderedPages: [0, 1, 2] },
        findings: [{ id: 'actual-finding', code: 'UNASSESSED', message: 'Unknown wall\nతెలుగు <script>literal</script>',
          floorId: 'upper', entityId: 'upper:living', discipline: 'architectural', severity: 'warning' }],
        attachments: evidence.airflow ? [{ fileName: 'airflow.json', mime: 'application/json', content: JSON.stringify(evidence.airflow) }] : [] });
      }
    },
    HomePlannerDrawing: { toSVG: sheet => `<svg xmlns="http://www.w3.org/2000/svg"><text>${sheet.metadata.index}</text></svg>` },
    HomePlannerDrawingExport: { pdfBytes: async () => new Uint8Array([37, 80, 68, 70]),
      pngBlob: async () => new Blob(['png'], { type: 'image/png' }) },
    HomePlannerWorkspace: { navigate(route) { commands.push({ type: 'route', route }); } }
  };
  const document = { getElementById: id => hosts[id] };
  const controller = UI.createController(bridge, runtime, document);
  return { controller, bridge, runtime, document, hosts, airflow, light, calls, captures, commands, listeners, urls, revoked,
    change(patch, emit = true) { project = { ...project, ...patch }; if (emit) listeners.forEach(fn => fn()); } };
}

test('lazy defaults, all pages share one frozen capture; PDF is one all-page file with evidence', async () => {
  const s = setup();
  assert.equal(s.calls.length, 0); assert.equal(s.commands.length, 0);
  assert.deepEqual(s.controller.getState().settings, defaults());
  s.airflow.change(freeze({ revision: 0, actual: 'evidence' }));
  let sheets;
  s.runtime.HomePlannerDrawingExport.pdfBytes = async value => { sheets = value; return new Uint8Array([1]); };
  s.controller.refresh();
  const result = await s.controller.exportFiles('pdf');
  assert.equal(s.captures.length, 1); assert.equal(s.calls.length, 1);
  assert.equal(sheets, result.package.sheets);
  assert.ok(Object.isFrozen(result.package.manifest));
  assert.equal(s.calls[0].evidence.airflow, s.airflow.getState().result);
  assert.equal(s.calls[0].evidence.light, null);
  assert.deepEqual(result.outputs.map(output => output.fileName),
    ['homeplanner-package-r0.pdf', 'homeplanner-package-r0.manifest.json', 'airflow.json']);
  assert.equal(result.isCurrent(), true);
  assert.equal(s.commands.length, 0);
});

for (const format of ['svg', 'png', 'manifest']) test(`${format} includes the manifest and all available evidence`, async () => {
  const s = setup(); s.airflow.change(freeze({ actual: true }));
  const result = await s.controller.exportFiles(format);
  assert.equal(result.outputs.length, format === 'manifest' ? 2 : 5);
  assert.equal(result.outputs.at(-1).fileName, 'airflow.json');
  if (format !== 'manifest') assert.equal(new Set(result.outputs.slice(0, 3).map(item => item.fileName)).size, 3);
  assert.equal(s.captures.length, 1);
  assert.equal(await result.outputs.at(-2).blob.text(), JSON.stringify(result.package.manifest, null, 2));
});

test('save syncs latest documentation without clobbering unrelated same-project changes or draft', () => {
  const s = setup(); s.controller.setSettings({ title: 'Draft', paper: 'A2' });
  const documentation = { version: 1, views: [{ id: 'latest' }], sheets: [{ id: 'sheet' }] };
  s.change({ documentation }, false);
  assert.equal(s.controller.saveSettings(), true);
  const command = s.commands.at(-1);
  assert.equal(command.type, 'set-documentation');
  assert.deepEqual(command.value.views, documentation.views); assert.deepEqual(command.value.sheets, documentation.sheets);
  assert.equal(command.value.package.title, 'Draft');
  assert.deepEqual(Object.keys(command.value.package).sort(), Object.keys(defaults()).sort());
  assert.equal(s.controller.getState().settingsDirty, false);
  assert.match(s.controller.getState().message, /global project Save/);
});

test('saved intent changes retain conflicted drafts; explicit reload and project return restore the right settings', () => {
  const s = setup();
  s.controller.setSettings({ title: 'unsaved' }); s.change({ name: 'Changed' });
  assert.equal(s.controller.getState().settings.title, 'unsaved');
  s.change({ documentation: { version: 1, views: [], sheets: [], package: { ...defaults(), title: 'external' } } });
  assert.equal(s.controller.getState().settings.title, 'unsaved');
  assert.match(s.controller.getState().error, /draft is retained/);
  assert.equal(s.controller.saveSettings(), false);
  s.controller.discardSettingsDraft();
  assert.equal(s.controller.getState().settings.title, 'external');
  s.change({ documentation: undefined }); assert.equal(s.controller.getState().settings.title, '');
  s.controller.setSettings({ title: 'local' }); s.change({ id: 'two' });
  assert.equal(s.controller.getState().settings.title, '');
  assert.equal(s.controller.getState().settingsDirty, false);
  s.change({ id: 'one' });
  assert.equal(s.controller.getState().settings.title, 'local');
  assert.equal(s.controller.getState().settingsDirty, true);
});

test('adding or removing an explicit default package retains drafts and exposes a source conflict', () => {
  const s = setup(); s.controller.setSettings({ title: 'unsaved' });
  s.change({ documentation: { version: 1, views: [], sheets: [], package: defaults() } });
  assert.equal(s.controller.getState().settings.title, 'unsaved');
  assert.match(s.controller.getState().error, /draft is retained/);
  s.controller.discardSettingsDraft();
  s.controller.setSettings({ title: 'another draft' });
  s.change({ documentation: { version: 1, views: [], sheets: [] } });
  assert.equal(s.controller.getState().settings.title, 'another draft');
  assert.equal(s.controller.saveSettings(), false);
  s.controller.discardSettingsDraft(); assert.equal(s.controller.getState().settings.title, '');
});

test('settings validation is atomic, exact and control-free', () => {
  const s = setup();
  for (const patch of [{ paper: 'A0' }, { version: 2 }, { title: 'x\n' }, { title: '\u0085' },
    { title: 'x'.repeat(201) }, { units: 'guess' }, { foo: 4 }, { scaleDenominator: 80 }, { pngDpi: 300 }])
    assert.throws(() => s.controller.setSettings(patch));
  assert.deepEqual(s.controller.getState().settings, defaults());
  s.controller.setSettings({ title: '日本語 <script>literal</script>' });
  assert.equal(s.controller.getState().settingsDirty, true);
});

test('same-id/revision content replacement invalidates; selection and floor navigation preserve all-floor package', async () => {
  const s = setup(), result = await s.controller.exportFiles('svg');
  s.change({ activeFloorId: 'upper' }); s.bridge.select({ kind: 'room', id: 'upper:living' });
  assert.equal(result.isCurrent(), true); assert.equal(s.captures.length, 1); assert.equal(s.revoked.length, 0);
  s.change({ name: 'Different content' }, false);
  assert.equal(result.isCurrent(), false);
  assert.equal(s.controller.getState().preview, null); assert.equal(s.controller.getState().package, null);
  assert.equal(s.revoked.length, result.outputs.length);
  assert.equal(await result.outputs.at(-1).blob.text(), JSON.stringify(result.package.manifest, null, 2));
});

test('capture source revision and before/after fingerprint guards reject inconsistent snapshots', () => {
  const s = setup(), original = s.bridge.getDrawingScene;
  s.bridge.getDrawingScene = () => { const scene = original(); s.change({ name: 'new' }, false); return scene; };
  assert.equal(s.controller.refresh(), null); assert.equal(s.calls.length, 0);
  s.bridge.getDrawingScene = () => ({ projectId: 'wrong', revision: 0 });
  assert.equal(s.controller.refresh(), null); assert.match(s.controller.getState().error, /Captured package source/);
});

test('page and zoom are view-only; dpi discards output but does not rebuild physical package', async () => {
  const s = setup(), result = await s.controller.exportFiles('svg'), pack = s.controller.getState().package;
  const urls = s.urls.length;
  s.controller.setPage(2); s.controller.setZoom('full');
  assert.equal(s.controller.getState().preview.pageIndex, 2);
  assert.equal(s.controller.getState().outputs[0], result.outputs[0]);
  assert.equal(s.urls.length, urls); assert.equal(s.revoked.length, 0); assert.equal(result.isCurrent(), true);
  s.controller.setSettings({ pngDpi: 72 });
  assert.equal(s.controller.getState().package.sheets, pack.sheets); assert.equal(s.controller.getState().outputs.length, 0);
  assert.equal(s.controller.getState().package.manifest.settings.pngDpi, 72);
  assert.equal(pack.manifest.settings.pngDpi, 150);
  assert.ok(Object.isFrozen(s.controller.getState().package.manifest.settings));
  const densities = []; s.runtime.HomePlannerDrawingExport.pngBlob = async (sheet, options) => {
    assert.equal(Object.hasOwn(options, 'dpi'), false, 'use the actual exporter density contract');
    densities.push(options.pixelsPerMm); return new Blob(['png']);
  };
  await s.controller.exportFiles('png');
  assert.deepEqual(densities, Array(3).fill(72 / 25.4));
  s.controller.setSettings({ pngDpi: 150 }); await s.controller.exportFiles('png');
  assert.deepEqual(densities.slice(3), Array(3).fill(150 / 25.4));
  assert.equal(s.controller.getState().package.manifest.settings.pngDpi, 150);
  assert.equal(s.captures.length, 1); assert.equal(s.calls.length, 1);
  assert.throws(() => s.controller.setPage(20), /available/);
});

for (const reason of ['cancel', 'settings', 'project', 'analysis', 'silent-analysis', 'dispose'])
  test(`${reason} during encode prevents all output URLs and further pages`, async () => {
    const s = setup(); let complete, count = 0, signal;
    s.runtime.HomePlannerDrawingExport.pngBlob = (sheet, options) => {
      count++; signal = options.signal; return new Promise(resolve => { complete = resolve; });
    };
    const pending = s.controller.exportFiles('png');
    assert.match(s.controller.getState().message, /page 1 of 3/);
    if (reason === 'cancel') s.controller.cancel();
    if (reason === 'settings') s.controller.setSettings({ paper: 'A4' });
    if (reason === 'project') s.change({ name: 'replaced' }, false);
    if (reason === 'analysis' || reason === 'silent-analysis') s.light.change(freeze({ realResult: true }), reason === 'analysis');
    if (reason === 'dispose') s.controller.dispose();
    complete(new Blob(['png']));
    assert.equal(await pending, null); assert.equal(count, 1);
    assert.equal(s.controller.getState().outputs.length, 0); assert.equal(s.urls.length, 0);
    if (!['project', 'silent-analysis'].includes(reason)) assert.equal(signal.aborted, true);
  });

test('a later-page failure publishes nothing; retry is possible', async () => {
  const s = setup(); let count = 0;
  s.runtime.HomePlannerDrawingExport.pngBlob = async () => {
    if (++count === 2) throw new Error('Raster cap exceeded'); return new Blob(['png']);
  };
  assert.equal(await s.controller.exportFiles('png'), null);
  assert.equal(s.urls.length, 0); assert.equal(s.controller.getState().outputs.length, 0);
  assert.match(s.controller.getState().error, /Raster cap/);
  assert.ok(await s.controller.exportFiles('svg'));
});

test('superseded PDF cannot overwrite newer complete SVG output', async () => {
  const s = setup(); let complete;
  s.runtime.HomePlannerDrawingExport.pdfBytes = () => new Promise(resolve => { complete = resolve; });
  const old = s.controller.exportFiles('pdf'), current = await s.controller.exportFiles('svg');
  complete(new Uint8Array([1]));
  assert.equal(await old, null); assert.equal(current.isCurrent(), true);
  assert.deepEqual(s.controller.getState().outputs, current.outputs);
});

test('late controllers reconnect, result changes invalidate, visual changes do not, disposal unsubscribes', async () => {
  const s = setup(); delete s.hosts.workspaceLightStudy; s.controller.sync();
  assert.equal(s.light.listeners.size, 0);
  const result = await s.controller.exportFiles('svg');
  s.hosts.workspaceLightStudy = { homePlannerLight: s.light }; s.controller.sync();
  assert.equal(s.light.listeners.size, 1);
  s.light.visualChange(); assert.equal(result.isCurrent(), true);
  s.light.change(freeze({ numericalResult: 'new' }));
  assert.equal(s.controller.getState().package, null);
  assert.match(s.controller.getState().message, /Analysis evidence changed/);
  s.controller.dispose(); assert.equal(s.light.listeners.size, 0); assert.equal(s.airflow.listeners.size, 0);
  assert.equal(s.listeners.size, 0);
});

test('URL allocation failure rolls back all allocated URLs', async () => {
  const s = setup(), create = s.runtime.URL.createObjectURL;
  s.runtime.URL.createObjectURL = blob => { if (s.urls.length === 2) throw new Error('URL allocation failed'); return create(blob); };
  assert.equal(await s.controller.exportFiles('svg'), null);
  assert.equal(s.controller.getState().outputs.length, 0);
  assert.equal(s.revoked.length, 2);
});

test('missing package, drawing renderer, export and Blob runtimes have explicit recoverable errors', async () => {
  const s = setup(), pack = s.runtime.HomePlannerPackage, drawing = s.runtime.HomePlannerDrawing;
  delete s.runtime.HomePlannerPackage;
  assert.equal(s.controller.refresh(), null); assert.match(s.controller.getState().error, /foundation unavailable/);
  s.runtime.HomePlannerPackage = pack; delete s.runtime.HomePlannerDrawing;
  assert.equal(s.controller.refresh(), null); assert.match(s.controller.getState().error, /renderer unavailable/);
  s.runtime.HomePlannerDrawing = drawing; delete s.runtime.HomePlannerDrawingExport;
  assert.equal(await s.controller.exportFiles('pdf'), null); assert.match(s.controller.getState().error, /PDF exporter/);
  assert.equal(await s.controller.exportFiles('png'), null); assert.match(s.controller.getState().error, /PNG exporter/);
  delete s.runtime.Blob;
  assert.equal(await s.controller.exportFiles('manifest'), null); assert.match(s.controller.getState().error, /Blob downloads/);
  s.runtime.Blob = Blob; assert.ok(await s.controller.exportFiles('manifest'));
  assert.throws(() => UI.createController(null), /bridge unavailable/);
  const noRuntime = UI.createController(s.bridge, null);
  assert.equal(noRuntime.refresh(), null); assert.match(noRuntime.getState().error, /foundation unavailable/); noRuntime.dispose();
});

test('finding links select only exact existing floor/entity IDs; missing objects never guess', () => {
  const s = setup(); s.controller.refresh();
  assert.equal(s.controller.openFinding('actual-finding'), true);
  assert.ok(s.commands.some(command => command.type === 'select-floor' && command.id === 'upper'));
  assert.ok(s.commands.some(command => command.type === 'select' && command.id === 'upper:living'));
  s.bridge.getScene = () => ({ rooms: [{ id: 'living', sourceId: 'upper:living' }] });
  s.commands.length = 0;
  assert.equal(s.controller.openFinding('actual-finding'), false);
  assert.match(s.controller.getState().error, /No substitute/);
  assert.equal(s.commands.filter(command => command.type === 'select').length, 0);
  assert.equal(s.commands.filter(command => command.type === 'route').length, 0, 'errors stay in the visible package');
});

for (const [collection, kind, discipline, host, property, route] of [
  ['structural', 'structural', 'structure', 'workspaceStructure', 'homePlannerStructure', 'design/structure'],
  ['fixtures', 'fixture', 'plumbing', 'workspacePlumbing', 'homePlannerServices', 'design/plumbing'],
  ['serviceNodes', 'serviceNode', 'drainage', 'workspaceDrainage', 'homePlannerDrainage', 'design/drainage'],
  ['serviceRoutes', 'serviceRoute', 'plumbing', 'workspacePlumbing', 'homePlannerServices', 'design/plumbing']
]) test(`package source opens exact ${collection} record in its owning workbench`, () => {
  const s = setup(), id = 'upper:authored:exact', selected = [];
  s.change({ floors: [{ id: 'ground' }, { id: 'upper', authored: { [collection]: [{ id }] } }] });
  s.hosts[host] = { [property]: { select(...args) { selected.push(args); } } };
  const build = s.runtime.HomePlannerPackage.build;
  s.runtime.HomePlannerPackage.build = (...args) => {
    const pack = clone(build(...args)); pack.findings[0] = { ...pack.findings[0], entityId: id, discipline }; return freeze(pack);
  };
  s.controller.refresh();
  assert.equal(s.controller.openFinding('actual-finding'), true, s.controller.getState().error);
  assert.deepEqual(selected, [collection === 'structural' ? [id] : [collection, id]]);
  assert.ok(s.commands.some(command => command.type === 'select' && command.id === id && command.kind === kind));
  assert.deepEqual(s.commands.at(-1), { type: 'route', route });
  delete s.hosts[host]; s.commands.length = 0;
  assert.equal(s.controller.openFinding('actual-finding'), false);
  assert.equal(s.commands.some(command => command.type === 'route'), false);
});

test('package source uses the electrical selection kind rather than architectural-only lookup', () => {
  const s = setup(), id = 'upper:electrical:point';
  s.change({ electrical: [{ id }] });
  const build = s.runtime.HomePlannerPackage.build;
  s.runtime.HomePlannerPackage.build = (...args) => {
    const pack = clone(build(...args)); pack.findings[0] = { ...pack.findings[0], entityId: id, discipline: 'electrical' }; return freeze(pack);
  };
  s.controller.refresh(); assert.equal(s.controller.openFinding('actual-finding'), true);
  assert.ok(s.commands.some(command => command.type === 'select' && command.kind === 'electrical' && command.id === id));
  assert.deepEqual(s.commands.at(-1), { type: 'route', route: 'design/electrical' });
});

test('unrouted authored sources fail visibly rather than claiming to open a working editor', () => {
  const s = setup(), id = 'upper:authored:dimension';
  s.change({ floors: [{ id: 'ground' }, { id: 'upper', authored: { dimensions: [{ id }] } }] });
  const build = s.runtime.HomePlannerPackage.build;
  s.runtime.HomePlannerPackage.build = (...args) => {
    const pack = clone(build(...args)); pack.findings[0].entityId = id; return freeze(pack);
  };
  s.controller.refresh(); assert.equal(s.controller.openFinding('actual-finding'), false);
  assert.match(s.controller.getState().error, /no routed editor/);
  assert.equal(s.commands.some(command => command.type === 'route' || command.type === 'select'), false);
});

function documentFor(s) {
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.listeners = new Map();
      this.dataset = {}; this.classList = { add() {} }; this.value = ''; this.textContent = ''; this.open = false; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    fire(name) { this.listeners.get(name)?.forEach(fn => fn({ preventDefault() {} })); }
  }
  const find = (node, predicate) => predicate(node) ? node : node.children.map(child => find(child, predicate)).find(Boolean);
  const host = new Element('section'), document = new Element('document');
  document.createElement = tag => new Element(tag);
  document.getElementById = id => id === 'workspacePackage' ? host : s.hosts[id] || find(host, node => node.id === id);
  const runtime = s.runtime;
  runtime.document = document; runtime.HomePlanner = s.bridge;
  runtime.addEventListener = () => {}; runtime.removeEventListener = () => {};
  document.defaultView = runtime;
  return { host, document, runtime, find };
}

test('mount is lazy/idempotent, native disclosures closed, original Window receivers, URLs cleaned', async () => {
  const s = setup(); s.controller.dispose();
  const { host, document, runtime, find } = documentFor(s), BlobClass = runtime.Blob, urlAPI = runtime.URL;
  Object.defineProperty(runtime, 'Blob', { get() { assert.equal(this, runtime); return BlobClass; }, configurable: true });
  Object.defineProperty(runtime, 'URL', { get() { assert.equal(this, runtime); return urlAPI; }, configurable: true });
  const controller = UI.mount(document, runtime);
  assert.equal(UI.mount(document, runtime), controller); assert.equal(host.homePlannerPackage, controller);
  assert.equal(s.captures.length, 0); assert.equal(s.commands.length, 0);
  document.fire('homeplanner:workspace-change'); assert.equal(s.captures.length, 0);
  assert.ok(host.children.filter(node => node.tagName === 'DETAILS').every(node => node.open === false));
  const previewPosition = host.children.indexOf(document.getElementById('hp-package-preview'));
  for (const className of ['hp-package-settings', 'hp-package-findings'])
    assert.ok(previewPosition < host.children.findIndex(node => node.className === className));
  assert.ok(host.children.findIndex(node => node.className === 'hp-package-view') < previewPosition);
  assert.ok(previewPosition < host.children.findIndex(node => node.children.includes(document.getElementById('hp-package-export-png'))));
  assert.ok(host.children.findIndex(node => node.children.includes(document.getElementById('hp-package-export-pdf'))) < previewPosition);
  assert.equal(document.getElementById('hp-package-status').attributes.role, 'status');
  controller.refresh();
  assert.ok(find(host, node => node.tagName === 'TD' && node.textContent.includes('తెలుగు <script>literal</script>')));
  const output = await controller.exportFiles('svg'), outputURLs = output.outputs.map(value => value.url);
  controller.setPage(1);
  assert.ok(outputURLs.every(url => !s.revoked.includes(url)));
  const urlsBeforeZoom = s.urls.length;
  controller.setZoom('full'); assert.equal(s.urls.length, urlsBeforeZoom);
  controller.cancel();
  assert.equal(s.revoked.length, s.urls.length);
  controller.dispose(); assert.equal(host.homePlannerPackage, undefined);
  assert.equal(document.listeners.get('homeplanner:workspace-change').size, 0);
});

test('browser global loads without document and styles contain overflow and native targets', () => {
  const source = fs.readFileSync(require.resolve('../planner-package-ui.js'), 'utf8'), sandbox = {};
  vm.runInNewContext(source, sandbox); assert.equal(typeof sandbox.HomePlannerPackageUI.mount, 'function');
  assert.equal(UI.mount({ getElementById: () => null }), null);
  assert.doesNotMatch(source, /\.innerHTML|insertAdjacentHTML|Object\.create\(.*(?:window|runtime)/);
  const css = fs.readFileSync(require.resolve('../planner-package-ui.css'), 'utf8');
  assert.match(css, /min-height: 44px/); assert.match(css, /scrollbar-gutter: stable/);
  assert.match(css, /overflow-x: auto/); assert.match(css, /focus-visible/); assert.match(css, /table-layout: fixed/);
  assert.doesNotMatch(css, /--accent/);
  assert.match(css, /\.hp-package-outputs a \{ color: var\(--acc, currentColor\)/);
});

test('real bridge settings persist across undo, redo, floor navigation and JSON roundtrip; older projects default', () => {
  const fixture = createFixture('multiple-floors'), bridge = controllerFor(fixture.project), s = setup({ bridge });
  const before = bridge.getProject();
  s.controller.setSettings({ title: 'Issued reference', units: 'imperial' });
  assert.equal(s.controller.saveSettings(), true, s.controller.getState().error);
  assert.equal(bridge.canUndo(), true);
  assert.deepEqual(bridge.getProject().documentation.views, before.documentation?.views || []);
  assert.deepEqual(bridge.getProject().documentation.sheets, before.documentation?.sheets || []);
  bridge.undo(); assert.equal(s.controller.getState().settings.title, '');
  bridge.redo(); assert.equal(s.controller.getState().settings.title, 'Issued reference');
  bridge.execute({ type: 'select-floor', id: 'upper' });
  assert.equal(s.controller.getState().settings.title, 'Issued reference');
  const roundtrip = controllerFor(JSON.parse(bridge.exportProject()));
  assert.equal(UI.createController(roundtrip, s.runtime).getState().settings.title, 'Issued reference');
  bridge.importProject(JSON.stringify(fixture.project));
  assert.deepEqual(s.controller.getState().settings, defaults());
  s.controller.dispose();
});

test('real bridge same-id/revision import replacement invalidates frozen package', () => {
  const bridge = controllerFor(createFixture('multiple-floors').project), s = setup({ bridge });
  s.controller.refresh(); assert.ok(s.controller.getState().package);
  const changed = JSON.parse(bridge.exportProject()); changed.name = 'Replacement';
  bridge.replaceProject(changed);
  assert.equal(s.controller.getState().package, null); assert.equal(s.controller.getState().stale, true);
  s.controller.dispose();
});

test('real bridge navigation and selection preserve complete outputs and captured revision', async () => {
  const bridge = controllerFor(createFixture('multiple-floors').project), s = setup({ bridge });
  let captures = 0; const capture = bridge.getDrawingScene;
  bridge.getDrawingScene = () => { captures++; return capture(); };
  const result = await s.controller.exportFiles('svg');
  bridge.execute({ type: 'select-floor', id: 'upper' }); bridge.select({ id: 'upper:living', kind: 'room' });
  assert.equal(result.isCurrent(), true); assert.equal(captures, 1);
  assert.equal(s.revoked.length, 0); assert.equal(s.controller.getState().package, result.package);
  s.controller.dispose();
});

test('real package foundation integration builds and exports fixture when installed', async t => {
  let Package;
  try { Package = require('../planner-package.js'); } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return t.skip('Parallel foundation has not landed yet');
    throw error;
  }
  const bridge = controllerFor(createFixture('multiple-floors').project), s = setup({ bridge });
  s.runtime.HomePlannerPackage = Package; s.runtime.HomePlannerDrawing = require('../planner-drawing.js');
  s.runtime.HomePlannerDrawingExport = require('../planner-drawing-export.js');
  const result = await s.controller.exportFiles('svg');
  assert.ok(result, s.controller.getState().error);
  assert.ok(result.package.sheets.length > 1);
  assert.equal(result.outputs.filter(output => output.fileName.endsWith('.svg')).length, result.package.sheets.length);
  const pdf = await s.controller.exportFiles('pdf');
  assert.ok(pdf, s.controller.getState().error);
  assert.equal(pdf.package, result.package);
  assert.equal(pdf.outputs.filter(output => output.mime === 'application/pdf').length, 1);
  s.controller.dispose();
});
