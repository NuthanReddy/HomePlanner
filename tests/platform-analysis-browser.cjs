'use strict';
// Standalone isolated-context parity check; never opens a saved browser profile.
async function runAnalysisBrowser(browser,baseURL,project){
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],workers=[],requests=[];
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  page.on('pageerror',error=>errors.push(error.message));
  page.on('worker',worker=>workers.push(worker.url()));
  page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests.push(request.url());});
  await context.route('**/__analysis-fixture.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(project)}));
  await context.route('**/api/cfd/runtime',route=>route.fulfill({status:503,contentType:'application/json',
    body:JSON.stringify({error:{message:'Synthetic fixture: local OpenFOAM runtime is not installed.'}})}));
  const tab=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();};
  try{
    await page.goto(new URL('/tests/fixtures/native-analysis-browser.html',baseURL).href,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.getElementById('workspaceCfd')?.homePlannerCFD);
    check(await page.evaluate(()=>!window.HomePlanner),'The adapter must not install a second global planner.');
    check(workers.length===0&&requests.length===0,'Mount/navigation started a worker or API request.');
    const original=await page.evaluate(()=>window.__analysisFixture.planner.exportProject());
    await page.evaluate(()=>{
      const site=window.__analysisFixture.planner.getProject().site;
      const date='2026-09-15',clock='11:00',instant=window.HomeSun.resolveLocal(date,clock,site.timeZone,'').instant.toISOString();
      // Synthetic computed-selection envelope: engine physics is not asserted here.
      const offsetMinutes=(Date.parse(`${date}T${clock}:00Z`)-Date.parse(instant))/60000;
      const offset=`${offsetMinutes<0?'-':'+'}${String(Math.floor(Math.abs(offsetMinutes)/60)).padStart(2,'0')}:${String(Math.abs(offsetMinutes)%60).padStart(2,'0')}`;
      const localTime=`${date}T${clock}:00${offset}`;
      window.__analysisFixture.setSolarSource({blocked:false,
        record:{project_id:'fixture-account',version:1,document:{site:{latitude:site.latitude,longitude:site.longitude,time_zone:site.timeZone}}},
        result:{project_id:'fixture-account',version:1,result:{
          inputs:{latitude:site.latitude,longitude:site.longitude,timeZone:site.timeZone,date,localClock:clock,occurrence:null},
          output:{selected:{instantUTC:instant,localTime}},engine:{name:'synthetic transport',version:'1'}}}});
    });
    await page.locator('#light-sun-path').evaluate(node=>{
      for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    });
    await page.locator('#light-sun-path').click();
    check(await page.locator('#light-date').inputValue()==='2026-09-15','Native Solar selection was not copied.');
    check(await page.locator('#light-startTime').inputValue()==='11:00','Native Solar clock was not copied.');
    check(workers.length===0&&requests.length===0,'Copying Solar selection ran a study.');
    await page.evaluate(()=>window.__analysisFixture.setSolarSource(null));
    await page.locator('#light-sun-path').click();
    check((await page.locator('#light-error').innerText()).includes('Calculate the current Solar selection'),'Cleared native Solar source was reused.');
    check(await page.locator('#light-date').inputValue()==='2026-09-15','Rejected source lost the prior accepted draft.');
    await page.locator('#light-whole-house').click();
    await page.waitForFunction(()=>!document.getElementById('workspaceLightStudy').lightController.getState().busy);
    const light=await page.evaluate(()=>{
      const controller=document.getElementById('workspaceLightStudy').lightController,state=controller.getState();
      return {error:state.error,result:!!state.result,planes:state.draft.workplanes.length,history:state.history.length,
        export:!!controller.exportData('svg')};
    });
    check(light.result&&light.export,`Light worker/display failed: ${light.error}`);
    await page.locator('#light-viewport img').waitFor({state:'visible'});
    check(await page.locator('#light-viewport img').evaluate(image=>image.naturalWidth>0),'Light SVG did not load.');
    await tab('Airflow');
    await page.locator('#hp-airflow-whole-house').click();
    await page.locator('#hp-airflow-plan-areas').click();
    await page.evaluate(()=>{
      const controller=document.getElementById('workspaceAirflow').homePlannerAirflow,draft=controller.getState().draft;
      controller.setDraft({densityKgM3:1.2,links:draft.links.map(link=>({...link,cd:0.6,pressurePa:0}))});
    });
    await page.locator('#hp-airflow-run').click();
    await page.waitForFunction(()=>!document.getElementById('workspaceAirflow').homePlannerAirflow.getState().busy);
    const airflow=await page.evaluate(()=>{
      const controller=document.getElementById('workspaceAirflow').homePlannerAirflow,state=controller.getState();
      return {error:state.error,result:!!state.result,rooms:state.draft.zones.length,export:!!controller.exportData('csv')};
    });
    check(airflow.result&&airflow.export,`Airflow worker failed: ${airflow.error}`);
    check(await page.evaluate(()=>window.__analysisFixture.planner.exportProject())===original,'Light/Airflow altered the physical project.');
    await tab('Thermal & energy');
    await page.locator('[data-native-thermal] [data-action="prepare"]').click();
    const input=JSON.parse(await page.locator('#native-thermal-input').inputValue());
    input.zones.forEach(zone=>Object.assign(zone,{capacityJ_K:10000,initialC:20,outsideConductanceW_K:0}));
    input.links.forEach(link=>{link.conductanceW_K=0;});
    input.steps=[{durationSeconds:60,outdoorC:10,gainsW:Object.fromEntries(input.zones.map(zone=>[zone.id,100]))}];
    await page.locator('#native-thermal-input').fill(JSON.stringify(input));
    await page.locator('#native-thermal-notes').fill('Explicit synthetic equation fixture; no real-building forecast.');
    await page.locator('[data-native-thermal] [data-ack]').check();
    await page.locator('[data-native-thermal] button[type="submit"]').click();
    check((await page.locator('[data-native-thermal] [data-result]').innerText()).includes('Hypothetical RC-state temperatures'),'Thermal result missing.');
    const thermalError=await page.locator('[data-native-thermal] [data-error]').isVisible();
    check(!thermalError,'Thermal form failed.');
    const download=page.waitForEvent('download');
    await page.locator('[data-native-thermal] [data-action="export"]').click();
    check((await download).suggestedFilename()==='homeplanner-thermal-analysis.json','Wrong export identity.');
    await page.evaluate(()=>window.__analysisFixture.planner.undo());
    check(!(await page.locator('[data-native-thermal] [data-result]').innerText()).includes('Hypothetical RC-state temperatures'),'Undo left stale thermal evidence.');
    await page.evaluate(()=>window.__analysisFixture.planner.redo());
    check((await page.locator('[data-native-thermal] [data-result]').innerText()).includes('Hypothetical RC-state temperatures'),'Redo failed to restore matching evidence.');
    await page.locator('#native-thermal-notes').fill('Retained tab draft');
    await tab('Other');await tab('Thermal & energy');
    check(await page.locator('#native-thermal-notes').inputValue()==='Retained tab draft','Navigation lost unapplied input.');
    await tab('Pressure / CFD');
    check(requests.length===0,'Visiting CFD started a service request.');
    await page.locator('[data-cfd-action="checkEngine"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-cfd-engine]').textContent.includes('not installed'));
    check(await page.locator('[data-cfd-action="run"]').isDisabled(),'Missing engine enabled Run.');
    const cfdBefore=await page.evaluate(()=>window.__analysisFixture.planner.getProject().revision);
    await page.locator('[data-cfd-action="save"]').click();
    check(await page.evaluate(()=>window.__analysisFixture.planner.getProject().revision)===cfdBefore+1,'CFD Save did not use one command.');
    const widths=[];
    for(const name of ['Light','Airflow','Pressure / CFD','Thermal & energy']){
      await page.setViewportSize({width:390,height:844});await tab(name);
      const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
      widths.push({name,...width});check(width.scroll<=width.viewport+1,`${name} has mobile page overflow (${width.scroll}).`);
    }
    await page.evaluate(()=>window.__analysisFixture.remount());
    await page.waitForFunction(()=>document.getElementById('workspaceCfd')?.homePlannerCFD);
    await tab('Pressure / CFD');
    const remountBefore=await page.evaluate(()=>window.__analysisFixture.planner.getProject().revision);
    await page.locator('[data-cfd-input="sourceNote"]').fill('Remounted synthetic fixture input');
    await page.locator('[data-cfd-action="save"]').click();
    check(await page.evaluate(()=>window.__analysisFixture.planner.getProject().revision)===remountBefore+1,'CFD remount failed or duplicated handlers.');
    await tab('Light');await page.locator('#light-whole-house').click();
    await page.waitForFunction(()=>!document.getElementById('workspaceLightStudy').lightController.getState().busy);
    await page.locator('#light-clear').click();
    check(await page.evaluate(()=>document.getElementById('workspaceLightStudy').lightController.getState().result===null),'Clear left numerical evidence.');
    check(errors.length===0,errors.join('\n'));
    return {light,airflow,thermal:true,cfdUnavailable:true,remount:true,widths,workers:workers.length,explicitRequests:requests.length,errors};
  }finally{await context.close();}
}
module.exports={runAnalysisBrowser};
if(typeof require!=='undefined'&&require.main===module){
  const {chromium}=require(process.env.HOMEPLANNER_PLAYWRIGHT_MODULE||'playwright');
  const {createFixture}=require('./fixtures/drawing-fixtures.cjs');
  const project=createFixture('multiple-floors').project;
  for(const floor of project.floors)floor.legacy.context.plate.sitePlot={x:-1,y:-2,w:12,h:12};
  project.legacy=JSON.parse(JSON.stringify(project.floors[0].legacy));
  (async()=>{
    const browser=await chromium.launch({channel:process.env.HOMEPLANNER_BROWSER_CHANNEL||'msedge'});
    try{console.log(JSON.stringify(await runAnalysisBrowser(browser,process.env.HOMEPLANNER_PLATFORM_URL||'http://127.0.0.1:5173',project),null,2));}
    finally{await browser.close();}
  })().catch(error=>{console.error(error);process.exitCode=1;});
}
