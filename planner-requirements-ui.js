(function (root, factory) {
  'use strict';
  const common = typeof module === 'object' && module.exports;
  const api = factory(root, common ? require('./planner-input-schema.js') : root.HomePlannerInputSchema);
  if (common) module.exports = api;
  else {
    root.HomePlannerRequirementsUI = api;
    const start = () => api.mount();
    if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, InputSchema) {
  'use strict';

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const copy = value => InputSchema.copyJSON(value);
  const title = key => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
    .replace(/^./, value => value.toUpperCase());
  const token = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
  const pathParts = path => path ? path.slice(1).split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~')) : [];

  function get(value, path) {
    return pathParts(path).reduce((current, key) => current?.[Array.isArray(current) ? Number(key) : key], value);
  }

  function set(value, path, next) {
    const parts = pathParts(path);
    if (!parts.length) return next;
    let current = value;
    for (let index = 0; index < parts.length - 1; index++) {
      const key = Array.isArray(current) ? Number(parts[index]) : parts[index];
      const following = parts[index + 1], array = /^\d+$/.test(following);
      if (current[key] === undefined || current[key] === null) current[key] = array ? [] : {};
      current = current[key];
    }
    const last = Array.isArray(current) ? Number(parts.at(-1)) : parts.at(-1);
    if (next === undefined) {
      if (Array.isArray(current)) current.splice(last, 1);
      else delete current[last];
    } else current[last] = next;
    return value;
  }

  function issueMap(issues) {
    const result = new Map();
    for (const issue of issues) {
      if (!result.has(issue.path)) result.set(issue.path, []);
      result.get(issue.path).push(issue.message);
    }
    return result;
  }

  function createController(schema, options = {}) {
    schema = InputSchema.assertSchema(schema);
    let draft = InputSchema.defaultValue(schema, schema);
    draft.version = 1;
    draft.timestamp = Date.now();
    const plotPlannerProvider = typeof options.plotPlannerProvider === 'function'
      ? options.plotPlannerProvider : () => options.plotPlanner;
    const metadataProvider = typeof options.metadataProvider === 'function'
      ? options.metadataProvider : null;
    let reviewed = null, reviewBaseline = null, reviewedPlotFingerprint = null;
    let plotPlanner = null, plotPlannerError = null, confirmed = null, issues = [], raw = new Map();
    const listeners = new Set();
    const emit = (type, source) => listeners.forEach(listener => listener({ type, source, state: api.getState() }));
    const capturePlotPlanner = () => {
      try {
        const next = InputSchema.assertPlotPlannerSnapshot(plotPlannerProvider());
        const changed = !plotPlanner ||
          InputSchema.stableStringify(next) !== InputSchema.stableStringify(plotPlanner);
        plotPlanner = next;plotPlannerError = null;
        if (changed) { reviewed = null;reviewedPlotFingerprint = null;confirmed = null; }
        return true;
      } catch (error) {
        plotPlanner = null;plotPlannerError = error.message;
        reviewed = null;reviewedPlotFingerprint = null;confirmed = null;
        return false;
      }
    };
    const captureMetadata = () => {
      if (!metadataProvider) return;
      const metadata = copy(metadataProvider());
      for (const key of ['version', 'userId', 'projectId', 'projectName', 'requestId', 'timestamp'])
        if (metadata[key] !== undefined) draft[key] = metadata[key];
    };
    const api = {
      schema,
      subscribe(listener) {
        if (typeof listener !== 'function') throw new Error('A requirements listener must be a function.');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getState: () => Object.freeze({
        draft: copy(draft),
        reviewed: reviewed ? copy(reviewed) : null,
        plotPlanner: plotPlanner ? copy(plotPlanner) : null,
        plotPlannerError,
        confirmed,
        issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue })))
      }),
      value: path => get(draft, path),
      rawValue: path => raw.has(path) ? raw.get(path) : undefined,
      refreshPlotPlanner() {
        capturePlotPlanner();
        emit('source');
        return plotPlanner !== null;
      },
      update(path, value, rawValue) {
        set(draft, path, value);
        if (rawValue === undefined) raw.delete(path); else raw.set(path, rawValue);
        reviewed = null; confirmed = null; issues = [];
        emit('draft', 'field');
      },
      replace(value) {
        draft = copy(value);raw = new Map();reviewed = null;reviewBaseline = null;confirmed = null;issues = [];
        emit('replace');
      },
      add(path, node) {
        const list = get(draft, path) || [];
        if (!Array.isArray(list)) throw new Error('The selected requirement field is not a list.');
        list.push(InputSchema.defaultValue(node.items || {}, schema));
        set(draft, path, list);reviewed = null;confirmed = null;issues = [];emit('draft');
      },
      remove(path, index) {
        const list = get(draft, path);
        if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length)
          throw new Error('Choose an existing requirement item.');
        list.splice(index, 1);reviewed = null;confirmed = null;issues = [];emit('draft');
      },
      choose(path, node, branchIndex) {
        if (!Array.isArray(node.oneOf) || !node.oneOf[branchIndex]) throw new Error('Choose a supported input mode.');
        set(draft, path, InputSchema.defaultValue(node.oneOf[branchIndex], schema));
        raw = new Map([...raw].filter(([key]) => !key.startsWith(path + '/')));
        reviewed = null;confirmed = null;issues = [];emit('draft');
      },
      review() {
        captureMetadata();
        const result = InputSchema.validateInputs(draft, schema);
        const sourceValid = capturePlotPlanner();
        issues = result.issues.slice();
        if (!sourceValid) issues.push({
          path: '/plotPlanner',
          keyword: 'source',
          message: plotPlannerError
        });
        reviewed = result.valid && sourceValid ? copy(draft) : null;
        if (reviewed) {
          reviewBaseline = copy(reviewed);
          reviewedPlotFingerprint = InputSchema.stableStringify(plotPlanner);
        }
        confirmed = null;
        emit('review');
        return result.valid && sourceValid;
      },
      confirm() {
        captureMetadata();
        capturePlotPlanner();
        if (!reviewed || !plotPlanner ||
            reviewedPlotFingerprint !== InputSchema.stableStringify(plotPlanner) ||
            InputSchema.stableStringify(reviewed) !== InputSchema.stableStringify(draft)) {
          if (!api.review()) return null;
        }
        confirmed = InputSchema.normalize(reviewed, schema, {
          reviewedAt: Date.now(),
          plotPlanner
        });
        emit('confirm');
        return confirmed;
      },
      discard() {
        if (reviewBaseline) {
          draft = copy(reviewBaseline);
          reviewed = copy(reviewBaseline);
        } else {
          draft = InputSchema.defaultValue(schema, schema);
          draft.version = draft.version || 1;draft.timestamp = Date.now();
          reviewed = null;
        }
        raw = new Map();issues = [];confirmed = null;emit('discard');
      }
    };
    if (options.initial !== undefined) api.replace(options.initial);
    captureMetadata();
    capturePlotPlanner();
    return Object.freeze(api);
  }

  function mount(options = {}) {
    const document = options.document || root.document;
    const host = options.host || document?.getElementById('plannerRequirements');
    if (!document || !host) return null;
    if (host.homePlannerRequirements) return host.homePlannerRequirements;
    let disposed = false, unsubscribe = null, controller = null, plotListener = null;
    const node = (tag, text) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const status = node('p', 'Loading the local requirement schema...');
    status.className = 'mini';status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');
    host.replaceChildren(status);

    function inputId(path) {
      return 'requirement-' + (path || 'root').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    }

    function renderScalar(parent, rawNode, path, key) {
      const schema = controller.schema, definition = InputSchema.resolve(schema, rawNode);
      const wrapper = node('label'), caption = node('span', definition.title || title(key));
      wrapper.className = 'hp-requirement-field';wrapper.appendChild(caption);
      let control;
      if (Array.isArray(definition.enum)) {
        control = node('select');
        const empty = node('option', 'Choose...');
        empty.value = '';control.appendChild(empty);
        definition.enum.forEach(value => {
          const option = node('option', String(value));option.value = String(value);control.appendChild(option);
        });
        control.value = controller.value(path) ?? '';
        control.addEventListener('change', () => controller.update(path, control.value || undefined));
      } else if (definition.type === 'boolean') {
        wrapper.classList.add('hp-requirement-check');
        control = node('input');control.type = 'checkbox';control.checked = controller.value(path) === true;
        control.addEventListener('change', () => controller.update(path, control.checked));
        wrapper.replaceChildren(control, caption);
      } else {
        control = node('input');
        const numeric = definition.type === 'number' || definition.type === 'integer';
        control.type = numeric ? 'number' : 'text';
        if (numeric) {
          control.inputMode = definition.type === 'integer' ? 'numeric' : 'decimal';
          if (definition.minimum !== undefined) control.min = String(definition.minimum);
          if (definition.maximum !== undefined) control.max = String(definition.maximum);
          if (definition.exclusiveMinimum !== undefined) control.min = String(definition.exclusiveMinimum);
          control.step = definition.type === 'integer' ? '1' : 'any';
        }
        const retained = controller.rawValue(path);
        control.value = retained === undefined ? (controller.value(path) ?? '') : retained;
        control.addEventListener('input', () => {
          if (!numeric) controller.update(path, control.value || undefined, control.value);
          else {
            const complete = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(control.value.trim());
            controller.update(path, complete ? Number(control.value) : undefined, control.value);
          }
        });
      }
      control.id = inputId(path);
      if (wrapper.firstChild === caption) wrapper.appendChild(control);
      if (definition.description) {
        const help = node('small', definition.description);help.className = 'mini';wrapper.appendChild(help);
      }
      const messages = issueMap(controller.getState().issues).get(path);
      if (messages?.length) {
        const error = node('small', messages.join(' '));error.className = 'hp-requirement-error';
        error.id = control.id + '-error';control.setAttribute('aria-describedby', error.id);wrapper.appendChild(error);
      }
      parent.appendChild(wrapper);
    }

    function renderNode(parent, rawNode, path, key) {
      const schema = controller.schema, definition = InputSchema.resolve(schema, rawNode);
      if (definition['x-ui']?.hidden) return;
      if (Array.isArray(definition.oneOf)) {
        const fieldset = node('fieldset'), legend = node('legend', definition.title || title(key));
        fieldset.className = 'hp-requirement-group';fieldset.appendChild(legend);
        const selector = node('select');selector.id = inputId(path) + '-mode';
        const current = controller.value(path);
        let selected = 0;
        definition.oneOf.forEach((branch, index) => {
          const resolved = InputSchema.resolve(schema, branch);
          const option = node('option', resolved.title || `Option ${index + 1}`);option.value = String(index);
          const discriminator = Object.entries(resolved.properties || {}).find(([, value]) => own(value, 'const'));
          if (discriminator && current?.[discriminator[0]] === discriminator[1].const) selected = index;
          selector.appendChild(option);
        });
        selector.value = String(selected);
        selector.addEventListener('change', () => controller.choose(path, definition, Number(selector.value)));
        const modeLabel = node('label');modeLabel.className = 'hp-requirement-field';
        modeLabel.append(node('span', 'Mode'), selector);fieldset.appendChild(modeLabel);
        renderNode(fieldset, definition.oneOf[selected], path, key);
        parent.appendChild(fieldset);return;
      }
      if (definition.type === 'object') {
        const collapsed = definition['x-ui']?.collapsed === true;
        const fieldset = node(collapsed ? 'details' : 'fieldset');
        const legend = node(collapsed ? 'summary' : 'legend', definition.title || title(key));
        fieldset.className = 'hp-requirement-group';fieldset.appendChild(legend);
        if (definition.description) {
          const help = node('p', definition.description);help.className = 'mini';fieldset.appendChild(help);
        }
        for (const [childKey, child] of Object.entries(definition.properties || {}))
          renderNode(fieldset, child, `${path}/${token(childKey)}`, childKey);
        parent.appendChild(fieldset);return;
      }
      if (definition.type === 'array') {
        const fieldset = node('fieldset'), legend = node('legend', definition.title || title(key));
        fieldset.className = 'hp-requirement-group';fieldset.appendChild(legend);
        const list = controller.value(path) || [];
        list.forEach((entry, index) => {
          const card = node('div');card.className = 'hp-requirement-array-item';
          renderNode(card, definition.items || {}, `${path}/${index}`, `${title(key)} ${index + 1}`);
          const remove = node('button', 'Remove');remove.type = 'button';remove.className = 'hp-requirement-remove';
          remove.addEventListener('click', () => controller.remove(path, index));card.appendChild(remove);fieldset.appendChild(card);
        });
        const add = node('button', `Add ${title(key).replace(/s$/, '')}`);add.type = 'button';
        add.addEventListener('click', () => controller.add(path, definition));fieldset.appendChild(add);
        const messages = issueMap(controller.getState().issues).get(path);
        if (messages?.length) {
          const error = node('p', messages.join(' '));error.className = 'hp-requirement-error';fieldset.appendChild(error);
        }
        parent.appendChild(fieldset);return;
      }
      renderScalar(parent, definition, path, key);
    }

    function downloadJSON(value) {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = node('a');
      link.href = url;link.download = 'homeplanner-layout-inputs.json';
      document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }

    function render() {
      if (disposed || !controller) return;
      const state = controller.getState(), wasOpen = host.querySelector('details.hp-requirements')?.open === true;
      const details = node('details');
      details.className = 'hp-requirements';details.open = wasOpen;
      const summary = node('summary', 'AI plan requirements');
      const intro = node('p', 'Enter a reviewed design brief using fields defined by configs/inputs.schema.json. Drafts do not edit the project.');
      intro.className = 'mini';
      const source = node('div');source.className = 'hp-requirement-source';
      if (state.plotPlanner) {
        const plot = state.plotPlanner.plot, plate = state.plotPlanner.plate;
        source.appendChild(node('strong', 'Using current Plot Planner inputs'));
        source.appendChild(node('p',
          `${plot.grossWidthM.toFixed(2)} m × ${plot.grossDepthM.toFixed(2)} m ${plot.facing}-facing plot; ` +
          `${plate.label} provides ${plate.areaM2.toFixed(2)} m² on floor ${plate.floorIndex}.`));
      } else {
        source.appendChild(node('strong', 'Plot Planner inputs required'));
        source.appendChild(node('p', state.plotPlannerError || 'Complete the Plot Planner before reviewing these requirements.'));
      }
      const plotLink = node('a', 'Edit Plot Planner inputs');
      plotLink.href = '?workspace=site&section=plot';
      plotLink.dataset.workspace = 'site';plotLink.dataset.section = 'plot';
      source.appendChild(plotLink);
      const form = node('form');form.noValidate = true;form.addEventListener('submit', event => event.preventDefault());
      renderNode(form, controller.schema, '', 'Layout requirements');
      const actions = node('div');actions.className = 'split-snaps hp-requirement-actions';
      const review = node('button', 'Review requirements'), confirm = node('button', 'Confirm and prepare generation');
      const discard = node('button', 'Discard changes'), exportButton = node('button', 'Export inputs');
      const importLabel = node('label', 'Import inputs'), importInput = node('input');
      for (const button of [review, confirm, discard, exportButton]) button.type = 'button';
      importLabel.className = 'hp-requirement-import';importInput.type = 'file';importInput.accept = 'application/json,.json';
      importLabel.appendChild(importInput);
      review.addEventListener('click', () => controller.review());
      confirm.addEventListener('click', () => {
        const brief = controller.confirm();
        if (brief) document.dispatchEvent(new CustomEvent('homeplanner:design-brief-confirmed', { detail: brief }));
      });
      discard.addEventListener('click', () => controller.discard());
      exportButton.addEventListener('click', () => downloadJSON(state.draft));
      importInput.addEventListener('change', async () => {
        const file = importInput.files?.[0];
        if (!file) return;
        try {
          if (file.size > 1024 * 1024) throw new Error('Requirement imports are limited to 1 MiB.');
          controller.replace(JSON.parse(await file.text()));
          controller.review();
        } catch (error) {
          status.textContent = `Inputs not imported: ${error.message}`;
          status.className = 'hp-requirement-error';
        } finally { importInput.value = ''; }
      });
      actions.append(review, confirm, discard, exportButton, importLabel);
      const result = node('div');result.className = 'hp-requirement-review';
      if (state.issues.length) {
        result.appendChild(node('h4', 'Review required'));
        const list = node('ul');
        state.issues.slice(0, 30).forEach(issue => list.appendChild(node('li', `${issue.path}: ${issue.message}`)));
        if (state.issues.length > 30) list.appendChild(node('li', `${state.issues.length - 30} more issues are not shown.`));
        result.appendChild(list);
      } else if (state.confirmed) {
        result.appendChild(node('h4', 'Requirements confirmed'));
        result.appendChild(node('p', `Prepared ${state.confirmed.requirements.length} explicit requirements for project ${state.confirmed.request.projectName}. Candidate generation has not modified the project.`));
      } else if (state.reviewed) {
        result.appendChild(node('h4', 'Ready to confirm'));
        result.appendChild(node('p', 'The requirement document is valid. Confirm it to create the immutable normalized brief.'));
      }
      details.append(summary, intro, source, form, actions, result);
      host.replaceChildren(details);
    }

    const handle = {
      get controller() { return controller; },
      dispose() {
        if (disposed) return;
        disposed = true;unsubscribe?.();
        if (plotListener) root.removeEventListener?.('homeplanner:plot-inputs-changed', plotListener);
        delete host.homePlannerRequirements;host.replaceChildren();
      }
    };
    host.homePlannerRequirements = handle;
    Promise.resolve(options.schema || InputSchema.load(options.schemaURL)).then(schema => {
      if (disposed) return;
      const requestId = root.crypto?.randomUUID?.() || `request-${Date.now().toString(36)}`;
      const requestTimestamp = Date.now();
      controller = createController(schema, {
        ...options,
        plotPlannerProvider: options.plotPlannerProvider || root.HomePlannerPlotInputs,
        metadataProvider: options.metadataProvider || (() => {
          const project = root.HomePlanner?.getProject?.();
          return {
            version: schema.properties.version.minimum,
            userId: 'local-browser',
            projectId: project?.id || 'local-project',
            projectName: project?.name || 'Untitled project',
            requestId,
            timestamp: requestTimestamp
          };
        })
      });
      unsubscribe = controller.subscribe(event => {
        if (event.type === 'draft' && event.source === 'field') {
          host.querySelector('.hp-requirement-review')?.replaceChildren();
          return;
        }
        render();
      });
      plotListener = () => controller.refreshPlotPlanner();
      root.addEventListener?.('homeplanner:plot-inputs-changed', plotListener);
      render();
    }).catch(error => {
      if (disposed) return;
      status.textContent = `Requirements unavailable: ${error.message} Serve HomePlanner over local HTTP to load the schema.`;
      status.className = 'hp-requirement-error';
    });
    return handle;
  }

  return Object.freeze({ createController, mount });
});
