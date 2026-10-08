const fs = require('node:fs');
const path = require('node:path');

// Classic scripts contain runtime imports. Vite's import-analysis transform
// injects an ESM import into them even with @vite-ignore on those expressions.
module.exports = function classicPlannerAssets(root) {
  const files = [
    'planner-features.js', 'planner-regions.js', 'planner-model.js',
    'planner-projection.js', 'planner-room-inputs.js', 'planner-bridge.js',
    'planner-layout-generator.js', 'planner-design-controls.js',
    'planner-layout-runtime.js', 'planner-design-runtime.js', 'planner-3d.js',
    'planner-3d.css', 'planner-drafts.js', 'planner-editor.js', 'planner-editor.css',
    'vendor/suncalc-2.0.1.js', 'sun-model.js', 'sun-exposure.js', 'building-physics.js',
    'environment-data.js',
    'environment-ui.js', 'environment-ui.css',
    'planner-light.js', 'planner-light-runner.js', 'planner-light-worker.js',
    'planner-light-display.js', 'planner-light-ui.js', 'planner-light-ui.css',
    'planner-airflow-field.js', 'planner-airflow.js', 'planner-airflow-runner.js',
    'planner-airflow-worker.js', 'planner-airflow-display.js', 'planner-airflow-inputs.js',
    'planner-airflow-ui.js', 'planner-airflow-ui.css', 'planner-cfd.js',
    'planner-cfd-ui.js', 'planner-cfd-ui.css', 'planner-reduced-ui.js',
    'planner-structure.js', 'planner-services.js', 'planner-drainage.js',
    'planner-drawing.js', 'planner-structure-drawing.js', 'planner-services-drawing.js',
    'planner-drainage-drawing.js', 'planner-elevation.js', 'planner-drawing-export.js',
    'planner-structure-ui.js', 'planner-structure-ui.css',
    'planner-services-ui.js', 'planner-services-ui.css', 'planner-drainage-ui.js',
    'planner-elevation-ui.js', 'planner-elevation-ui.css',
    'planner-facade-ui.js', 'planner-facade-ui.css',
    'electrical-planner.js', 'electrical-planner.css',
    'planner-drawing-ui.js', 'planner-drawing-ui.css', 'vendor/pdf/pdf-lib-1.17.1.min.js',
  ];
  const allowed = new Set(files);
  const filename = url => {
    const name = new URL(url, 'http://localhost').pathname;
    const relative = name.startsWith('/classic/') ? name.slice(9) : name.slice(1);
    if (allowed.has(relative)) return relative;
    if (relative.startsWith('vendor/three/') && !relative.includes('..') &&
        /^[\w./-]+\.js$/.test(relative)) return relative;
    return null;
  };
  return {
    name: 'homeplanner-classic-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const relative = filename(req.url || '/');
        if (!relative) return next();
        const file = path.join(root, ...relative.split('/'));
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', relative.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(fs.readFileSync(file));
      });
    },
    closeBundle() {
      const target = path.join(root, 'dist', 'classic');
      fs.mkdirSync(target, { recursive: true });
      for (const file of files) {
        const destination = path.join(target, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(root, file), destination);
      }
      fs.cpSync(path.join(root, 'vendor', 'three'), path.join(target, 'vendor', 'three'), { recursive: true });
    },
  };
};
