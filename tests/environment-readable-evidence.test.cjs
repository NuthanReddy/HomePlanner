const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../environment-ui.js'), 'utf8');
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('Environment warnings deduplicate readable messages and retain exact records in closed details', () => {
  const start = source.indexOf('  function warnList(items){'), end = source.indexOf('  function table(', start);
  const sandbox = { esc };
  vm.runInNewContext(source.slice(start, end), sandbox);
  const finding = { code: 'missing-height', message: 'Supply the building height.', ref: { floorId: 'ground', entityId: 'building-1' } };
  const html = sandbox.warnList([finding, JSON.parse(JSON.stringify(finding)), finding.message]);
  assert.equal((html.match(/<li>/g) || []).length, 1);
  assert.match(html, /<li>Supply the building height\.<\/li>/);
  assert.doesNotMatch(html.split('</ul>')[0], /floorId|missing-height|building-1/);
  assert.match(html, /<details class="env-details"><summary>Technical warning records/);
  assert.equal((html.match(/"floorId"/g) || []).length, 1);
  assert.match(sandbox.warnList([{ message: '<script>bad</script>' }]), /&lt;script&gt;/);
  assert.equal(sandbox.warnList([]), '');
});

test('window proposal shows dimensions before its closed exact command without applying an edit', () => {
  const start = source.indexOf('    function renderPreview(){'), end = source.indexOf('    function download(', start);
  const host = { innerHTML: '' }, command = { type: 'add-window', wallId: 'ground:wall-1', offsetM: 2,
    widthM: 1.2, heightM: 1.4, sillM: .9, openFraction: .5 };
  const sandbox = { by: () => host, preview: { reason: 'A second opening on this room.', command, cautions: [] },
    esc, nice: String, warnList: () => '', planSVG: () => '<svg></svg>', scene: () => ({}) };
  vm.runInNewContext(source.slice(start, end) + '\nrenderPreview();', sandbox);
  assert.match(host.innerHTML, /Width 1.2 m · Height 1.4 m · Sill 0.9 m · Open 50%/);
  assert.doesNotMatch(host.innerHTML.split('<details')[0], /wallId|offsetM|add-window/);
  assert.match(host.innerHTML, /<details class="env-details"><summary>Technical command<\/summary>/);
  assert.ok(host.innerHTML.includes(JSON.stringify(command, null, 2)));
  assert.match(host.innerHTML, /id="env-window-apply"/);
});
