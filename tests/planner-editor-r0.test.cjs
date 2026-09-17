const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Editor = require('../planner-editor.js');
const Drafts = require('../planner-drafts.js');
const Model = require('../planner-model.js');
const View = require('../planner-3d.js');
const { createController } = require('../planner-bridge.js');
const { createFixture } = require('./fixtures/drawing-fixtures.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

// A local event/element double exercises mounted editor handlers without a DOM package.
// Real number-input sanitization, native text undo and WebGL remain browser checks.
function documentFixture() {
  let document, frameId = 0;
  const frames = new Map();
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = [];
      this.parentElement = null; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
      this.style = {}; this.value = ''; this.type = ''; this.checked = false; this.disabled = false;
      this.hidden = false; this.className = ''; this.clientWidth = 800; this.clientHeight = 600;
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].join(' ').trim(); },
        toggle: (name, on) => {
          const names = new Set(this.className.split(/\s+/));
          if (on ?? !names.has(name)) names.add(name); else names.delete(name);
          this.className = [...names].join(' ');
        }
      };
    }
    get isConnected() { return this === document || !!this.parentElement?.isConnected; }
    get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
    get textContent() { return (this._text || '') + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    set innerHTML(value) {
      this.replaceChildren();
      for (const match of value.matchAll(/<([a-z]+)\b[^>]*data-hp3d="([^"]+)"[^>]*>/g)) {
        const node = document.createElement(match[1]); node.dataset.hp3d = match[2];
        for (const key of ['checked', 'hidden', 'disabled']) node[key] = new RegExp(`\\s${key}(?:\\s|>)`).test(match[0]);
        this.appendChild(node);
      }
    }
    appendChild(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
    append(...nodes) { for (const node of nodes) this.appendChild(node); }
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
    replaceChildren(...nodes) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      for (const node of nodes) this.appendChild(node);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
      this.parentElement = null;
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; }
    setCustomValidity(value) { this.validationMessage = value; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, isComposing: false,
        preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (let node = this; node; node = type === 'keydown' ? node.parentElement : null)
        for (const fn of [...(node.listeners.get(type) || [])]) fn(event);
      return event;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() {
      if (!this.isConnected || this.disabled) return;
      const previous = document.activeElement;
      if (previous === this) return;
      document.activeElement = this;
      previous?.dispatch('blur', { relatedTarget: this });
    }
    matches(selector) {
      selector = selector.trim();
      if (selector.includes(':not(:disabled)') && this.disabled) return false;
      selector = selector.replace(':not(:disabled)', '');
      const tag = selector.match(/^[a-z]+/i);
      if (tag && this.tagName !== tag[0].toUpperCase()) return false;
      const id = selector.match(/#([\w-]+)/);
      if (id && this.id !== id[1]) return false;
      const className = selector.match(/\.([\w-]+)/);
      if (className && !this.className.split(/\s+/).includes(className[1])) return false;
      for (const match of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        const key = match[1], value = key.startsWith('data-')
          ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.getAttribute(key);
        if (value === undefined || value === null || match[2] !== undefined && value !== match[2]) return false;
      }
      return true;
    }
    querySelectorAll(selector) {
      const found = [], choices = selector.split(',');
      const visit = node => {
        for (const child of node.children) {
          if (choices.some(choice => child.matches(choice))) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getContext() { return { getExtension() { return null; } }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }
  document = new Element('document'); document.ownerDocument = document; document.activeElement = null;
  document.createElement = tag => new Element(tag); document.createElementNS = (_, tag) => new Element(tag);
  document.createTextNode = text => { const node = new Element('text'); node.textContent = text; return node; };
  document.getElementById = id => document.querySelector(`#${id}`);
  const window = new Element('window');
  Object.assign(window, {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); }, queueMicrotask,
    getComputedStyle() { return { getPropertyValue() { return ''; } }; }
  });
  document.defaultView = window;
  const add = (tag, id) => { const node = document.createElement(tag); node.id = id; document.appendChild(node); return node; };
  const inspector = add('details', 'plannerInspector'), tools = add('section', 'plannerProjectTools'), host = add('section', 'planner3d');
  return {
    document, inspector, tools, host, frames,
    by: id => document.getElementById(id),
    action: (name, owner = document) => owner.querySelector(`[data-hp-editor-action="${name}"]`),
    three: name => host.querySelector(`[data-hp3d="${name}"]`),
    flush() { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(); }
  };
}

function plannerFixture(project = createFixture('multiple-floors').project) {
  project.legacy.context.g.balconies = [{ id: 'balcony-3', label: 'Balcony 3', x: .1, y: 2, w: .6, h: 1, attachedRoomId: 'living' }];
  project.floors[0].legacy = copy(project.legacy);
  let legacy = copy(project.legacy), nextId = 1, failNext = '';
  const adapter = {
    capture: () => copy(legacy), restore: value => { legacy = copy(value); }, render() {},
    edit(command, entity) {
      if (failNext) { const error = failNext; failNext = ''; throw new Error(error); }
      const plan = legacy.context.plan;
      if (command.type === 'update-room') {
        const room = plan.placed.find(room => room.req.id === entity.sourceId), prior = room.carpet;
        if (Object.keys(command.rect).some(key => command.rect[key] !== prior[key])) {
          room.module = { x: room.module.x + command.rect.x - prior.x, y: room.module.y + command.rect.y - prior.y,
            w: room.module.w + command.rect.w - prior.w, h: room.module.h + command.rect.h - prior.h };
          room.carpet = copy(command.rect);
        }
        if (Object.hasOwn(command, 'stairEnclosure')) room.req.stairEnclosure = command.stairEnclosure;
      } else if (command.type === 'delete-furniture') plan.furniture = plan.furniture.filter(item => item.id !== entity.sourceId);
      else {
        const item = plan.furniture.find(item => item.id === entity.sourceId);
        if (command.rect) Object.assign(item, command.rect);
        for (const name of ['pinned', 'headLocal']) if (Object.hasOwn(command, name)) item[name] = command[name];
      }
    },
    deleteOpening(entity) {
      const plan = legacy.context.plan, ids = [entity.sourceId, ...(entity.sourceIds || [])];
      for (const key of ['doors', 'windows']) plan.openings[key] = plan.openings[key].filter(item => !ids.includes(item.id));
      plan.customOpenings = plan.customOpenings.filter(item => !ids.includes(item.id));
    },
    deleteRoom(entity) {
      const plan = legacy.context.plan;
      plan.placed = plan.placed.filter(item => item.req.id !== entity.sourceId);
      plan.furniture = plan.furniture.filter(item => item.roomId !== entity.sourceId);
      for (const key of ['doors', 'windows']) plan.openings[key] = plan.openings[key].filter(item =>
        item.roomId !== entity.sourceId && item.targetRoomId !== entity.sourceId);
    },
    deleteBalcony(entity) { legacy.context.g.balconies = legacy.context.g.balconies.filter(item => item.id !== entity.sourceId); },
    restoreWall() { return false; },
    addOpening(command, wall) {
      const id = `added-${nextId++}`;
      const room = controller.getScene().rooms.find(item => item.id === wall.roomIds[0]);
      legacy.context.plan.customOpenings.push({
        id, type: command.kind === 'window' ? 'window' : 'door', kind: command.kind, custom: true,
        wallId: wall.id, roomId: room?.sourceId || null, offsetM: command.offsetM, widthM: command.widthM,
        heightM: command.heightM, sillM: command.sillM, openFraction: command.openFraction,
        ...(command.kind === 'hinged' ? { hinge: command.hinge, swing: command.swing } : {})
      });
      return id;
    }
  };
  const controller = createController(adapter, Model);
  controller.importProject(JSON.stringify(project));
  const commands = [], planner = { ...controller, execute(command) { commands.push(copy(command)); return controller.execute(command); } };
  const dom = documentFixture(), editor = Editor.init(planner, dom.document, Model);
  assert.ok(editor);
  assert.equal(dom.by('hp-editor-inspector-error').hidden, true, dom.by('hp-editor-inspector-error').textContent);
  return {
    planner, editor, dom, commands, external: controller,
    select: (kind, id) => planner.select({ kind, id }),
    fill(id, value, change = false) {
      const input = dom.by(id); assert.ok(input, `Missing field ${id}`); input.focus(); input.value = value;
      input.dispatch(change ? 'change' : 'input'); return input;
    },
    fail(message) { failNext = message; },
    confirm() { const button = dom.action('confirm'); assert.ok(button, dom.inspector.textContent); button.click(); },
    cancel() { const button = dom.action('cancel-confirmation'); assert.ok(button); button.click(); },
    dispose() { editor.destroy(); }
  };
}

test('browser editor fails visibly before subscribing when the draft dependency is missing', () => {
  const dom = documentFixture(); let subscriptions = 0;
  const planner = Object.fromEntries(['getProject', 'getScene', 'getSelection', 'select', 'execute', 'undo', 'redo', 'canUndo', 'canRedo']
    .map(name => [name, () => {}]));
  planner.subscribe = () => { subscriptions++; return () => {}; };
  const window = { document: dom.document, HomePlanner: planner, HomePlannerModel: Model };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'planner-editor.js'), 'utf8'), { window });
  assert.equal(window.HomePlannerEditorInstance, null); assert.equal(subscriptions, 0);
  assert.match(dom.inspector.textContent, /planner-drafts\.js.*protect pending inputs/);
  assert.equal(dom.inspector.getAttribute('role'), 'alert');
});

test('every numeric inspector and staged wall owner is registered and survives selection, floor and project replacement', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  const id = planner.getProject().id, before = planner.getProject().revision;
  try {
    for (const [kind, entityId, fields] of [
      ['room', 'ground:living', ['x', 'y', 'w', 'h']],
      ['furniture', 'ground:bed', ['x', 'y', 'w', 'h']],
      ['door', 'ground:entry', ['offsetM', 'widthM', 'heightM', 'openFraction']],
      ['window', 'ground:living-window', ['offsetM', 'widthM', 'sillM', 'headM', 'heightM', 'openFraction']]
    ]) {
      h.select(kind, entityId);
      for (const field of fields) {
        const input = h.fill(`hp-editor-${kind}-${field}`, '-');
        assert.equal(input.type, 'text', 'Native number inputs sanitize incomplete drafts on remount.');
        assert.equal(input.inputMode, 'decimal');
      }
    }
    h.fill('hp-editor-floor-name', '');
    h.fill('hp-editor-floor-height', '-');
    const internal = planner.getScene().walls.find(wall => !wall.exterior && Editor.wallLength(wall) > 2);
    h.select('wall', internal.id);
    h.fill('hp-editor-wall-span', 'to-end', true); h.fill('hp-editor-wall-offsetM', '-');
    h.fill('hp-editor-retainedStartM', '-'); h.fill('hp-editor-retainedEndM', '');
    assert.equal(editor.requestAddOpening('door'), true);
    h.fill('hp-editor-new-opening-widthM', '-');
    h.fill('hp-editor-new-opening-hinge', 'end', true); h.fill('hp-editor-new-opening-swing', 'right', true);
    const exterior = planner.getScene().walls.find(wall => wall.exterior && Editor.wallLength(wall) > 2);
    h.select('wall', exterior.id);
    assert.equal(editor.requestAddOpening('window'), true);
    h.fill('hp-editor-new-opening-headM', '-');
    const collections = editor.getPendingDrafts().map(entry => entry.collection).sort();
    assert.deepEqual(collections, ['doors', 'floors', 'furniture', 'rooms', 'wall-connection', 'wall-opening-door', 'wall-opening-window', 'wall-trim', 'windows']);
    for (const entry of Drafts.pending(planner, id)) {
      assert.equal(entry.floorId, 'ground'); assert.ok(entry.collection && entry.entityId);
    }
    assert.equal(planner.getProject().revision, before, 'Typing and staging have no geometry history.');
    const pending = copy(editor.getPendingDrafts());
    planner.execute({ type: 'rename-project', name: 'Unrelated rename' });
    planner.execute({ type: 'select-floor', id: 'upper' });
    assert.deepEqual(editor.getPendingDrafts(), pending);
    planner.execute({ type: 'select-floor', id: 'ground' });
    h.select('room', 'ground:living');
    assert.equal(dom.by('hp-editor-room-x').value, '-');
    const original = copy(planner.getProject());
    planner.replaceProject({ ...copy(original), id: 'another-project' });
    assert.equal(Drafts.hasPending(planner, 'another-project'), false);
    assert.equal(Drafts.hasPending(planner, id), true);
    planner.replaceProject(original);
    h.select('window', 'ground:living-window');
    assert.equal(dom.by('hp-editor-window-headM').value, '-');
    assert.equal(editor.getPendingDrafts().length, 9);
    const read = editor.getPendingDrafts(); read[0].draft.fields.x.raw = 'outside edit';
    assert.notEqual(editor.getPendingDrafts()[0].draft.fields.x.raw, 'outside edit');
  } finally { h.dispose(); }
});

test('field commits are atomic, preserve latest other coordinates and clear only that field after success', () => {
  const h = plannerFixture(), { planner, dom, editor, commands } = h;
  const other = Drafts.createStore(planner, 'Unrelated workbench');
  try {
    other.put({ projectId: planner.getProject().id, floorId: 'ground', collection: 'structure', entityId: 'column' }, { label: 'Pending' });
    h.select('room', 'ground:living');
    h.fill('hp-editor-room-w', '-');
    const input = h.fill('hp-editor-room-x', '.77');
    const latest = planner.getScene().rooms.find(room => room.id === 'ground:living');
    h.external.execute({ type: 'update-room', id: latest.id, rect: { ...latest.rect, y: latest.rect.y + .03 } });
    const y = planner.getScene().rooms.find(room => room.id === latest.id).rect.y, revision = planner.getProject().revision;
    assert.equal(dom.by('hp-editor-room-x'), input);
    assert.equal(dom.document.activeElement, input);
    input.dispatch('keydown', { key: 'Enter' }); input.dispatch('change'); input.dispatch('blur');
    assert.equal(commands.filter(command => command.type === 'update-room').length, 1);
    assert.equal(planner.getProject().revision, revision + 1);
    assert.equal(planner.getScene().rooms.find(room => room.id === latest.id).rect.y, y);
    const draft = editor.getPendingDrafts().find(entry => entry.collection === 'rooms').draft;
    assert.equal(draft.fields.w.raw, '-'); assert.equal(draft.fields.x, undefined);
    assert.equal(Drafts.pending(planner).length, 2, 'The unrelated workbench stays pending.');
    const snapshot = planner.exportProject();
    h.fill('hp-editor-room-x', '.8'); h.fail('Synthetic rejected destination');
    input.dispatch('keydown', { key: 'Enter' }); input.dispatch('blur');
    assert.equal(planner.exportProject(), snapshot);
    assert.equal(dom.by('hp-editor-room-x').value, '.8');
    assert.match(dom.by('hp-editor-inspector-error').textContent, /Synthetic rejected destination/);
    assert.equal(commands.filter(command => command.type === 'update-room').length, 2, 'A rejected Enter plus blur attempts only once.');
    input.parentElement.querySelector('[data-hp-editor-action="apply-field-draft"]').click();
    assert.equal(planner.getScene().rooms.find(room => room.id === latest.id).rect.x, .8, 'Explicit Apply can retry a rejected value.');
    const noOpRevision = planner.getProject().revision;
    h.fill('hp-editor-room-x', '.8').dispatch('keydown', { key: 'Enter' });
    assert.equal(planner.getProject().revision, noOpRevision);
    assert.equal(editor.getPendingDrafts().find(entry => entry.collection === 'rooms').draft.fields.x, undefined);
  } finally { other.dispose(); h.dispose(); }
});

test('shared requests and pointer navigation park valid uncommitted fields instead of committing on focus changes', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    h.select('room', 'ground:living');
    let input = h.fill('hp-editor-room-x', '.77');
    const before = planner.exportProject();
    assert.equal(editor.requestDeleteSelection(), true);
    assert.equal(planner.exportProject(), before, 'A delete request must only stage a confirmation.');
    h.cancel();
    assert.equal(editor.getPendingDrafts()[0].draft.fields.x.raw, '.77');
    input.focus();
    editor.requestChooseFloor();
    assert.equal(planner.exportProject(), before, 'Revealing the floor selector does not apply a field.');
    input.focus();
    const svg = dom.document.createElement('svg'); dom.document.appendChild(svg);
    dom.document.dispatch('pointerdown', { target: svg });
    input.dispatch('change');
    svg.focus();
    h.select('furniture', 'ground:bed');
    dom.document.dispatch('pointerup');
    assert.equal(planner.exportProject(), before, 'Click-picking another object cannot accidentally commit the previous field.');
    h.select('room', 'ground:living'); input = dom.by('hp-editor-room-x');
    assert.equal(input.value, '.77');
    assert.equal(editor.getPendingDrafts()[0].draft.fields.x.error, undefined, 'Parking is not a rejected geometry command.');
    input.focus();
    const floor = dom.by('hp-editor-floor-select');
    dom.document.dispatch('pointerdown', { target: floor });
    input.dispatch('change');
    floor.focus(); floor.value = 'upper'; floor.dispatch('change');
    dom.document.dispatch('pointerup');
    assert.equal(planner.getProject().activeFloorId, 'upper');
    assert.equal(planner.getScenes().find(scene => scene.floorId === 'ground').rooms.find(room => room.id === 'ground:living').rect.x, .75);
    assert.equal(editor.getPendingDrafts()[0].floorId, 'ground');
    planner.execute({ type: 'select-floor', id: 'ground' });
    h.select('room', 'ground:living'); input = dom.by('hp-editor-room-x');
    assert.equal(input.value, '.77');
    assert.equal(planner.getScene().rooms.find(room => room.id === 'ground:living').rect.x, .75);
    input.dispatch('keydown', { key: 'Enter' });
    assert.equal(planner.getScene().rooms.find(room => room.id === 'ground:living').rect.x, .77);
  } finally { h.dispose(); }
});

test('same-owner source conflicts require explicit review, and canceled field/owner discard retains input', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    h.select('room', 'ground:living');
    const input = h.fill('hp-editor-room-x', '1.25');
    const current = planner.getScene().rooms.find(room => room.id === 'ground:living');
    h.external.execute({ type: 'update-room', id: current.id, rect: { ...current.rect, x: .8 } });
    const source = planner.exportProject();
    input.dispatch('keydown', { key: 'Enter' });
    assert.equal(planner.exportProject(), source);
    assert.equal(input.value, '1.25');
    assert.match(input.parentElement.textContent, /source changed/i);
    dom.action('discard-field-draft', input.parentElement).click(); h.cancel();
    assert.equal(editor.getPendingDrafts()[0].draft.fields.x.raw, '1.25');
    dom.action('discard-owner-draft').click(); h.cancel();
    assert.equal(editor.getPendingDrafts()[0].draft.fields.x.raw, '1.25');
    dom.action('review-field-draft', input.parentElement).click(); h.confirm();
    assert.equal(planner.exportProject(), source, 'Reviewing the source is not an authored edit.');
    input.dispatch('keydown', { key: 'Enter' });
    assert.equal(planner.getScene().rooms.find(room => room.id === current.id).rect.x, 1.25);
    assert.equal(Drafts.hasPending(planner), false);
    h.fill('hp-editor-room-x', '-');
    const original = planner.exportProject();
    for (const key of ['Delete', 'Backspace']) assert.equal(input.dispatch('keydown', { key }).defaultPrevented, false);
    assert.equal(input.dispatch('keydown', { key: 'z', ctrlKey: true }).defaultPrevented, false);
    assert.equal(input.dispatch('keydown', { key: 'Enter', isComposing: true }).defaultPrevented, false);
    assert.equal(planner.exportProject(), original);
    input.dispatch('keydown', { key: 'Escape' });
    assert.equal(Drafts.hasPending(planner), false);
    assert.equal(input.value, '1.25');
  } finally { h.dispose(); }
});

test('bed direction, explicit false pin and opening handing use the same scoped field registry', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    h.select('furniture', 'ground:bed');
    const head = h.fill('hp-editor-bed-head', 'N'), revision = planner.getProject().revision;
    assert.equal(editor.getPendingDrafts()[0].draft.fields.headLocal.raw, 'N');
    head.dispatch('change'); head.dispatch('blur');
    assert.equal(planner.getProject().revision, revision + 1);
    assert.equal(Drafts.hasPending(planner), false);
    const pin = dom.by('hp-editor-bed-pinned');
    pin.focus(); pin.checked = false; pin.dispatch('input');
    assert.equal(editor.getPendingDrafts()[0].draft.fields.pinned.raw, false);
    h.select('door', 'ground:entry');
    const hinge = h.fill('hp-editor-door-hinge', 'end');
    assert.equal(editor.getPendingDrafts().find(entry => entry.collection === 'doors').draft.fields.hinge.raw, 'end');
    h.select('furniture', 'ground:bed');
    assert.equal(dom.by('hp-editor-bed-pinned').checked, false);
    assert.equal(planner.getScene().furniture.find(item => item.id === 'ground:bed').pinned, true, 'Parking an explicit false draft does not author it.');
    h.select('door', 'ground:entry');
    assert.equal(dom.by('hp-editor-door-hinge').value, 'end');
    dom.by('hp-editor-door-hinge').dispatch('change');
    const swing = h.fill('hp-editor-door-swing', 'right');
    assert.equal(editor.getPendingDrafts().find(entry => entry.collection === 'doors').draft.fields.swing.raw, 'right');
    swing.dispatch('change');
    assert.equal(editor.getPendingDrafts().some(entry => entry.collection === 'doors'), false);
    assert.equal(editor.getPendingDrafts().find(entry => entry.collection === 'furniture').draft.fields.pinned.raw, false);
  } finally { h.dispose(); }
});

test('stair enclosure uses scoped drafts and real controller/model history with an enclosure-aware fixture adapter', () => {
  const project = createFixture('multiple-floors').project;
  const request = project.legacy.context.plan.placed.find(room => room.req.id === 'bedroom').req;
  request.type = 'staircase'; request.label = 'Synthetic staircase';
  delete request.stairEnclosure;
  const initial = Model.buildScene(project.legacy.context, project), id = 'ground:bedroom';
  const host = initial.walls.find(wall => wall.roomIds.includes(id)
    && !initial.openings.some(opening => opening.wallId === wall.id));
  assert.ok(host);
  const custom = {
    id: 'kept-stair-opening', kind: 'window', type: 'window', custom: true, roomId: 'bedroom',
    wallId: host.id, offsetM: .2, widthM: .3, sillM: .5, heightM: .3, openFraction: 0,
    metadata: { reference: 'Retain supplied source metadata' }
  };
  project.legacy.context.plan.customOpenings.push(custom);
  const h = plannerFixture(project), { planner, editor, dom } = h;
  try {
    h.select('room', 'ground:living');
    assert.equal(dom.by('hp-editor-stair-enclosure'), null, 'Ordinary rooms do not receive an enclosure selector.');
    h.select('room', id);
    const before = planner.exportProject(), beforeScene = planner.getScene();
    const original = beforeScene.rooms.find(room => room.id === id), revision = planner.getProject().revision;
    assert.equal(dom.by('hp-editor-stair-enclosure').value, 'enclosed');
    editor.render(); editor.render();
    assert.equal(planner.exportProject(), before, 'Displaying the legacy enclosed default does not backfill it.');
    assert.equal(Object.hasOwn(original, 'stairEnclosure'), false);
    h.fill('hp-editor-room-x', '-');
    h.fill('hp-editor-stair-enclosure', 'open');
    assert.equal(editor.getPendingDrafts().find(entry => entry.entityId === id).draft.fields.stairEnclosure.raw, 'open');
    h.select('room', 'ground:living'); h.select('room', id);
    const enclosure = dom.by('hp-editor-stair-enclosure');
    assert.equal(enclosure.value, 'open');
    h.fail('Synthetic enclosure rejection');
    enclosure.dispatch('change');
    assert.equal(planner.exportProject(), before);
    assert.equal(enclosure.value, 'open');
    assert.match(dom.by('hp-editor-inspector-error').textContent, /Synthetic enclosure rejection/);
    dom.action('apply-field-draft', enclosure.parentElement).click();
    assert.deepEqual(h.commands.at(-1), { type: 'update-room', id, rect: original.rect, stairEnclosure: 'open' });
    assert.equal(planner.getProject().revision, revision + 1);
    const updated = planner.getScene().rooms.find(room => room.id === id);
    assert.equal(updated.stairEnclosure, 'open');
    assert.deepEqual(updated.rect, original.rect);
    assert.deepEqual(updated.module, original.module);
    assert.deepEqual(planner.getScene().rooms.filter(room => room.id !== id).map(room => room.rect),
      beforeScene.rooms.filter(room => room.id !== id).map(room => room.rect));
    assert.deepEqual(planner.getProject().legacy.context.plan.customOpenings, [custom]);
    const pending = editor.getPendingDrafts().find(entry => entry.entityId === id).draft.fields;
    assert.equal(pending.x.raw, '-');
    assert.equal(pending.stairEnclosure, undefined, 'Successful enclosure commit removes only its own field draft.');
    assert.match(enclosure.parentElement.textContent, /Custom openings stay saved but may need host review/);
    planner.undo(); h.select('room', id);
    assert.equal(Object.hasOwn(planner.getScene().rooms.find(room => room.id === id), 'stairEnclosure'), false);
    assert.equal(dom.by('hp-editor-stair-enclosure').value, 'enclosed');
    assert.deepEqual(planner.getProject().legacy.context.plan.customOpenings, [custom]);
    planner.redo(); h.select('room', id);
    assert.equal(dom.by('hp-editor-stair-enclosure').value, 'open');
  } finally { h.dispose(); }
});

test('same-ID replacement, deletion and inspector remount keep pending owner values available for review', () => {
  const h = plannerFixture(), { planner, dom } = h;
  let editor = h.editor;
  try {
    h.select('room', 'ground:living'); h.fill('hp-editor-room-x', '-');
    const replacement = copy(planner.getProject()), room = replacement.legacy.context.plan.placed.find(room => room.req.id === 'living');
    room.carpet.x += .02; room.module.x += .02;
    planner.replaceProject(replacement);
    h.select('room', 'ground:living');
    assert.equal(dom.by('hp-editor-room-x').value, '-');
    assert.match(dom.by('hp-editor-room-x').parentElement.textContent, /source changed/i);
    editor.destroy();
    assert.equal(Drafts.hasPending(planner), true, 'Tearing down a view is not consent to discard pending inputs.');
    editor = Editor.init(planner, dom.document, Model);
    assert.equal(editor.getPendingDrafts().length, 1);
    assert.equal(dom.by('hp-editor-room-x').value, '-');
    assert.equal(editor.requestDeleteSelection(), true); h.confirm();
    assert.equal(editor.getPendingDrafts().length, 1, 'Deleting geometry does not erase an unapplied field draft.');
    assert.equal(planner.getScene().rooms.some(room => room.id === 'ground:living'), false);
    dom.action('review-owner-draft').click();
    assert.match(dom.by('hp-editor-inspector-error').textContent, /unavailable or deleted/);
    planner.undo(); h.select('room', 'ground:living');
    assert.equal(dom.by('hp-editor-room-x').value, '-');
    dom.action('discard-owner-draft').click(); h.confirm();
    assert.equal(Drafts.hasPending(planner), false);
  } finally { editor.destroy(); }
});

test('confirmation detects same-revision source replacement even when its project and floor IDs stay unchanged', () => {
  const h = plannerFixture(), { planner, dom } = h;
  try {
    dom.action('delete-floor').click();
    const confirmation = dom.action('confirm'), replacement = copy(planner.getProject());
    replacement.floors[0].heightM += .25;
    planner.replaceProject(replacement);
    assert.equal(planner.getProject().revision, replacement.revision);
    assert.equal(dom.action('confirm'), confirmation, 'The existing floor confirmation remains available for explicit review/cancel.');
    assert.equal(confirmation.getAttribute('aria-disabled'), 'true');
    const before = planner.exportProject();
    h.confirm();
    assert.equal(planner.exportProject(), before);
    assert.match(dom.by('hp-editor-project-error').textContent, /plan changed/i);
    h.cancel();
    dom.action('delete-floor').click(); h.confirm();
    assert.equal(planner.getProject().floors.length, 1);
    planner.undo();
    assert.equal(planner.getProject().floors.length, 2);
  } finally { h.dispose(); }
});

test('staged connection and trim values preserve exact wall-end intent and independent drafts through one-action commits', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    const wall = planner.getScene().walls.find(wall => !wall.exterior && Editor.wallLength(wall) > 2);
    h.select('wall', wall.id);
    assert.equal(editor.requestEditSelection({ section: 'wall-span' }), true);
    assert.equal(dom.document.activeElement.id, 'hp-editor-retainedStartM');
    const length = Editor.wallLength(wall);
    h.fill('hp-editor-retainedStartM', '.25');
    h.fill('hp-editor-retainedEndM', String(length));
    h.fill('hp-editor-wall-span', 'to-end', true); h.fill('hp-editor-wall-offsetM', '1');
    const before = planner.getProject().revision;
    dom.action('review-open-wall').click(); h.cancel();
    assert.equal(planner.getProject().revision, before);
    assert.ok(editor.getPendingDrafts().some(entry => entry.collection === 'wall-connection'));
    dom.action('review-open-wall').click(); h.confirm();
    assert.equal(planner.getProject().revision, before + 1);
    assert.equal(planner.getProject().wallEdits[wall.id].toEnd, true);
    assert.equal(Object.hasOwn(planner.getProject().wallEdits[wall.id], 'widthM'), false);
    const passage = planner.getScene().openings.find(opening => opening.wallId === wall.id && opening.kind === 'passage');
    assert.equal(passage.widthM, length - 1);
    assert.equal(editor.getPendingDrafts().some(entry => entry.collection === 'wall-connection'), false);
    assert.equal(editor.getPendingDrafts().find(entry => entry.collection === 'wall-trim').draft.values.endM, String(length));
    dom.action('review-trim-wall').click();
    assert.match(dom.by('hp-editor-inspector-error').textContent, /host or wall edit changed/i);
    const trim = dom.by('hp-editor-retainedStartM').parentElement.parentElement.parentElement;
    dom.action('discard-staged-draft', trim).click(); h.cancel();
    dom.action('review-staged-draft', trim).click(); h.confirm();
    dom.action('review-trim-wall').click(); h.confirm();
    assert.equal(planner.getProject().revision, before + 2);
    assert.deepEqual(planner.getProject().wallEdits[wall.id].retainedSpan, { startM: .25, endM: null });
    assert.equal(Drafts.hasPending(planner), false);
    planner.undo();
    assert.equal(planner.getProject().wallEdits[wall.id].retainedSpan, undefined);
    planner.redo();
    assert.equal(planner.getProject().wallEdits[wall.id].retainedSpan.endM, null);
  } finally { h.dispose(); }
});

for (const exterior of [false, true]) test(`hosted ${exterior ? 'exterior' : 'internal'} door and window forms keep independent drafts and commit through the real bridge`, () => {
  const h = plannerFixture(), { planner, editor, dom, commands } = h;
  try {
    const wall = planner.getScene().walls.find(wall => wall.exterior === exterior && Editor.wallLength(wall) > 2
      && !planner.getScene().openings.some(opening => opening.wallId === wall.id));
    assert.ok(wall);
    h.select('wall', wall.id);
    assert.equal(editor.requestAddOpening('door'), true);
    h.fill('hp-editor-new-opening-widthM', '-');
    h.fill('hp-editor-new-opening-hinge', 'end', true); h.fill('hp-editor-new-opening-swing', 'right', true);
    assert.equal(editor.requestAddOpening('window'), true);
    assert.equal(dom.by('hp-editor-new-opening-widthM').value, '', 'Window values are not borrowed from the door draft.');
    const before = planner.getProject().revision;
    dom.action('add-window').click();
    assert.equal(planner.getProject().revision, before);
    assert.ok(editor.getPendingDrafts().find(entry => entry.collection === 'wall-opening-window').draft.error);
    h.select('room', 'ground:living'); h.select('wall', wall.id);
    editor.requestAddOpening('door');
    assert.equal(dom.by('hp-editor-new-opening-widthM').value, '-');
    assert.equal(dom.by('hp-editor-new-opening-hinge').value, 'end');
    editor.requestAddOpening('window');
    for (const [field, value] of Object.entries({ offsetM: '.1', widthM: '.3', sillM: '.9', headM: '2.1', openFraction: '0' }))
      h.fill(`hp-editor-new-opening-${field}`, value);
    dom.action('add-window').click();
    assert.equal(planner.getProject().revision, before + 1, dom.by('hp-editor-inspector-error').textContent);
    assert.equal(commands.filter(command => command.type === 'add-window').length, 1);
    assert.equal(planner.getSelection().kind, 'window');
    const opening = Editor.selectionEntity(planner.getScene(), planner.getSelection());
    assert.equal(opening.wallId, wall.id); assert.equal(opening.widthM, .3);
    assert.ok(Math.abs(opening.heightM - 1.2) < 1e-12);
    assert.deepEqual(editor.getPendingDrafts().map(entry => entry.collection), ['wall-opening-door']);
    const addedId = opening.id;
    assert.equal(editor.requestDeleteSelection(), true); h.cancel();
    assert.equal(planner.getScene().openings.some(opening => opening.id === addedId), true);
    assert.equal(editor.requestDeleteSelection(), true); h.confirm();
    assert.equal(commands.at(-1).type, 'delete-opening'); assert.equal(commands.at(-1).id, addedId);
    planner.undo();
    assert.equal(planner.getScene().openings.some(opening => opening.id === addedId), true);
  } finally { h.dispose(); }
});

test('opening deletion review describes source suppression, retained backups and shared fragments without authoring', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    for (const [kind, id] of [['door', 'ground:entry'], ['window', 'ground:living-window']]) {
      h.select(kind, id);
      const before = planner.exportProject();
      assert.equal(editor.requestDeleteSelection(), true);
      const message = dom.action('confirm').parentElement.parentElement.textContent;
      assert.match(message, /including any fragments sharing those sources/);
      assert.match(message, /generated or added source records.*edit metadata remain in project backups/);
      assert.doesNotMatch(message, /Added records are removed/);
      assert.equal(planner.exportProject(), before);
      h.cancel();
    }
  } finally { h.dispose(); }
});

test('full-wall canonical infill stays editable and deletable while new placement and false wall restoration remain unavailable', () => {
  const h = plannerFixture(), { planner, editor, dom } = h;
  try {
    const wall = planner.getScene().walls.find(wall => !wall.exterior && Editor.wallLength(wall) > 2
      && !planner.getScene().openings.some(opening => opening.wallId === wall.id));
    assert.ok(wall);
    planner.execute({ type: 'add-window', wallId: wall.id, offsetM: 0, widthM: Editor.wallLength(wall),
      sillM: 0, heightM: wall.heightM, openFraction: 0 });
    const openingId = planner.getSelection().id;
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, true);
    assert.equal(editor.getActionState().canDelete, true);
    assert.equal(dom.action('delete-opening').disabled, false);
    const revision = planner.getProject().revision;
    h.fill('hp-editor-window-heightM', String(wall.heightM - .2)).dispatch('keydown', { key: 'Enter' });
    assert.equal(planner.getProject().revision, revision + 1, dom.by('hp-editor-inspector-error').textContent);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, false);
    planner.undo();
    h.select('wall', wall.id);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, true);
    assert.equal(editor.getActionState().canAddWindow, false);
    assert.equal(editor.getActionState().canAddDoor, false);
    assert.equal(dom.action('review-restore-wall').disabled, true);
    assert.match(dom.inspector.textContent, /No surviving masonry; door\/window aperture retained/);
    h.select('window', openingId);
    assert.equal(editor.requestDeleteSelection(), true); h.confirm();
    assert.equal(planner.getScene().openings.some(opening => opening.id === openingId), false);
    const restored = planner.getScene().walls.find(item => item.id === wall.id);
    assert.equal(restored.removed, false);
    assert.ok(Math.abs(restored.solidSections.reduce((area, section) => area + (section.endM - section.startM) * section.heightM, 0)
      - Editor.wallLength(wall) * wall.heightM) < 1e-7);
    planner.undo(); h.select('window', openingId);
    assert.equal(editor.getActionState().canDelete, true);
    assert.equal(planner.getScene().walls.find(item => item.id === wall.id).removed, true);
  } finally { h.dispose(); }
});

for (const [kind, id] of [['door', 'ground:entry'], ['window', 'ground:living-window']])
  test(`generated ${kind} deletion uses the shared bridge action and exact one-step history`, () => {
    const h = plannerFixture(), { planner, editor, commands } = h;
    try {
      h.select(kind, id);
      const scene = copy(planner.getScene()), inactive = copy(planner.getProject().floors[1]), revision = planner.getProject().revision;
      assert.equal(editor.requestDeleteSelection(), true); h.confirm();
      assert.deepEqual(commands.at(-1), { type: 'delete-opening', id });
      assert.equal(planner.getProject().revision, revision + 1);
      assert.equal(planner.getScene().openings.some(opening => opening.id === id), false);
      assert.deepEqual(planner.getScene().rooms, scene.rooms);
      assert.deepEqual(planner.getScene().furniture, scene.furniture);
      assert.deepEqual(planner.getProject().floors[1], inactive);
      for (const opening of scene.openings.filter(opening => opening.id !== id))
        assert.deepEqual(planner.getScene().openings.find(item => item.id === opening.id), opening);
      planner.undo();
      assert.deepEqual(planner.getScene().openings.find(opening => opening.id === id), scene.openings.find(opening => opening.id === id));
      planner.redo();
      assert.equal(planner.getScene().openings.some(opening => opening.id === id), false);
    } finally { h.dispose(); }
  });

test('real persistence status, replacement confirmation and unload guards see current and parked inspector drafts', async () => {
  const Persistence = require('../planner-persistence.js'), Storage = require('../planner-storage.js');
  const h = plannerFixture(), { planner, dom } = h;
  const host = dom.document.createElement('section'); dom.document.appendChild(host);
  let persistence;
  const mount = async () => {
    const record = Storage.createRecord(planner.getProject(), undefined, '2026-09-17T12:00:00.000Z');
    persistence = Persistence.mount(host, planner, { model: Model, openStore: async () => ({
      list: async () => [copy(record)], getSetting: async () => undefined, close() {}
    }) });
    await persistence.controller.ready;
  };
  try {
    await mount();
    assert.equal(persistence.controller.getState().dirty, false);
    assert.equal(dom.document.defaultView.dispatch('beforeunload').defaultPrevented, false);
    h.select('room', 'ground:living'); h.fill('hp-editor-room-x', '-');
    h.select('furniture', 'ground:bed');
    assert.equal(persistence.controller.getState().dirty, false);
    assert.equal(persistence.controller.getState().draftCount, 1);
    assert.match(host.textContent, /pending input draft.*not included/i);
    const before = planner.exportProject();
    host.querySelectorAll('button').find(button => button.textContent === 'New project').click();
    assert.match(dom.by('hp-storage-confirm-message').textContent, /pending input draft.*NOT included/);
    host.querySelectorAll('button').find(button => button.textContent === 'Cancel').click();
    assert.equal(planner.exportProject(), before);
    assert.equal(Drafts.hasPending(planner), true);
    assert.equal(dom.document.defaultView.dispatch('beforeunload').defaultPrevented, true);
    persistence.destroy();
    planner.replaceProject({ ...copy(planner.getProject()), id: 'parked-owner-test' });
    await mount();
    assert.equal(persistence.controller.getState().dirty, false);
    assert.equal(persistence.controller.getState().draftCount, 0, 'Current-project save status does not misattribute another project’s draft.');
    assert.equal(dom.document.defaultView.dispatch('beforeunload').defaultPrevented, true, 'Parked project drafts still protect unloading.');
  } finally { persistence?.destroy(); h.dispose(); }
});

async function engineFixture() {
  const THREE = await import('../vendor/three/three.module.min.js'), renderers = [], controls = [];
  class Renderer {
    constructor() { renderers.push(this); this.shadowMap = {}; this.listDisposals = 0; this.renderLists = { dispose: () => this.listDisposals++ }; }
    setPixelRatio() {} setSize() {}
    render(world, camera) { this.world = world; this.camera = camera; }
    dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  class Controls extends THREE.EventDispatcher {
    constructor(camera) { super(); this.camera = camera; this.target = new THREE.Vector3(); controls.push(this); }
    listenToKeyEvents() {} update() {} dispose() { this.disposed = true; }
  }
  return { engine: { THREE: { ...THREE, WebGLRenderer: Renderer }, OrbitControls: Controls }, renderers, controls };
}

test('native 3D actions use the same inspector and history, retain camera and never switch floors on picking', async () => {
  const h = plannerFixture(), { planner, editor, dom } = h, engine = await engineFixture(), requests = [];
  const shared = { ...editor };
  for (const name of ['requestAddOpening', 'requestDeleteSelection', 'requestEditSelection', 'requestChooseFloor'])
    shared[name] = (...args) => { requests.push([name, ...args]); return editor[name](...args); };
  const view = View.mount(dom.host, planner, Model, { editor: shared, loadEngine: async () => engine.engine });
  try {
    const beforeOpen = planner.exportProject();
    await view.open(); dom.flush();
    assert.equal(view.isOpen, true, dom.three('status').textContent);
    assert.equal(planner.exportProject(), beforeOpen);
    assert.equal(dom.three('undo').disabled, true); assert.equal(dom.three('redo').disabled, true);
    const renderer = engine.renderers[0], camera = renderer.camera.position.toArray(), rebuilds = renderer.listDisposals;
    h.select('room', 'ground:living'); dom.flush();
    assert.equal(renderer.listDisposals, rebuilds, 'Shared selection does not rebuild geometry.');
    assert.equal(dom.three('delete-selection').disabled, false);
    dom.three('edit-selection').click();
    assert.deepEqual(requests.at(-1), ['requestEditSelection']);
    assert.equal(dom.inspector.open, true); assert.equal(view.isOpen, true);
    h.fill('hp-editor-room-x', '.77').dispatch('keydown', { key: 'Enter' }); dom.flush();
    assert.equal(dom.three('undo').disabled, false); assert.equal(dom.three('redo').disabled, true);
    dom.three('undo').click(); dom.flush();
    assert.equal(dom.three('undo').disabled, true); assert.equal(dom.three('redo').disabled, false);
    dom.three('redo').click(); dom.flush();
    assert.equal(dom.three('undo').disabled, false); assert.equal(dom.three('redo').disabled, true);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    const snapshot = planner.exportProject(), internal = planner.getScene().walls.find(wall => !wall.exterior);
    const exterior = planner.getScene().walls.find(wall => wall.exterior);
    h.select('wall', exterior.id);
    const findings = dom.three('intent-findings-list').textContent;
    dom.three('delete-selection').dispatch('click');
    assert.equal(dom.three('action-error').hidden, false);
    assert.equal(dom.three('intent-findings-list').textContent, findings, 'Action errors do not erase model/intent diagnostics.');
    assert.equal(view.isOpen, true); assert.equal(planner.exportProject(), snapshot);
    h.select('wall', internal.id);
    assert.equal(dom.three('add-window').disabled, false);
    dom.three('add-window').click(); assert.deepEqual(requests.at(-1), ['requestAddOpening', 'window']);
    dom.three('add-door').click(); assert.deepEqual(requests.at(-1), ['requestAddOpening', 'door']);
    dom.three('edit-wall-span').click(); assert.deepEqual(requests.at(-1), ['requestEditSelection', { section: 'wall-span' }]);
    assert.equal(dom.document.activeElement.id, 'hp-editor-retainedStartM');
    assert.equal(planner.exportProject(), snapshot);
    for (const [kind, id] of [['wall', internal.id], ['room', 'ground:living'], ['balcony', 'ground:balcony-3'],
      ['door', 'ground:entry'], ['window', 'ground:living-window'], ['furniture', 'ground:bed']]) {
      h.select(kind, id);
      dom.three('delete-selection').click();
      assert.deepEqual(requests.at(-1), ['requestDeleteSelection']);
      assert.ok(dom.action('confirm'), `Shared ${kind} confirmation`);
      h.cancel();
      assert.equal(planner.exportProject(), snapshot, `Canceled ${kind} deletion cannot author geometry.`);
      assert.equal(view.isOpen, true);
    }
    h.select('room', 'upper:living');
    assert.equal(dom.three('delete-selection').disabled, true);
    assert.equal(dom.three('edit-selection').disabled, true);
    dom.three('choose-floor').click();
    assert.equal(dom.document.activeElement.id, 'hp-editor-floor-select');
    assert.equal(planner.getProject().activeFloorId, 'ground');
    assert.equal(planner.exportProject(), snapshot);
    assert.match(dom.three('edit-note').textContent, /explicitly.*Picking does not switch floors/);
    h.select('balcony', 'ground:balcony-3');
    dom.three('delete-selection').click(); h.confirm(); dom.flush();
    assert.equal(planner.getScene().balconies.length, 0);
    assert.equal(view.isOpen, true);
    assert.deepEqual(renderer.camera.position.toArray(), camera);
    dom.three('undo').click(); dom.flush();
    assert.equal(planner.getScene().balconies[0].id, 'ground:balcony-3');
    const canvas = dom.host.querySelector('canvas'), beforeKeys = planner.exportProject();
    for (const extra of [{ key: 'Delete' }, { key: 'Backspace' }, { key: 'Escape', isComposing: true }, { key: 'r', defaultPrevented: true }])
      canvas.dispatch('keydown', extra);
    assert.equal(planner.exportProject(), beforeKeys);
    assert.equal(view.isOpen, true);
    view.close({ focus: false });
    assert.ok(renderer.disposed && renderer.lost && engine.controls[0].disposed);
    assert.equal(dom.frames.size, 0);
    assert.equal(Drafts.hasPending(planner), true, 'Closing 3D does not discard the staged door inputs.');
  } finally { view.destroy(); h.dispose(); }
});
