(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require);
  else root.HomePlannerDrawingExport = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, load) {
  'use strict';

  const PT_PER_MM = 72 / 25.4;
  const MAX_PAGES = 100;
  const MAX_PRIMITIVES = 100000;
  const MAX_COMMANDS = 500000;
  const MAX_TEXT = 1000000;
  const MAX_PIXELS = 16000000;
  const MAX_SIDE = 8192;
  const PDF_SOURCE = root.document && root.document.currentScript && root.document.currentScript.src
    ? new root.URL('vendor/pdf/pdf-lib-1.17.1.min.js', root.document.currentScript.src).href
    : 'vendor/pdf/pdf-lib-1.17.1.min.js';
  let pdfLoading;

  function renderer() {
    const drawing = root.HomePlannerDrawing || (load && load('./planner-drawing.js'));
    if (!drawing || typeof drawing.validateSheet !== 'function' || typeof drawing.toSVG !== 'function') {
      throw new Error('Drawing renderer unavailable: load planner-drawing.js before exporting.');
    }
    return drawing;
  }

  async function pdfLibrary() {
    const library = root.PDFLib || (load && load('./vendor/pdf/pdf-lib-1.17.1.min.js'));
    if (library) return library;
    if (!root.document || !root.document.head) {
      throw new Error('PDF library unavailable: load vendor/pdf/pdf-lib-1.17.1.min.js before exporting PDF.');
    }
    if (!pdfLoading) {
      pdfLoading = new Promise((resolve, reject) => {
        const script = root.document.createElement('script');
        let timer;
        const finish = error => {
          root.clearTimeout(timer);
          script.onload = null;
          script.onerror = null;
          if (error) { script.remove(); reject(error); }
          else resolve(root.PDFLib);
        };
        script.src = PDF_SOURCE;
        script.async = true;
        script.onload = () => finish(root.PDFLib && root.PDFLib.PDFDocument
          ? null : new Error('Local PDF library loaded without its API; reload the page and retry.'));
        script.onerror = () => finish(new Error('Could not load the local PDF library. Check the application files and retry, or export SVG.'));
        timer = root.setTimeout(() => finish(new Error('Local PDF library loading timed out after 30 seconds. Retry or export SVG.')), 30000);
        try { root.document.head.appendChild(script); }
        catch (error) { finish(error); }
      }).catch(error => {
        pdfLoading = undefined;
        throw error;
      });
    }
    return pdfLoading;
  }

  function snapshot(sheets, drawing, sameProject) {
    if (!Array.isArray(sheets) || sheets.length === 0 || sheets.length > MAX_PAGES) {
      throw new RangeError(`Export requires 1–${MAX_PAGES} sheets.`);
    }
    let primitives = 0, commands = 0, text = 0;
    const first = sheets[0];
    return sheets.map((sheet, index) => {
      drawing.validateSheet(sheet);
      if (sheet.widthMm > 5080 || sheet.heightMm > 5080) {
        throw new RangeError('Export paper must not exceed 5080 mm per side (PDF 14,400-point limit).');
      }
      if (sameProject && (sheet.metadata.projectId !== first.metadata.projectId ||
          sheet.metadata.revision !== first.metadata.revision)) {
        throw new Error(`Sheet ${index + 1} has a different project or revision; regenerate all sheets from one project snapshot.`);
      }
      primitives += sheet.primitives.length;
      if (primitives > MAX_PRIMITIVES) throw new RangeError('Export exceeds 100,000 primitives; export fewer floors.');
      for (const primitive of sheet.primitives) {
        if (primitive.type === 'path') commands += primitive.commands.length;
        else text += primitive.text.length;
      }
      if (commands > MAX_COMMANDS || text > MAX_TEXT) {
        throw new RangeError('Export exceeds 500,000 path commands or 1,000,000 text characters; export fewer floors.');
      }
      // Copy before the first await so editing the live project cannot mix revisions.
      return {
        version: sheet.version, widthMm: sheet.widthMm, heightMm: sheet.heightMm,
        metadata: { ...sheet.metadata, assumptions: sheet.metadata.assumptions.slice() },
        primitives: sheet.primitives.map(primitive => primitive.type === 'path'
          ? { ...primitive, commands: primitive.commands.map(command => command.slice()) }
          : { ...primitive })
      };
    });
  }

  function rgb(hex) {
    return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  }

  async function pdfBytes(sheets) {
    const pages = snapshot(sheets, renderer(), true);
    const pdf = await pdfLibrary();
    const document = await pdf.PDFDocument.create();
    const font = await document.embedFont(pdf.StandardFonts.Helvetica);
    const supported = new Set(font.getCharacterSet());
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      for (const primitive of pages[pageIndex].primitives) {
        if (primitive.type !== 'text') continue;
        for (const character of primitive.text) {
          const code = character.codePointAt(0);
          if (!supported.has(code)) {
            throw new Error(`PDF page ${pageIndex + 1}: Helvetica/WinAnsi cannot encode U+${code.toString(16).toUpperCase().padStart(4, '0')}. ` +
              'Use SVG or PNG for this text, or edit the label to supported Latin characters. No text was replaced.');
          }
        }
      }
    }
    for (const sheet of pages) {
      const page = document.addPage();
      page.setSize(sheet.widthMm * PT_PER_MM, sheet.heightMm * PT_PER_MM);
      const fontKey = page.node.newFontDictionary(font.name, font.ref);
      for (const primitive of sheet.primitives) {
        if (primitive.type === 'path') {
          const ops = [pdf.pushGraphicsState(),
            pdf.concatTransformationMatrix(PT_PER_MM, 0, 0, -PT_PER_MM, 0, sheet.heightMm * PT_PER_MM),
            pdf.setLineCap(1), pdf.setLineJoin(1)];
          if (primitive.fill !== null) ops.push(pdf.setFillingRgbColor(...rgb(primitive.fill)));
          // A zero SVG stroke is invisible, not a PDF device-width hairline.
          const hasStroke = primitive.stroke !== null && primitive.strokeWidthMm > 0;
          if (hasStroke) ops.push(pdf.setStrokingRgbColor(...rgb(primitive.stroke)), pdf.setLineWidth(primitive.strokeWidthMm));
          for (const [command, ...args] of primitive.commands) {
            if (command === 'M') ops.push(pdf.moveTo(...args));
            else if (command === 'L') ops.push(pdf.lineTo(...args));
            else if (command === 'C') ops.push(pdf.appendBezierCurve(...args));
            else if (command === 'Z') ops.push(pdf.closePath());
          }
          ops.push(primitive.fill !== null
            ? (hasStroke ? pdf.fillAndStroke() : pdf.fill())
            : (hasStroke ? pdf.stroke() : pdf.endPath()), pdf.popGraphicsState());
          // Do not spread a potentially large command array into a function call.
          for (const op of ops) page.pushOperators(op);
        } else {
          const size = primitive.fontSizeMm * PT_PER_MM;
          // Tj uses individual glyph advances, not pair kerning. Match that for anchoring.
          let width = 0;
          for (const character of primitive.text) width += font.widthOfTextAtSize(character, size);
          const offset = primitive.align === 'middle' ? width / 2 : primitive.align === 'end' ? width : 0;
          const angle = -primitive.rotationDeg * Math.PI / 180;
          const cosine = Math.cos(angle), sine = Math.sin(angle);
          page.pushOperators(pdf.pushGraphicsState(), pdf.setFillingRgbColor(...rgb(primitive.color)),
            pdf.beginText(), pdf.setFontAndSize(fontKey, size),
            pdf.setTextMatrix(cosine, sine, -sine, cosine,
              primitive.xMm * PT_PER_MM - offset * cosine,
              (sheet.heightMm - primitive.yMm) * PT_PER_MM - offset * sine),
            pdf.showText(font.encodeText(primitive.text)), pdf.endText(), pdf.popGraphicsState());
        }
      }
    }
    return document.save({ useObjectStreams: false });
  }

  function rasterSize(sheet, options) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('PNG options must be an object.');
    }
    const pixelsPerMm = options.pixelsPerMm === undefined ? 4 : options.pixelsPerMm;
    const maxPixels = options.maxPixels === undefined ? MAX_PIXELS : options.maxPixels;
    if (typeof pixelsPerMm !== 'number' || !Number.isFinite(pixelsPerMm) || pixelsPerMm <= 0 || pixelsPerMm > 1200) {
      throw new RangeError('pixelsPerMm must be a finite number greater than 0 and at most 1200.');
    }
    if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_PIXELS) {
      throw new RangeError('maxPixels must be an integer from 1 to 16,000,000.');
    }
    const ratio = Math.min(pixelsPerMm, MAX_SIDE / sheet.widthMm, MAX_SIDE / sheet.heightMm,
      Math.sqrt(maxPixels / sheet.widthMm / sheet.heightMm));
    const width = Math.max(1, Math.min(maxPixels, Math.floor(sheet.widthMm * ratio)));
    const height = Math.max(1, Math.min(Math.floor(maxPixels / width), Math.floor(sheet.heightMm * ratio)));
    return { width, height };
  }

  async function pngBlob(sheet, options = {}) {
    const drawing = renderer();
    const [copy] = snapshot([sheet], drawing, false);
    const { width, height } = rasterSize(copy, options);
    if (!root.document || !root.Image || !root.URL || typeof root.URL.createObjectURL !== 'function') {
      throw new Error('PNG export requires a browser with canvas, Image and object URL support.');
    }
    const svg = drawing.toSVG(copy);
    if (svg.length > 16000000) throw new RangeError('SVG raster input exceeds 16 MB; export fewer details.');
    const url = root.URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    let canvas, image, timer;
    try {
      image = new root.Image();
      await new Promise((resolve, reject) => {
        timer = root.setTimeout(() => reject(new Error('SVG rasterization timed out after 30 seconds.')), 30000);
        image.onload = resolve;
        image.onerror = () => reject(new Error('SVG could not be rasterized; export SVG or check browser image support.'));
        image.src = url;
      });
      root.clearTimeout(timer);
      canvas = root.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Browser could not allocate a 2D canvas; reduce PNG maxPixels.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return await new Promise((resolve, reject) => {
        timer = root.setTimeout(() => reject(new Error('PNG encoding timed out after 30 seconds.')), 30000);
        canvas.toBlob(blob => {
          if (!blob || blob.type !== 'image/png' || blob.size === 0) {
            reject(new Error('Browser failed to encode PNG; reduce PNG maxPixels.'));
          } else resolve(blob);
        }, 'image/png');
      });
    } finally {
      root.clearTimeout(timer);
      try {
        if (image) { image.onload = null; image.onerror = null; image.src = ''; }
      } finally {
        root.URL.revokeObjectURL(url);
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
  }

  return Object.freeze({ pdfBytes, pngBlob });
});
