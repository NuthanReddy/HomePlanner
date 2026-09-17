const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PDF = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'planner-drawing-export.js'), 'utf8');
const PT = 72 / 25.4;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

function sheet(overrides = {}) {
  return {
    version: 1, widthMm: 210, heightMm: 297,
    metadata: { projectId: 'project-1', revision: 7, floorId: 'floor-1', floorName: 'Ground',
      title: 'Plan', paper: 'A4', orientation: 'portrait', scaleDenominator: 100, units: 'metric', assumptions: [] },
    primitives: [
      { type: 'path', commands: [['M', 10, 20], ['L', 40, 20], ['C', 40, 25, 35, 30, 10, 20], ['Z']],
        fill: '#123456', stroke: '#654321', strokeWidthMm: 0.25 },
      { type: 'text', xMm: 50, yMm: 60, text: 'AV café € — (x)\\', fontSizeMm: 4,
        align: 'middle', rotationDeg: 30, color: '#123456' }
    ],
    ...overrides
  };
}

function harness(extra = {}) {
  const calls = { validated: [], revoked: [], allocated: 0, drawn: [], sizes: [] };
  const context = {
    PDFLib: PDF, Blob, setTimeout, clearTimeout,
    HomePlannerDrawing: {
      validateSheet(value) { calls.validated.push(value); return value; },
      toSVG() { return '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"/>'; }
    },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL(url) { calls.revoked.push(url); } },
    Image: class {
      set src(value) { if (value) queueMicrotask(() => this.onload?.()); }
    },
    document: {
      createElement(name) {
        assert.equal(name, 'canvas');
        calls.allocated++;
        return {
          width: 0, height: 0,
          getContext() { return { fillRect() {}, drawImage(...args) { calls.drawn.push(args); } }; },
          toBlob(callback, type) { calls.sizes.push([this.width, this.height]); callback(new Blob(['png'], { type })); }
        };
      }
    },
    ...extra
  };
  vm.runInNewContext(source, context);
  return { api: context.HomePlannerDrawingExport, context, calls };
}

async function readPdf(bytes) {
  const document = await PDF.PDFDocument.load(bytes);
  const pages = document.getPages();
  const streams = pages.map(page => {
    const contents = page.node.Contents();
    return Array.from({ length: contents.size() }, (_, index) =>
      Buffer.from(PDF.decodePDFRawStream(document.context.lookup(contents.get(index))).decode()).toString('latin1')).join('\n');
  });
  return { document, pages, streams };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test('actual multipage PDF has physical media boxes, vector paths, text and a readable xref', async () => {
  const { api, calls } = harness();
  const first = deepFreeze(sheet());
  const second = deepFreeze(sheet({ widthMm: 420, heightMm: 297,
    metadata: { ...first.metadata, floorId: 'floor-2', paper: 'A3', orientation: 'landscape' } }));
  const before = JSON.stringify([first, second]);
  const bytes = await api.pdfBytes([first, second]);
  assert.ok(bytes instanceof Uint8Array);
  const { pages, streams } = await readPdf(bytes);
  assert.equal(pages.length, 2);
  close(pages[0].getWidth(), 210 * PT);
  close(pages[0].getHeight(), 297 * PT);
  close(pages[1].getWidth(), 420 * PT);
  close(pages[1].getHeight(), 297 * PT);
  for (const stream of streams) {
    assert.match(stream, /10 20 m\n40 20 l\n40 25 35 30 10 20 c\nh\nB/);
    assert.match(stream, /0\.25 w/);
    assert.match(stream, /1 J\n1 j/);
    assert.match(stream, /BT\n/);
    assert.match(stream, /<415620636166E920802097202878295C> Tj/i);
    assert.doesNotMatch(stream, /\bDo\b|\bBI\b/);
    const matrix = stream.split('\n').find(line => line.endsWith(' cm')).split(' ').slice(0, 6).map(Number);
    [PT, 0, 0, -PT, 0, 297 * PT].forEach((expected, index) => close(matrix[index], expected));
  }
  const raw = Buffer.from(bytes).toString('latin1');
  const xref = Number(raw.match(/startxref\s+(\d+)/)[1]);
  assert.equal(raw.slice(xref, xref + 4), 'xref');
  assert.doesNotMatch(raw, /\/Subtype\s*\/Image/);
  assert.match(raw, /\/BaseFont \/Helvetica/);
  assert.equal(JSON.stringify([first, second]), before);
  assert.equal(calls.validated.length, 2);
});

test('PDF uses SVG clockwise baseline rotation and start/middle/end anchoring', async () => {
  const { api } = harness();
  const doc = await PDF.PDFDocument.create();
  const font = await doc.embedFont(PDF.StandardFonts.Helvetica);
  for (const rotationDeg of [0, 30, 90, -90, 180]) {
    for (const align of ['start', 'middle', 'end']) {
      const input = sheet();
      input.primitives = [{ ...input.primitives[1], rotationDeg, align }];
      const { streams } = await readPdf(await api.pdfBytes([input]));
      const matrix = streams[0].split('\n').find(line => line.endsWith(' Tm')).split(' ').slice(0, 6).map(Number);
      const angle = -rotationDeg * Math.PI / 180;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const width = [...input.primitives[0].text].reduce((sum, character) => sum + font.widthOfTextAtSize(character, 4 * PT), 0);
      const offset = align === 'middle' ? width / 2 : align === 'end' ? width : 0;
      [cosine, sine, -sine, cosine, 50 * PT - offset * cosine, 237 * PT - offset * sine]
        .forEach((expected, index) => close(matrix[index], expected));
    }
  }
});

test('zero-width and null strokes never become PDF hairlines; paint modes remain vector', async () => {
  const { api } = harness();
  for (const [fill, stroke, strokeWidthMm, operator] of [
    [null, '#123456', 0, 'n'], [null, null, 1, 'n'],
    ['#123456', '#123456', 0, 'f'], [null, '#123456', 1, 'S']
  ]) {
    const input = sheet();
    input.primitives = [{ ...input.primitives[0], fill, stroke, strokeWidthMm }];
    const { streams } = await readPdf(await api.pdfBytes([input]));
    assert.ok(streams[0].includes(`\nh\n${operator}\n`));
    if (strokeWidthMm === 0) assert.doesNotMatch(streams[0], /\bw\n/);
  }
});

test('same snapshot project/revision required, page and memory limits enforced', async () => {
  const { api } = harness();
  for (const override of [{ projectId: 'other' }, { revision: 8 }]) {
    const other = sheet();
    Object.assign(other.metadata, override);
    await assert.rejects(api.pdfBytes([sheet(), other]), /different project or revision/);
  }
  for (const invalid of [[], null, Array(101).fill(sheet())]) {
    await assert.rejects(api.pdfBytes(invalid), /1–100 sheets/);
  }
  await assert.rejects(api.pdfBytes([sheet({ widthMm: 5081 })]), /5080 mm/);
  const input = sheet();
  await assert.rejects(api.pdfBytes([sheet({ primitives: Array(100001).fill(input.primitives[1]) })]), /100,000 primitives/);
  await assert.rejects(api.pdfBytes([sheet({ primitives: [{ ...input.primitives[1], text: 'a'.repeat(1000001) }] })]), /1,000,000/);
  await assert.rejects(api.pdfBytes([sheet({ primitives: [{ ...input.primitives[0], commands: Array(500001).fill(['Z']) }] })]), /500,000/);
});

test('unsupported scripts and control characters fail explicitly without replacement', async () => {
  const { api } = harness();
  for (const text of ['中文', 'తెలుగు', 'العربية', '😀', 'A\nB', 'A\tB', 'A\u0301', '\u2028']) {
    const input = sheet();
    input.primitives[1].text = text;
    await assert.rejects(api.pdfBytes([input]), /Helvetica\/WinAnsi cannot encode U\+.*Use SVG or PNG/);
  }
});

test('editing source while PDF awaits cannot change the captured output', async () => {
  const { api } = harness();
  const input = sheet();
  const pending = api.pdfBytes([input]);
  input.primitives[0].commands[0][1] = 999;
  input.primitives[1].text = 'MUTATED';
  input.metadata.revision = 100;
  const { streams } = await readPdf(await pending);
  assert.match(streams[0], /10 20 m/);
  assert.match(streams[0], /<415620636166E9/);
});

test('renderer validation is delegated and dependencies resolve lazily', async () => {
  const { api, context } = harness({ HomePlannerDrawing: undefined, PDFLib: undefined });
  await assert.rejects(api.pdfBytes([sheet()]), /Drawing renderer unavailable/);
  context.HomePlannerDrawing = { validateSheet() { throw new Error('renderer validation sentinel'); }, toSVG() {} };
  await assert.rejects(api.pdfBytes([sheet()]), /renderer validation sentinel/);
  await assert.rejects(api.pngBlob(sheet()), /renderer validation sentinel/);
  context.HomePlannerDrawing.validateSheet = () => {};
  await assert.rejects(api.pdfBytes([sheet()]), /PDF library unavailable/);
  context.PDFLib = PDF;
  assert.ok((await api.pdfBytes([sheet()])).length > 0);
});

test('PNG caps sides/pixels, produces browser blob, revokes URLs and preserves sheets', async () => {
  const { api, calls } = harness();
  const input = deepFreeze(sheet());
  const before = JSON.stringify(input);
  const blob = await api.pngBlob(input);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(calls.sizes[0], [840, 1188]);
  await api.pngBlob(input, { pixelsPerMm: 1200, maxPixels: 10000 });
  await api.pngBlob(sheet({ widthMm: 5080, heightMm: 0.1 }), { pixelsPerMm: 1200, maxPixels: 10 });
  await api.pngBlob(input, { pixelsPerMm: Number.MIN_VALUE, maxPixels: 1 });
  await api.pngBlob(sheet({ widthMm: 5080, heightMm: 0.1 }), { pixelsPerMm: 1200 });
  for (const [width, height] of calls.sizes) {
    assert.ok(width > 0 && height > 0 && width <= 8192 && height <= 8192);
  }
  assert.ok(calls.sizes[1][0] * calls.sizes[1][1] <= 10000);
  assert.ok(calls.sizes[2][0] * calls.sizes[2][1] <= 10);
  assert.deepEqual(calls.sizes[3], [1, 1]);
  assert.deepEqual(calls.sizes[4], [8192, 1]);
  assert.equal(calls.revoked.length, 5);
  assert.equal(JSON.stringify(input), before);
});

test('browser PDF runtime loads only on export and concurrent exports share the local load', async () => {
  const scripts = [];
  const { api, context } = harness({
    PDFLib: undefined, URL,
    document: {
      currentScript: { src: 'https://example.test/app/planner-drawing-export.js' },
      head: { appendChild(script) { scripts.push(script); } },
      createElement(name) { assert.equal(name, 'script'); return { remove() {} }; }
    }
  });
  assert.equal(scripts.length, 0);
  const input = sheet();
  const first = api.pdfBytes([input]);
  const second = api.pdfBytes([sheet()]);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://example.test/app/vendor/pdf/pdf-lib-1.17.1.min.js');
  input.primitives[1].text = 'MUTATED';
  context.PDFLib = PDF;
  scripts[0].onload();
  const outputs = await Promise.all([first, second]);
  assert.equal(scripts[0].onload, null);
  assert.match((await readPdf(outputs[0])).streams[0], /<415620636166E9/);
  await api.pdfBytes([sheet()]);
  assert.equal(scripts.length, 1);
});

test('failed browser PDF loads report errors, clean up and permit retry', async () => {
  for (const failure of ['error', 'missing-api', 'timeout', 'append']) {
    const scripts = [];
    let removed = 0, timeout;
    const { api, context } = harness({
      PDFLib: undefined,
      setTimeout(callback) { timeout = callback; return 1; },
      clearTimeout() {},
      document: {
        head: { appendChild(script) {
          scripts.push(script);
          if (failure === 'append' && scripts.length === 1) throw new Error('append denied');
        } },
        createElement() { return { remove() { removed++; } }; }
      }
    });
    const pending = api.pdfBytes([sheet()]);
    if (failure === 'error') scripts[0].onerror();
    if (failure === 'missing-api') scripts[0].onload();
    if (failure === 'timeout') timeout();
    await assert.rejects(pending, /local PDF library|without its API|timed out|append denied/i);
    assert.equal(removed, 1);
    const retry = api.pdfBytes([sheet()]);
    assert.equal(scripts.length, 2);
    context.PDFLib = PDF;
    scripts[1].onload();
    assert.ok((await retry).length > 0);
  }
});

test('invalid raster numbers reject before canvas, image or URL allocation', async () => {
  const { api, calls, context } = harness();
  context.URL.createObjectURL = () => assert.fail('Must not create URL');
  for (const options of [null, [], 2, { pixelsPerMm: '4' }, { pixelsPerMm: NaN },
    { pixelsPerMm: Infinity }, { pixelsPerMm: -1 }, { pixelsPerMm: 0 }, { pixelsPerMm: 1201 },
    { maxPixels: 0 }, { maxPixels: -1 }, { maxPixels: 0.5 }, { maxPixels: 16000001 }, { maxPixels: '100' },
    { maxPixels: Infinity }, { maxPixels: NaN }]) {
    await assert.rejects(api.pngBlob(sheet(), options), /options|pixelsPerMm|maxPixels/);
  }
  assert.equal(calls.allocated, 0);
});

test('raster failures propagate and always revoke their URL and release canvas', async () => {
  for (const failure of ['image', 'image-constructor', 'image-src', 'context', 'draw', 'null-blob', 'wrong-blob', 'throw-blob', 'timeout']) {
    const { api, context, calls } = harness();
    let canvas;
    if (failure === 'image') context.Image = class { set src(value) { if (value) queueMicrotask(() => this.onerror?.()); } };
    if (failure === 'image-constructor') context.Image = class { constructor() { throw new Error('image-constructor'); } };
    if (failure === 'image-src') context.Image = class { set src(value) { if (value) throw new Error('image-src'); } };
    if (failure === 'timeout') {
      context.Image = class { set src(value) {} };
      context.setTimeout = callback => { queueMicrotask(callback); return 1; };
    }
    context.document.createElement = () => (canvas = {
      getContext() {
        if (failure === 'context') return null;
        return { fillRect() {}, drawImage() { if (failure === 'draw') throw new Error('draw failed'); } };
      },
      toBlob(callback) {
        if (failure === 'throw-blob') throw new Error('encode failed');
        callback(failure === 'wrong-blob' ? new Blob(['x'], { type: 'image/jpeg' }) : null);
      }
    });
    await assert.rejects(api.pngBlob(sheet()), /rasterized|image-constructor|image-src|2D canvas|draw failed|encode PNG|encode failed|timed out/);
    assert.deepEqual(calls.revoked, ['blob:test'], failure);
    if (canvas) assert.equal(canvas.width + canvas.height, 0);
  }
});

const rendererPath = path.join(__dirname, '..', 'planner-drawing.js');
test('real renderer integration validates shared sheets and exports multipage PDF', { skip: !fs.existsSync(rendererPath) && 'renderer integration pending' }, async () => {
  const Drawing = require(rendererPath);
  const Export = require('../planner-drawing-export.js');
  const input = sheet();
  Drawing.validateSheet(input);
  const svg = Drawing.toSVG(input);
  assert.match(svg, /<svg/);
  assert.match(svg, /text-anchor="middle"/);
  assert.match(svg, /rotate\(30 50 60\)/);
  const second = sheet({ widthMm: 420, heightMm: 297,
    metadata: { ...input.metadata, floorId: 'floor-2', paper: 'A3', orientation: 'landscape' } });
  const { pages } = await readPdf(await Export.pdfBytes([deepFreeze(input), deepFreeze(second)]));
  assert.equal(pages.length, 2);
  close(pages[0].getWidth(), 210 * PT);
  close(pages[1].getWidth(), 420 * PT);
  const wrongRevision = sheet();
  wrongRevision.metadata.revision++;
  await assert.rejects(Export.pdfBytes([input, wrongRevision]), /different project or revision/);
});
