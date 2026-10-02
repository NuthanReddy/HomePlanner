const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadLegacyPlannerApiModule() {
  const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'domain', 'project', 'legacy-planner-api.ts')).href;
  return import(moduleUrl);
}

function setWindow(value) {
  if (value === undefined) {
    delete globalThis.window;
    return;
  }
  globalThis.window = value;
}

function expectLegacyError(fn, expectedCode, expectedMessagePattern) {
  let thrown;
  try {
    fn();
    assert.fail(`Expected LegacyPlannerIntegrationError with code ${expectedCode}`);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof Error);
  assert.equal(thrown.code, expectedCode);
  assert.match(thrown.message, expectedMessagePattern);
  return thrown;
}

test('missing window.HomePlanner is rejected with explicit legacy errors', async () => {
  const previousWindow = globalThis.window;
  const { hasLegacyPlannerGlobal, createLegacyPlannerApi, LegacyPlannerIntegrationError } = await loadLegacyPlannerApiModule();

  try {
    setWindow(undefined);
    assert.equal(hasLegacyPlannerGlobal(globalThis), false);

    const missingGlobalError = expectLegacyError(
      () => createLegacyPlannerApi(),
      'LegacyPlannerGlobalUnavailableError',
      /window\.HomePlanner is unavailable/i,
    );
    assert.ok(missingGlobalError instanceof LegacyPlannerIntegrationError);

    setWindow({});
    assert.equal(hasLegacyPlannerGlobal(globalThis), false);

    const emptyAuthorityError = expectLegacyError(
      () => createLegacyPlannerApi(),
      'LegacyPlannerGlobalUnavailableError',
      /Load the existing planner bridge/i,
    );
    assert.ok(emptyAuthorityError instanceof LegacyPlannerIntegrationError);
  } finally {
    setWindow(previousWindow);
  }
});

test('incomplete planner authority reports missing callable methods and invalid observer diagnostics', async () => {
  const previousWindow = globalThis.window;
  const { createLegacyPlannerApi, LegacyPlannerIntegrationError } = await loadLegacyPlannerApiModule();

  try {
    const authority = {
      getProject: () => ({ id: 'project' }),
      getScene: () => ({ id: 'scene' }),
      getScenes: () => [],
      getDrawingScene: () => ({ id: 'drawing' }),
      getSelection: () => ({ kind: 'room', id: 'room-1' }),
      execute: () => ({ id: 'executed' }),
      select: () => undefined,
      subscribe: () => () => undefined,
      getObserverErrors: 'broken',
      canUndo: () => false,
      canRedo: () => false,
      undo: () => false,
      redo: () => false,
      inputFingerprint: () => 'fp',
      createSnapshot: () => ({ id: 'snapshot' }),
      exportProject: () => '{}',
      importProject: () => ({ id: 'imported' }),
      newProject: () => ({ id: 'new-project' }),
      isBusy: () => false,
    };

    setWindow({ HomePlanner: authority });

    let thrown;
    try {
      createLegacyPlannerApi();
      assert.fail('Expected an incomplete planner authority error');
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof LegacyPlannerIntegrationError);
    assert.equal(thrown.code, 'LegacyPlannerApiIncompleteError');
    assert.match(thrown.message, /replaceProject/i);
    assert.match(thrown.message, /getObserverErrors/i);
    assert.ok(thrown.missingMethods.includes('replaceProject'));
    assert.ok(thrown.missingMethods.includes('getObserverErrors'));
  } finally {
    setWindow(previousWindow);
  }
});

test('successful adapter forwards commands, selection, history, persistence, fingerprints and observer diagnostics', async () => {
  const previousWindow = globalThis.window;
  const { createLegacyPlannerApi } = await loadLegacyPlannerApiModule();

  try {
    const project = { id: 'project-1', name: 'Project A' };
    const scene = { id: 'scene-1' };
    const scenes = [{ id: 'scene-a' }, { id: 'scene-b' }];
    const drawingScene = { id: 'drawing-scene' };
    const selection = { kind: 'window', id: 'window-1' };
    const command = { type: 'add-room', id: 'room-9' };
    const updatedProject = { id: 'project-2', name: 'Updated' };
    const snapshot = { id: 'snapshot-1', provenance: { inputFingerprint: 'fp-1' } };
    const exportedJson = '{"id":"project-1"}';
    const importedProject = { id: 'project-imported' };
    const replacedProject = { id: 'project-replaced' };
    const newProject = { id: 'project-new' };
    const diagnostics = [{ message: 'observer warning', revision: 'r-1' }];
    const unsubscribe = () => undefined;
    const calls = [];
    const observer = () => undefined;

    const authority = {
      getProject: function () {
        calls.push(['getProject', this === authority]);
        return project;
      },
      getScene: function () {
        calls.push(['getScene', this === authority]);
        return scene;
      },
      getScenes: function () {
        calls.push(['getScenes', this === authority]);
        return scenes;
      },
      getDrawingScene: function () {
        calls.push(['getDrawingScene', this === authority]);
        return drawingScene;
      },
      getSelection: function () {
        calls.push(['getSelection', this === authority]);
        return selection;
      },
      execute: function (nextCommand) {
        calls.push(['execute', this === authority, nextCommand]);
        return updatedProject;
      },
      select: function (nextSelection) {
        calls.push(['select', this === authority, nextSelection]);
      },
      subscribe: function (nextObserver) {
        calls.push(['subscribe', this === authority, nextObserver]);
        return unsubscribe;
      },
      getObserverErrors: function () {
        calls.push(['getObserverErrors', this === authority]);
        return diagnostics;
      },
      canUndo: function () {
        calls.push(['canUndo', this === authority]);
        return true;
      },
      canRedo: function () {
        calls.push(['canRedo', this === authority]);
        return false;
      },
      undo: function () {
        calls.push(['undo', this === authority]);
        return true;
      },
      redo: function () {
        calls.push(['redo', this === authority]);
        return false;
      },
      inputFingerprint: function (inputs) {
        calls.push(['inputFingerprint', this === authority, inputs]);
        return 'fp-42';
      },
      createSnapshot: function (options) {
        calls.push(['createSnapshot', this === authority, options]);
        return snapshot;
      },
      exportProject: function () {
        calls.push(['exportProject', this === authority]);
        return exportedJson;
      },
      importProject: function (json) {
        calls.push(['importProject', this === authority, json]);
        return importedProject;
      },
      replaceProject: function (nextProject) {
        calls.push(['replaceProject', this === authority, nextProject]);
        return replacedProject;
      },
      newProject: function () {
        calls.push(['newProject', this === authority]);
        return newProject;
      },
      isBusy: function () {
        calls.push(['isBusy', this === authority]);
        return true;
      },
    };

    setWindow({ HomePlanner: authority });

    const api = createLegacyPlannerApi();

    assert.equal(api.getProject(), project);
    assert.equal(api.getScene(), scene);
    assert.deepEqual(api.getScenes(), scenes);
    assert.equal(api.getDrawingScene(), drawingScene);
    assert.deepEqual(api.getSelection(), selection);
    assert.equal(api.execute(command), updatedProject);
    api.select(selection);
    const unsubscribeFromObserver = api.subscribe(observer);
    assert.equal(unsubscribeFromObserver, unsubscribe);
    assert.deepEqual(api.getObserverErrors(), diagnostics);
    assert.equal(api.canUndo(), true);
    assert.equal(api.canRedo(), false);
    assert.equal(api.undo(), true);
    assert.equal(api.redo(), false);
    assert.equal(api.inputFingerprint({ season: 'summer' }), 'fp-42');
    const snapshotOptions = { purpose: 'export', engineId: 'engine', engineVersion: '1.0.0', inputs: { season: 'winter' } };
    assert.equal(api.createSnapshot(snapshotOptions), snapshot);
    assert.equal(api.exportProject(), exportedJson);
    assert.equal(api.importProject(exportedJson), importedProject);
    assert.equal(api.replaceProject(project), replacedProject);
    assert.equal(api.newProject(), newProject);
    assert.equal(api.isBusy(), true);

    assert.deepEqual(calls, [
      ['getProject', true],
      ['getScene', true],
      ['getScenes', true],
      ['getDrawingScene', true],
      ['getSelection', true],
      ['execute', true, command],
      ['select', true, selection],
      ['subscribe', true, observer],
      ['getObserverErrors', true],
      ['canUndo', true],
      ['canRedo', true],
      ['undo', true],
      ['redo', true],
      ['inputFingerprint', true, { season: 'summer' }],
      ['createSnapshot', true, snapshotOptions],
      ['exportProject', true],
      ['importProject', true, exportedJson],
      ['replaceProject', true, project],
      ['newProject', true],
      ['isBusy', true],
    ]);
  } finally {
    setWindow(previousWindow);
  }
});