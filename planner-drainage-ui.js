(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./planner-services-ui.js'));
  else {
    const api = root.HomePlannerDrainageUI = factory(root.HomePlannerServicesUI);
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    else api.mount();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (shared) {
  'use strict';
  if (!shared?.createController) throw new Error('Load planner-services-ui.js before planner-drainage-ui.js.');
  return Object.freeze({
    createController(planner, runtime) { return shared.createController(planner, runtime, { domain: 'drainage' }); },
    mount(document) { return shared.mount(document, { domain: 'drainage' }); }
  });
});
