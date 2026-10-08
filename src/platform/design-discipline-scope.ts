// Bind incumbent document mounts to an owned subtree and an injected authority.
// No assignment to window.HomePlanner and no hidden classic application.
import type { PlannerApi } from '../domain/project/planner-api'

export function scopedDocument(host: HTMLElement, planner: PlannerApi, runtime: Window = host.ownerDocument.defaultView!) {
  const document = host.ownerDocument;
  const view = new Proxy(runtime, {
    get(target, key) {
      if (key === 'HomePlanner') return planner;
      const value = Reflect.get(target, key, target);
      // Constructors/namespaces keep their static methods (URL.createObjectURL).
      return typeof value === 'function' && typeof key === 'string' && /^[a-z]/.test(key)
        ? value.bind(target) : value;
    },
  });
  return new Proxy(document, {
    get(target, key) {
      if (key === 'defaultView') return view;
      if (key === 'body') return host;
      if (key === 'getElementById') return (id: string) =>
        host.id === id ? host : [...host.querySelectorAll('[id]')].find(node => node.id === id) || null;
      if (key === 'querySelector') return (selector: string) => host.querySelector(selector);
      if (key === 'querySelectorAll') return (selector: string) => host.querySelectorAll(selector);
      if (key === 'addEventListener' || key === 'removeEventListener')
        return host[key].bind(host);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export const scripts = [
  'planner-structure', 'planner-services', 'planner-drainage', 'planner-drawing',
  'planner-structure-drawing', 'planner-services-drawing', 'planner-drainage-drawing',
  'planner-elevation', 'planner-drawing-export', 'planner-structure-ui',
  'planner-services-ui', 'planner-drainage-ui', 'planner-elevation-ui',
  'planner-facade-ui', 'electrical-planner', 'planner-drawing-ui',
];
export const styles = [
  'planner-structure-ui', 'planner-services-ui', 'planner-elevation-ui',
  'planner-facade-ui', 'electrical-planner', 'planner-drawing-ui',
];
