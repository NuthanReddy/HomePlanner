(function (root, factory) {
  'use strict';
  const editor = factory(typeof module === 'object' && module.exports ? require('./planner-drafts.js') : root?.HomePlannerDrafts);
  if (typeof module === 'object' && module.exports) module.exports = editor;
  if (!root || !root.document) return;
  root.HomePlannerEditor = editor;
  const start = () => {
    if (!root.HomePlannerEditorInstance) {
      root.HomePlannerEditorInstance = editor.init(root.HomePlanner, root.document, root.HomePlannerModel);
    }
  };
  if (root.document.readyState === 'loading' && !root.document.getElementById('plannerInspector')) {
    root.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else start();
})(typeof window === 'object' ? window : null, function (Drafts) {
  'use strict';

  const DIRECTIONS = { N: 0, E: 90, S: 180, W: 270 };
  const KIND_LABELS = {
    room: 'Room', balcony: 'Balcony', furniture: 'Furniture', door: 'Door', window: 'Window',
    wall: 'Wall', electrical: 'Electrical point'
  };
  const WALL_CAUTION = 'Conceptual plan edit only — never permission for safe demolition or construction. '
    + 'Structural, fire, acoustic and service roles are unverified. A qualified local professional must review '
    + 'the wall and any affected door, window or electrical attachments before work.';
  const COLLECTIONS = { room: 'rooms', furniture: 'furniture', door: 'doors', window: 'windows', balcony: 'balconies', wall: 'walls' };
  const inspectorStores = new WeakMap();
  const sameDraft = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function wallDraftBase(wall) {
    if (!wall) return null;
    const { id, start, end, retainedSpan, heightM, baseM, exterior, structuralRole, removed } = wall;
    return { id, start, end, retainedSpan, heightM, baseM, exterior, structuralRole, removed };
  }
  function openingHostAvailable(wall, existingOpening = false) {
    return !!wall && (existingOpening || !wall.removed) && typeof wall.exterior === 'boolean'
      && ['unknown', 'non-structural'].includes(wall.structuralRole);
  }

  function selectionActions(scene, selection) {
    const entity = selectionEntity(scene, selection), wall = selection?.kind === 'wall' && entity;
    const partition = wall && wall.exterior === false && ['unknown', 'non-structural'].includes(wall.structuralRole);
    const host = openingHostAvailable(wall);
    const opening = entity && ['door', 'window'].includes(selection.kind);
    const openingHost = opening && (scene.walls || []).find(wall => wall.id === entity.wallId);
    const canDeleteOpening = opening && openingHostAvailable(openingHost, true);
    return {
      canEdit: !!entity,
      canDelete: !!entity && (['room', 'balcony', 'furniture'].includes(selection.kind) || !!canDeleteOpening
        || !!partition && !wall.removed),
      canAddDoor: !!host, canAddWindow: !!host,
      canEditWallSpan: !!partition,
      reason: !entity ? 'Select an existing object on the active editable floor.'
        : opening && !canDeleteOpening ? 'Opening deletion requires a canonical aperture on a classified, unprotected host. Its source records are retained; review the host or use Undo.'
        : wall && !partition ? 'Exterior, protected or unclassified walls cannot be deleted or trimmed. Apertures require a surviving, classified and unprotected host.'
          : ''
    };
  }

  function numberValue(value, options = {}) {
    const label = options.label || 'Value';
    if ((typeof value !== 'string' && typeof value !== 'number')
      || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value).trim())) {
      throw new Error(`${label}: enter a number, without units.`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label}: enter a finite number.`);
    if (options.positive && number <= 0) throw new Error(`${label}: must be greater than zero.`);
    if (options.min !== undefined && number < options.min) {
      throw new Error(`${label}: must be at least ${options.min}.`);
    }
    if (options.max !== undefined && number > options.max) {
      throw new Error(`${label}: must be no more than ${options.max}.`);
    }
    return number;
  }

  function selectionEntity(scene, selection) {
    if (!scene || !selection || typeof selection.id !== 'string') return null;
    let items;
    if (selection.kind === 'room') items = scene.rooms;
    else if (selection.kind === 'balcony') items = scene.balconies;
    else if (selection.kind === 'furniture') items = scene.furniture;
    else if (selection.kind === 'wall') items = scene.walls;
    else if (selection.kind === 'electrical') items = scene.electrical;
    else if (selection.kind === 'door' || selection.kind === 'window') {
      items = (scene.openings || []).filter(item => selection.kind === 'window'
        ? item.kind === 'window' : item.kind === 'hinged' || item.kind === 'sliding');
    }
    return (items || []).find(item => item.id === selection.id) || null;
  }

  function selectionFloor(scenes, selection, activeFloorId) {
    const scene = (scenes || []).find(item => item && item.floorId !== activeFloorId && selectionEntity(item, selection));
    return scene ? scene.floorId : null;
  }

  function rectCommand(kind, entity, field, value) {
    if (!['room', 'furniture'].includes(kind) || !['x', 'y', 'w', 'h'].includes(field)) {
      throw new Error('This position or dimension cannot be edited here.');
    }
    if (!entity || typeof entity.id !== 'string' || !entity.rect) {
      throw new Error('The selected object no longer has editable geometry.');
    }
    const rect = {};
    for (const key of ['x', 'y', 'w', 'h']) {
      rect[key] = numberValue(key === field ? value : entity.rect[key], {
        label: { x: 'X position', y: 'Y position', w: 'Width', h: 'Depth' }[key],
        positive: key === 'w' || key === 'h'
      });
    }
    return { type: `update-${kind}`, id: entity.id, rect };
  }

  function headBearing(headLocal, headingDeg) {
    if (!Object.prototype.hasOwnProperty.call(DIRECTIONS, headLocal) || !Number.isFinite(headingDeg)) {
      return null;
    }
    return ((DIRECTIONS[headLocal] + headingDeg) % 360 + 360) % 360;
  }

  function bedHeadCommand(entity, headLocal) {
    if (!entity || typeof entity.id !== 'string' || entity.type !== 'bed'
      || !Object.prototype.hasOwnProperty.call(DIRECTIONS, headLocal)) {
      throw new Error('Choose an actual bed head direction: N, E, S or W.');
    }
    return { type: 'update-furniture', id: entity.id, headLocal, pinned: true };
  }

  function wallLength(wall) {
    if (!wall || !wall.start || !wall.end) throw new Error('The host wall is unavailable.');
    const dx = numberValue(wall.end.x, { label: 'Wall end X' }) - numberValue(wall.start.x, { label: 'Wall start X' });
    const dy = numberValue(wall.end.y, { label: 'Wall end Y' }) - numberValue(wall.start.y, { label: 'Wall start Y' });
    return numberValue(Math.hypot(dx, dy), { label: 'Wall length', positive: true });
  }
  function retainedSpan(wall) {
    const length = wallLength(wall);
    const startM = numberValue(wall.retainedSpan?.startM ?? 0, { label: 'Retained wall start', min: 0 });
    const endM = numberValue(wall.retainedSpan?.endM ?? length, { label: 'Retained wall end', positive: true, max: length });
    if (startM >= endM) throw new Error('The retained wall end must follow its start.');
    return { startM, endM };
  }

  function openingCommand(kind, entity, field, value, wall) {
    if (!entity || typeof entity.id !== 'string' || !wall || entity.wallId !== wall.id) {
      throw new Error('The opening has an unresolved host wall. Review its attachment before editing.');
    }
    if ((kind === 'window' && entity.kind !== 'window')
      || (kind === 'door' && !['hinged', 'sliding'].includes(entity.kind))
      || !['door', 'window'].includes(kind)) throw new Error('Choose a matching door or window.');
    const command = { type: `update-${kind}`, id: entity.id };
    if (field === 'hinge' || field === 'swing') {
      const choices = field === 'hinge' ? ['start', 'end'] : ['left', 'right'];
      if (kind !== 'door' || entity.kind !== 'hinged' || !choices.includes(value)) {
        throw new Error('Hinge and swing editing is available only for hinged doors.');
      }
      command[field] = value;
    } else {
      const allowed = kind === 'window'
        ? ['offsetM', 'widthM', 'sillM', 'heightM', 'headM', 'openFraction'] : ['offsetM', 'widthM', 'heightM', 'openFraction'];
      if (!allowed.includes(field)) throw new Error('This opening dimension is read-only.');
      const parsed = numberValue(value, {
        label: { offsetM: 'Opening offset', widthM: 'Opening width', sillM: 'Sill height', heightM: 'Opening height',
          headM: 'Head height', openFraction: 'Open fraction' }[field],
        min: ['offsetM', 'sillM', 'openFraction'].includes(field) ? 0 : undefined,
        max: field === 'openFraction' ? 1 : undefined,
        positive: ['widthM', 'heightM', 'headM'].includes(field)
      });
      if (field === 'headM') {
        const sill = numberValue(entity.sillM, { label: 'Current sill height', min: 0 });
        command.heightM = numberValue(parsed - sill, { label: 'Head minus sill height', positive: true });
      } else command[field] = parsed;
      if (field === 'widthM' || field === 'offsetM') {
        const span = retainedSpan(wall);
        const offset = command.offsetM ?? numberValue(entity.offsetM, { label: 'Opening offset', min: 0 });
        const width = command.widthM ?? numberValue(entity.widthM, { label: 'Opening width', positive: true });
        if (offset < span.startM || offset + width > span.endM + 1e-7)
          throw new Error('The opening would extend past its retained host wall.');
      }
      if (['sillM', 'heightM', 'headM'].includes(field)) {
        const sill = command.sillM === undefined ? numberValue(entity.sillM, { label: 'Sill height', min: 0 }) : command.sillM;
        const height = command.heightM === undefined
          ? numberValue(entity.heightM, { label: 'Opening height', positive: true }) : command.heightM;
        if (sill + height > numberValue(wall.heightM, { label: 'Wall height', positive: true }) + 1e-7) {
          throw new Error('The opening head would extend above its host wall.');
        }
      }
    }
    return command;
  }

  function wallOpeningCommand(wall, options) {
    if (!wall || typeof wall.id !== 'string' || wall.exterior !== false) {
      throw new Error('Exterior or unclassified walls cannot be opened here.');
    }
    if (!['unknown', 'non-structural'].includes(wall.structuralRole)) {
      throw new Error('This wall has a protected or unclassified role; conceptual opening is unavailable.');
    }
    const span = retainedSpan(wall);
    if (!options || typeof options.full !== 'boolean') throw new Error('Choose a full-span or partial-span connection.');
    if (options.toEnd !== undefined && typeof options.toEnd !== 'boolean') throw new Error('Choose a valid to-wall-end mode.');
    if (options.full && options.toEnd) throw new Error('Choose full span or to wall end, not both.');
    const command = { type: 'open-wall', id: wall.id, full: options.full, confirmConceptual: true };
    if (!options.full) {
      command.offsetM = numberValue(options.offsetM, { label: 'Opening offset', min: span.startM });
      const width = options.toEnd ? span.endM - command.offsetM
        : numberValue(options.widthM, { label: 'Opening width', positive: true });
      if (width <= 1e-7 || command.offsetM + width > span.endM + 1e-7) {
        throw new Error('The partial connection must fit within the wall span.');
      }
      if (options.toEnd) command.toEnd = true;
      else command.widthM = width;
    }
    return command;
  }
  function wallTrimCommand(wall, start, end) {
    wallOpeningCommand(wall, { full: true });
    const length = wallLength(wall);
    const startM = numberValue(start, { label: 'Retained wall start', min: 0, max: length });
    const endM = end === null ? null : numberValue(end, { label: 'Retained wall end', positive: true, max: length });
    if (startM >= (endM ?? length)) throw new Error('The retained wall end must follow its start.');
    return { type: 'trim-wall', id: wall.id, startM, endM, confirmConceptual: true };
  }
  function addOpeningCommand(wall, kind, values) {
    if (!['door', 'window'].includes(kind) || !wall || typeof wall.id !== 'string')
      throw new Error('Choose a door or window and a current host wall.');
    if (!openingHostAvailable(wall))
      throw new Error('Choose a surviving, unprotected host wall.');
    const span = retainedSpan(wall);
    const offsetM = numberValue(values.offsetM, { label: 'Opening offset', min: span.startM });
    const widthM = numberValue(values.widthM, { label: 'Opening width', positive: true, min: kind === 'door' ? .68 : .3 });
    const sillM = kind === 'window' ? numberValue(values.sillM, { label: 'Window sill', min: 0 }) : 0;
    const heightM = kind === 'window' && values.headM !== undefined
      ? numberValue(numberValue(values.headM, { label: 'Window head', positive: true }) - sillM, { label: 'Head minus sill', positive: true })
      : numberValue(values.heightM, { label: 'Opening height', positive: true });
    if (offsetM + widthM > span.endM + 1e-7) throw new Error('The opening must fit within the retained host wall span.');
    if (sillM + heightM > numberValue(wall.heightM, { label: 'Wall height', positive: true }) + 1e-7)
      throw new Error('The opening head would extend above its host wall.');
    const command = { type: `add-${kind}`, wallId: wall.id, offsetM, widthM, heightM,
      openFraction: numberValue(values.openFraction, { label: 'Open fraction', min: 0, max: 1 }) };
    if (kind === 'window') command.sillM = sillM;
    else {
      if (!['start', 'end'].includes(values.hinge) || !['left', 'right'].includes(values.swing))
        throw new Error('Choose the door hinge endpoint and swing side.');
      command.hinge = values.hinge;
      command.swing = values.swing;
    }
    return command;
  }

  function floorElevation(project, id) {
    const floors = project && project.floors;
    const index = Array.isArray(floors) ? floors.findIndex(floor => floor.id === id) : -1;
    if (index < 0) throw new Error('The floor no longer exists.');
    let elevation = numberValue(project.building && project.building.floorElevationM, { label: 'Building base elevation' });
    for (let i = 0; i < index; i++) {
      elevation += numberValue(floors[i].heightM, { label: `${floors[i].name || 'Floor'} storey height`, positive: true });
    }
    if (!Number.isFinite(elevation)) throw new Error('The derived floor elevation is not finite.');
    return elevation;
  }

  function floorPatchCommand(id, field, value) {
    if (typeof id !== 'string' || !id) throw new Error('Choose an existing floor.');
    let parsed;
    if (field === 'name') {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Floor name cannot be empty.');
      parsed = value.trim();
    } else if (field === 'heightM') parsed = numberValue(value, { label: 'Storey height', positive: true });
    else throw new Error('This floor property cannot be edited here.');
    return { type: 'update-floor', id, patch: { [field]: parsed } };
  }

  function deleteFloorCommand(project, id) {
    if (!project || !Array.isArray(project.floors) || !project.floors.some(floor => floor.id === id)) {
      throw new Error('The floor no longer exists.');
    }
    if (project.floors.length <= 1) throw new Error('Keep at least one floor. The last floor cannot be removed.');
    return { type: 'delete-floor', id };
  }

  function floorAllowanceNotice(count, allowance) {
    const allowed = allowance && allowance.allowedFloors;
    if (!Number.isSafeInteger(allowed) || allowed < 0) {
      return `${count} independent schematic floor${count === 1 ? '' : 's'}. Regulatory allowance is unavailable here. `
        + 'This count is separate from the regulatory floor selector; it does not establish safe or approved floors.';
    }
    const comparison = count > allowed
      ? `Exceeds the optimizer floor allowance estimate of ${allowed} by ${count - allowed}. `
      : `Optimizer floor allowance estimate: ${allowed}; being within this count is not approval. `;
    return `${count} independent schematic floor${count === 1 ? '' : 's'}. ${comparison}`
      + (allowance.basis ? `${allowance.basis} ` : '')
      + 'Layouts remain editable for study only; structural safety and approved building height are not established.';
  }

  function isTextEntry(element) {
    for (let node = element; node; node = node.parentElement) {
      if (/^(INPUT|TEXTAREA|SELECT)$/i.test(node.tagName || '') || node.isContentEditable
        || (node.getAttribute && (node.getAttribute('role') === 'textbox'
          || (node.getAttribute('contenteditable') !== null && node.getAttribute('contenteditable') !== 'false')))) return true;
    }
    return false;
  }

  function historyShortcut(event) {
    if (!event || event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    if (path.some(isTextEntry)) return null;
    const key = String(event.key || '').toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !event.shiftKey) return 'redo';
    return null;
  }

  function metreText(value) {
    return Number.isFinite(value) ? `${Number(value.toFixed(4))} m` : 'Not available';
  }

  function init(planner, document, model) {
    if (!document) return null;
    const inspectorRoot = document.getElementById('plannerInspector');
    const toolsRoot = document.getElementById('plannerProjectTools');
    if (!inspectorRoot && !toolsRoot) return null;
    const required = ['getProject', 'getScene', 'getSelection', 'subscribe', 'select', 'execute', 'undo', 'redo', 'canUndo', 'canRedo'];
    if (!planner || required.some(key => typeof planner[key] !== 'function')) {
      for (const root of [inspectorRoot, toolsRoot].filter(Boolean)) {
        root.textContent = 'The editor is unavailable: load the HomePlanner bridge before planner-editor.js.';
        root.setAttribute('role', 'alert');
      }
      return null;
    }
    if (!Drafts?.createStore || !Drafts?.key) {
      for (const root of [inspectorRoot, toolsRoot].filter(Boolean)) {
        root.textContent = 'The editor is unavailable: load planner-drafts.js before planner-editor.js to protect pending inputs.';
        root.setAttribute('role', 'alert');
      }
      return null;
    }
    if (!inspectorStores.has(planner)) inspectorStores.set(planner, Drafts.createStore(planner, 'Selection inspector'));
    const drafts = inspectorStores.get(planner);

    let destroyed = false;
    let selectionKey = null;
    let floorKey = null;
    let lastSelection = null;
    let selectionRefresh = () => {};
    let floorRefresh = () => {};
    let selectionRequests = {};
    let refreshDraftList = () => {};
    let retainingInputs = false, pointerNavigation = false;
    const historyButtons = [];

    function element(tag, className, text, parent) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      if (parent) parent.appendChild(node);
      return node;
    }
    function button(parent, text, action, handler) {
      const node = element('button', 'hp-editor-button', text, parent);
      node.type = 'button';
      node.dataset.hpEditorAction = action;
      node.addEventListener('click', handler);
      return node;
    }
    function text(node, value) {
      if (node.textContent !== value) node.textContent = value;
    }
    function focus(node) {
      if (node && node.isConnected && typeof node.focus === 'function') node.focus({ preventScroll: true });
    }
    function panel(root, title, prefix) {
      if (!root) return null;
      root.classList.add('hp-editor');
      root.replaceChildren();
      const heading = element('h2', 'hp-editor-heading', title, root);
      heading.tabIndex = -1;
      heading.id = `${prefix}-heading`;
      const error = element('p', 'hp-editor-alert', '', root);
      error.id = `${prefix}-error`;
      error.setAttribute('role', 'alert');
      error.hidden = true;
      const status = element('p', 'hp-editor-status', '', root);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      const body = element('div', 'hp-editor-body', undefined, root);
      const confirmation = element('div', 'hp-editor-confirm-host', undefined, root);
      return { root, heading, error, status, body, confirmation, pending: null };
    }
    const inspector = panel(inspectorRoot, 'Selection inspector', 'hp-editor-inspector');
    const tools = panel(toolsRoot, 'Floors & edit history', 'hp-editor-project');

    function snapshot() {
      return { project: planner.getProject(), scene: planner.getScene(), selection: planner.getSelection() };
    }
    function keyFor(state) {
      return JSON.stringify([state.project.id, state.project.activeFloorId, state.selection && state.selection.kind,
        state.selection && state.selection.id]);
    }
    function selectionScope(key, collection) {
      const [projectId, floorId, kind, entityId] = JSON.parse(key);
      return { projectId, floorId, collection: collection || COLLECTIONS[kind], entityId };
    }
    function fieldScope(owner) {
      const state = snapshot();
      return owner === tools
        ? { projectId: state.project.id, floorId: state.project.activeFloorId, collection: 'floors', entityId: state.project.activeFloorId }
        : selectionScope(keyFor(state));
    }
    function fieldSource(scope, name, state = snapshot()) {
      if (scope.projectId !== state.project.id || scope.floorId !== state.project.activeFloorId)
        throw new Error('This draft belongs to another project or floor. Choose its owner explicitly before editing.');
      let value, host;
      if (scope.collection === 'floors') {
        const floor = state.project.floors.find(item => item.id === scope.entityId);
        if (!floor) throw new Error('The draft floor no longer exists. Its pending inputs are retained.');
        value = floor[name];
      } else {
        const kind = Object.keys(COLLECTIONS).find(kind => COLLECTIONS[kind] === scope.collection);
        const entity = selectionEntity(state.scene, { kind, id: scope.entityId });
        if (!entity) throw new Error('The draft object is unavailable. Its pending inputs are retained.');
        value = ['x', 'y', 'w', 'h'].includes(name) ? entity.rect?.[name]
          : name === 'headM' ? entity.sillM + entity.heightM : entity[name];
        if (kind === 'door' || kind === 'window') host = {
          wall: wallDraftBase(state.scene.walls.find(wall => wall.id === entity.wallId)),
          wallId: entity.wallId, kind: entity.kind, ...(name === 'headM' ? { sillM: entity.sillM } : {})
        };
      }
      return { value, base: JSON.stringify({ value, host }) };
    }
    function pendingField(scope, name) { return drafts.get(scope)?.fields?.[name] || null; }
    function putField(scope, name, value) {
      const entry = drafts.get(scope) || { fields: {} };
      entry.fields[name] = value;
      drafts.put(scope, entry);
      refreshDraftList();
    }
    function removeField(scope, name, expected) {
      const entry = drafts.get(scope);
      if (!entry?.fields?.[name] || expected && !sameDraft(entry.fields[name], expected)) return;
      delete entry.fields[name];
      if (Object.keys(entry.fields).length) drafts.put(scope, entry);
      else drafts.remove(scope);
      refreshDraftList();
    }
    function reveal(owner, target = owner?.heading) {
      for (let node = target; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
      focus(target);
    }
    function retainInputs(action) {
      const previous = retainingInputs;
      retainingInputs = true;
      try { return action(); }
      finally { retainingInputs = previous; }
    }
    function selectedContext(expectedKey) {
      const state = snapshot();
      if (keyFor(state) !== expectedKey) throw new Error('Selection changed. Select the object again before editing.');
      const entity = selectionEntity(state.scene, state.selection);
      if (!entity) throw new Error('This object is unavailable or has been deleted. Select an existing object.');
      return { ...state, entity, wall: (state.scene.walls || []).find(wall => wall.id === entity.wallId) };
    }
    function activeFloor(expectedKey) {
      const state = snapshot();
      if (JSON.stringify([state.project.id, state.project.activeFloorId]) !== expectedKey) {
        throw new Error('The active floor changed. Review its properties before editing.');
      }
      const floor = state.project.floors.find(item => item.id === state.project.activeFloorId);
      if (!floor) throw new Error('The active floor no longer exists.');
      return { ...state, floor };
    }
    function reportError(owner, error) {
      if (!owner) return;
      text(owner.error, error && error.message ? error.message : 'The edit could not be applied.');
      owner.error.hidden = false;
      text(owner.status, '');
    }
    function run(owner, action, success = '') {
      try {
        action();
        owner.error.hidden = true;
        text(owner.error, '');
        if (success) text(owner.status, success);
        render();
        return true;
      } catch (error) {
        reportError(owner, error);
        return false;
      }
    }
    function executeChanged(command, entity) {
      const same = Object.keys(command).filter(key => !['type', 'id'].includes(key)).every(key => {
        if (key === 'rect') return Object.keys(command.rect).every(axis => command.rect[axis] === entity.rect[axis]);
        return entity[key] === command[key];
      });
      if (!same) planner.execute(command);
    }

    function historyControls(owner) {
      if (!owner) return;
      const row = element('div', 'hp-editor-actions hp-editor-history', undefined, owner.body);
      for (const action of ['undo', 'redo']) {
        const label = action === 'undo' ? 'Undo' : 'Redo';
        const control = button(row, label, action, () => run(owner, () => planner[action](), `${label} applied.`));
        control.title = action === 'undo' ? 'Undo (Ctrl/Cmd+Z)' : 'Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)';
        historyButtons.push({ control, action });
      }
    }
    historyControls(inspector);
    historyControls(tools);

    function cancelConfirmation(owner, restoreFocus) {
      const pending = owner.pending;
      if (!pending) return;
      owner.pending = null;
      owner.confirmation.replaceChildren();
      if (restoreFocus) focus(pending.trigger && pending.trigger.isConnected ? pending.trigger : owner.heading);
    }
    function confirmationIsCurrent(pending, state) {
      return !!pending && pending.projectId === state.project.id && pending.revision === state.project.revision
        && pending.floorId === state.project.activeFloorId
        && pending.sourceKey === JSON.stringify(state.project)
        && (pending.selectionKey === null || pending.selectionKey === keyFor(state));
    }
    function confirmAction(owner, trigger, options) {
      cancelConfirmation(owner, false);
      const state = snapshot();
      const group = element('section', 'hp-editor-confirm', undefined, owner.confirmation);
      group.setAttribute('role', 'group');
      const title = element('h3', 'hp-editor-subheading', options.title, group);
      title.id = `${owner.heading.id}-confirmation`;
      group.setAttribute('aria-labelledby', title.id);
      element('p', 'hp-editor-note', options.description, group);
      if (options.caution) element('p', 'hp-editor-warning', options.caution, group);
      const stale = element('p', 'hp-editor-warning', 'The plan changed. Cancel and review this action again.', group);
      stale.hidden = true;
      stale.setAttribute('role', 'status');
      const actions = element('div', 'hp-editor-actions', undefined, group);
      const approve = button(actions, options.label, 'confirm', () => {
        run(owner, () => {
          if (!confirmationIsCurrent(owner.pending, snapshot())) throw new Error('The plan changed. Review this action again before confirming.');
          options.execute();
          cancelConfirmation(owner, true);
        }, options.success);
      });
      approve.classList.add('hp-editor-caution-button');
      button(actions, 'Cancel', 'cancel-confirmation', () => cancelConfirmation(owner, true));
      owner.pending = {
        projectId: state.project.id, revision: state.project.revision, floorId: state.project.activeFloorId,
        sourceKey: JSON.stringify(state.project), selectionKey: owner === inspector ? keyFor(state) : null,
        trigger, stale, approve
      };
      group.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          cancelConfirmation(owner, true);
        }
      });
      retainInputs(() => focus(approve));
    }

    function field(owner, parent, specification) {
      const wrapper = element('div', 'hp-editor-field', undefined, parent);
      const label = element('label', 'hp-editor-label', specification.label, wrapper);
      const input = element(specification.options ? 'select' : 'input', 'hp-editor-input', undefined, wrapper);
      input.id = specification.id;
      input.dataset.hpEditorField = specification.key;
      label.htmlFor = input.id;
      if (specification.options) {
        for (const option of specification.options) {
          const node = element('option', '', option.label, input);
          node.value = option.value;
          if (option.value === '') node.disabled = true;
        }
      } else {
        const numeric = !specification.type || specification.type === 'number';
        // Number inputs erase incomplete values such as "-" when their DOM is rebuilt.
        // Decimal text entry keeps the original draft; numberValue remains the validator.
        input.type = numeric ? 'text' : specification.type;
        input.required = input.type !== 'checkbox';
        if (numeric) {
          input.dataset.hpEditorNumeric = 'true';
          input.inputMode = 'decimal';
          input.autocomplete = 'off';
          input.spellcheck = false;
          if (specification.min !== undefined) input.min = String(specification.min);
          if (specification.max !== undefined) input.max = String(specification.max);
        }
        if (input.type === 'checkbox') wrapper.classList.add('hp-editor-checkbox');
      }
      let help;
      if (specification.help) {
        help = element('span', 'hp-editor-help', specification.help, wrapper);
        help.id = `${input.id}-help`;
      }
      const feedback = element('span', 'hp-editor-field-error', '', wrapper);
      feedback.id = `${input.id}-error`;
      feedback.hidden = true;
      input.setAttribute('aria-describedby', [help && help.id, feedback.id].filter(Boolean).join(' '));
      const scope = fieldScope(owner), name = specification.key;
      const draftNote = element('span', 'hp-editor-warning', '', wrapper);
      draftNote.id = `${input.id}-draft`;
      draftNote.setAttribute('role', 'status');
      draftNote.hidden = true;
      const actions = element('div', 'hp-editor-actions', undefined, wrapper);
      actions.hidden = true;
      let initialized = false, composing = false;
      let currentValue;
      let failedValue;
      const raw = () => input.type === 'checkbox' ? input.checked : input.value;
      function clearError() {
        input.removeAttribute('aria-invalid');
        input.setCustomValidity('');
        feedback.hidden = true;
        feedback.textContent = '';
      }
      function writeValue(value) {
        if (input.type === 'checkbox') {
          input.indeterminate = typeof value !== 'boolean';
          input.checked = value === true;
        } else input.value = value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value);
      }
      function showError(message) {
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity(message);
        feedback.textContent = message;
        feedback.hidden = false;
      }
      function update(value, state) {
        currentValue = value;
        const entry = pendingField(scope, name);
        if (!initialized && entry) {
          writeValue(entry.raw);
          failedValue = entry.error ? entry.raw : undefined;
        } else if (!entry && document.activeElement !== input) writeValue(value);
        initialized = true;
        let source, conflict = '';
        try { source = fieldSource(scope, name, state); }
        catch (error) { conflict = error.message; }
        if (entry && source && source.base !== entry.base)
          conflict = `The source changed since this draft began. Current value: ${source.value ?? 'not recorded'}. Review the draft against the current source before applying it.`;
        actions.hidden = !entry;
        review.hidden = !entry || !conflict;
        draftNote.hidden = !entry;
        text(draftNote, conflict || (entry ? 'Pending input only — not included in project saves or exports.' : ''));
        input.setAttribute('aria-describedby', [help && help.id, feedback.id, entry && draftNote.id].filter(Boolean).join(' '));
        if (entry?.error) showError(entry.error);
        else clearError();
      }
      function capture(force = false) {
        const previous = pendingField(scope, name), value = raw();
        if (!force && !previous && value === (input.type === 'checkbox' ? currentValue : String(currentValue ?? ''))) return;
        const source = fieldSource(scope, name);
        putField(scope, name, { raw: value, base: previous?.base ?? source.base, label: specification.label });
        failedValue = undefined;
        clearError();
        cancelConfirmation(owner, false);
        update(currentValue);
      }
      function discard() {
        removeField(scope, name);
        failedValue = undefined;
        clearError();
        const source = fieldSource(scope, name);
        writeValue(source.value);
        owner.error.hidden = true;
        text(owner.error, '');
        text(owner.status, 'Uncommitted field edit discarded; other drafts are retained.');
        update(source.value);
      }
      function commit(explicit = false) {
        const entry = pendingField(scope, name);
        if (!entry || input.disabled || composing || retainingInputs || !explicit && pointerNavigation) return;
        try {
          const state = snapshot();
          if (state.project.id !== scope.projectId || state.project.activeFloorId !== scope.floorId
            || scope.collection !== 'floors' && (state.selection?.id !== scope.entityId || COLLECTIONS[state.selection?.kind] !== scope.collection)) return;
          const source = fieldSource(scope, name);
          if (entry.base !== source.base)
            throw new Error('The source changed. Your draft is retained; review it against the current value or discard it before applying.');
          if (entry.raw === failedValue) return;
          specification.commit(entry.raw);
          removeField(scope, name, entry);
          failedValue = undefined;
          clearError();
          owner.error.hidden = true;
          text(owner.error, '');
          text(owner.status, `${specification.label} updated.`);
          render();
        } catch (error) {
          failedValue = entry.raw;
          if (sameDraft(pendingField(scope, name), entry))
            putField(scope, name, { ...entry, error: error.message || 'This value could not be applied.' });
          showError(error.message || 'This value could not be applied.');
          reportError(owner, error);
        }
      }
      const review = button(actions, 'Review current source…', 'review-field-draft', () => run(owner, () => {
        const entry = pendingField(scope, name), source = fieldSource(scope, name);
        if (!entry) return;
        confirmAction(owner, input, {
          title: 'Review retained field draft', label: 'Keep draft against current source',
          description: `${specification.label}: pending “${entry.raw}”; current source “${source.value ?? 'not recorded'}”. `
            + 'This only updates the draft base. Apply the field separately after review; no geometry changes now.',
          success: 'Draft reviewed against the current source. Apply it explicitly when ready.',
          execute: () => {
            if (!sameDraft(pendingField(scope, name), entry)) throw new Error('The pending field changed. Review it again.');
            putField(scope, name, { raw: entry.raw, label: entry.label, base: fieldSource(scope, name).base });
            failedValue = undefined;
            update(currentValue);
          }
        });
      }));
      button(actions, 'Apply field', 'apply-field-draft', () => { failedValue = undefined; commit(true); });
      button(actions, 'Discard field…', 'discard-field-draft', () => {
        const entry = pendingField(scope, name);
        if (!entry) return;
        confirmAction(owner, input, {
          title: 'Discard this field draft?', label: 'Discard field draft',
          description: `Discard only the pending ${specification.label.toLowerCase()} value “${entry.raw}”. The current project and other drafts are unchanged.`,
          success: 'Field draft discarded; current source reloaded.',
          execute: () => {
            if (!sameDraft(pendingField(scope, name), entry)) throw new Error('The pending field changed. Review discard again.');
            discard();
          }
        });
      });
      input.addEventListener('input', () => {
        try { capture(true); } catch (error) { reportError(owner, error); }
      });
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; });
      input.addEventListener('change', () => {
        if (composing) return;
        try {
          if (raw() !== pendingField(scope, name)?.raw) capture();
          commit(!!specification.options || input.type === 'checkbox');
        } catch (error) { reportError(owner, error); }
      });
      input.addEventListener('blur', () => {
        commit();
        if (!pendingField(scope, name)) writeValue(currentValue);
      });
      input.addEventListener('keydown', event => {
        if (event.isComposing || event.defaultPrevented || composing) return;
        if (event.key === 'Enter' && !specification.options && input.type !== 'checkbox') {
          event.preventDefault();
          try {
            if (raw() !== pendingField(scope, name)?.raw) capture();
            commit(true);
          } catch (error) { reportError(owner, error); }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          try { discard(); } catch (error) { reportError(owner, error); }
        }
      });
      return { input, update, wrapper };
    }

    function readout(parent, label) {
      const row = element('div', 'hp-editor-readout', undefined, parent);
      element('span', 'hp-editor-readout-label', label, row);
      return element('span', 'hp-editor-readout-value', '', row);
    }
    function group(parent, title) {
      const node = element('fieldset', 'hp-editor-group', undefined, parent);
      element('legend', 'hp-editor-legend', title, node);
      return node;
    }
    function replaceSection(owner, section) {
      if (section.contains(document.activeElement)) focus(owner.heading);
      section.replaceChildren();
    }
    function selectOptions(control, options, value) {
      const signature = JSON.stringify(options);
      if (document.activeElement === control) return;
      if (control.dataset.hpEditorOptions !== signature) {
        control.replaceChildren();
        for (const option of options) {
          const node = element('option', '', option.label, control);
          node.value = option.value;
          if (option.value === '') node.disabled = true;
        }
        control.dataset.hpEditorOptions = signature;
      }
      control.value = value || '';
    }

    let objectSelect, identityType, identityId, selectionNote, selectionFields, diagnosticList, floorSelectionHint;
    if (inspector) {
      const label = element('label', 'hp-editor-label', 'Choose an object on the active floor', inspector.body);
      objectSelect = element('select', 'hp-editor-input hp-editor-object-select', undefined, inspector.body);
      objectSelect.id = 'hp-editor-object-select';
      label.htmlFor = objectSelect.id;
      objectSelect.addEventListener('change', () => {
        if (!objectSelect.value) return;
        run(inspector, () => {
          const ref = JSON.parse(objectSelect.value);
          if (!selectionEntity(planner.getScene(), ref)) throw new Error('This object is no longer on the active floor.');
          planner.select(ref);
        });
      });
      objectSelect.addEventListener('blur', () => render());
      const identity = element('div', 'hp-editor-identity', undefined, inspector.body);
      identityType = element('strong', 'hp-editor-kind', 'No selection', identity);
      identityType.id = 'hp-editor-selected-kind';
      identityId = element('code', 'hp-editor-id', '', identity);
      identityId.id = 'hp-editor-selected-id';
      selectionNote = element('p', 'hp-editor-note', '', inspector.body);
      selectionNote.setAttribute('role', 'status');
      floorSelectionHint = button(inspector.body, 'Choose its active floor explicitly', 'focus-floor-selector', () => requestChooseFloor());
      floorSelectionHint.hidden = true;
      selectionFields = element('div', 'hp-editor-properties', undefined, inspector.body);
      diagnosticList = element('ul', 'hp-editor-diagnostics', undefined, inspector.body);
    }

    function rectFields(parent, kind, key, fields) {
      const dimensions = group(parent, 'Position & footprint · metres');
      const grid = element('div', 'hp-editor-grid', undefined, dimensions);
      for (const [axis, label] of [['x', 'X position (m)'], ['y', 'Y position (m)'], ['w', 'Width X (m)'], ['h', 'Depth Y (m)']]) {
        const control = field(inspector, grid, {
          id: `hp-editor-${kind}-${axis}`, key: axis, label,
          min: axis === 'w' || axis === 'h' ? 0 : undefined,
          commit: value => {
            const ctx = selectedContext(key);
            executeChanged(rectCommand(kind, ctx.entity, axis, value), ctx.entity);
          }
        });
        fields.push(ctx => control.update(ctx.entity.rect && ctx.entity.rect[axis], ctx));
      }
      element('p', 'hp-editor-help', 'Building-local coordinates: X right; Y toward the rear. '
        + 'Commit with Enter or leave the field. Escape discards a draft. Bounds and collisions are checked by the planner.', dimensions);
    }

    function bedFields(parent, key, fields) {
      const bed = group(parent, 'Actual bed head');
      const direction = field(inspector, bed, {
        id: 'hp-editor-bed-head', key: 'headLocal', label: 'Head end in the building-local frame',
        options: [{ value: '', label: 'Not recorded — choose explicitly' },
          { value: 'N', label: 'N · toward −Y' }, { value: 'E', label: 'E · toward +X' },
          { value: 'S', label: 'S · toward +Y' }, { value: 'W', label: 'W · toward −X' }],
        help: 'The head is the pillow/headboard end, not the feet. Choosing a direction pins it; no direction is inferred from the footprint.',
        commit: value => {
          const ctx = selectedContext(key);
          executeChanged(bedHeadCommand(ctx.entity, value), ctx.entity);
        }
      });
      const bearing = readout(bed, 'True head bearing');
      const pinnedState = readout(bed, 'Placement state');
      const pinned = field(inspector, bed, {
        id: 'hp-editor-bed-pinned', key: 'pinned', type: 'checkbox', label: 'Pin manual placement',
        help: 'Pinned beds are preserved rather than silently reoriented. Unpinning permits automatic placement.',
        commit: value => {
          const ctx = selectedContext(key);
          executeChanged({ type: 'update-furniture', id: ctx.entity.id, pinned: value }, ctx.entity);
        }
      });
      fields.push(ctx => {
        direction.update(Object.prototype.hasOwnProperty.call(DIRECTIONS, ctx.entity.headLocal) ? ctx.entity.headLocal : '', ctx);
        const degrees = headBearing(ctx.entity.headLocal, ctx.scene.headingDeg);
        text(bearing, degrees === null ? 'Unknown — no inferred head direction' : `${Number(degrees.toFixed(2))}° from true north`);
        text(pinnedState, ctx.entity.pinned === true ? 'Pinned · manual' : ctx.entity.pinned === false ? 'Unpinned · automatic eligible' : 'Pin state not recorded');
        pinned.update(ctx.entity.pinned, ctx);
      });
    }

    function openingFields(parent, kind, key, fields, firstContext) {
      const opening = group(parent, kind === 'window' ? 'Window aperture' : 'Door aperture');
      const host = readout(opening, 'Host wall ID');
      const head = kind === 'door' ? readout(opening, 'Head above floor') : null;
      const requestedWidth = kind === 'door' ? readout(opening, 'Requested clear width · unverified') : null;
      const nominalLeaf = kind === 'door' ? readout(opening, 'Nominal leaf width · schematic') : null;
      const wallDirection = readout(opening, 'Wall start → end');
      const inputs = [];
      const grid = element('div', 'hp-editor-grid', undefined, opening);
      const specs = [['offsetM', 'Offset from original wall start (m)', 0], ['widthM', 'Opening width (m)', 0]];
      if (kind === 'window') specs.push(['sillM', 'Sill above floor (m)', 0], ['headM', 'Head above floor (m)', 0],
        ['heightM', 'Window height (m)', 0]);
      else specs.push(['heightM', 'Door opening height (m)', 0]);
      specs.push(['openFraction', 'Operating open fraction', 0, 1]);
      for (const [name, label, min, max] of specs) {
        const control = field(inspector, grid, {
          id: `hp-editor-${kind}-${name}`, key: name, label, min, max,
          help: name === 'openFraction' ? '0 = closed; 1 = fully open. Not the drawing angle.' : undefined,
          commit: value => {
            const ctx = selectedContext(key);
            executeChanged(openingCommand(kind, ctx.entity, name, value, ctx.wall), ctx.entity);
          }
        });
        inputs.push(control);
        fields.push(ctx => control.update(name === 'headM'
          ? Number.isFinite(ctx.entity.sillM) && Number.isFinite(ctx.entity.heightM) ? ctx.entity.sillM + ctx.entity.heightM : undefined
          : ctx.entity[name], ctx));
      }
      if (kind === 'door' && firstContext.entity.kind === 'hinged') {
        let swingControl;
        for (const [name, label, choices] of [
          ['hinge', 'Hinge endpoint', [{ value: 'start', label: 'Opening start endpoint' }, { value: 'end', label: 'Opening end endpoint' }]],
          ['swing', 'Swing side · wall start → end', [{ value: 'left', label: 'Left side (canonical wall direction)' }, { value: 'right', label: 'Right side (canonical wall direction)' }]]
        ]) {
          const control = field(inspector, opening, {
            id: `hp-editor-door-${name}`, key: name, label,
            options: [{ value: '', label: 'Not recorded' }, ...choices],
            commit: value => {
              const ctx = selectedContext(key);
              executeChanged(openingCommand(kind, ctx.entity, name, value, ctx.wall), ctx.entity);
            }
          });
          inputs.push(control);
          if (name === 'swing') swingControl = control;
          fields.push(ctx => control.update(ctx.entity[name], ctx));
        }
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const sketch = document.createElementNS(svgNamespace, 'svg');
        sketch.classList.add('hp-editor-door-sketch');
        sketch.setAttribute('role', 'img');
        sketch.setAttribute('aria-label', 'Hinge and fully open swing diagram, not the operating open fraction');
        opening.appendChild(sketch);
        function sketchElement(tag, className) {
          const node = document.createElementNS(svgNamespace, tag);
          node.setAttribute('class', className);
          sketch.appendChild(node);
          return node;
        }
        const closedLine = sketchElement('line', 'hp-editor-sketch-closed');
        const swingArc = sketchElement('path', 'hp-editor-sketch-arc');
        const openLine = sketchElement('line', 'hp-editor-sketch-leaf');
        const hingeDot = sketchElement('circle', 'hp-editor-sketch-hinge');
        const preview = element('p', 'hp-editor-help hp-editor-hinge-preview', '', opening);
        fields.push(ctx => {
          if (!ctx.wall || !model || typeof model.doorGeometry !== 'function') {
            sketch.setAttribute('hidden', '');
            text(preview, 'The plan shows the selected hinge and swing. Start/end refer to the opening interval along its host wall.');
            return;
          }
          try {
            const geometry = model.doorGeometry({ ...ctx.entity, openFraction: 1 }, ctx.wall);
            const points = [geometry.hinge, geometry.closedEnd, geometry.openEnd];
            if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
              || !Number.isFinite(geometry.radiusM) || geometry.radiusM <= 0 || ![0, 1].includes(geometry.arcSweep)) {
              throw new Error('The shared model did not return valid hinge geometry.');
            }
            sketch.removeAttribute('hidden');
            const margin = geometry.radiusM * .18;
            const minX = Math.min(...points.map(point => point.x)) - margin;
            const minY = Math.min(...points.map(point => point.y)) - margin;
            const width = Math.max(...points.map(point => point.x)) - minX + margin;
            const height = Math.max(...points.map(point => point.y)) - minY + margin;
            sketch.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
            for (const [line, end] of [[closedLine, geometry.closedEnd], [openLine, geometry.openEnd]]) {
              line.setAttribute('x1', geometry.hinge.x);
              line.setAttribute('y1', geometry.hinge.y);
              line.setAttribute('x2', end.x);
              line.setAttribute('y2', end.y);
            }
            hingeDot.setAttribute('cx', geometry.hinge.x);
            hingeDot.setAttribute('cy', geometry.hinge.y);
            hingeDot.setAttribute('r', geometry.radiusM * .045);
            swingArc.setAttribute('d', `M ${geometry.closedEnd.x} ${geometry.closedEnd.y} A ${geometry.radiusM} `
              + `${geometry.radiusM} 0 0 ${geometry.arcSweep} ${geometry.openEnd.x} ${geometry.openEnd.y}`);
            text(preview, `Hinge: X ${metreText(geometry.hinge.x)}, Y ${metreText(geometry.hinge.y)}. `
              + 'Fully open diagram from the shared door geometry; dashed line is closed position. '
              + 'This preview does not set the operating open fraction.');
            if (document.activeElement !== swingControl.input) {
              const adjacent = (ctx.scene.rooms || []).filter(room => (ctx.wall.roomIds || []).includes(room.id)
                || [ctx.entity.roomId, ctx.entity.targetRoomId].includes(room.id));
              for (const side of ['left', 'right']) {
                const candidate = model.doorGeometry({ ...ctx.entity, swing: side, openFraction: 1 }, ctx.wall);
                const point = {
                  x: candidate.hinge.x + .6 * (candidate.openEnd.x - candidate.hinge.x),
                  y: candidate.hinge.y + .6 * (candidate.openEnd.y - candidate.hinge.y)
                };
                const rooms = adjacent.filter(room => room.rect && point.x > room.rect.x
                  && point.x < room.rect.x + room.rect.w && point.y > room.rect.y && point.y < room.rect.y + room.rect.h);
                const option = Array.from(swingControl.input.options).find(item => item.value === side);
                if (option) text(option, `${side === 'left' ? 'Left' : 'Right'}`
                  + (rooms.length === 1 ? ` · into ${rooms[0].label || rooms[0].id}` : ' side (canonical wall direction)'));
              }
            }
          } catch (error) {
            sketch.setAttribute('hidden', '');
            text(preview, `Hinge preview unavailable: ${error.message}`);
          }
        });
      } else if (kind === 'door') {
        element('p', 'hp-editor-note', 'Sliding door — no hinge or swing controls. Sliding notation is preserved.', opening);
      }
      element('p', 'hp-editor-help', kind === 'window'
        ? 'Head = sill + height. Changing the sill retains height; editing the head changes height. '
          + 'Heights are above this floor. Glazing is not automatically an open airflow aperture.'
        : 'Width is the schematic model opening width, not a certified clear passage. '
          + 'Offset is measured from the original host wall start; wall ends and collisions are checked before each edit. '
          + 'The swing diagram is not its operating state.', opening);
      fields.push(ctx => {
        text(host, ctx.entity.wallId || 'Unresolved attachment');
        text(wallDirection, ctx.wall
          ? `(${metreText(ctx.wall.start.x)}, ${metreText(ctx.wall.start.y)}) → (${metreText(ctx.wall.end.x)}, ${metreText(ctx.wall.end.y)})`
          : 'Missing host — review attachment');
        if (head) text(head, Number.isFinite(ctx.entity.sillM) && Number.isFinite(ctx.entity.heightM)
          ? metreText(ctx.entity.sillM + ctx.entity.heightM) : 'Not available');
        if (requestedWidth) text(requestedWidth, metreText(ctx.entity.requestedClearWidthM));
        if (nominalLeaf) text(nominalLeaf, metreText(ctx.entity.nominalLeafWidthM));
        for (const control of inputs) control.input.disabled = !ctx.wall;
      });
      const actions = element('div', 'hp-editor-actions', undefined, opening);
      const remove = button(actions, `Delete ${kind}…`, 'delete-opening', () => requestDeleteSelection());
      remove.classList.add('hp-editor-caution-button');
      fields.push(ctx => {
        const state = selectionActions(ctx.scene, ctx.selection);
        remove.disabled = !state.canDelete;
        remove.title = state.canDelete ? '' : state.reason;
      });
      selectionRequests.delete = () => run(inspector, () => {
        const ctx = selectedContext(key);
        confirmAction(inspector, remove, {
          title: `Delete this ${kind}?`, label: `Confirm ${kind} deletion`,
          description: `Suppress the selected opening's source(s) (${ctx.entity.id}) on this floor, including any fragments sharing those sources. `
            + 'Original generated or added source records and existing edit metadata remain in project backups. '
            + 'Other opening sources, rooms and furniture are unchanged. Review access and ventilation after removal.',
          success: `${kind === 'door' ? 'Door' : 'Window'} deleted in both views. Use Undo to restore it.`,
          execute: () => planner.execute({ type: 'delete-opening', id: selectedContext(key).entity.id })
        });
      });
    }

    function stagedNumber(parent, key, label, value, changed) {
      const wrapper = element('div', 'hp-editor-field', undefined, parent);
      const labelNode = element('label', 'hp-editor-label', label, wrapper);
      const input = element('input', 'hp-editor-input', undefined, wrapper);
      input.id = `hp-editor-${key}`;
      input.dataset.hpEditorField = key;
      input.type = 'text';
      input.dataset.hpEditorNumeric = 'true';
      input.min = '0';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = value === undefined || value === null ? '' : String(value);
      labelNode.htmlFor = input.id;
      input.addEventListener('input', changed);
      return input;
    }

    function stagedDraft(parent, specification) {
      const note = element('p', 'hp-editor-warning', '', parent);
      note.setAttribute('role', 'status');
      const actions = element('div', 'hp-editor-actions', undefined, parent);
      let loadedKey = null;
      const scope = () => specification.scope();
      const label = () => typeof specification.label === 'function' ? specification.label() : specification.label;
      function sync(force = false) {
        const owner = scope();
        if (!owner) { note.hidden = actions.hidden = true; return; }
        const entry = drafts.get(owner), source = specification.source(), key = Drafts.key(owner);
        if (force || loadedKey !== key || !entry && !specification.inputs().includes(document.activeElement))
          specification.write(entry ? entry.values : source.values);
        loadedKey = key;
        const stale = entry && !sameDraft(entry.base, source.base);
        note.hidden = actions.hidden = !entry;
        review.hidden = !stale;
        text(note, entry?.error || (stale
          ? 'The host or wall edit changed since this draft began. The pending values are retained. Review the current source before applying.'
          : 'Staged inputs are retained on this project, floor and wall, but are not included in saves or exports.'));
      }
      function capture() {
        const owner = scope();
        if (!owner) return;
        const previous = drafts.get(owner), source = specification.source();
        drafts.put(owner, { label: label(), values: specification.read(), base: previous?.base ?? source.base });
        cancelConfirmation(inspector, false);
        refreshDraftList();
        sync();
      }
      function reject(error) {
        const owner = scope(), entry = owner && drafts.get(owner);
        if (entry) drafts.put(owner, { ...entry, error: error.message || 'This staged edit could not be applied.' });
        refreshDraftList();
        try { sync(); }
        catch (_) { note.hidden = false; text(note, error.message); }
        throw error;
      }
      function assertCurrent(saved) {
        if (!sameDraft(scope(), saved.scope) || !sameDraft(drafts.get(saved.scope), saved.entry))
          throw new Error('The staged inputs changed. Review the pending action again.');
        if (!sameDraft(saved.entry.base, specification.source().base))
          throw new Error('The host or wall edit changed. Review the retained draft against the current source or discard it before applying.');
      }
      function checkpoint() {
        try {
          const owner = scope();
          if (!owner) throw new Error('Choose a staged wall action first.');
          const existing = drafts.get(owner);
          if (!existing || !sameDraft(existing.values, specification.read())) capture();
          const saved = { scope: owner, entry: drafts.get(owner) };
          assertCurrent(saved);
          return saved;
        } catch (error) { return reject(error); }
      }
      function commit(action, saved) {
        try {
          saved = saved || checkpoint();
          assertCurrent(saved);
          action();
        } catch (error) { return reject(error); }
        if (sameDraft(drafts.get(saved.scope), saved.entry)) drafts.remove(saved.scope);
        refreshDraftList();
      }
      const review = button(actions, 'Review current host…', 'review-staged-draft', () => run(inspector, () => {
        const owner = scope(), entry = drafts.get(owner);
        if (!entry) return;
        confirmAction(inspector, specification.inputs()[0], {
          title: 'Review retained wall draft', label: 'Keep draft against current host',
          description: `${label()}: ${Object.entries(entry.values).map(([key, value]) => `${key} = ${value || '(empty)'}`).join('; ')}. `
            + 'Review the current wall dimensions and retained span above. This updates only the draft base; adding or changing geometry still requires its ordinary action and validation.',
          success: 'Draft reviewed against the current host. Apply or review the geometry action separately.',
          execute: () => {
            if (!sameDraft(drafts.get(owner), entry)) throw new Error('The staged inputs changed. Review them again.');
            drafts.put(owner, { label: entry.label, values: entry.values, base: specification.source().base });
            refreshDraftList();
            sync();
          }
        });
      }));
      const discard = button(actions, 'Discard staged inputs…', 'discard-staged-draft', () => {
        const owner = scope(), entry = owner && drafts.get(owner);
        if (!entry) return;
        confirmAction(inspector, specification.inputs()[0], {
          title: 'Discard these staged inputs?', label: 'Discard staged inputs',
          description: `Discard only “${entry.label}” for wall ${owner.entityId}. Current geometry and every other owner's pending inputs are unchanged.`,
          success: 'Staged inputs discarded; current wall values reloaded.',
          execute: () => {
            if (!sameDraft(drafts.get(owner), entry)) throw new Error('The staged inputs changed. Review discard again.');
            drafts.remove(owner);
            refreshDraftList();
            sync(true);
          }
        });
      });
      return { sync, capture, checkpoint, commit, reject, discard };
    }

    function addOpeningFields(parent, key, fields) {
      const section = group(parent, 'Doors & windows on this wall');
      const actions = element('div', 'hp-editor-actions', undefined, section);
      const form = element('div', 'hp-editor-wall-draft', undefined, section);
      form.hidden = true;
      let kind = null;
      const title = element('h3', 'hp-editor-subheading', '', form);
      const grid = element('div', 'hp-editor-grid', undefined, form);
      const inputs = {};
      let stage;
      const changed = () => {
        if (!kind) return;
        try { stage.capture(); } catch (error) { reportError(inspector, error); }
      };
      for (const [name, label] of [
        ['offsetM', 'Offset from original wall start (m)'], ['widthM', 'Opening width (m)'],
        ['heightM', 'Door opening height (m)'], ['sillM', 'Window sill above floor (m)'],
        ['headM', 'Window head above floor (m)'], ['openFraction', 'Operating open fraction · 0–1']
      ]) inputs[name] = stagedNumber(grid, `new-opening-${name}`, label, name === 'openFraction' ? 0 : '', changed);
      const handing = element('div', 'hp-editor-grid', undefined, form);
      for (const [name, label, choices] of [
        ['hinge', 'Door hinge endpoint', [['start', 'Opening start'], ['end', 'Opening end']]],
        ['swing', 'Door swing side · wall start → end', [['left', 'Left side'], ['right', 'Right side']]]
      ]) {
        const labelNode = element('label', 'hp-editor-label', label, handing);
        const select = element('select', 'hp-editor-input', undefined, handing);
        select.id = `hp-editor-new-opening-${name}`;
        select.dataset.hpEditorField = `new-opening-${name}`;
        labelNode.htmlFor = select.id;
        for (const [value, label] of [['', 'Choose…'], ...choices]) {
          const option = element('option', '', label, select);
          option.value = value;
          if (!value) option.disabled = true;
        }
        select.value = '';
        select.addEventListener('change', changed);
        inputs[name] = select;
      }
      element('p', 'hp-editor-help', 'All dimensions are metres. An actual wall aperture is created in both views; '
        + 'it cannot cross a wall end, another opening or a removed span. Heights are above this floor. '
        + 'Open fraction starts at 0 (closed); it is not a swing angle or certified clear passage.', form);
      const read = () => Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value]));
      stage = stagedDraft(form, {
        scope: () => kind ? selectionScope(key, `wall-opening-${kind}`) : null,
        label: () => `New ${kind} aperture`, read, inputs: () => Object.values(inputs),
        write: values => { for (const [name, input] of Object.entries(inputs)) input.value = values[name] ?? ''; },
        source: () => {
          const ctx = selectedContext(key);
          return {
            values: Object.fromEntries(Object.keys(inputs).map(name => [name, name === 'openFraction' ? '0' : ''])),
            base: { wall: wallDraftBase(ctx.entity), edit: ctx.project.wallEdits?.[ctx.entity.id] || null }
          };
        }
      });
      const place = button(form, 'Add opening', 'add-wall-opening', () => run(inspector, () => {
        stage.commit(() => {
          const ctx = selectedContext(key), values = read();
          if (kind === 'door') delete values.headM;
          planner.execute(addOpeningCommand(ctx.entity, kind, values));
        });
      }, 'Opening added to the selected wall. Its real aperture and selection are shared by 2D and 3D.'));
      function show(next, moveFocus = true) {
        kind = next;
        form.hidden = false;
        text(title, next === 'door' ? 'New door aperture' : 'New window aperture');
        for (const name of ['sillM', 'headM']) inputs[name].parentElement.hidden = next !== 'window';
        inputs.heightM.parentElement.hidden = next !== 'door';
        handing.hidden = next !== 'door';
        text(place, next === 'door' ? 'Add door' : 'Add window');
        place.dataset.hpEditorAction = `add-${next}`;
        stage.sync(true);
        if (!drafts.get(selectionScope(key, `wall-opening-${kind}`))) stage.capture();
        if (moveFocus) reveal(inspector, inputs.offsetM);
      }
      const door = button(actions, 'Add door…', 'configure-door', () => requestAddOpening('door'));
      const windowButton = button(actions, 'Add window…', 'configure-window', () => requestAddOpening('window'));
      selectionRequests.addOpening = show;
      button(form, 'Close placement · keep draft', 'cancel-wall-opening', () => {
        form.hidden = true;
        focus(kind === 'door' ? door : windowButton);
      });
      fields.push(ctx => {
        const available = selectionActions(ctx.scene, ctx.selection);
        door.disabled = !available.canAddDoor;
        windowButton.disabled = !available.canAddWindow;
        for (const control of [place, ...Object.values(inputs)])
          control.disabled = kind === 'window' ? !available.canAddWindow : !available.canAddDoor;
        section.title = 'Choose a surviving, classified and unprotected internal or exterior host wall.';
        stage.sync();
      });
      const retained = ['door', 'window'].find(next => drafts.get(selectionScope(key, `wall-opening-${next}`)));
      if (retained) show(retained, false);
    }

    function wallFields(parent, key, fields, firstContext) {
      const wallGroup = group(parent, 'Physical partition');
      const values = {};
      for (const [name, label] of [['length', 'Span length'], ['heightM', 'Wall height'], ['thicknessM', 'Thickness'],
        ['baseM', 'Base elevation'], ['classification', 'Classification'], ['state', 'Connection state'], ['rooms', 'Adjoining rooms']]) {
        values[name] = readout(wallGroup, label);
      }
      element('p', 'hp-editor-warning', WALL_CAUTION, wallGroup);
      const directActions = element('div', 'hp-editor-actions', undefined, wallGroup);
      const remove = button(directActions, 'Delete internal wall…', 'delete-wall', () => requestDeleteSelection());
      selectionRequests.delete = () => run(inspector, () => {
        const ctx = selectedContext(key), span = retainedSpan(ctx.entity);
        wallOpeningCommand(ctx.entity, { full: true });
        confirmAction(inspector, remove, {
          title: 'Delete this internal partition?', label: 'Confirm conceptual wall deletion',
          description: `Open the full retained ${metreText(span.endM - span.startM)} span, through the full wall height. `
            + `Wall ID: ${ctx.entity.id}. Room boundaries are not moved. Related openings and independent references are retained for review.`,
          caution: WALL_CAUTION, success: 'Internal partition opened in both views. Use Undo or Restore wall to reverse it.',
          execute: () => planner.execute(wallOpeningCommand(selectedContext(key).entity, { full: true }))
        });
      });
      remove.classList.add('hp-editor-caution-button');
      const draft = element('div', 'hp-editor-wall-draft', undefined, wallGroup);
      const modeLabel = element('label', 'hp-editor-label', 'Full-height opening', draft);
      const mode = element('select', 'hp-editor-input', undefined, draft);
      mode.id = 'hp-editor-wall-span';
      mode.dataset.hpEditorField = 'wallSpan';
      modeLabel.htmlFor = mode.id;
      for (const [value, label] of [['full', 'Full retained span'], ['partial', 'Partial · enter width'], ['to-end', 'To wall end · exact remaining span']]) {
        const option = element('option', '', label, mode);
        option.value = value;
      }
      const existing = firstContext.project.wallEdits && firstContext.project.wallEdits[firstContext.entity.id];
      const modeFor = edit => edit?.toEnd ? 'to-end' : edit?.full === false ? 'partial' : 'full';
      mode.value = modeFor(existing);
      let connectionStage;
      let latestWall = firstContext.entity;
      const partial = element('div', 'hp-editor-grid', undefined, draft);
      const staged = {};
      for (const [name, label] of [['offsetM', 'Offset from original wall start (m)'], ['widthM', 'Open span width (m)']]) {
        const input = stagedNumber(partial, `wall-${name}`, label, existing?.full === false ? existing[name] : '', () => {
          try { connectionStage.capture(); } catch (error) { reportError(inspector, error); }
          updateRemaining();
        });
        input.dataset.hpEditorField = name;
        input.placeholder = 'Required for partial span';
        staged[name] = input;
      }
      const remaining = element('p', 'hp-editor-help', '', draft);
      remaining.dataset.hpEditorReadout = 'remaining-wall-span';
      function updateRemaining() {
        try {
          const span = retainedSpan(latestWall);
          if (mode.value === 'full') {
            text(remaining, `Full retained span: ${metreText(span.endM - span.startM)}. No partial-width entry needed.`);
            return;
          }
          const offset = numberValue(staged.offsetM.value, { label: 'Opening offset', min: span.startM, max: span.endM });
          const width = span.endM - offset;
          let note = `Exact remaining span to wall end: ${metreText(width)}. `;
          if (mode.value === 'to-end') note += 'The end follows the effective host span after later edits.';
          else if (staged.widthM.value !== '') {
            const entered = numberValue(staged.widthM.value, { label: 'Opening width', positive: true });
            note += entered <= width ? `${metreText(width - entered)} deliberately remains at this end. Choose “To wall end” to remove it exactly.`
              : 'The entered width exceeds the available span; it will be rejected.';
          } else note += 'Enter a deliberate width, or choose “To wall end”.';
          text(remaining, note);
        } catch (error) { text(remaining, error.message); }
      }
      function updateMode() {
        partial.hidden = mode.value === 'full';
        staged.widthM.parentElement.hidden = mode.value === 'to-end';
        staged.offsetM.disabled = mode.disabled || mode.value === 'full';
        staged.widthM.disabled = mode.disabled || mode.value !== 'partial';
        updateRemaining();
      }
      mode.addEventListener('change', () => {
        try { connectionStage.capture(); } catch (error) { reportError(inspector, error); }
        updateMode();
      });
      const connectionScope = selectionScope(key, 'wall-connection');
      connectionStage = stagedDraft(draft, {
        scope: () => connectionScope, label: 'Full-height wall connection',
        inputs: () => [mode, ...Object.values(staged)],
        read: () => ({ mode: mode.value, offsetM: staged.offsetM.value, widthM: staged.widthM.value }),
        write: values => {
          mode.value = values.mode;
          for (const [name, input] of Object.entries(staged)) input.value = values[name];
        },
        source: () => {
          const ctx = selectedContext(key), edit = ctx.project.wallEdits?.[ctx.entity.id];
          return {
            values: { mode: modeFor(edit), offsetM: edit?.full === false ? String(edit.offsetM ?? '') : '',
              widthM: edit?.full === false ? String(edit.widthM ?? '') : '' },
            base: { wall: wallDraftBase(ctx.entity), edit: edit || null }
          };
        }
      });
      const actions = element('div', 'hp-editor-actions', undefined, draft);
      const review = button(actions, 'Review conceptual opening…', 'review-open-wall', () => run(inspector, () => {
        const pending = connectionStage.checkpoint();
        const ctx = selectedContext(key);
        let command;
        try {
          command = wallOpeningCommand(ctx.entity, {
            full: mode.value === 'full', toEnd: mode.value === 'to-end', offsetM: staged.offsetM.value, widthM: staged.widthM.value
          });
        } catch (error) { connectionStage.reject(error); }
        const span = retainedSpan(ctx.entity);
        const description = command.full
          ? `Open the full ${metreText(span.endM - span.startM)} retained span and full wall height.`
          : `Open ${metreText(command.toEnd ? span.endM - command.offsetM : command.widthM)} starting ${metreText(command.offsetM)} `
            + `from the original wall start, through the full wall height${command.toEnd ? ', exactly to the wall end (persistent intent)' : ''}.`;
        confirmAction(inspector, review, {
          title: 'Review internal connection', label: 'Confirm conceptual opening',
          description: `${description} Wall ID: ${ctx.entity.id}. Named rooms remain. `
            + 'Affected attachments may require review; an internal connection is not an outdoor air inlet.',
          caution: WALL_CAUTION, success: 'Conceptual connection applied. Review affected attachments and diagnostics.',
          execute: () => connectionStage.commit(() => {
            const latest = selectedContext(key);
            planner.execute(wallOpeningCommand(latest.entity, command));
          }, pending)
        });
      }));
      const restore = button(directActions, 'Restore wall…', 'review-restore-wall', () => run(inspector, () => {
        const ctx = selectedContext(key);
        confirmAction(inspector, restore, {
          title: 'Review conceptual wall restoration', label: 'Confirm wall restoration',
          description: `Restore the selected wall in the schematic plan. Wall ID: ${ctx.entity.id}. `
            + 'Review its doors, windows and electrical attachments after restoration.',
          caution: WALL_CAUTION, success: 'Wall restored in the conceptual plan.',
          execute: () => {
            planner.execute({ type: 'restore-wall', id: selectedContext(key).entity.id, confirmConceptual: true });
          }
        });
      }));
      const trim = element('details', 'hp-editor-wall-draft', undefined, wallGroup);
      element('summary', 'hp-editor-label', 'Adjust retained wall ends within the original span', trim);
      element('p', 'hp-editor-help', 'Trim only: no moving or extending walls, and no reshaping adjoining rooms. '
        + 'Offsets use the original wall start. An end equal to the original wall end continues to follow that end. '
        + 'Openings or attachments in cut-away material stay retained but unresolved for review.', trim);
      const trimGrid = element('div', 'hp-editor-grid', undefined, trim);
      const initialSpan = retainedSpan(firstContext.entity);
      let trimStage;
      const trimChanged = () => {
        try { trimStage.capture(); } catch (error) { reportError(inspector, error); }
      };
      const trimStart = stagedNumber(trimGrid, 'retainedStartM', 'Retained start (m)', initialSpan.startM, trimChanged);
      const trimEnd = stagedNumber(trimGrid, 'retainedEndM', 'Retained end (m)', initialSpan.endM, trimChanged);
      const trimScope = selectionScope(key, 'wall-trim');
      trimStage = stagedDraft(trim, {
        scope: () => trimScope, label: 'Retained wall ends', inputs: () => [trimStart, trimEnd],
        read: () => ({ startM: trimStart.value, endM: trimEnd.value }),
        write: values => { trimStart.value = values.startM; trimEnd.value = values.endM; },
        source: () => {
          const ctx = selectedContext(key), span = retainedSpan(ctx.entity);
          return { values: { startM: String(span.startM), endM: String(span.endM) },
            base: { wall: wallDraftBase(ctx.entity), edit: ctx.project.wallEdits?.[ctx.entity.id] || null } };
        }
      });
      const trimReview = button(trim, 'Review retained ends…', 'review-trim-wall', () => run(inspector, () => {
        const pending = trimStage.checkpoint(), ctx = selectedContext(key);
        let command;
        try { command = wallTrimCommand(ctx.entity, trimStart.value, trimEnd.value); }
        catch (error) { trimStage.reject(error); }
        confirmAction(inspector, trimReview, {
          title: 'Review internal wall trim', label: 'Confirm retained wall ends',
          description: `Retain only ${metreText(command.startM)} to ${metreText(command.endM)} within the original `
            + `${metreText(wallLength(ctx.entity))} wall span. Existing full-height openings within that interval remain. `
            + 'Door/window and independent attachment records are not deleted or silently moved.',
          caution: WALL_CAUTION, success: 'Retained wall ends applied. Review attachments in removed material.',
          execute: () => trimStage.commit(() => planner.execute(command), pending)
        });
      }));
      selectionRequests.editWallSpan = () => { trim.open = true; reveal(inspector, trimStart); };
      fields.push(ctx => {
        const wall = ctx.entity;
        latestWall = wall;
        let length;
        try { length = wallLength(wall); } catch (_) { length = null; }
        text(values.length, metreText(length));
        for (const name of ['heightM', 'thicknessM', 'baseM']) text(values[name], metreText(wall[name]));
        text(values.classification, `${wall.exterior === true ? 'Exterior' : wall.exterior === false ? 'Internal' : 'Unclassified'} · structural role: ${wall.structuralRole || 'unknown'}`);
        const edit = ctx.project.wallEdits && ctx.project.wallEdits[wall.id];
        const passages = (ctx.scene.openings || []).filter(item => item.wallId === wall.id && item.kind === 'passage');
        const retainsAperture = (ctx.scene.openings || []).some(item => item.wallId === wall.id && ['hinged', 'sliding', 'window'].includes(item.kind));
        text(values.state, wall.removed ? retainsAperture ? 'No surviving masonry; door/window aperture retained' : 'Full-height partition removed'
          : edit?.retainedSpan ? `Retained interval ${metreText(wall.retainedSpan?.startM)} → ${metreText(wall.retainedSpan?.endM)}`
            : passages.length ? 'Partial-span opening' : 'No open-connection override');
        text(values.rooms, (wall.roomIds || []).map(id => (ctx.scene.rooms || []).find(room => room.id === id)?.label || id).join(' ↔ ') || 'Not recorded');
        const protectedWall = wall.exterior !== false || !['unknown', 'non-structural'].includes(wall.structuralRole) || !length;
        mode.disabled = protectedWall;
        review.disabled = protectedWall;
        remove.disabled = protectedWall || wall.removed;
        trimReview.disabled = protectedWall;
        trimStart.disabled = trimEnd.disabled = protectedWall;
        review.title = protectedWall ? 'Exterior, protected or unclassified walls cannot be opened here.' : '';
        restore.disabled = protectedWall || (!edit && !passages.length);
        connectionStage.sync();
        trimStage.sync();
        updateMode();
      });
      updateMode();
      addOpeningFields(parent, key, fields);
    }

    function buildSelection(ctx, key) {
      replaceSection(inspector, selectionFields);
      cancelConfirmation(inspector, false);
      selectionRequests = {};
      const updates = [];
      const kind = ctx.selection.kind;
      if (kind === 'room' || kind === 'furniture') rectFields(selectionFields, kind, key, updates);
      if (kind === 'room') {
        const roomType = readout(selectionFields, 'Room type');
        updates.push(state => text(roomType, state.entity.type || 'Not recorded'));
        const usableArea=readout(selectionFields,'Usable floor area');
        const reservedArea=readout(selectionFields,'Reserved by lift / staircase');
        const serviceFootprint=readout(selectionFields,'Service footprint including walls');
        updates.push(state=>{
          const room=state.entity;
          const area=room.usableAreaM2===undefined?room.rect.w*room.rect.h:room.usableAreaM2;
          text(usableArea,Number.isFinite(area)?`${area.toFixed(2)} m²`:'Not available');
          text(reservedArea,room.reservedAreaM2===undefined?'0.00 m²':
            Number.isFinite(room.reservedAreaM2)?`${room.reservedAreaM2.toFixed(2)} m²`:'Not available');
          serviceFootprint.parentElement.hidden=!room.reservesSpace;
          const footprint=room.reservationFootprint;
          text(serviceFootprint,footprint&&Number.isFinite(footprint.w*footprint.h)?
            `${(footprint.w*footprint.h).toFixed(2)} m²`:'Not available');
        });
        const actions=element('div','hp-editor-actions',undefined,selectionFields);
        const remove=button(actions,'Delete room…','delete-room',()=>requestDeleteSelection());
        selectionRequests.delete=()=>run(inspector,()=>{
          const current=selectedContext(key);
          confirmAction(inspector,remove,{
            title:'Delete this room?',label:'Confirm room deletion',
            description:`Remove “${current.entity.label || current.entity.id}” from this floor's programme, along with its furniture and room-owned openings. Other rooms and floors keep their identities and positions. Independent electrical, structural and annotation records remain for host review; an adjoining bathroom is not automatically deleted or reassigned.`,
            success:'Room deleted. Use Undo to restore it and its room-owned components.',
            execute:()=>planner.execute({type:'delete-room',id:selectedContext(key).entity.id,confirmRemoval:true})
          });
        });
        remove.classList.add('hp-editor-caution-button');
      } else if (kind === 'balcony') {
        const position = readout(selectionFields, 'Balcony footprint');
        const host = readout(selectionFields, 'Attached room');
        updates.push(state => {
          const rect = state.entity.rect;
          text(position, `X ${metreText(rect.x)}, Y ${metreText(rect.y)} · ${metreText(rect.w)} × ${metreText(rect.h)}`);
          text(host, (state.scene.rooms || []).find(room => room.id === state.entity.roomId)?.label || 'Unresolved / not recorded');
        });
        const actions = element('div', 'hp-editor-actions', undefined, selectionFields);
        const remove = button(actions, 'Delete balcony…', 'delete-balcony', () => requestDeleteSelection());
        selectionRequests.delete = () => run(inspector, () => {
          const current = selectedContext(key);
          confirmAction(inspector, remove, {
            title: 'Delete this balcony?', label: 'Confirm balcony deletion',
            description: `Remove “${current.entity.label || current.entity.id}” and its balcony-owned access openings from this floor's programme. `
              + 'Other balconies keep their identities and positions. Independent electrical, structural and annotation records remain for host review.',
            success: 'Balcony deleted. Its quantity is updated; use Undo to restore it.',
            execute: () => planner.execute({ type: 'delete-balcony', id: selectedContext(key).entity.id, confirmRemoval: true })
          });
        });
        remove.classList.add('hp-editor-caution-button');
      } else if (kind === 'furniture') {
        const host = readout(selectionFields, 'Room');
        updates.push(state => text(host, (state.scene.rooms || []).find(room => room.id === state.entity.roomId)?.label
          || state.entity.roomId || 'Unresolved'));
        if (ctx.entity.type === 'bed') bedFields(selectionFields, key, updates);
        const actions = element('div', 'hp-editor-actions', undefined, selectionFields);
        button(actions, ctx.entity.type === 'bed' ? 'Reorient head +90°' : 'Rotate 90°', 'rotate-furniture', () => run(inspector, () => {
          planner.execute({ type: 'rotate-furniture', id: selectedContext(key).entity.id });
        }, 'Component reoriented. Actual head and footprint come from the updated scene.'));
        const remove = button(actions, 'Delete component…', 'delete-furniture', () => requestDeleteSelection());
        selectionRequests.delete = () => run(inspector, () => {
          const ctx = selectedContext(key);
          confirmAction(inspector, remove, {
            title: 'Delete this component?', label: 'Confirm component deletion',
            description: `Remove “${ctx.entity.label || ctx.entity.type || ctx.entity.id}” (${ctx.entity.id}) from this floor. Other components and pending inputs are unchanged.`,
            success: 'Component deleted. Use Undo to restore it.',
            execute: () => planner.execute({ type: 'delete-furniture', id: selectedContext(key).entity.id })
          });
        });
        remove.classList.add('hp-editor-caution-button');
      } else if (kind === 'door' || kind === 'window') openingFields(selectionFields, kind, key, updates, ctx);
      else if (kind === 'wall') wallFields(selectionFields, key, updates, ctx);
      else element('p', 'hp-editor-note', 'This electrical point shares the selection. Use the Electrical workspace to edit its properties.', selectionFields);
      selectionRefresh = state => {
        for (const update of updates) update(state);
      };
    }

    let floorSelect, floorDetails, allowanceNote;
    if (tools) {
      element('p', 'hp-editor-note', 'These are independent editable layouts, not the regulatory floor selector.', tools.body);
      const label = element('label', 'hp-editor-label', 'Active editable floor', tools.body);
      floorSelect = element('select', 'hp-editor-input', undefined, tools.body);
      floorSelect.id = 'hp-editor-floor-select';
      label.htmlFor = floorSelect.id;
      floorSelect.addEventListener('change', () => run(tools, () => {
        if (!planner.getProject().floors.some(floor => floor.id === floorSelect.value)) throw new Error('Choose an existing floor.');
        if (planner.getProject().activeFloorId !== floorSelect.value) planner.execute({ type: 'select-floor', id: floorSelect.value });
      }, 'Active editable floor selected.'));
      floorSelect.addEventListener('blur', () => render());
      const actions = element('div', 'hp-editor-actions', undefined, tools.body);
      button(actions, 'Add empty floor', 'add-floor', () => run(tools, () => planner.execute({ type: 'add-floor' }), 'Empty floor added.'));
      button(actions, 'Duplicate active floor', 'duplicate-floor', () => run(tools, () => {
        const project = planner.getProject();
        if (!project.floors.some(floor => floor.id === project.activeFloorId)) throw new Error('Choose an existing floor to duplicate.');
        planner.execute({ type: 'add-floor', copyFromId: project.activeFloorId });
      }, 'Independent copy of the active floor added.'));
      floorDetails = element('div', 'hp-editor-floor-details', undefined, tools.body);
      allowanceNote = element('p', 'hp-editor-warning', '', tools.body);
      allowanceNote.id = 'hp-editor-floor-allowance';
    }

    function buildFloor(state, key) {
      replaceSection(tools, floorDetails);
      const groupNode = group(floorDetails, 'Active floor properties');
      const grid = element('div', 'hp-editor-grid', undefined, groupNode);
      const name = field(tools, grid, {
        id: 'hp-editor-floor-name', key: 'name', type: 'text', label: 'Floor name',
        commit: value => {
          const ctx = activeFloor(key);
          const command = floorPatchCommand(ctx.floor.id, 'name', value);
          if (command.patch.name !== ctx.floor.name) planner.execute(command);
        }
      });
      const height = field(tools, grid, {
        id: 'hp-editor-floor-height', key: 'heightM', label: 'Storey height (m)', min: 0,
        help: 'Vertical spacing to the next floor, not the room ceiling height.',
        commit: value => {
          const ctx = activeFloor(key);
          const command = floorPatchCommand(ctx.floor.id, 'heightM', value);
          if (command.patch.heightM !== ctx.floor.heightM) planner.execute(command);
        }
      });
      const id = readout(groupNode, 'Stable floor ID');
      const elevation = readout(groupNode, 'Derived elevation');
      const base = readout(groupNode, 'Building base elevation');
      element('p', 'hp-editor-help', 'Elevation = building base + preceding storey heights. '
        + 'Preview heights and elevations are assumptions, not a surveyed datum or structural design.', groupNode);
      const actions = element('div', 'hp-editor-actions', undefined, groupNode);
      const remove = button(actions, 'Remove active floor…', 'delete-floor', () => run(tools, () => {
        const ctx = activeFloor(key);
        const command = deleteFloorCommand(ctx.project, ctx.floor.id);
        confirmAction(tools, remove, {
          title: 'Remove this floor?', label: 'Confirm floor removal',
          description: `Remove “${ctx.floor.name}” (${ctx.floor.id}) and its rooms, components, opening edits, `
            + 'obstacles and electrical points. Other floor layouts are retained. This is reversible with Undo in this session.',
          success: 'Floor removed. Use Undo to restore it.',
          execute: () => {
            const latest = activeFloor(key);
            planner.execute(deleteFloorCommand(latest.project, command.id));
          }
        });
      }));
      remove.classList.add('hp-editor-caution-button');
      const last = element('p', 'hp-editor-help', 'Keep at least one floor; the last floor cannot be removed.', groupNode);
      floorRefresh = latest => {
        const active = latest.project.floors.find(item => item.id === latest.project.activeFloorId);
        if (!active) return;
        name.update(active.name, latest);
        height.update(active.heightM, latest);
        text(id, active.id);
        try { text(elevation, metreText(floorElevation(latest.project, active.id))); }
        catch (error) { text(elevation, error.message); }
        text(base, metreText(latest.project.building && latest.project.building.floorElevationM));
        remove.disabled = latest.project.floors.length <= 1;
        last.hidden = latest.project.floors.length > 1;
      };
      floorRefresh(state);
    }

    function renderInspector(state) {
      if (!inspector) return;
      const options = [{ value: '', label: 'Click a room, component or wall — or choose here' }];
      for (const kind of ['room', 'balcony', 'furniture', 'door', 'window', 'wall', 'electrical']) {
        const items = kind === 'room' ? state.scene?.rooms : kind === 'balcony' ? state.scene?.balconies : kind === 'furniture' ? state.scene?.furniture
          : kind === 'wall' ? state.scene?.walls : kind === 'electrical' ? state.scene?.electrical
            : (state.scene?.openings || []).filter(item => kind === 'window' ? item.kind === 'window' : ['hinged', 'sliding'].includes(item.kind));
        for (const item of items || []) {
          options.push({ value: JSON.stringify({ kind, id: item.id }),
            label: `${KIND_LABELS[kind]} · ${item.label || item.type || (item.exterior ? 'Exterior' : 'Internal')} · ${item.id}` });
        }
      }
      const entity = selectionEntity(state.scene, state.selection);
      const otherFloorId = !entity && state.selection && typeof planner.getScenes === 'function'
        ? selectionFloor(planner.getScenes(), state.selection, state.project.activeFloorId) : null;
      const otherFloor = otherFloorId ? state.project.floors.find(floor => floor.id === otherFloorId) : null;
      floorSelectionHint.hidden = !otherFloorId || !tools;
      selectOptions(objectSelect, options, entity ? JSON.stringify({ kind: state.selection.kind, id: state.selection.id }) : '');
      const key = keyFor(state);
      const shape = entity ? `${key}:${state.selection.kind}:${entity.type || entity.kind || ''}` : `${key}:unavailable`;
      if (entity) {
        if (selectionKey !== shape) buildSelection({ ...state, entity,
          wall: (state.scene.walls || []).find(wall => wall.id === entity.wallId) }, key);
        lastSelection = { projectId: state.project.id, floorId: state.project.activeFloorId, ...state.selection };
        text(identityType, `${KIND_LABELS[state.selection.kind] || state.selection.kind}${entity.label ? ` · ${entity.label}` : ''}`);
        text(identityId, `ID: ${entity.id}`);
        text(selectionNote, state.selection.kind === 'door' || state.selection.kind === 'window'
          ? (state.scene.walls || []).some(wall => wall.id === entity.wallId)
            ? 'Selection is shared by the 2D plan and 3D model. Focusing a field does not select or move an object.'
            : 'Unresolved host wall: the attachment is retained for review. Opening edits are disabled.'
          : 'Selection is shared by the 2D plan and 3D model. Focusing a field does not select or move an object.');
        selectionFields.hidden = false;
        selectionRefresh({ ...state, entity, wall: (state.scene.walls || []).find(wall => wall.id === entity.wallId) });
      } else {
        if (selectionKey !== shape) {
          replaceSection(inspector, selectionFields);
          cancelConfirmation(inspector, false);
          selectionRequests = {};
        }
        const stale = state.selection || (lastSelection && lastSelection.projectId === state.project.id
          && lastSelection.floorId === state.project.activeFloorId ? lastSelection : null);
        text(identityType, stale ? `${KIND_LABELS[stale.kind] || stale.kind} · ${otherFloorId ? 'on another floor' : 'unavailable selection'}` : 'No selection');
        text(identityId, stale ? `${otherFloorId ? 'Selected' : 'Last selected'} ID: ${stale.id}` : '');
        text(selectionNote, otherFloorId
          ? `This object belongs to “${otherFloor?.name || otherFloorId}”. Choose that floor in “Active editable floor” `
            + 'above the plan before editing. The active 2D floor has not changed.'
          : !state.scene
          ? 'The active floor has no valid scene. Correct its plot/layout inputs, then click a room, component or wall.'
          : state.selection ? 'This selected object was deleted or is no longer available on the active floor. Click a room, component or wall to select another.'
            : stale ? 'Selection cleared or object deleted. Click a room, component or wall, or use the object chooser.'
              : 'Click a room, component or wall in the floor plan to inspect it. You can also choose an object above; no dragging is required.');
        selectionFields.hidden = true;
      }
      selectionKey = shape;
      diagnosticList.replaceChildren();
      const remembered = lastSelection && lastSelection.projectId === state.project.id
        && lastSelection.floorId === state.project.activeFloorId ? lastSelection.id : null;
      const diagnosticId = entity?.id || state.selection?.id || remembered;
      const messages = (state.scene?.diagnostics || []).filter(item => diagnosticId && (item.ids || []).includes(diagnosticId));
      for (const message of messages) {
        const level = ['error', 'warning'].includes(message.level) ? message.level : 'info';
        element('li', `hp-editor-diagnostic hp-editor-diagnostic-${level}`, message.message, diagnosticList);
      }
      diagnosticList.hidden = messages.length === 0;
    }

    function renderTools(state) {
      if (!tools) return;
      const floors = state.project.floors || [];
      const options = floors.map((floor, index) => {
        let elevation;
        try { elevation = metreText(floorElevation(state.project, floor.id)); } catch (_) { elevation = 'Elevation unavailable'; }
        return { value: floor.id, label: `${index + 1}. ${floor.name} · ${elevation}` };
      });
      selectOptions(floorSelect, options, state.project.activeFloorId);
      const key = JSON.stringify([state.project.id, state.project.activeFloorId]);
      if (floors.some(floor => floor.id === state.project.activeFloorId)) {
        if (floorKey !== key) buildFloor(state, key);
        floorRefresh(state);
      } else {
        replaceSection(tools, floorDetails);
        element('p', 'hp-editor-warning', 'No valid active floor. Floor property editing is unavailable.', floorDetails);
      }
      floorKey = key;
      text(allowanceNote, floorAllowanceNotice(floors.length, state.scene?.regulatory));
    }

    const draftList = inspector ? element('details', 'hp-editor-group', undefined, inspector.body) : null;
    let draftListSignature = '';
    if (draftList) {
      draftList.dataset.hpEditorDrafts = '';
      const summary = element('summary', 'hp-editor-label', 'Pending inspector inputs', draftList);
      const list = element('div', 'hp-editor-body', undefined, draftList);
      refreshDraftList = () => {
        const entries = drafts.scopes().map(scope => ({ scope, draft: drafts.get(scope) })), state = snapshot();
        const signature = JSON.stringify([state.project.id, state.project.activeFloorId, entries]);
        if (signature === draftListSignature) return;
        draftListSignature = signature;
        draftList.hidden = !entries.length;
        text(summary, `Pending inspector inputs · ${entries.length} owner${entries.length === 1 ? '' : 's'}`);
        list.replaceChildren();
        element('p', 'hp-editor-help', 'These session-only values are not included in project saves or exports. '
          + 'Selection and floor changes retain them; review or discard each owner explicitly.', list);
        for (const { scope, draft } of entries) {
          const section = element('section', 'hp-editor-group', undefined, list);
          section.dataset.hpEditorDraftScope = Drafts.key(scope);
          element('p', 'hp-editor-note', `${scope.projectId} · ${scope.floorId} · ${scope.collection} · ${scope.entityId}`, section);
          const values = draft.fields
            ? Object.entries(draft.fields).map(([name, value]) => `${value.label || name}: ${String(value.raw)}${value.error ? ` — ${value.error}` : ''}`)
            : Object.entries(draft.values || {}).map(([name, value]) => `${name}: ${String(value)}`);
          for (const value of values) element('p', 'hp-editor-help', value, section);
          if (draft.error) element('p', 'hp-editor-warning', draft.error, section);
          const actions = element('div', 'hp-editor-actions', undefined, section);
          button(actions, 'Review owner', 'review-owner-draft', () => run(inspector, () => {
            const current = snapshot();
            if (scope.projectId !== current.project.id)
              throw new Error('This draft belongs to another project. Reopen that project explicitly to review it; its values remain here.');
            if (scope.floorId !== current.project.activeFloorId) {
              requestChooseFloor();
              text(inspector.status, `Choose floor “${current.project.floors.find(floor => floor.id === scope.floorId)?.name || scope.floorId}” explicitly. The draft and active floor are unchanged.`);
              return;
            }
            if (scope.collection === 'floors') { requestChooseFloor(); return; }
            const kind = scope.collection.startsWith('wall-') ? 'wall'
              : Object.keys(COLLECTIONS).find(kind => COLLECTIONS[kind] === scope.collection);
            const selection = { kind, id: scope.entityId };
            if (!selectionEntity(current.scene, selection))
              throw new Error('The draft object is unavailable or deleted. The pending values are retained here; use Undo to restore its source or discard this owner explicitly.');
            planner.select(selection);
            const accepted = scope.collection.startsWith('wall-opening-')
              ? requestAddOpening(scope.collection.slice('wall-opening-'.length))
              : requestEditSelection({ section: scope.collection === 'wall-trim' ? 'wall-span' : 'properties' });
            if (!accepted) throw new Error('The draft is retained, but this owner no longer supports that editing action. Review its current geometry or discard the owner inputs.');
          }));
          const discard = button(actions, 'Discard owner inputs…', 'discard-owner-draft', () => {
            const expected = drafts.get(scope);
            if (!expected) return;
            confirmAction(inspector, discard, {
              title: 'Discard this owner’s pending inputs?', label: 'Discard owner inputs',
              description: `Discard only ${scope.collection} inputs for ${scope.entityId} on ${scope.floorId} (${scope.projectId}). `
                + 'The authored project and other pending inputs are unchanged.',
              success: 'This owner’s pending inputs were discarded. Other drafts are retained.',
              execute: () => {
                if (!sameDraft(drafts.get(scope), expected)) throw new Error('These pending inputs changed. Review discard again.');
                drafts.remove(scope);
                refreshDraftList();
              }
            });
          });
        }
      };
    }

    function getActionState() {
      const state = snapshot(), actions = selectionActions(state.scene, state.selection);
      const otherFloor = state.selection && !selectionEntity(state.scene, state.selection) && typeof planner.getScenes === 'function'
        ? selectionFloor(planner.getScenes(), state.selection, state.project.activeFloorId) : null;
      return {
        ...actions, projectId: state.project.id, floorId: state.project.activeFloorId,
        selection: state.selection, selectionFloorId: otherFloor || (state.selection ? state.project.activeFloorId : null),
        canUndo: planner.canUndo(), canRedo: planner.canRedo(),
        reason: otherFloor ? 'Choose the selected object’s floor explicitly in Active editable floor before editing. Picking does not switch floors.' : actions.reason
      };
    }
    function requestChooseFloor() {
      if (destroyed || !tools || !floorSelect) return false;
      retainInputs(() => reveal(tools, floorSelect));
      return true;
    }
    function requestEditSelection({ section = 'properties' } = {}) {
      if (destroyed || !inspector) return false;
      return retainInputs(() => run(inspector, () => {
        render();
        const state = getActionState();
        if (!['properties', 'wall-span'].includes(section)) throw new Error('Choose selection properties or retained wall ends.');
        if (!state.canEdit || section === 'wall-span' && !state.canEditWallSpan)
          throw new Error(state.reason || 'Only supported internal partitions have editable retained wall ends.');
        if (section === 'wall-span') selectionRequests.editWallSpan();
        else reveal(inspector, selectionFields.querySelector('input:not(:disabled), select:not(:disabled)') || inspector.heading);
      }));
    }
    function requestAddOpening(kind) {
      if (destroyed || !inspector) return false;
      return retainInputs(() => run(inspector, () => {
        render();
        const state = getActionState();
        if (!['door', 'window'].includes(kind)) throw new Error('Choose a door or window.');
        if (!(kind === 'window' ? state.canAddWindow : state.canAddDoor))
          throw new Error(state.reason || 'Select a surviving, classified and unprotected internal or exterior wall on the active floor.');
        selectionRequests.addOpening(kind);
      }));
    }
    function requestDeleteSelection() {
      if (destroyed || !inspector) return false;
      try {
        render();
        const state = getActionState();
        if (!state.canDelete || typeof selectionRequests.delete !== 'function')
          throw new Error(state.reason || 'This selection cannot be deleted here. Exterior and protected walls are retained.');
        return retainInputs(() => {
          reveal(inspector);
          return selectionRequests.delete();
        });
      } catch (error) { reportError(inspector, error); return false; }
    }

    function render() {
      if (destroyed) return;
      try {
        const current = snapshot();
        renderInspector(current);
        renderTools(current);
        refreshDraftList();
        for (const item of historyButtons) item.control.disabled = !planner[item.action === 'undo' ? 'canUndo' : 'canRedo']();
        for (const owner of [inspector, tools].filter(Boolean)) {
          if (!owner.pending) continue;
          const valid = confirmationIsCurrent(owner.pending, current);
          owner.pending.stale.hidden = valid;
          owner.pending.approve.setAttribute('aria-disabled', String(!valid));
        }
      } catch (error) {
        reportError(inspector || tools, error);
      }
    }
    const unsubscribe = planner.subscribe(() => render());
    const pointerdown = event => {
      pointerNavigation = false;
      for (let node = event.target; node; node = node.parentElement) {
        if (/^(BUTTON|SELECT|SUMMARY|CANVAS|SVG|A)$/i.test(node.tagName || '')
          || ['button', 'tab'].includes(node.getAttribute?.('role'))) {
          pointerNavigation = true;
          break;
        }
      }
    };
    const clearPointer = () => { pointerNavigation = false; };
    const keydown = event => {
      const action = historyShortcut(event);
      if (!action || !planner[action === 'undo' ? 'canUndo' : 'canRedo']()) return;
      event.preventDefault();
      const owner = inspector && inspector.root.contains(event.target) ? inspector : tools || inspector;
      run(owner, () => planner[action](), `${action === 'undo' ? 'Undo' : 'Redo'} applied.`);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown, true);
    document.addEventListener('pointerup', clearPointer, true);
    document.addEventListener('pointercancel', clearPointer, true);
    document.addEventListener('keydown', clearPointer, true);
    render();
    return {
      render, getActionState, requestAddOpening, requestEditSelection, requestDeleteSelection, requestChooseFloor,
      getPendingDrafts: () => drafts.scopes().map(scope => ({ ...scope, draft: drafts.get(scope) })),
      destroy() {
        destroyed = true;
        unsubscribe();
        document.removeEventListener('keydown', keydown);
        document.removeEventListener('pointerdown', pointerdown, true);
        document.removeEventListener('pointerup', clearPointer, true);
        document.removeEventListener('pointercancel', clearPointer, true);
        document.removeEventListener('keydown', clearPointer, true);
        if (!drafts.scopes().length) {
          drafts.dispose();
          inspectorStores.delete(planner);
        }
      }
    };
  }

  return {
    init, numberValue, selectionEntity, selectionFloor, selectionActions, rectCommand, headBearing, bedHeadCommand, openingCommand,
    wallLength, retainedSpan, wallOpeningCommand, wallTrimCommand, addOpeningCommand, floorElevation, floorPatchCommand, deleteFloorCommand,
    floorAllowanceNotice, isTextEntry, historyShortcut
  };
});
