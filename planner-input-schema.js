(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerInputSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA_ID = 'https://homeplanner.local/schema/inputs.schema.json';
  const MAX_DEPTH = 64;
  const MAX_NODES = 200000;
  const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const plain = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);

  function failure(code, message, issues = []) {
    const error = new Error(message);
    error.name = 'HomePlannerInputSchemaError';
    error.code = code;
    error.issues = issues;
    return error;
  }

  function copyJSON(value) {
    const ancestors = new Set();
    let nodes = 0;
    function visit(item, depth) {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH)
        throw failure('InputLimitError', 'The requirement input is too large or deeply nested.');
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number' && Number.isFinite(item)) return item;
      if (!item || typeof item !== 'object')
        throw failure('InvalidInputValueError', 'Requirements must contain only finite JSON values.');
      if (ancestors.has(item)) throw failure('InvalidInputValueError', 'Requirement data cannot be cyclic.');
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length)
          throw failure('InvalidInputValueError', 'Requirement arrays must be dense.');
        ancestors.add(item);
        const result = item.map(value => visit(value, depth + 1));
        ancestors.delete(item);
        return result;
      }
      if (!plain(item)) throw failure('InvalidInputValueError', 'Requirement objects must be plain JSON objects.');
      const descriptors = Object.getOwnPropertyDescriptors(item), result = {};
      ancestors.add(item);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (unsafeKeys.has(key) || !descriptor.enumerable || !own(descriptor, 'value'))
          throw failure('InvalidInputValueError', 'Requirement objects cannot contain unsafe or hidden properties.');
        result[key] = visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
      return result;
    }
    return visit(value, 0);
  }

  function stableStringify(value) {
    const copy = copyJSON(value);
    function stringify(item) {
      if (item === null || typeof item !== 'object') return JSON.stringify(item);
      if (Array.isArray(item)) return '[' + item.map(stringify).join(',') + ']';
      return '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + stringify(item[key])).join(',') + '}';
    }
    return stringify(copy);
  }

  function freezeJSON(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeJSON);
      Object.freeze(value);
    }
    return value;
  }

  function schemaVersion(schema) {
    const version = schema?.properties?.version?.minimum;
    if (!Number.isSafeInteger(version) || version < 1)
      throw failure('UnsupportedInputSchemaError', 'The input schema does not declare a supported version.');
    return version;
  }

  function assertSchema(schema) {
    const value = copyJSON(schema);
    if (value.$schema !== 'https://json-schema.org/draft/2020-12/schema' || value.$id !== SCHEMA_ID ||
        value.type !== 'object' || !plain(value.properties) || !plain(value.$defs))
      throw failure('UnsupportedInputSchemaError', 'Load the pinned HomePlanner draft 2020-12 input schema.');
    schemaVersion(value);
    return value;
  }

  function pointer(rootSchema, ref) {
    if (typeof ref !== 'string' || !ref.startsWith('#/'))
      throw failure('UnsupportedInputSchemaError', `Only local schema references are supported: ${String(ref)}.`);
    let current = rootSchema;
    for (const token of ref.slice(2).split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!plain(current) || !own(current, token))
        throw failure('UnsupportedInputSchemaError', `The schema reference ${ref} cannot be resolved.`);
      current = current[token];
    }
    if (!plain(current)) throw failure('UnsupportedInputSchemaError', `The schema reference ${ref} is not an object.`);
    return current;
  }

  function resolved(rootSchema, node) {
    return node?.$ref ? pointer(rootSchema, node.$ref) : node;
  }

  function validate(value, schema) {
    const rootSchema = assertSchema(schema), issues = [];
    let nodes = 0;
    const add = (path, keyword, message) => issues.push({ path: path || '/', keyword, message });
    function check(item, rawNode, path, depth) {
      if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
        add(path, 'limit', 'The input is too large or deeply nested.');
        return;
      }
      const node = resolved(rootSchema, rawNode);
      if (Array.isArray(node.oneOf)) {
        const matches = node.oneOf.filter(branch => {
          const before = issues.length;
          check(item, branch, path, depth + 1);
          const valid = issues.length === before;
          issues.splice(before);
          return valid;
        });
        if (matches.length !== 1) add(path, 'oneOf', 'Choose exactly one supported option.');
        else check(item, matches[0], path, depth + 1);
        return;
      }
      if (own(node, 'const') && item !== node.const) {
        add(path, 'const', `Value must be ${JSON.stringify(node.const)}.`);
        return;
      }
      if (Array.isArray(node.enum) && !node.enum.includes(item))
        add(path, 'enum', `Choose one of: ${node.enum.join(', ')}.`);
      const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
      const typeValid = type => type === 'null' ? item === null :
        type === 'array' ? Array.isArray(item) :
        type === 'object' ? plain(item) :
        type === 'integer' ? Number.isSafeInteger(item) :
        type === 'number' ? typeof item === 'number' && Number.isFinite(item) :
        typeof item === type;
      if (types.length && !types.some(typeValid)) {
        add(path, 'type', `Expected ${types.join(' or ')}.`);
        return;
      }
      if (typeof item === 'number') {
        if (node.minimum !== undefined && item < node.minimum) add(path, 'minimum', `Minimum is ${node.minimum}.`);
        if (node.maximum !== undefined && item > node.maximum) add(path, 'maximum', `Maximum is ${node.maximum}.`);
        if (node.exclusiveMinimum !== undefined && item <= node.exclusiveMinimum)
          add(path, 'exclusiveMinimum', `Value must be greater than ${node.exclusiveMinimum}.`);
        if (node.exclusiveMaximum !== undefined && item >= node.exclusiveMaximum)
          add(path, 'exclusiveMaximum', `Value must be less than ${node.exclusiveMaximum}.`);
      }
      if (typeof item === 'string') {
        if (node.minLength !== undefined && item.length < node.minLength)
          add(path, 'minLength', `Enter at least ${node.minLength} character${node.minLength === 1 ? '' : 's'}.`);
        if (node.maxLength !== undefined && item.length > node.maxLength)
          add(path, 'maxLength', `Enter no more than ${node.maxLength} characters.`);
        if (node.pattern !== undefined && !(new RegExp(node.pattern, 'u')).test(item))
          add(path, 'pattern', 'Enter a value in the required format.');
      }
      if (Array.isArray(item)) {
        if (node.minItems !== undefined && item.length < node.minItems)
          add(path, 'minItems', `Add at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}.`);
        if (node.maxItems !== undefined && item.length > node.maxItems)
          add(path, 'maxItems', `Use no more than ${node.maxItems} items.`);
        item.forEach((entry, index) => check(entry, node.items || {}, `${path}/${index}`, depth + 1));
      }
      if (plain(item)) {
        const properties = plain(node.properties) ? node.properties : {};
        const keys = Object.keys(item);
        if (node.minProperties !== undefined && keys.length < node.minProperties)
          add(path, 'minProperties', `Provide at least ${node.minProperties} field${node.minProperties === 1 ? '' : 's'}.`);
        for (const key of node.required || [])
          if (!own(item, key)) add(`${path}/${key}`, 'required', 'This field is required.');
        if (node.additionalProperties === false)
          for (const key of keys) if (!own(properties, key))
            add(`${path}/${key}`, 'additionalProperties', 'This field is not supported.');
        for (const [key, child] of Object.entries(properties))
          if (own(item, key)) check(item[key], child, `${path}/${key}`, depth + 1);
      }
    }
    check(value, rootSchema, '', 0);
    return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues.map(Object.freeze)) });
  }

  function crossFieldIssues(value) {
    const issues = [];
    const add = (path, message) => issues.push({ path, keyword: 'domain', message });
    const ids = new Set();
    for (const [index, requirement] of (value.requirements || []).entries()) {
      const base = `/requirements/${index}`;
      if (ids.has(requirement.id)) add(`${base}/id`, 'Requirement IDs must be unique.');
      ids.add(requirement.id);
      const area = requirement.constraints?.area;
      if (area && area.minAreaFt2 > area.maxAreaFt2)
        add(`${base}/constraints/area`, 'Minimum area must not exceed maximum area.');
      const dimensions = requirement.constraints?.dimensions;
      if (dimensions) {
        if (dimensions.minWidthFt > dimensions.maxWidthFt)
          add(`${base}/constraints/dimensions`, 'Minimum width must not exceed maximum width.');
        if (dimensions.minDepthFt > dimensions.maxDepthFt)
          add(`${base}/constraints/dimensions`, 'Minimum depth must not exceed maximum depth.');
      }
      if (requirement.details && requirement.type !== 'kitchen')
        add(`${base}/details`, 'Kitchen size and layout details are supported only for kitchen requirements.');
    }
    return issues;
  }

  function validateInputs(value, schema) {
    const structural = validate(value, schema);
    const issues = structural.issues.concat(structural.valid ? crossFieldIssues(value) : []);
    return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))) });
  }

  const feetToMetres = value => value * 0.3048;
  const squareFeetToSquareMetres = value => value * 0.09290304;

  function assertPlotPlannerSnapshot(value) {
    if (value === undefined || value === null)
      throw failure('InvalidPlotPlannerSnapshotError', 'Complete the Plot Planner before reviewing AI requirements.');
    let snapshot;
    try { snapshot = copyJSON(value); }
    catch (error) {
      throw failure('InvalidPlotPlannerSnapshotError', 'The Plot Planner snapshot is not valid JSON data.');
    }
    const finite = (number, label, positive = false) => {
      if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0))
        throw failure('InvalidPlotPlannerSnapshotError', `Plot Planner ${label} is unavailable or invalid.`);
    };
    if (snapshot?.version !== 1 || snapshot?.source !== 'plot-planner')
      throw failure('InvalidPlotPlannerSnapshotError', 'Use the current versioned Plot Planner snapshot.');
    if (!plain(snapshot.plot) || !plain(snapshot.plate) || !plain(snapshot.regulation))
      throw failure('InvalidPlotPlannerSnapshotError', 'Complete the Plot Planner before reviewing AI requirements.');
    finite(snapshot.plot.grossWidthM, 'east-west plot dimension', true);
    finite(snapshot.plot.grossDepthM, 'north-south plot dimension', true);
    finite(snapshot.plot.netWidthM, 'net east-west plot dimension', true);
    finite(snapshot.plot.netDepthM, 'net north-south plot dimension', true);
    if (!['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(snapshot.plot.facing))
      throw failure('InvalidPlotPlannerSnapshotError', 'Plot Planner facing is unavailable.');
    if (!['N', 'E', 'S', 'W'].includes(snapshot.plot.frontEdge))
      throw failure('InvalidPlotPlannerSnapshotError', 'Plot Planner front edge is unavailable.');
    if (!plain(snapshot.plot.roadsM))
      throw failure('InvalidPlotPlannerSnapshotError', 'Plot Planner road inputs are unavailable.');
    for (const [edge, width] of Object.entries(snapshot.plot.roadsM)) {
      if (!['N', 'E', 'S', 'W'].includes(edge)) throw failure('InvalidPlotPlannerSnapshotError', 'Plot Planner road direction is invalid.');
      finite(width, `${edge} road width`);
    }
    if (typeof snapshot.plate.id !== 'string' || !snapshot.plate.id ||
        typeof snapshot.plate.label !== 'string' || !snapshot.plate.label)
      throw failure('InvalidPlotPlannerSnapshotError', 'Choose a current Plot Planner floor plate.');
    for (const [key, label] of [
      ['widthM', 'selected plate width'], ['depthM', 'selected plate depth'],
      ['areaM2', 'selected plate area']
    ]) finite(snapshot.plate[key], label, true);
    if (!['N', 'E', 'S', 'W'].includes(snapshot.plate.frontEdge))
      throw failure('InvalidPlotPlannerSnapshotError', 'Selected Plot Planner plate front edge is unavailable.');
    if (!plain(snapshot.plate.setbacksM))
      throw failure('InvalidPlotPlannerSnapshotError', 'Selected Plot Planner setbacks are unavailable.');
    for (const edge of ['N', 'E', 'S', 'W']) finite(snapshot.plate.setbacksM[edge], `${edge} setback`);
    if (!Number.isSafeInteger(snapshot.plate.floorIndex) || snapshot.plate.floorIndex < 1)
      throw failure('InvalidPlotPlannerSnapshotError', 'Selected Plot Planner floor is unavailable.');
    finite(snapshot.plate.floorElevationM, 'selected floor elevation');
    finite(snapshot.regulation.floorToFloorM, 'floor-to-floor height', true);
    if (!Number.isSafeInteger(snapshot.regulation.plannedFloors) || snapshot.regulation.plannedFloors < 1)
      throw failure('InvalidPlotPlannerSnapshotError', 'Plot Planner floor count is unavailable.');
    return freezeJSON(snapshot);
  }

  function normalize(value, schema, options = {}) {
    const checked = validateInputs(value, schema);
    if (!checked.valid) throw failure('InvalidLayoutInputsError', 'Review the requirement fields before generating a plan.', checked.issues);
    const plotPlanner = assertPlotPlannerSnapshot(options.plotPlanner);
    const input = copyJSON(value), requirements = input.requirements.map(requirement => {
      const constraints = requirement.constraints || {}, dimensions = constraints.dimensions, area = constraints.area;
      return {
        id: requirement.id,
        type: requirement.type,
        name: requirement.name,
        constraints: {
          ...(area ? { area: { minM2: squareFeetToSquareMetres(area.minAreaFt2),
            maxM2: squareFeetToSquareMetres(area.maxAreaFt2), sourcePath: `/requirements/${requirement.id}/constraints/area` } } : {}),
          ...(dimensions ? { dimensions: {
            minWidthM: feetToMetres(dimensions.minWidthFt), minDepthM: feetToMetres(dimensions.minDepthFt),
            maxWidthM: feetToMetres(dimensions.maxWidthFt), maxDepthM: feetToMetres(dimensions.maxDepthFt),
            sourcePath: `/requirements/${requirement.id}/constraints/dimensions`
          } } : {}),
          directions: (constraints.directions || []).slice(),
          requiredAdjacencies: (constraints.requiredAdjacencies || []).slice(),
          prohibitedAdjacencies: (constraints.prohibitedAdjacencies || []).slice()
        },
        preferences: copyJSON(requirement.preferences || {}),
        ...(requirement.details ? { details: copyJSON(requirement.details) } : {})
      };
    });
    const reviewedAt = options.reviewedAt === undefined ? input.timestamp : options.reviewedAt;
    if (!Number.isSafeInteger(reviewedAt) || reviewedAt < 0)
      throw failure('InvalidReviewedAtError', 'The reviewed requirement timestamp must be a nonnegative integer.');
    return freezeJSON({
      version: 1,
      source: {
        schemaId: schema.$id,
        schemaVersion: input.version,
        inputFingerprint: stableStringify({ inputs: input, plotPlanner }),
        plotPlannerFingerprint: stableStringify(plotPlanner),
        reviewedAt
      },
      request: {
        userId: input.userId,
        projectId: input.projectId,
        projectName: input.projectName,
        requestId: input.requestId,
        style: input.style
      },
      plot: {
        id: 'plot-planner-current',
        name: 'Current Plot Planner scenario',
        widthM: plotPlanner.plot.grossWidthM,
        depthM: plotPlanner.plot.grossDepthM,
        netWidthM: plotPlanner.plot.netWidthM,
        netDepthM: plotPlanner.plot.netDepthM,
        facing: plotPlanner.plot.facing,
        frontEdge: plotPlanner.plot.frontEdge,
        roadsM: copyJSON(plotPlanner.plot.roadsM),
        category: plotPlanner.plot.category,
        use: plotPlanner.plot.use,
        setbacks: {
          type: plotPlanner.plate.customSetbacks ? 'custom' : 'rules',
          valuesM: copyJSON(plotPlanner.plate.setbacksM),
          requiredValuesM: copyJSON(plotPlanner.plate.requiredSetbacksM || plotPlanner.plate.setbacksM)
        },
        nonCompliant: plotPlanner.plate.nonCompliant,
        selectedPlate: copyJSON(plotPlanner.plate),
        regulation: copyJSON(plotPlanner.regulation),
        location: null
      },
      programme: copyJSON(input.programme),
      buildup: {
        type: 'plot-planner',
        targetM2: plotPlanner.plate.areaM2,
        toleranceM2: null,
        widthM: plotPlanner.plate.widthM,
        depthM: plotPlanner.plate.depthM,
        sourcePlateId: plotPlanner.plate.id
      },
      requirements,
      vastuEnabled: input.vastuEnabled,
      assumptions: input.assumptions.slice(),
      unknowns: input.unknowns.slice()
    });
  }

  function defaultValue(rawNode, schema) {
    const node = resolved(schema, rawNode);
    if (own(node, 'default')) return copyJSON(node.default);
    if (Array.isArray(node.oneOf) && node.oneOf.length) return defaultValue(node.oneOf[0], schema);
    if (own(node, 'const')) return node.const;
    if (Array.isArray(node.enum) && node.enum.length) return node.enum[0];
    if (node.type === 'object') {
      const result = {};
      for (const key of node.required || []) {
        const child = node.properties?.[key];
        if (child) result[key] = defaultValue(child, schema);
      }
      return result;
    }
    if (node.type === 'array') {
      const length = node.minItems || 0;
      return Array.from({ length }, () => defaultValue(node.items || {}, schema));
    }
    if (node.type === 'boolean') return false;
    if (node.type === 'integer' || node.type === 'number') return node.minimum ?? (node.exclusiveMinimum !== undefined ? node.exclusiveMinimum + 1 : 0);
    return '';
  }

  async function load(url = 'configs/inputs.schema.json', fetchImpl = root.fetch) {
    if (typeof fetchImpl !== 'function') throw failure('InputSchemaLoadError', 'A local fetch implementation is required.');
    const response = await fetchImpl(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!response?.ok) throw failure('InputSchemaLoadError', `The requirement schema could not be loaded (${response?.status || 'network error'}).`);
    return assertSchema(await response.json());
  }

  return Object.freeze({
    SCHEMA_ID, assertSchema, assertPlotPlannerSnapshot, resolve: resolved, validate, validateInputs, normalize,
    defaultValue, stableStringify, copyJSON, load, feetToMetres, squareFeetToSquareMetres
  });
});
