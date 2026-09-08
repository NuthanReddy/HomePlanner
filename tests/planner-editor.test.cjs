const test = require('node:test');
const assert = require('node:assert/strict');
const editor = require('../planner-editor.js');

const copy = value => JSON.parse(JSON.stringify(value));
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const wall = deepFreeze({
  id: 'floor-one:wall-west', start: { x: 0, y: 0 }, end: { x: 0, y: 5 },
  heightM: 2.8, baseM: 0, thicknessM: .15, exterior: false, structuralRole: 'unknown'
});
const door = deepFreeze({
  id: 'floor-one:door', kind: 'hinged', wallId: wall.id,
  offsetM: .5, widthM: .9, sillM: 0, heightM: 2.1,
  hinge: 'start', swing: 'left', openFraction: .25
});
const windowOpening = deepFreeze({
  ...door, id: 'floor-one:window', kind: 'window', sillM: .9, heightM: 1.2
});
const project = deepFreeze({
  id: 'project', activeFloorId: 'floor-two', building: { floorElevationM: -.2 },
  floors: [
    { id: 'floor-one', name: 'Ground', heightM: 3 },
    { id: 'floor-two', name: 'Upper', heightM: 3.5 },
    { id: 'floor-three', name: 'Study only', heightM: 2.9 }
  ]
});

test('CommonJS loading and exported helpers do not require a DOM', () => {
  assert.equal(typeof editor.init, 'function');
  assert.equal(editor.init(null, null), null);
  assert.equal(typeof globalThis.document, 'undefined');
});

test('numeric input accepts finite decimal values without silently clamping', () => {
  for (const [raw, expected] of [['0', 0], ['-2.75', -2.75], ['.5', .5], ['+1.25', 1.25],
    [' 2.3 ', 2.3], ['1e-3', .001], [1.25, 1.25]]) {
    assert.equal(editor.numberValue(raw), expected);
  }
  assert.equal(editor.numberValue('-150'), -150);
  assert.equal(editor.numberValue('0.3333', { min: 0, max: 1 }), .3333);
});

test('blank, incomplete, non-decimal, non-finite and unit-bearing values are rejected', () => {
  for (const raw of ['', ' ', '-', '+', '.', '1e', 'NaN', 'Infinity', '1e9999', '1m',
    '2.5 feet', '0x10', '0b11', '1,25', '1_000', true, false, null, undefined, {}, []]) {
    assert.throws(() => editor.numberValue(raw, { label: 'Width' }), /Width:/, String(raw));
  }
});

test('numeric bounds reject instead of clamping, including positive dimensions', () => {
  assert.throws(() => editor.numberValue('0', { positive: true }), /greater than zero/);
  assert.throws(() => editor.numberValue('-1', { min: 0 }), /at least 0/);
  assert.throws(() => editor.numberValue('1.01', { max: 1 }), /no more than 1/);
  assert.equal(editor.numberValue('1', { min: 0, max: 1 }), 1);
});

test('selection resolution uses the exact kind and floor-namespaced ID', () => {
  const room = { id: 'floor-one:room' }, furniture = { id: 'floor-one:chair' };
  const scene = { rooms: [room], furniture: [furniture], walls: [wall], openings: [door, windowOpening] };
  assert.equal(editor.selectionEntity(scene, { kind: 'room', id: room.id }), room);
  assert.equal(editor.selectionEntity(scene, { kind: 'furniture', id: furniture.id }), furniture);
  assert.equal(editor.selectionEntity(scene, { kind: 'door', id: door.id }), door);
  assert.equal(editor.selectionEntity(scene, { kind: 'window', id: windowOpening.id }), windowOpening);
  assert.equal(editor.selectionEntity(scene, { kind: 'wall', id: wall.id }), wall);
  assert.equal(editor.selectionEntity(scene, { kind: 'window', id: door.id }), null);
  assert.equal(editor.selectionEntity(scene, { kind: 'room', id: 'floor-two:room' }), null);
  assert.equal(editor.selectionEntity(scene, { kind: 'unknown', id: room.id }), null);
});

test('invalid, deleted or unselected objects resolve to an explicit empty result', () => {
  assert.equal(editor.selectionEntity(null, { kind: 'room', id: 'gone' }), null);
  assert.equal(editor.selectionEntity({ rooms: [] }, { kind: 'room', id: 'gone' }), null);
  assert.equal(editor.selectionEntity({ rooms: [] }, null), null);
  assert.equal(editor.selectionEntity({ rooms: [] }, { kind: 'room', id: null }), null);
  assert.equal(editor.selectionEntity({ openings: [{ id: 'passage', kind: 'passage' }] },
    { kind: 'door', id: 'passage' }), null);
});

test('cross-floor selection resolves read-only without treating another storey as active', () => {
  const scenes = deepFreeze([
    { floorId: 'floor-one', rooms: [{ id: 'floor-one:room' }] },
    { floorId: 'floor-two', rooms: [{ id: 'floor-two:room' }] }
  ]);
  assert.equal(editor.selectionFloor(scenes, { kind: 'room', id: 'floor-two:room' }, 'floor-one'), 'floor-two');
  assert.equal(editor.selectionFloor(scenes, { kind: 'room', id: 'floor-one:room' }, 'floor-one'), null);
  assert.equal(editor.selectionFloor(scenes, { kind: 'door', id: 'floor-two:room' }, 'floor-one'), null);
  assert.equal(editor.selectionFloor(scenes, { kind: 'room', id: 'floor-two:deleted' }, 'floor-one'), null);
  assert.equal(editor.selectionFloor([], null, 'floor-one'), null);
});

test('rectangle changes preserve the latest unedited coordinates and the immutable snapshot', () => {
  const room = deepFreeze({ id: 'floor-one:room', rect: { x: 1, y: 2, w: 3, h: 4 } });
  const before = copy(room);
  assert.deepEqual(editor.rectCommand('room', room, 'x', '-.4'),
    { type: 'update-room', id: room.id, rect: { x: -.4, y: 2, w: 3, h: 4 } });
  const latest = deepFreeze({ ...room, rect: { ...room.rect, y: 3.4 } });
  assert.deepEqual(editor.rectCommand('furniture', latest, 'w', '1.8'),
    { type: 'update-furniture', id: room.id, rect: { x: 1, y: 3.4, w: 1.8, h: 4 } });
  assert.deepEqual(room, before);
});

test('rectangle editing rejects zero dimensions, corrupt source geometry and unsupported fields', () => {
  const room = { id: 'room', rect: { x: 1, y: 1, w: 2, h: 3 } };
  assert.throws(() => editor.rectCommand('room', room, 'w', '0'), /greater than zero/);
  assert.throws(() => editor.rectCommand('room', room, 'x', ''), /enter a number/);
  assert.throws(() => editor.rectCommand('room', { ...room, rect: { ...room.rect, h: NaN } }, 'x', '2'), /Depth/);
  assert.throws(() => editor.rectCommand('wall', room, 'x', '2'), /cannot be edited/);
  assert.throws(() => editor.rectCommand('room', room, 'z', '2'), /cannot be edited/);
  assert.throws(() => editor.rectCommand('room', null, 'x', '2'), /no longer/);
});

for (const [direction, expected] of Object.entries({ N: [0, 90, 180, 270], E: [90, 180, 270, 0],
  S: [180, 270, 0, 90], W: [270, 0, 90, 180] })) {
  test(`actual ${direction} bed head is retained across all four road headings`, () => {
    [0, 90, 180, 270].forEach((heading, index) => assert.equal(editor.headBearing(direction, heading), expected[index]));
    const bed = deepFreeze({ id: 'floor-one:bed', type: 'bed', rect: { x: 0, y: 0, w: 2, h: 2 }, pinned: false });
    assert.deepEqual(editor.bedHeadCommand(bed, direction),
      { type: 'update-furniture', id: bed.id, headLocal: direction, pinned: true });
  });
}

test('head direction never falls back to footprint aspect ratio or an assumed polarity', () => {
  const bed = { id: 'bed', type: 'bed', get rect() { throw new Error('Footprint must not be consulted'); } };
  assert.equal(editor.bedHeadCommand(bed, 'S').headLocal, 'S');
  assert.equal(editor.headBearing(undefined, 90), null);
  assert.equal(editor.headBearing('n', 90), null);
  assert.equal(editor.headBearing('N', undefined), null);
  assert.equal(editor.headBearing('N', NaN), null);
  assert.equal(editor.headBearing('W', -450), 180);
  assert.equal(editor.headBearing('E', 12.5), 102.5);
  assert.throws(() => editor.bedHeadCommand(bed, ''), /actual bed head/);
  assert.throws(() => editor.bedHeadCommand({ id: 'chair', type: 'chair' }, 'S'), /actual bed head/);
});

test('door controls submit exact canonical hinge, swing, width and operating state', () => {
  assert.deepEqual(editor.openingCommand('door', door, 'hinge', 'end', wall),
    { type: 'update-door', id: door.id, hinge: 'end' });
  assert.deepEqual(editor.openingCommand('door', door, 'swing', 'right', wall),
    { type: 'update-door', id: door.id, swing: 'right' });
  assert.deepEqual(editor.openingCommand('door', door, 'widthM', '1.05', wall),
    { type: 'update-door', id: door.id, widthM: 1.05 });
  assert.deepEqual(editor.openingCommand('door', door, 'openFraction', '0', wall),
    { type: 'update-door', id: door.id, openFraction: 0 });
  assert.equal(door.widthM, .9);
  assert.equal(door.openFraction, .25);
});

test('sliding doors keep operating/width edits but do not acquire hinge semantics', () => {
  const slider = { ...door, kind: 'sliding' };
  assert.deepEqual(editor.openingCommand('door', slider, 'openFraction', '.45', wall),
    { type: 'update-door', id: door.id, openFraction: .45 });
  for (const field of ['hinge', 'swing']) {
    assert.throws(() => editor.openingCommand('door', slider, field, field === 'hinge' ? 'end' : 'right', wall), /hinged doors/);
  }
});

test('window head editing translates to height without adding an unsupported head command', () => {
  const command = editor.openingCommand('window', windowOpening, 'headM', '2.3', wall);
  assert.equal(command.type, 'update-window');
  assert.equal(command.id, windowOpening.id);
  assert.ok(Math.abs(command.heightM - 1.4) < 1e-10);
  assert.equal(Object.hasOwn(command, 'headM'), false);
  assert.deepEqual(editor.openingCommand('window', windowOpening, 'sillM', '1.1', wall),
    { type: 'update-window', id: windowOpening.id, sillM: 1.1 });
  assert.equal(windowOpening.sillM, .9);
});

test('opening validation rejects unsafe dimensions, missing hosts and unsupported commands before execution', () => {
  const invalid = [
    ['door', door, 'widthM', '0', wall],
    ['door', door, 'widthM', '4.6', wall],
    ['door', door, 'openFraction', '-.1', wall],
    ['door', door, 'openFraction', '1.01', wall],
    ['door', door, 'heightM', '2.2', wall],
    ['door', door, 'hinge', 'north', wall],
    ['door', door, 'swing', 'in', wall],
    ['window', windowOpening, 'sillM', '-1', wall],
    ['window', windowOpening, 'headM', '.8', wall],
    ['window', windowOpening, 'headM', '2.9', wall],
    ['window', windowOpening, 'heightM', '0', wall],
    ['window', windowOpening, 'heightM', '2', wall],
    ['window', door, 'widthM', '1', wall],
    ['door', door, 'widthM', '1', null],
    ['door', door, 'widthM', '1', { ...wall, id: 'wrong-floor:wall' }]
  ];
  for (const args of invalid) assert.throws(() => editor.openingCommand(...args));
});

test('full and partial wall commands remain explicit, conceptual and immutable', () => {
  assert.equal(editor.wallLength(wall), 5);
  assert.deepEqual(editor.wallOpeningCommand(wall, { full: true }),
    { type: 'open-wall', id: wall.id, full: true, confirmConceptual: true });
  assert.deepEqual(editor.wallOpeningCommand(wall, { full: false, offsetM: '.5', widthM: '1.2' }),
    { type: 'open-wall', id: wall.id, full: false, offsetM: .5, widthM: 1.2, confirmConceptual: true });
  assert.equal(wall.exterior, false);
  assert.equal(Object.hasOwn(wall, 'removed'), false);
});

test('exterior, protected and unclassified walls cannot be opened by the inspector', () => {
  for (const patch of [{ exterior: true }, { exterior: undefined }, { structuralRole: 'structural' },
    { structuralRole: 'fire-separating' }, { structuralRole: undefined }]) {
    assert.throws(() => editor.wallOpeningCommand({ ...wall, ...patch }, { full: true }));
  }
  assert.throws(() => editor.wallOpeningCommand(wall, { full: 'yes' }), /Choose a full-span/);
});

test('partial wall opening requires explicit valid offset and width, never generated defaults', () => {
  for (const options of [
    { full: false }, { full: false, offsetM: '', widthM: '1' },
    { full: false, offsetM: '-.1', widthM: '1' }, { full: false, offsetM: '0', widthM: '0' },
    { full: false, offsetM: '4', widthM: '1.1' }, { full: false, offsetM: '1', widthM: 'Infinity' }
  ]) assert.throws(() => editor.wallOpeningCommand(wall, options));
  assert.equal(editor.wallOpeningCommand(wall, { full: false, offsetM: '4', widthM: '1' }).widthM, 1);
  assert.throws(() => editor.wallOpeningCommand({ ...wall, end: wall.start }, { full: true }), /greater than zero/);
});

test('ordered independent floors derive elevation from base and preceding storey heights', () => {
  const before = copy(project);
  assert.equal(editor.floorElevation(project, 'floor-one'), -.2);
  assert.equal(editor.floorElevation(project, 'floor-two'), 2.8);
  assert.equal(editor.floorElevation(project, 'floor-three'), 6.3);
  assert.equal(project.activeFloorId, 'floor-two');
  assert.deepEqual(project, before);
});

test('floor elevation does not invent missing base or storey values', () => {
  assert.throws(() => editor.floorElevation(project, 'deleted'), /no longer exists/);
  assert.throws(() => editor.floorElevation({ ...project, building: {} }, 'floor-two'), /base elevation/);
  const invalid = copy(project);
  invalid.floors[0].heightM = 0;
  assert.throws(() => editor.floorElevation(invalid, 'floor-two'), /greater than zero/);
});

test('floor rename and height commands edit only the intended floor property', () => {
  assert.deepEqual(editor.floorPatchCommand('floor-two', 'name', ' Upper study '),
    { type: 'update-floor', id: 'floor-two', patch: { name: 'Upper study' } });
  assert.deepEqual(editor.floorPatchCommand('floor-two', 'heightM', '3.25'),
    { type: 'update-floor', id: 'floor-two', patch: { heightM: 3.25 } });
  assert.throws(() => editor.floorPatchCommand('floor-two', 'name', ' '), /cannot be empty/);
  assert.throws(() => editor.floorPatchCommand('floor-two', 'heightM', ''), /enter a number/);
  assert.throws(() => editor.floorPatchCommand('floor-two', 'heightM', '0'), /greater than zero/);
  assert.throws(() => editor.floorPatchCommand('floor-two', 'floorElevationM', '1'), /cannot be edited/);
});

test('floor deletion validates identity and independently protects the last floor', () => {
  assert.deepEqual(editor.deleteFloorCommand(project, 'floor-two'), { type: 'delete-floor', id: 'floor-two' });
  assert.throws(() => editor.deleteFloorCommand(project, 'deleted'), /no longer exists/);
  assert.throws(() => editor.deleteFloorCommand({ floors: [project.floors[0]] }, 'floor-one'), /last floor/);
  assert.equal(project.floors.length, 3);
});

test('floor count warning distinguishes study layouts from regulatory approval', () => {
  assert.match(editor.floorAllowanceNotice(5, { allowedFloors: 3 }), /Exceeds.*3 by 2/);
  assert.match(editor.floorAllowanceNotice(3, { allowedFloors: 3 }), /not approval/);
  assert.match(editor.floorAllowanceNotice(3, { allowedFloors: 3 }), /Optimizer floor allowance estimate/);
  assert.match(editor.floorAllowanceNotice(1, null), /allowance is unavailable/);
  assert.match(editor.floorAllowanceNotice(3, { allowedFloors: NaN }), /allowance is unavailable/);
  assert.match(editor.floorAllowanceNotice(3, { allowedFloors: Number.MAX_SAFE_INTEGER + 1 }), /allowance is unavailable/);
  assert.match(editor.floorAllowanceNotice(1, { allowedFloors: 0 }), /Exceeds.*0 by 1/);
  assert.match(editor.floorAllowanceNotice(1, null), /separate from the regulatory floor selector/);
});

function target(tagName, attributes = {}, parentElement = null) {
  return { tagName, parentElement, getAttribute: key => Object.hasOwn(attributes, key) ? attributes[key] : null };
}
function keyEvent(overrides = {}) {
  return { key: 'z', ctrlKey: true, target: target('BUTTON'), ...overrides };
}

test('history shortcuts distinguish undo and both redo conventions', () => {
  assert.equal(editor.historyShortcut(keyEvent()), 'undo');
  assert.equal(editor.historyShortcut(keyEvent({ shiftKey: true })), 'redo');
  assert.equal(editor.historyShortcut(keyEvent({ key: 'y' })), 'redo');
  assert.equal(editor.historyShortcut(keyEvent({ ctrlKey: false, metaKey: true, key: 'Z' })), 'undo');
});

test('history shortcuts never intercept text/numeric fields or editable ancestors', () => {
  for (const element of [target('INPUT'), target('TEXTAREA'), target('SELECT'),
    target('DIV', { contenteditable: '' }), target('DIV', { role: 'textbox' }),
    target('SPAN', {}, target('DIV', { contenteditable: 'true' }))]) {
    assert.equal(editor.isTextEntry(element), true);
    assert.equal(editor.historyShortcut(keyEvent({ target: element })), null);
  }
  assert.equal(editor.isTextEntry(target('DIV', { contenteditable: 'false' })), false);
  assert.equal(editor.historyShortcut(keyEvent({
    target: target('DIV'), composedPath: () => [target('INPUT'), target('DIV')]
  })), null);
});

test('editing preserves composing, modified and already handled keyboard events', () => {
  for (const override of [{ isComposing: true }, { defaultPrevented: true }, { altKey: true },
    { ctrlKey: false }, { key: 'ArrowUp' }, { key: 'Delete' }, { key: 'y', shiftKey: true }]) {
    assert.equal(editor.historyShortcut(keyEvent(override)), null);
  }
});

// Optional real-browser regression runner for the existing Playwright MCP; no npm dependency.
async function browserSmoke(page, directory) {
  const browserPage = await page.context().newPage();
  const checks = [];
  function check(condition, message) {
    if (!condition) throw new Error(message);
    checks.push(message);
  }
  try {
    await browserPage.setViewportSize({ width: 1280, height: 900 });
    await browserPage.setContent(`<style>
      :root{--bg:#0d1117;--panel:#161b22;--panel2:#1c2430;--line:#30363d;--txt:#e6edf3;
        --dim:#8b949e;--acc:#2f81f7;--warn:#d29922;--bad:#f85149}
      body{margin:0;background:var(--bg);color:var(--txt);font:14px system-ui}
      .component-pane{width:290px;padding:12px;box-sizing:border-box}
      #plannerProjectTools{max-width:720px;padding:12px}*{box-sizing:border-box}
      </style><div class="component-pane"><section id="plannerInspector"></section></div>
      <section id="plannerProjectTools"></section><div id="fullscreenHost"></div>`);
    await browserPage.evaluate(() => {
      const clone = value => JSON.parse(JSON.stringify(value));
      const listeners = new Set();
      const baseScene = id => ({
        floorId: id, headingDeg: 90, wallHeightM: 2.8, floorElevationM: 0,
        regulatory: { allowedFloors: 2, basis: 'Fixture regulatory estimate; not planning approval.' },
        floor: { x: 0, y: 0, w: 10, h: 12 },
        rooms: [{ id: `${id}:room`, label: 'Living', type: 'living', rect: { x: 1, y: 1, w: 4, h: 4 } }],
        furniture: [{ id: `${id}:bed`, type: 'bed', label: 'Square bed', roomId: `${id}:room`,
          rect: { x: 1, y: 1, w: 2, h: 2 }, headLocal: 'S', pinned: false }],
        walls: [
          { id: `${id}:wall`, start: { x: 0, y: 0 }, end: { x: 0, y: 5 }, heightM: 2.8,
            baseM: 0, thicknessM: .15, exterior: false, structuralRole: 'unknown',
            roomIds: [`${id}:room`], solidSegments: [{ startM: 0, endM: 5 }], removed: false },
          { id: `${id}:outside`, start: { x: 5, y: 0 }, end: { x: 5, y: 5 }, heightM: 2.8,
            baseM: 0, thicknessM: .2, exterior: true, structuralRole: 'unknown', roomIds: [`${id}:room`] }
        ],
        openings: [
          { id: `${id}:door`, kind: 'hinged', wallId: `${id}:wall`, roomId: `${id}:room`,
            offsetM: .5, widthM: .9, sillM: 0, heightM: 2.1, hinge: 'start', swing: 'left', openFraction: .25,
            requestedClearWidthM: .9, nominalLeafWidthM: .9, clearWidthVerified: false, dimensionConvention: 'schematic-proxy' },
          { id: `${id}:window`, kind: 'window', wallId: `${id}:wall`, roomId: `${id}:room`,
            offsetM: 2, widthM: 1, sillM: .9, heightM: 1.2, openFraction: .25 }
        ],
        electrical: [], diagnostics: []
      });
      const fixture = window.__fixture = {
        project: {
          id: 'browser-project', revision: 0, activeFloorId: 'f1', building: { floorElevationM: 0, wallHeightM: 2.8 },
          floors: [{ id: 'f1', name: 'Ground', heightM: 3 }, { id: 'f2', name: 'Upper', heightM: 3.5 }],
          wallEdits: {}, furnitureEdits: {}, doorEdits: {}, windowEdits: {}
        },
        scenes: { f1: baseScene('f1'), f2: baseScene('f2') }, selection: null, commands: [],
        history: [], future: [], undoCalls: 0, redoCalls: 0, nextFloor: 3, sceneNull: false, failNext: null
      };
      const state = () => clone({ project: fixture.project, scenes: fixture.scenes, selection: fixture.selection });
      function restore(saved) {
        fixture.project = clone(saved.project);
        fixture.scenes = clone(saved.scenes);
        fixture.selection = clone(saved.selection);
      }
      function emit(type = 'scene') {
        for (const fn of listeners) fn({ type, project: api.getProject(), scene: api.getScene(), selection: api.getSelection() });
      }
      const api = window.HomePlanner = {
        getProject: () => clone(fixture.project),
        getScenes() {
          let elevation = fixture.project.building.floorElevationM;
          return fixture.project.floors.map(floor => {
            const scene = clone(fixture.scenes[floor.id]);
            scene.floorElevationM = elevation;
            scene.revision = fixture.project.revision;
            elevation += floor.heightM;
            return scene;
          });
        },
        getScene() {
          if (fixture.sceneNull) return null;
          const scene = clone(fixture.scenes[fixture.project.activeFloorId]);
          const index = fixture.project.floors.findIndex(floor => floor.id === fixture.project.activeFloorId);
          scene.floorElevationM = fixture.project.building.floorElevationM
            + fixture.project.floors.slice(0, index).reduce((sum, floor) => sum + floor.heightM, 0);
          scene.revision = fixture.project.revision;
          return scene;
        },
        getSelection: () => clone(fixture.selection),
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        select(ref) { fixture.selection = clone(ref); emit('selection'); },
        canUndo: () => fixture.history.length > 0,
        canRedo: () => fixture.future.length > 0,
        undo() {
          fixture.undoCalls++;
          if (fixture.history.length) {
            const before = state(), saved = fixture.history.pop();
            restore(saved);
            fixture.future.push(before);
            fixture.project.revision = before.project.revision + 1;
            emit('history');
          }
        },
        redo() {
          fixture.redoCalls++;
          if (fixture.future.length) {
            const before = state(), saved = fixture.future.pop();
            restore(saved);
            fixture.history.push(before);
            fixture.project.revision = before.project.revision + 1;
            emit('history');
          }
        },
        execute(command) {
          fixture.commands.push(clone(command));
          if (fixture.failNext) {
            const message = fixture.failNext;
            fixture.failNext = null;
            throw new Error(message);
          }
          const before = state(), scene = fixture.scenes[fixture.project.activeFloorId];
          if (command.type === 'update-room' || command.type === 'update-furniture') {
            const items = command.type === 'update-room' ? scene.rooms : scene.furniture;
            const entity = items.find(item => item.id === command.id);
            for (const [key, value] of Object.entries(command)) {
              if (!['type', 'id'].includes(key)) entity[key] = clone(value);
            }
          } else if (command.type === 'rotate-furniture') {
            const entity = scene.furniture.find(item => item.id === command.id);
            entity.headLocal = { N: 'E', E: 'S', S: 'W', W: 'N' }[entity.headLocal];
            [entity.rect.w, entity.rect.h] = [entity.rect.h, entity.rect.w];
            entity.pinned = true;
          } else if (command.type === 'delete-furniture') {
            scene.furniture = scene.furniture.filter(item => item.id !== command.id);
            fixture.selection = null;
          } else if (command.type === 'update-door' || command.type === 'update-window') {
            const entity = scene.openings.find(item => item.id === command.id);
            for (const [key, value] of Object.entries(command)) {
              if (!['type', 'id'].includes(key)) entity[key] = value;
            }
          } else if (command.type === 'open-wall') {
            fixture.project.wallEdits[command.id] = clone(command);
            scene.walls.find(item => item.id === command.id).removed = command.full;
          } else if (command.type === 'restore-wall') {
            delete fixture.project.wallEdits[command.id];
            scene.walls.find(item => item.id === command.id).removed = false;
          } else if (command.type === 'update-floor') {
            Object.assign(fixture.project.floors.find(floor => floor.id === command.id), command.patch);
          } else if (command.type === 'select-floor') {
            fixture.project.activeFloorId = command.id;
            fixture.selection = null;
          } else if (command.type === 'add-floor') {
            const id = `f${fixture.nextFloor++}`;
            fixture.project.floors.push({ id, name: `Floor ${id}`, heightM: 3 });
            fixture.scenes[id] = command.copyFromId
              ? JSON.parse(JSON.stringify(fixture.scenes[command.copyFromId]).replaceAll(`${command.copyFromId}:`, `${id}:`))
              : { ...baseScene(id), rooms: [], furniture: [], openings: [], walls: [] };
            fixture.scenes[id].floorId = id;
            fixture.project.activeFloorId = id;
            fixture.selection = null;
          } else if (command.type === 'delete-floor') {
            if (fixture.project.floors.length === 1) throw new Error('Keep the last floor.');
            fixture.project.floors = fixture.project.floors.filter(floor => floor.id !== command.id);
            delete fixture.scenes[command.id];
            fixture.project.activeFloorId = fixture.project.floors[0].id;
            fixture.selection = null;
          } else throw new Error(`Unsupported fixture command: ${command.type}`);
          if (command.type !== 'select-floor') {
            fixture.history.push(before);
            fixture.future = [];
          }
          fixture.project.revision++;
          emit('scene');
        }
      };
      fixture.emit = emit;
      fixture.listenerCount = () => listeners.size;
      window.HomePlannerModel = {
        doorGeometry(opening, host) {
          const hingeY = host.start.y + opening.offsetM + (opening.hinge === 'end' ? opening.widthM : 0);
          return {
            hinge: { x: host.start.x, y: hingeY },
            closedEnd: { x: host.start.x, y: hingeY + (opening.hinge === 'end' ? -opening.widthM : opening.widthM) },
            openEnd: { x: host.start.x + (opening.swing === 'left' ? opening.widthM : -opening.widthM), y: hingeY },
            arcSweep: opening.hinge === 'end' ? 1 : 0, radiusM: opening.widthM
          };
        }
      };
    });
    await browserPage.addStyleTag({ path: `${directory}\\planner-editor.css` });
    await browserPage.addScriptTag({ path: `${directory}\\planner-editor.js` });
    const inspectorText = () => browserPage.locator('#plannerInspector').innerText();
    const choose = (kind, id) => browserPage.evaluate(ref => HomePlanner.select(ref), { kind, id });
    const action = name => browserPage.locator(`[data-hp-editor-action="${name}"]`);
    check((await inspectorText()).includes('Click a room, component or wall'), 'Immediate accessible empty state');
    check((await browserPage.locator('#hp-editor-floor-allowance').innerText()).includes('Optimizer floor allowance estimate: 2; being within this count is not approval.'),
      'Within-allowance floor count is explicitly not approval');
    await choose('room', 'f2:room');
    check((await inspectorText()).includes('belongs to “Upper”')
      && await browserPage.evaluate(() => __fixture.project.activeFloorId === 'f1'
        && __fixture.selection.id === 'f2:room' && __fixture.commands.length === 0),
    'Cross-floor selection identifies the storey without changing the active floor');
    check(await browserPage.locator('#hp-editor-room-x').count() === 0, 'Non-active-storey geometry is not editable');
    await action('focus-floor-selector').click();
    check(await browserPage.evaluate(() => document.activeElement.id === 'hp-editor-floor-select'
      && __fixture.commands.length === 0), 'Cross-floor hint focuses the ordinary selector without mutation');
    await choose('room', 'f1:room');
    const roomX = browserPage.locator('#hp-editor-room-x');
    await roomX.fill('2.75');
    await browserPage.evaluate(() => {
      window.__inputBefore = document.activeElement;
      __fixture.scenes.f1.rooms[0].rect.y = 3.25;
      __fixture.project.revision++;
      __fixture.emit();
    });
    check(await browserPage.evaluate(() => document.activeElement === window.__inputBefore
      && document.activeElement.value === '2.75' && __fixture.commands.length === 0),
    'Scene events preserve live node, focus and draft');
    await roomX.press('Enter');
    await roomX.press('Tab');
    check(await browserPage.evaluate(() => __fixture.commands.length === 1
      && __fixture.commands[0].rect.x === 2.75 && __fixture.commands[0].rect.y === 3.25),
    'Enter then blur commits once using latest other coordinates');
    await roomX.focus();
    await roomX.press('Control+z');
    check(await browserPage.evaluate(() => __fixture.undoCalls === 0), 'Native text undo is not hijacked');
    await roomX.press('Escape');
    await roomX.fill('');
    await roomX.press('Tab');
    check(await browserPage.evaluate(() => __fixture.commands.length === 1
      && document.querySelector('#hp-editor-room-x').getAttribute('aria-invalid') === 'true'),
    'Blank number rejected before command execution');
    await roomX.fill('3.1');
    await browserPage.evaluate(() => { __fixture.failNext = 'Geometry rejected by bridge'; });
    await roomX.press('Tab');
    check(await browserPage.evaluate(() => __fixture.commands.length === 2
      && document.querySelector('#hp-editor-room-x').value === '3.1'
      && document.querySelector('#hp-editor-inspector-error').textContent.includes('Geometry rejected')),
    'Bridge rejection surfaces once and preserves draft');
    await roomX.fill('3.2');
    await roomX.press('Enter');
    await roomX.press('Tab');
    await choose('furniture', 'f1:bed');
    check(await browserPage.locator('#hp-editor-bed-head').inputValue() === 'S', 'Square bed uses stored head polarity');
    await browserPage.locator('#hp-editor-bed-head').selectOption('N');
    check(await browserPage.evaluate(() => __fixture.commands.at(-1).headLocal === 'N'
      && __fixture.commands.at(-1).pinned === true), 'Explicit head direction pins the bed');
    await action('rotate-furniture').click();
    check(await browserPage.locator('#hp-editor-bed-head').inputValue() === 'E', 'Quarter-turn refreshes actual head');
    await choose('door', 'f1:door');
    await browserPage.locator('#hp-editor-door-hinge').selectOption('end');
    await browserPage.locator('#hp-editor-door-swing').selectOption('right');
    await browserPage.locator('#hp-editor-door-openFraction').fill('.4');
    await browserPage.locator('#hp-editor-door-openFraction').press('Enter');
    check(await browserPage.evaluate(() => __fixture.commands.at(-1).openFraction === .4
      && __fixture.scenes.f1.openings[0].hinge === 'end' && __fixture.scenes.f1.openings[0].swing === 'right'),
    'Door hinge, swing and operating state commands');
    check(await browserPage.evaluate(() => document.querySelector('.hp-editor-door-sketch').getAttribute('hidden') === null
      && document.querySelector('.hp-editor-sketch-hinge').getAttribute('cy') === '1.4'
      && document.querySelector('.hp-editor-sketch-leaf').getAttribute('x2') === '-0.9'),
    'Door sketch uses the shared model hinge and swing endpoints');
    check((await inspectorText()).includes('Requested clear width · unverified')
      && (await inspectorText()).includes('Nominal leaf width · schematic'), 'Door dimensions retain schematic and unverified metadata');
    await choose('window', 'f1:window');
    await browserPage.locator('#hp-editor-window-headM').fill('2.35');
    await browserPage.locator('#hp-editor-window-headM').press('Enter');
    check(await browserPage.evaluate(() => Math.abs(__fixture.commands.at(-1).heightM - 1.45) < 1e-8
      && !Object.hasOwn(__fixture.commands.at(-1), 'headM')), 'Window head translates into height');
    await choose('wall', 'f1:wall');
    const beforeWall = await browserPage.evaluate(() => __fixture.commands.length);
    await action('review-open-wall').click();
    check((await inspectorText()).includes('never permission for safe demolition'), 'Explicit wall safety caution');
    check(await browserPage.evaluate(() => __fixture.commands.length) === beforeWall, 'Wall review is non-mutating');
    await action('confirm').press('Escape');
    check(await action('confirm').count() === 0, 'Escape cancels an uncommitted confirmation');
    await browserPage.locator('#hp-editor-wall-span').selectOption('partial');
    await browserPage.locator('#hp-editor-wall-offsetM').fill('.5');
    await browserPage.locator('#hp-editor-wall-widthM').fill('1.2');
    await action('review-open-wall').click();
    await browserPage.evaluate(() => { __fixture.project.revision++; __fixture.emit(); });
    await action('confirm').click({ force: true });
    check(await browserPage.evaluate(() => __fixture.commands.length) === beforeWall, 'Stale wall confirmation is rejected');
    await action('cancel-confirmation').click();
    await action('review-open-wall').click();
    await action('confirm').click();
    check(await browserPage.evaluate(() => __fixture.commands.at(-1).full === false
      && __fixture.commands.at(-1).offsetM === .5 && __fixture.commands.at(-1).widthM === 1.2
      && __fixture.commands.at(-1).confirmConceptual), 'Confirmed partial wall opening is atomic');
    await action('review-restore-wall').click();
    await action('confirm').click();
    check(await browserPage.evaluate(() => __fixture.commands.at(-1).type === 'restore-wall'), 'Wall restoration is confirmed');
    await choose('wall', 'f1:outside');
    check(await action('review-open-wall').isDisabled(), 'Exterior wall opening is unavailable');
    await browserPage.locator('#hp-editor-floor-name').fill('Ground study');
    await browserPage.locator('#hp-editor-floor-name').press('Enter');
    await browserPage.locator('#hp-editor-floor-height').fill('3.25');
    await browserPage.locator('#hp-editor-floor-height').press('Enter');
    await browserPage.locator('#hp-editor-floor-height').press('Tab');
    check(await browserPage.evaluate(() => __fixture.project.floors[0].name === 'Ground study'
      && __fixture.project.floors[0].heightM === 3.25), 'Floor name and height commands');
    await browserPage.locator('#hp-editor-floor-select').selectOption('f2');
    check((await browserPage.locator('.hp-editor-floor-details').innerText()).includes('3.25 m'), 'Derived floor elevation');
    await action('duplicate-floor').click();
    check(await browserPage.evaluate(() => __fixture.commands.at(-1).copyFromId === 'f2'
      && __fixture.project.floors.length === 3), 'Duplicate uses active floor source');
    await action('add-floor').click();
    check(await browserPage.evaluate(() => __fixture.project.floors.length === 4
      && HomePlanner.getScene().rooms.length === 0), 'New floor is independently empty');
    check((await browserPage.locator('#hp-editor-floor-allowance').innerText()).includes('Exceeds the optimizer floor allowance estimate of 2 by 2.')
      && !await action('add-floor').isDisabled(), 'Excess floors stay editable with a numerical schematic warning');
    await action('delete-floor').click();
    check(await browserPage.evaluate(() => __fixture.project.floors.length === 4), 'Floor deletion is staged');
    await action('confirm').click();
    check(await browserPage.evaluate(() => __fixture.project.floors.length === 3), 'Explicit floor deletion confirmation');
    await browserPage.evaluate(() => {
      while (__fixture.project.floors.length > 1) {
        HomePlanner.execute({ type: 'delete-floor', id: __fixture.project.floors.at(-1).id });
      }
    });
    check(await action('delete-floor').isDisabled(), 'Last floor cannot be removed');
    await browserPage.locator('#plannerProjectTools [data-hp-editor-action="undo"]').focus();
    await browserPage.keyboard.press('Control+z');
    check(await browserPage.evaluate(() => __fixture.undoCalls === 1), 'History shortcut operates outside text fields');
    await browserPage.locator('#plannerProjectTools [data-hp-editor-action="redo"]').focus();
    await browserPage.keyboard.press('Control+Shift+z');
    check(await browserPage.evaluate(() => __fixture.redoCalls === 1), 'Redo shortcut operates outside text fields');
    await choose('room', 'f1:room');
    await roomX.fill('4.2');
    await browserPage.evaluate(() => {
      window.__fullscreenInput = document.activeElement;
      document.querySelector('#fullscreenHost').appendChild(document.querySelector('.component-pane'));
      __fixture.emit();
    });
    check(await browserPage.evaluate(() => document.querySelector('#hp-editor-room-x') === window.__fullscreenInput
      && document.querySelector('#hp-editor-room-x').value === '4.2'), 'Fullscreen pane move preserves nodes and draft');
    await roomX.press('Escape');
    await browserPage.evaluate(() => { __fixture.sceneNull = true; __fixture.emit(); });
    check((await inspectorText()).includes('no valid scene'), 'Invalid scene has explicit non-editable state');
    await browserPage.evaluate(() => { __fixture.sceneNull = false; });
    await choose('door', 'f1:door');
    await browserPage.evaluate(() => {
      __fixture.scenes.f1.openings[0].kind = 'sliding';
      __fixture.emit();
    });
    check(await browserPage.locator('#hp-editor-door-hinge').count() === 0
      && (await inspectorText()).includes('Sliding door'), 'Sliding doors never show hinge controls');
    await browserPage.evaluate(() => {
      __fixture.scenes.f1.walls = [];
      __fixture.emit();
    });
    check(await browserPage.locator('#hp-editor-door-widthM').isDisabled()
      && (await inspectorText()).includes('Unresolved host wall'), 'Unresolved opening hosts retain inspectable IDs but disable edits');
    await browserPage.evaluate(() => {
      __fixture.scenes.f1.openings = [];
      __fixture.scenes.f1.diagnostics = [{ level: 'warning', message: 'Detached door is retained in the project for host review.', ids: ['f1:door'] }];
      __fixture.emit();
    });
    check((await inspectorText()).includes('Detached door is retained in the project for host review.'),
      'Diagnostics remain visible for retained records excluded from active apertures');
    await choose('room', 'f1:deleted');
    check((await browserPage.locator('#hp-editor-selected-id').innerText()).includes('f1:deleted'), 'Deleted selection retains diagnostic ID');
    await browserPage.setViewportSize({ width: 360, height: 800 });
    check(await browserPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Narrow viewport has no horizontal overflow');
    await browserPage.evaluate(() => {
      delete __fixture.scenes.f1.regulatory;
      __fixture.emit();
    });
    check((await browserPage.locator('#hp-editor-floor-allowance').innerText()).includes('Regulatory allowance is unavailable here.'),
      'Missing regulatory metadata never produces an inferred floor cap');
    await browserPage.evaluate(() => HomePlannerEditorInstance.destroy());
    check(await browserPage.evaluate(() => __fixture.listenerCount() === 0), 'Destroy releases subscription');
    return { passed: checks.length, checks };
  } catch (error) {
    return { passed: checks.length, checks, error: error.message,
      inspector: await browserPage.locator('#plannerInspector').innerText(),
      tools: await browserPage.locator('#plannerProjectTools').innerText() };
  } finally {
    await browserPage.close();
  }
}

module.exports.browserSmoke = browserSmoke;
