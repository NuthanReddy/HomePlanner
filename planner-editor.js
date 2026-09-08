(function (root, factory) {
  'use strict';
  const editor = factory();
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
})(typeof window === 'object' ? window : null, function () {
  'use strict';

  const DIRECTIONS = { N: 0, E: 90, S: 180, W: 270 };
  const KIND_LABELS = {
    room: 'Room', furniture: 'Furniture', door: 'Door', window: 'Window',
    wall: 'Wall', electrical: 'Electrical point'
  };
  const WALL_CAUTION = 'Conceptual plan edit only — never permission for safe demolition or construction. '
    + 'Structural, fire, acoustic and service roles are unverified. A qualified local professional must review '
    + 'the wall and any affected door, window or electrical attachments before work.';

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
        ? ['widthM', 'sillM', 'heightM', 'headM', 'openFraction'] : ['widthM', 'openFraction'];
      if (!allowed.includes(field)) throw new Error('This opening dimension is read-only.');
      const parsed = numberValue(value, {
        label: { widthM: 'Opening width', sillM: 'Sill height', heightM: 'Opening height',
          headM: 'Head height', openFraction: 'Open fraction' }[field],
        min: field === 'sillM' || field === 'openFraction' ? 0 : undefined,
        max: field === 'openFraction' ? 1 : undefined,
        positive: ['widthM', 'heightM', 'headM'].includes(field)
      });
      if (field === 'headM') {
        const sill = numberValue(entity.sillM, { label: 'Current sill height', min: 0 });
        command.heightM = numberValue(parsed - sill, { label: 'Head minus sill height', positive: true });
      } else command[field] = parsed;
      if (field === 'widthM') {
        const end = numberValue(entity.offsetM, { label: 'Opening offset', min: 0 }) + parsed;
        if (end > wallLength(wall) + 1e-7) throw new Error('The opening would extend past its host wall.');
      }
      if (kind === 'window' && ['sillM', 'heightM', 'headM'].includes(field)) {
        const sill = command.sillM === undefined ? numberValue(entity.sillM, { label: 'Sill height', min: 0 }) : command.sillM;
        const height = command.heightM === undefined
          ? numberValue(entity.heightM, { label: 'Opening height', positive: true }) : command.heightM;
        if (sill + height > numberValue(wall.heightM, { label: 'Wall height', positive: true }) + 1e-7) {
          throw new Error('The window head would extend above its host wall.');
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
    const length = wallLength(wall);
    if (!options || typeof options.full !== 'boolean') throw new Error('Choose a full-span or partial-span connection.');
    const command = { type: 'open-wall', id: wall.id, full: options.full, confirmConceptual: true };
    if (!options.full) {
      command.offsetM = numberValue(options.offsetM, { label: 'Opening offset', min: 0 });
      command.widthM = numberValue(options.widthM, { label: 'Opening width', positive: true });
      if (command.offsetM + command.widthM > length + 1e-7) {
        throw new Error('The partial connection must fit within the wall span.');
      }
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

    let destroyed = false;
    let selectionKey = null;
    let floorKey = null;
    let lastSelection = null;
    let selectionRefresh = () => {};
    let floorRefresh = () => {};
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
      return pending.projectId === state.project.id && pending.revision === state.project.revision
        && pending.floorId === state.project.activeFloorId;
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
        trigger, stale, approve
      };
      group.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          cancelConfirmation(owner, true);
        }
      });
      focus(approve);
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
        input.type = specification.type || 'number';
        input.required = input.type !== 'checkbox';
        if (input.type === 'number') {
          input.step = 'any';
          input.inputMode = 'decimal';
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
      let dirty = false;
      let lastSuccessful;
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
        lastSuccessful = raw();
      }
      function update(value) {
        currentValue = value;
        // Keep the actual node, caret, incomplete numbers and rejected drafts through scene renders.
        if (document.activeElement !== input && !dirty) writeValue(value);
      }
      function commit() {
        if (!dirty || input.disabled) return;
        if (raw() === lastSuccessful) {
          dirty = false;
          clearError();
          return;
        }
        const value = raw();
        if (value === failedValue) return;
        try {
          specification.commit(value);
          dirty = false;
          lastSuccessful = value;
          failedValue = undefined;
          clearError();
          owner.error.hidden = true;
          text(owner.error, '');
          text(owner.status, `${specification.label} updated.`);
          render();
        } catch (error) {
          failedValue = value;
          input.setAttribute('aria-invalid', 'true');
          input.setCustomValidity(error.message || 'This value could not be applied.');
          feedback.textContent = error.message || 'This value could not be applied.';
          feedback.hidden = false;
          reportError(owner, error);
        }
      }
      input.addEventListener('input', () => {
        dirty = true;
        failedValue = undefined;
        clearError();
      });
      input.addEventListener('change', () => {
        dirty = raw() !== lastSuccessful;
        commit();
      });
      input.addEventListener('blur', () => {
        commit();
        if (!dirty) writeValue(currentValue);
      });
      input.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Enter' && !specification.options && input.type !== 'checkbox') {
          event.preventDefault();
          dirty = raw() !== lastSuccessful;
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          dirty = false;
          failedValue = undefined;
          clearError();
          writeValue(currentValue);
          owner.error.hidden = true;
          text(owner.error, '');
          text(owner.status, 'Uncommitted field edit discarded.');
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
      floorSelectionHint = button(inspector.body, 'Choose its floor above the plan', 'focus-floor-selector', () => focus(floorSelect));
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
        fields.push(ctx => control.update(ctx.entity.rect && ctx.entity.rect[axis]));
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
        direction.update(Object.prototype.hasOwnProperty.call(DIRECTIONS, ctx.entity.headLocal) ? ctx.entity.headLocal : '');
        const degrees = headBearing(ctx.entity.headLocal, ctx.scene.headingDeg);
        text(bearing, degrees === null ? 'Unknown — no inferred head direction' : `${Number(degrees.toFixed(2))}° from true north`);
        text(pinnedState, ctx.entity.pinned === true ? 'Pinned · manual' : ctx.entity.pinned === false ? 'Unpinned · automatic eligible' : 'Pin state not recorded');
        pinned.update(ctx.entity.pinned);
      });
    }

    function openingFields(parent, kind, key, fields, firstContext) {
      const opening = group(parent, kind === 'window' ? 'Window aperture' : 'Door aperture');
      const host = readout(opening, 'Host wall ID');
      const offset = readout(opening, 'Offset from wall start');
      const height = kind === 'door' ? readout(opening, 'Height · read-only (m)') : null;
      const head = kind === 'door' ? readout(opening, 'Head above floor') : null;
      const requestedWidth = kind === 'door' ? readout(opening, 'Requested clear width · unverified') : null;
      const nominalLeaf = kind === 'door' ? readout(opening, 'Nominal leaf width · schematic') : null;
      const wallDirection = readout(opening, 'Wall start → end');
      const inputs = [];
      const grid = element('div', 'hp-editor-grid', undefined, opening);
      const specs = [['widthM', 'Opening width (m)', 0]];
      if (kind === 'window') specs.push(['sillM', 'Sill above floor (m)', 0], ['headM', 'Head above floor (m)', 0],
        ['heightM', 'Window height (m)', 0]);
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
          : ctx.entity[name]));
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
          fields.push(ctx => control.update(ctx.entity[name]));
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
          + 'Door height and wall offset are read-only in this editor. The swing diagram is not its operating state.', opening);
      fields.push(ctx => {
        text(host, ctx.entity.wallId || 'Unresolved attachment');
        text(offset, metreText(ctx.entity.offsetM));
        text(wallDirection, ctx.wall
          ? `(${metreText(ctx.wall.start.x)}, ${metreText(ctx.wall.start.y)}) → (${metreText(ctx.wall.end.x)}, ${metreText(ctx.wall.end.y)})`
          : 'Missing host — review attachment');
        if (height) text(height, metreText(ctx.entity.heightM));
        if (head) text(head, Number.isFinite(ctx.entity.sillM) && Number.isFinite(ctx.entity.heightM)
          ? metreText(ctx.entity.sillM + ctx.entity.heightM) : 'Not available');
        if (requestedWidth) text(requestedWidth, metreText(ctx.entity.requestedClearWidthM));
        if (nominalLeaf) text(nominalLeaf, metreText(ctx.entity.nominalLeafWidthM));
        for (const control of inputs) control.input.disabled = !ctx.wall;
      });
    }

    function wallFields(parent, key, fields, firstContext) {
      const wallGroup = group(parent, 'Physical partition');
      const values = {};
      for (const [name, label] of [['length', 'Span length'], ['heightM', 'Wall height'], ['thicknessM', 'Thickness'],
        ['baseM', 'Base elevation'], ['classification', 'Classification'], ['state', 'Connection state'], ['rooms', 'Adjoining rooms']]) {
        values[name] = readout(wallGroup, label);
      }
      element('p', 'hp-editor-warning', WALL_CAUTION, wallGroup);
      const draft = element('div', 'hp-editor-wall-draft', undefined, wallGroup);
      const modeLabel = element('label', 'hp-editor-label', 'Conceptual connection span', draft);
      const mode = element('select', 'hp-editor-input', undefined, draft);
      mode.id = 'hp-editor-wall-span';
      mode.dataset.hpEditorField = 'wallSpan';
      modeLabel.htmlFor = mode.id;
      for (const [value, label] of [['full', 'Full wall span · full height'], ['partial', 'Partial wall span · full height']]) {
        const option = element('option', '', label, mode);
        option.value = value;
      }
      const existing = firstContext.project.wallEdits && firstContext.project.wallEdits[firstContext.entity.id];
      mode.value = existing && existing.full === false ? 'partial' : 'full';
      let draftDirty = false;
      const partial = element('div', 'hp-editor-grid', undefined, draft);
      const staged = {};
      for (const [name, label] of [['offsetM', 'Offset from wall start (m)'], ['widthM', 'Open span width (m)']]) {
        const wrapper = element('div', 'hp-editor-field', undefined, partial);
        const labelNode = element('label', 'hp-editor-label', label, wrapper);
        const input = element('input', 'hp-editor-input', undefined, wrapper);
        input.id = `hp-editor-wall-${name}`;
        input.dataset.hpEditorField = name;
        input.type = 'number';
        input.step = 'any';
        input.min = '0';
        input.inputMode = 'decimal';
        input.placeholder = 'Required for partial span';
        input.value = existing && existing.full === false && Number.isFinite(existing[name]) ? String(existing[name]) : '';
        labelNode.htmlFor = input.id;
        staged[name] = input;
        input.addEventListener('input', () => {
          draftDirty = true;
          cancelConfirmation(inspector, false);
        });
      }
      function updateMode() {
        partial.hidden = mode.value !== 'partial';
        for (const input of Object.values(staged)) input.disabled = mode.disabled || mode.value !== 'partial';
      }
      mode.addEventListener('change', () => {
        draftDirty = true;
        updateMode();
        cancelConfirmation(inspector, false);
      });
      const actions = element('div', 'hp-editor-actions', undefined, draft);
      const review = button(actions, 'Review conceptual opening…', 'review-open-wall', () => run(inspector, () => {
        const ctx = selectedContext(key);
        const command = wallOpeningCommand(ctx.entity, {
          full: mode.value === 'full', offsetM: staged.offsetM.value, widthM: staged.widthM.value
        });
        const description = command.full
          ? `Open the full ${metreText(wallLength(ctx.entity))} span and full wall height.`
          : `Open ${metreText(command.widthM)} starting ${metreText(command.offsetM)} from the wall start, through the full wall height.`;
        confirmAction(inspector, review, {
          title: 'Review internal connection', label: 'Confirm conceptual opening',
          description: `${description} Wall ID: ${ctx.entity.id}. Named rooms remain. `
            + 'Affected attachments may require review; an internal connection is not an outdoor air inlet.',
          caution: WALL_CAUTION, success: 'Conceptual connection applied. Review affected attachments and diagnostics.',
          execute: () => {
            const latest = selectedContext(key);
            planner.execute(wallOpeningCommand(latest.entity, command));
            draftDirty = false;
          }
        });
      }));
      const restore = button(actions, 'Review wall restoration…', 'review-restore-wall', () => run(inspector, () => {
        const ctx = selectedContext(key);
        confirmAction(inspector, restore, {
          title: 'Review conceptual wall restoration', label: 'Confirm wall restoration',
          description: `Restore the selected wall in the schematic plan. Wall ID: ${ctx.entity.id}. `
            + 'Review its doors, windows and electrical attachments after restoration.',
          caution: WALL_CAUTION, success: 'Wall restored in the conceptual plan.',
          execute: () => {
            planner.execute({ type: 'restore-wall', id: selectedContext(key).entity.id });
            draftDirty = false;
          }
        });
      }));
      fields.push(ctx => {
        const wall = ctx.entity;
        let length;
        try { length = wallLength(wall); } catch (_) { length = null; }
        text(values.length, metreText(length));
        for (const name of ['heightM', 'thicknessM', 'baseM']) text(values[name], metreText(wall[name]));
        text(values.classification, `${wall.exterior === true ? 'Exterior' : wall.exterior === false ? 'Internal' : 'Unclassified'} · structural role: ${wall.structuralRole || 'unknown'}`);
        const edit = ctx.project.wallEdits && ctx.project.wallEdits[wall.id];
        const passages = (ctx.scene.openings || []).filter(item => item.wallId === wall.id && item.kind === 'passage');
        text(values.state, wall.removed || (edit && edit.full) ? 'Full-span opening'
          : edit || passages.length ? 'Partial-span opening' : 'No open-connection override');
        text(values.rooms, (wall.roomIds || []).map(id => (ctx.scene.rooms || []).find(room => room.id === id)?.label || id).join(' ↔ ') || 'Not recorded');
        const protectedWall = wall.exterior !== false || !['unknown', 'non-structural'].includes(wall.structuralRole) || !length;
        mode.disabled = protectedWall;
        review.disabled = protectedWall;
        review.title = protectedWall ? 'Exterior, protected or unclassified walls cannot be opened here.' : '';
        restore.disabled = !edit && !wall.removed && !passages.length;
        if (!draftDirty && document.activeElement !== mode && !Object.values(staged).includes(document.activeElement)) {
          mode.value = edit && edit.full === false ? 'partial' : 'full';
          for (const [name, input] of Object.entries(staged)) {
            input.value = edit && edit.full === false && Number.isFinite(edit[name]) ? String(edit[name]) : '';
          }
        }
        updateMode();
      });
      updateMode();
    }

    function buildSelection(ctx, key) {
      replaceSection(inspector, selectionFields);
      cancelConfirmation(inspector, false);
      const updates = [];
      const kind = ctx.selection.kind;
      if (kind === 'room' || kind === 'furniture') rectFields(selectionFields, kind, key, updates);
      if (kind === 'room') {
        const roomType = readout(selectionFields, 'Room type');
        updates.push(state => text(roomType, state.entity.type || 'Not recorded'));
      } else if (kind === 'furniture') {
        const host = readout(selectionFields, 'Room');
        updates.push(state => text(host, (state.scene.rooms || []).find(room => room.id === state.entity.roomId)?.label
          || state.entity.roomId || 'Unresolved'));
        if (ctx.entity.type === 'bed') bedFields(selectionFields, key, updates);
        const actions = element('div', 'hp-editor-actions', undefined, selectionFields);
        button(actions, ctx.entity.type === 'bed' ? 'Reorient head +90°' : 'Rotate 90°', 'rotate-furniture', () => run(inspector, () => {
          planner.execute({ type: 'rotate-furniture', id: selectedContext(key).entity.id });
        }, 'Component reoriented. Actual head and footprint come from the updated scene.'));
        const remove = button(actions, 'Delete component', 'delete-furniture', () => run(inspector, () => {
          planner.execute({ type: 'delete-furniture', id: selectedContext(key).entity.id });
          focus(inspector.heading);
        }, 'Component deleted. Use Undo to restore it.'));
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
        name.update(active.name);
        height.update(active.heightM);
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
      for (const kind of ['room', 'furniture', 'door', 'window', 'wall', 'electrical']) {
        const items = kind === 'room' ? state.scene?.rooms : kind === 'furniture' ? state.scene?.furniture
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
            ? 'Selection is shared with the plan. Focusing a field does not select or move an object.'
            : 'Unresolved host wall: the attachment is retained for review. Opening edits are disabled.'
          : 'Selection is shared with the plan. Focusing a field does not select or move an object.');
        selectionFields.hidden = false;
        selectionRefresh({ ...state, entity, wall: (state.scene.walls || []).find(wall => wall.id === entity.wallId) });
      } else {
        if (selectionKey !== shape) {
          replaceSection(inspector, selectionFields);
          cancelConfirmation(inspector, false);
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

    function render() {
      if (destroyed) return;
      try {
        const current = snapshot();
        renderInspector(current);
        renderTools(current);
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
    const keydown = event => {
      const action = historyShortcut(event);
      if (!action || !planner[action === 'undo' ? 'canUndo' : 'canRedo']()) return;
      event.preventDefault();
      const owner = inspector && inspector.root.contains(event.target) ? inspector : tools || inspector;
      run(owner, () => planner[action](), `${action === 'undo' ? 'Undo' : 'Redo'} applied.`);
    };
    document.addEventListener('keydown', keydown);
    render();
    return {
      render,
      destroy() {
        destroyed = true;
        unsubscribe();
        document.removeEventListener('keydown', keydown);
      }
    };
  }

  return {
    init, numberValue, selectionEntity, selectionFloor, rectCommand, headBearing, bedHeadCommand, openingCommand,
    wallLength, wallOpeningCommand, floorElevation, floorPatchCommand, deleteFloorCommand,
    floorAllowanceNotice, isTextEntry, historyShortcut
  };
});
