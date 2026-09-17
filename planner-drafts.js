(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerDrafts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const registries = new WeakMap();
  const copy = value => JSON.parse(JSON.stringify(value));
  const key = scope => JSON.stringify([scope.projectId, scope.floorId || '', scope.collection || '', scope.entityId || '']);
  function registry(planner) {
    if (!registries.has(planner)) registries.set(planner, { stores: new Set(), listeners: new Set(), version: 0 });
    return registries.get(planner);
  }
  function notify(state) {
    state.version++;
    for (const listener of state.listeners) listener();
  }
  function createStore(planner, label) {
    const state = registry(planner), entries = new Map();
    const store = { label, entries };
    state.stores.add(store);
    let disposed = false;
    return {
      scopes() { return [...entries.values()].map(entry => copy(entry.scope)); },
      get(scope) { const entry = entries.get(key(scope)); return entry ? copy(entry.value) : null; },
      put(scope, value) {
        if (disposed) return;
        const entry = { scope: copy(scope), value: copy(value) }, id = key(scope);
        if (JSON.stringify(entries.get(id)) === JSON.stringify(entry)) return;
        entries.set(id, entry); notify(state);
      },
      remove(scope) { if (entries.delete(key(scope))) notify(state); },
      dispose() {
        if (disposed) return;
        disposed = true; entries.clear(); state.stores.delete(store); notify(state);
      }
    };
  }
  function pending(planner, projectId) {
    return [...registry(planner).stores].flatMap(store => [...store.entries.values()]
      .filter(entry => projectId === undefined || entry.scope.projectId === projectId)
      .map(entry => ({ label: store.label, ...copy(entry.scope) })));
  }
  return {
    createStore, pending, key,
    hasPending: (planner, projectId) => pending(planner, projectId).length > 0,
    token: planner => registry(planner).version,
    subscribe(planner, listener) {
      const state = registry(planner); state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    }
  };
});
