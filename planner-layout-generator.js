(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomePlannerLayoutGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const requiredFunctions = [
    'subtractFree', 'occupiedBounds', 'serviceKeepClear', 'rectInside', 'carpetModule',
    'moduleClear', 'balconyTouches', 'balconyEligible', 'hardAdjacencyValid',
    'servicePlacementRank', 'directionPenalty', 'adjacencyPenalty', 'rolePenalty',
    'recalculatePlan', 'balconyAttachments', 'circulationAnalysis', 'scoreLess',
    'assignBalconies', 'optimizeLeftovers'
  ];

  function create(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      throw new Error('Layout generator requires explicit geometry and scoring dependencies.');
    for (const name of requiredFunctions)
      if (typeof options[name] !== 'function') throw new Error(`Layout generator dependency ${name} is unavailable.`);
    const intWall = options.internalWallM, eps = options.epsilon;
    if (!Number.isFinite(intWall) || intWall <= 0 || !Number.isFinite(eps) || eps <= 0)
      throw new Error('Layout generator requires positive internal-wall and epsilon values.');

    function order(requests, mode) {
      const minArea = request => (request.range.minW + intWall) * (request.range.minD + intWall);
      const rank = { living: 0, kitchen: 1, pooja: 2, bedroom: 3, bathroom: 4, staircase: 5, lift: 6 };
      const sorted = requests.slice().sort((a, b) => mode === 'large'
        ? minArea(b) - minArea(a) || a.priority - b.priority || a.seq - b.seq
        : rank[a.type] - rank[b.type] || minArea(b) - minArea(a) || a.seq - b.seq);
      const ensuiteByBedroom = new Map(requests.filter(request =>
        request.type === 'bathroom' && request.accessMode === 'ensuite')
        .map(request => [request.bedroomId, request]));
      const result = sorted.filter(request => request.type === 'lift' || request.type === 'staircase')
        .sort((a, b) => Number(b.type === 'staircase') - Number(a.type === 'staircase'));
      sorted.forEach(request => {
        if (request.type === 'lift' || request.type === 'staircase') return;
        if (request.type === 'bathroom' && request.accessMode === 'ensuite' &&
            requests.some(parent => parent.id === request.bedroomId)) return;
        result.push(request);
        const ensuite = ensuiteByBedroom.get(request.id);
        if (ensuite) result.push(ensuite);
      });
      return result;
    }

    function packAttempt(g, requests, sizeMode, orderMode, index, initial = [], accessPassages = []) {
      let free = [{ ...g.core }], serviceFree = [{ ...g.core }];
      const overflow = requests.filter(request => request.type === 'bathroom' && request.accessMode === 'overflow');
      const placed = initial.map(item => ({ ...item, carpet: { ...item.carpet }, module: { ...item.module } }));
      const unmet = overflow.slice();
      for (const item of placed) {
        if (item.req.reserveFootprint) serviceFree = options.subtractFree(serviceFree, options.occupiedBounds(item));
        else free = options.subtractFree(free, item.module);
      }
      const requestsInOrder = order(requests.filter(request => request.accessMode !== 'overflow'), orderMode);
      let totalDeviation = 0;

      requestsInOrder.forEach(request => {
        let best = null;
        const pad = request.reserveFootprint ? 2 * intWall : intWall;
        const placementContext = { placed, accessPassages };
        const keepClear = options.serviceKeepClear(placementContext, g);
        (request.reserveFootprint ? serviceFree : free).forEach(freeRect => {
          [false, true].forEach(rotated => {
            const range = request.range;
            const minW = rotated ? range.minD : range.minW;
            const minD = rotated ? range.minW : range.minD;
            const maxW = rotated ? range.maxD : range.maxW;
            const maxD = rotated ? range.maxW : range.maxD;
            const preferredW = (minW + maxW) / 2, preferredD = (minD + maxD) / 2;
            let carpetW = sizeMode === 'minimum' ? minW : Math.min(preferredW, freeRect.w - pad);
            let carpetD = sizeMode === 'minimum' ? minD : Math.min(preferredD, freeRect.h - pad);
            if (carpetW < minW - eps || carpetD < minD - eps) return;
            carpetW = Math.min(carpetW, maxW);carpetD = Math.min(carpetD, maxD);
            if (request.type === 'staircase' && carpetW < carpetD - eps) return;
            const moduleW = carpetW + pad, moduleD = carpetD + pad;
            if (moduleW > freeRect.w + eps || moduleD > freeRect.h + eps) return;
            const poses = [
              [freeRect.x, freeRect.y], [freeRect.x + freeRect.w - moduleW, freeRect.y],
              [freeRect.x, freeRect.y + freeRect.h - moduleD],
              [freeRect.x + freeRect.w - moduleW, freeRect.y + freeRect.h - moduleD]
            ];
            if (request.type === 'lift' || request.type === 'staircase') {
              const companionType = request.type === 'lift' ? 'staircase' : 'lift';
              const companions = placed.filter(item => item.req.type === companionType).map(options.occupiedBounds);
              const references = companions.concat(request.type === 'lift' ? keepClear.map(item => item.rect) : []);
              for (const reference of references) {
                for (const y of [reference.y, reference.y + reference.h - moduleD, reference.y + (reference.h - moduleD) / 2])
                  poses.push([reference.x - moduleW, y], [reference.x + reference.w, y]);
                for (const x of [reference.x, reference.x + reference.w - moduleW, reference.x + (reference.w - moduleW) / 2])
                  poses.push([x, reference.y - moduleD], [x, reference.y + reference.h]);
              }
            }
            const seen = new Set();
            poses.forEach(([x, y]) => {
              const key = `${x.toFixed(6)}:${y.toFixed(6)}`;
              if (seen.has(key)) return;
              seen.add(key);
              if (!options.rectInside({ x, y, w: moduleW, h: moduleD }, freeRect)) return;
              const carpet = { x: x + pad / 2, y: y + pad / 2, w: carpetW, h: carpetD };
              const module = options.carpetModule(carpet);
              if (!options.moduleClear(module, request.id, request, placementContext, g)) return;
              const balconyTouches = (g.balconies || []).filter(balcony => options.balconyTouches(module, balcony));
              if (balconyTouches.length && !options.balconyEligible(request)) return;
              if (!options.hardAdjacencyValid(placed.concat({ req: request, module }))) return;
              const deviation = Math.abs(carpetW * carpetD - preferredW * preferredD) /
                Math.max(preferredW * preferredD, eps);
              const short = Math.min(freeRect.w - moduleW, freeRect.h - moduleD);
              const long = Math.max(freeRect.w - moduleW, freeRect.h - moduleD);
              const serviceRank = options.servicePlacementRank(request,
                { x, y, w: moduleW, h: moduleD }, placed, keepClear);
              const score = [
                ...serviceRank,
                options.directionPenalty(request, module, g),
                options.adjacencyPenalty(request, module, placed),
                -balconyTouches.length,
                deviation,
                options.rolePenalty(request, x, y, moduleW, moduleD, g),
                short, long, y, x, rotated ? 1 : 0
              ];
              if (options.scoreLess(score, best?.score))
                best = { req: request, x, y, mw: moduleW, md: moduleD, cw: carpetW, cd: carpetD,
                  rotated, minW, minD, maxW, maxD, dev: deviation, score };
            });
          });
        });
        if (!best) {
          unmet.push(request);
          return;
        }
        const carpet = { x: best.x + pad / 2, y: best.y + pad / 2, w: best.cw, h: best.cd };
        const module = options.carpetModule(carpet);
        placed.push({ ...best, module, carpet });
        totalDeviation += best.dev;
        if (request.reserveFootprint)
          serviceFree = options.subtractFree(serviceFree, options.occupiedBounds({ req: request, module, carpet }));
        else free = options.subtractFree(free, module);
      });

      const plan = { placed, unmet, free, totalDeviation, index };
      options.recalculatePlan(plan, g);
      const unattached = options.balconyAttachments(placed, g.balconies)
        .filter(attachment => !attachment.eligible.length || attachment.ineligible.length).length;
      const by = type => unmet.filter(item => item.type === type).length;
      const inaccessible = options.circulationAnalysis(g, plan).inaccessible.length;
      const directionPenalty = placed.reduce((sum, item) => sum + options.directionPenalty(item.req, item.module, g), 0);
      const score = [
        by('living'), inaccessible, by('bedroom'), by('kitchen'), by('pooja'),
        by('bathroom'), by('staircase'), by('lift'), unmet.length, unattached,
        directionPenalty, totalDeviation, -plan.carpetArea, plan.unassigned, index
      ];
      return { ...plan, score };
    }

    function packProgram(g, config, requests) {
      if (!Array.isArray(requests)) throw new Error('Layout generator requires an explicit request list.');
      const attempts = [
        ['preferred', 'large'], ['minimum', 'large'],
        ['preferred', 'service'], ['minimum', 'privacy']
      ].map((attempt, index) => packAttempt(g, requests, attempt[0], attempt[1], index));
      const best = attempts.reduce((current, attempt) =>
        options.scoreLess(attempt.score, current?.score) ? attempt : current, null);
      options.assignBalconies(best, g);
      options.optimizeLeftovers(best, g);
      options.assignBalconies(best, g, false);
      return options.recalculatePlan(best, g);
    }

    return Object.freeze({ order, packAttempt, packProgram });
  }

  return Object.freeze({ create });
});
