async (page) => {
  const context = await page.context().browser().newContext();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    const legacy = await context.newPage();
    await legacy.goto('http://127.0.0.1:5174/index.html', { waitUntil: 'domcontentloaded' });
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms?.length > 0);
    const project = await legacy.evaluate(() => JSON.parse(window.HomePlanner.exportProject()));
    const native = await context.newPage(), errors = [];
    native.on('pageerror', error => errors.push(error.message));
    await native.goto('http://127.0.0.1:5174/platform.html', { waitUntil: 'domcontentloaded' });
    for (const asset of ['sun-model.js', 'sun-exposure.js', 'building-physics.js', 'vendor/suncalc-2.0.1.js']) {
      const response = await native.request.get(`http://127.0.0.1:5174/classic/${asset}`);
      check(response.ok(), `Missing classic sunlight asset ${asset}`);
    }
    await native.evaluate(async () => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js');
      const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { NativeDesign } = await import('/src/platform/NativeDesign.tsx');
      const { HouseSunStudy } = await import('/src/platform/HouseSunStudy.tsx');
      const host = document.createElement('div');
      document.body.append(host);
      window.houseCache = { document: null };
      function Fixture() {
        const [planner, setPlanner] = React.useState(null);
        const [date, setDate] = React.useState('2026-09-15');
        const [record, setRecord] = React.useState({project_id:'disposable-independent-account',version:1,
          document:{site:{latitude:null,longitude:null,time_zone:null,obstacles:[],width:null,depth:null,units:'m'}}});
        window.houseRecord = setRecord;
        window.houseDate = setDate;
        const onPlanner = React.useCallback(value => { window.housePlanner = value; setPlanner(value); }, []);
        return React.createElement(React.Fragment, null,
          React.createElement(NativeDesign, { cache: window.houseCache, onPlannerChange: onPlanner }),
          React.createElement(HouseSunStudy, { planner, date, record }));
      }
      window.houseRoot = DOM.createRoot(host);
      window.houseRoot.render(React.createElement(Fixture));
    });
    await native.locator('.native-design input[type="file"]').setInputFiles({
      name: 'actual-isolated-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
    });
    await native.waitForFunction(() => !!window.housePlanner?.getScene()?.rooms?.length);
    check(!errors.length, `Mount errors: ${errors.join('; ')}`);
    const before = await native.evaluate(() => window.housePlanner.exportProject());
    const house = native.getByRole('region', { name: 'Whole house direct sunlight and shading' });
    await house.getByLabel(/^House study location source/).selectOption('design');
    await house.getByLabel(/^House obstruction source/).selectOption('legacy');
    await house.getByText('I reviewed the selected location', { exact: false }).click();
    await house.getByRole('button', { name: 'Calculate house direct sun hours', exact: true }).click();
    await house.getByRole('alert').filter({ hasText: 'front side is unknown' }).waitFor();
    for (const side of ['front', 'right', 'rear', 'left']) {
      await house.getByLabel(`${side} neighbour state`, { exact: true }).selectOption('clear');
    }
    await house.getByRole('button', { name: 'Calculate house direct sun hours', exact: true }).click();
    await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).waitFor();
    const rows = await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).locator('tbody tr').allTextContents();
    check(rows.length >= 5, 'Actual roof/wall sunlight groups not displayed.');
    check(rows.some(row => row.includes('Exposed roof / terrace')), 'No actual roof result.');
    check(await native.evaluate(() => window.housePlanner.exportProject()) === before, 'Study changed the actual project.');
    const preview = house.getByRole('slider', { name: 'House direct sun time trend', exact: true });
    await preview.fill('0');
    check((await house.textContent()).includes('0.000 cumulative direct sun h'), 'Time slider did not show actual night/initial cumulative hours.');
    check(await native.evaluate(() => window.housePlanner.exportProject()) === before, 'Preview changed project.');
    const clearRoof = Number((await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).locator('tbody tr')
      .filter({ hasText: 'Exposed roof / terrace' }).first().locator('td').nth(1).textContent()).trim());
    await house.getByLabel('front neighbour state', { exact: true }).selectOption('block');
    check(await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).count() === 0, 'Neighbour edit kept stale result.');
    await house.getByLabel('front block height m', { exact: true }).fill('30');
    await house.getByLabel('front net-plot boundary gap m', { exact: true }).fill('0');
    await house.getByRole('button', { name: 'Calculate house direct sun hours', exact: true }).click();
    await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).waitFor();
    const blockRoof = Number((await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).locator('tbody tr')
      .filter({ hasText: 'Exposed roof / terrace' }).first().locator('td').nth(1).textContent()).trim());
    check(blockRoof < clearRoof, `Neighbour screen did not reduce real roof sunlight: ${blockRoof} vs ${clearRoof}.`);
    const registration = await native.evaluate(() => {
      const scene=window.housePlanner.getScenes()[0],project=window.housePlanner.getProject();
      const heading=scene.headingDeg,w=scene.plot.w,h=scene.plot.h;
      const quarter=heading===90||heading===270;
      const width=quarter?h:w,depth=quarter?w:h;
      const x=heading===180||heading===270?w:0,y=heading===90||heading===180?h:0;
      const site={width,depth,units:'m',latitude:project.site.latitude,longitude:project.site.longitude,time_zone:project.site.timeZone,obstacles:[]};
      window.houseAppliedSite=site;
      window.houseRecord({project_id:'disposable-independent-account',version:2,document:{site}});
      return {x,y,width,depth};
    });
    await house.getByLabel(/^House study location source/).selectOption('native');
    await house.getByLabel(/^House obstruction source/).selectOption('site');
    await house.getByLabel('Site gross NW in Design net-plot-local x (m)', {exact:true}).fill(String(registration.x));
    await house.getByLabel('Site gross NW in Design net-plot-local y (m)', {exact:true}).fill(String(registration.y));
    await house.getByLabel('Site base datum offset into Design ground (m)', {exact:true}).fill('0');
    await house.getByText('I registered these coordinate origins/datum', {exact:false}).click();
    await house.getByText('I reviewed the selected location', {exact:false}).click();
    await house.getByRole('button', {name:'Calculate house direct sun hours',exact:true}).click();
    await house.getByRole('region', {name:'House sunlight hours by actual modeled surface'}).waitFor();
    const siteClearRoof=Number((await house.getByRole('region', {name:'House sunlight hours by actual modeled surface'}).locator('tbody tr')
      .filter({hasText:'Exposed roof / terrace'}).first().locator('td').nth(1).textContent()).trim());
    await native.evaluate(({width,depth})=>{
      const obstacle={id:'actual-authored-across-road',name:'Authored across-road building',kind:'cuboid',x:width+1,y:-2,
        width_m:3,depth_m:depth+4,height_m:30,base_m:0,transmission:0};
      window.houseAppliedSite={...window.houseAppliedSite,obstacles:[obstacle]};
      window.houseRecord({project_id:'disposable-independent-account',version:3,document:{site:window.houseAppliedSite}});
    },registration);
    await house.getByRole('region', {name:'House sunlight hours by actual modeled surface'}).waitFor({state:'hidden'});
    await house.getByText('I registered these coordinate origins/datum', {exact:false}).click();
    await house.getByText('I reviewed the selected location', {exact:false}).click();
    await house.getByRole('button', {name:'Calculate house direct sun hours',exact:true}).click();
    await house.getByRole('region', {name:'House sunlight hours by actual modeled surface'}).waitFor();
    const siteBlockedRoof=Number((await house.getByRole('region', {name:'House sunlight hours by actual modeled surface'}).locator('tbody tr')
      .filter({hasText:'Exposed roof / terrace'}).first().locator('td').nth(1).textContent()).trim());
    check(siteBlockedRoof<siteClearRoof,`Saved Site Environment caster did not reduce roof sunlight ${siteBlockedRoof} vs ${siteClearRoof}`);
    check(await native.evaluate(()=>window.housePlanner.exportProject())===before,'Saved Site study mutated Design project.');
    await native.evaluate(async()=>{
      const {sharedWeatherCommand}=await import('/src/platform/shared-environment.ts');
      const weather={id:'disposable-source',kind:'tmy',source:{name:'Explicit hypothetical irradiance fixture'},
        units:{dniWm2:'W/m2',dhiWm2:'W/m2',ghiWm2:'W/m2'},
        records:[{timestamp:'2001-09-15T04:00:00Z',durationSeconds:3600,dniWm2:800,dhiWm2:100,ghiWm2:700},
          {timestamp:'2001-09-15T05:00:00Z',durationSeconds:3600,dniWm2:null,dhiWm2:100,ghiWm2:700}]};
      window.housePlanner.execute(await sharedWeatherCommand(window.housePlanner,'json',JSON.stringify(weather)));
      window.housePlanner.execute({type:'set-environment',patch:{solar:{groundAlbedo:.3},glazing:{shgc:.45,source:'Shared hypothetical Materials'}}});
    });
    // Shared authored environment may invalidate the daily study; rerun explicitly, never automatically.
    if(!await house.getByRole('region',{name:'House sunlight hours by actual modeled surface'}).count()){
      await house.getByRole('checkbox',{name:/I reviewed the selected location/}).check();
      await house.getByRole('button',{name:'Calculate house direct sun hours',exact:true}).click();
      await house.getByRole('region',{name:'House sunlight hours by actual modeled surface'}).waitFor();
    }
    const weatherBefore=await native.evaluate(()=>window.housePlanner.exportProject());
    await house.getByRole('button',{name:'Calculate shared-weather irradiance snapshot',exact:true}).click();
    const irradiance=house.getByRole('region',{name:'Actual house weather irradiance by surface'});
    await irradiance.waitFor();
    const irradianceRows=await irradiance.locator('tbody tr').count();
    check(irradianceRows>=5,'Missing actual per-surface irradiance.');
    const receiverEvidence=await irradiance.locator('tbody tr').evaluateAll(rows=>rows.map(row=>{
      const cells=[...row.querySelectorAll('td')].map(cell=>cell.textContent.trim());
      return {label:row.querySelector('th').textContent,area:Number(cells[0]),beam:Number(cells[2]),
        diffuse:Number(cells[3]),ground:Number(cells[4]),incident:Number(cells[5]),gain:cells[6]};
    }));
    check(receiverEvidence.every(row=>Math.abs(row.incident-row.beam-row.diffuse-row.ground)<.03),'Displayed W/m² components do not sum.');
    const windowReceiver=receiverEvidence.find(row=>row.label.includes('/ window /'));
    check(windowReceiver&&windowReceiver.gain!=='Not evaluated','Known shared SHGC gain missing on actual window.');
    check(Math.abs(Number(windowReceiver.gain)-windowReceiver.incident*windowReceiver.area*.45)<2,'Constant-SHGC W conversion wrong.');
    check((await house.textContent()).includes('2001-09-15T03:30:00.000Z'),'TMY source year or exact UTC midpoint was silently remapped.');
    check((await house.textContent()).includes('not Wh/m²'),'Irradiance unit caveat missing.');
    check(await native.evaluate(()=>window.housePlanner.exportProject())===weatherBefore,'Irradiance mutated shared project.');
    await house.getByLabel(/^Shared weather source interval index/).fill('1');
    await irradiance.waitFor({state:'hidden'});
    await house.getByRole('button',{name:'Calculate shared-weather irradiance snapshot',exact:true}).click();
    await house.getByRole('alert').filter({hasText:'missing dniWm2'}).waitFor();
    await house.getByLabel(/^Shared weather source interval index/).fill('0');
    await house.getByRole('button',{name:'Calculate shared-weather irradiance snapshot',exact:true}).click();
    await irradiance.waitFor();
    await native.evaluate(()=>window.housePlanner.execute({type:'set-environment',patch:{glazing:{shgc:.5,source:'Changed Materials'}}}));
    await irradiance.waitFor({state:'hidden'});
    await native.evaluate(() => window.houseDate('2026-12-21'));
    await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).waitFor({ state: 'hidden' });
    check(await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).count() === 0, 'Date edit retained stale hours.');
    await house.getByRole('button', { name: 'Calculate house direct sun hours', exact: true }).click();
    await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).waitFor();
    await native.evaluate(()=>window.housePlanner.execute({type:'add-floor',copyFromId:window.housePlanner.getProject().activeFloorId}));
    await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).waitFor({ state: 'hidden' });
    check(await house.getByRole('region', { name: 'House sunlight hours by actual modeled surface' }).count() === 0, 'Actual floor edit retained stale house sunlight.');
    check(await native.evaluate(() => window.housePlanner.getProject().floors.length) === 2, 'Actual duplication did not happen.');
    check(!errors.length, `Browser errors: ${errors.join('; ')}`);
    await native.evaluate(() => window.houseRoot.unmount());
    return { actualSurfaceRows: rows.length, clearRoofHours: clearRoof, blockedRoofHours: blockRoof,
      unknownNeighbourRejected: true, projectUnchangedByStudy: true, actualCumulativeSlider: true,
      dateStaleDiscarded: true, floorEditStaleDiscarded: true, classicAssets: true,
      savedSiteClearRoofHours:siteClearRoof,savedSiteBlockedRoofHours:siteBlockedRoof,appliedObstacleEditInvalidated:true,explicitRegistration:true,
      irradianceRows,windowGainW:Number(windowReceiver.gain),componentSumVerified:true,
      sharedWeatherMidpoint:true,irradianceProjectUnchanged:true,missingRadiationRejected:true,materialsInvalidatedIrradiance:true,errors };
  } finally { await context.close(); }
}
