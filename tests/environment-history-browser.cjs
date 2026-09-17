const assert=require('node:assert/strict');

async function solarWindHistory(page){
  const failures=[],checks=[];
  const check=(name,condition)=>{checks.push(name);if(!condition)failures.push(name);};
  const route=destination=>page.evaluate(value=>HomePlannerWorkspace.navigate(value),destination);
  const project=()=>page.evaluate(()=>HomePlanner.getProject());
  const passive=async work=>{
    const before=await page.evaluate(()=>window.__environmentCalls);
    await work();
    assert.deepEqual(await page.evaluate(()=>window.__environmentCalls),before,'Restoration must not rerun any Environment numerical study');
  };
  const replace=value=>passive(()=>page.evaluate(snapshot=>HomePlanner.replaceProject(snapshot),value));
  const history=action=>passive(()=>page.evaluate(method=>HomePlanner[method](),action));
  const text=id=>page.locator(`#${id}`).textContent();
  const discard=async name=>{
    if(await page.locator(`#env-${name}-form`).getAttribute('data-dirty')==='true')
      page.once('dialog',dialog=>dialog.accept());
    await page.locator(`#env-${name}-form-reload`).click();
  };
  const submit=async name=>{
    await page.locator(`#env-${name}-form button[type="submit"]`).click();
    await page.waitForFunction(id=>document.getElementById(id).dataset.dirty!=='true',`env-${name}-form`);
    assert.equal(await page.locator(`#env-${name}-error`).isVisible(),false);
  };
  const holdMonth=async()=>{
    await page.evaluate(()=>{
      const set=window.setTimeout;
      window.__resumeEnvironmentMonth=null;
      window.setTimeout=function(callback,delay,...args){
        if(delay===0&&document.getElementById('env-monthly').disabled&&!window.__resumeEnvironmentMonth){
          window.setTimeout=set;
          window.__resumeEnvironmentMonth=()=>new Promise(done=>set(()=>{
            callback(...args);queueMicrotask(()=>queueMicrotask(done));
          },0));
          return 0;
        }
        return set(callback,delay,...args);
      };
    });
    await page.locator('#env-monthly').click();
    await page.waitForFunction(()=>typeof window.__resumeEnvironmentMonth==='function');
    return async()=>{
      await page.evaluate(()=>window.__resumeEnvironmentMonth());
      await page.waitForFunction(()=>!document.getElementById('env-monthly').disabled);
    };
  };
  await route('environment/solar');
  await page.locator('#env-solar-date').fill('2024-06-21');
  await page.locator('#env-solar-time').fill('09:00');
  await submit('solar');
  const solarFirst=await project(),solarFirstText=await text('env-solar-results');
  await page.locator('#env-solar-time').fill('15:00');
  await submit('solar');
  const solarSecond=await project(),solarSecondText=await text('env-solar-results');
  assert.notEqual(solarFirstText,solarSecondText,'The two real solar evaluations must be distinguishable');
  assert.equal(solarSecond.revision,solarFirst.revision+1);
  await history('undo');
  assert.equal(await page.locator('#env-solar-time').inputValue(),'09:00');
  assert.deepEqual((await project()).environment.results.solar,solarFirst.environment.results.solar);
  check('Solar Undo restores the displayed result with its input',await text('env-solar-results')===solarFirstText);
  await history('redo');
  check('Solar Redo restores the displayed result with its input',await text('env-solar-results')===solarSecondText);
  await replace(solarFirst);
  check('Same-ID replacement restores the saved solar display',await text('env-solar-results')===solarFirstText);
  const missingSolar=structuredClone(solarFirst);delete missingSolar.environment.results.solar;
  await replace(missingSolar);
  check('Missing saved solar evidence clears the old table',await page.locator('#env-solar-results table').count()===0);
  assert.match(await text('env-solar-status'),/unavailable|stale/i);
  const unknownSolar=structuredClone(solarFirst);
  unknownSolar.environment.results.solar.output.floors[0].shadow.receivers[0].sunlitFraction=null;
  await replace(unknownSolar);
  check('Unknown saved beam fractions are not rendered as zero',await page.locator('#env-solar-results tbody tr').first().locator('td').nth(4).textContent()==='Not evaluated');
  unknownSolar.environment.results.solar.output.floors[0].shadow.receivers[0].sunlitFraction=0;
  await replace(unknownSolar);
  check('Explicit zero saved beam fractions remain zero',await page.locator('#env-solar-results tbody tr').first().locator('td').nth(4).textContent()==='0%');
  const incompleteSolar=structuredClone(solarFirst);incompleteSolar.environment.results.solar.output={};
  await replace(incompleteSolar);
  check('Incomplete stored solar output is visibly unsupported',/incomplete|unsupported/.test(await text('env-solar-results'))&&await page.locator('#env-solar-results table').count()===0);
  await replace(solarFirst);
  await page.locator('#env-solar-time').fill('10:00');
  await passive(()=>discard('solar'));
  check('Discarding solar fields restores matching saved evidence',await text('env-solar-results')===solarFirstText);
  await page.locator('#env-solar-time').fill('10:00');
  const otherSolar=structuredClone(solarFirst);otherSolar.id+='-other';
  await replace(otherSolar);await replace(solarFirst);
  assert.equal(await page.locator('#env-solar-time').inputValue(),'10:00');
  check('Restored pending solar fields never inherit the saved table',await page.locator('#env-solar-results table').count()===0);
  await discard('solar');
  await page.locator('#env-radiation-mode').selectOption('manual');
  const beforeFailure=await project();
  await page.locator('#env-solar-form button[type="submit"]').click();
  assert.equal(await page.locator('#env-solar-error').isVisible(),true);
  assert.deepEqual(await project(),beforeFailure);
  check('A rejected solar calculation does not keep a calculating status',!/Calculating/i.test(await text('env-solar-status')));
  await discard('solar');

  await route('environment/airflow');
  await page.locator('#env-wind-tools summary').first().click();
  await page.locator('#env-wind-source').selectOption('manual');
  await page.locator('#env-wind-bearing').fill('0');
  await page.locator('#env-wind-speed').fill('3');
  await submit('wind');
  const windFirst=await project(),roseFirst=await text('env-wind-rose'),proposalsFirst=await text('env-window-proposals');
  assert.ok(windFirst.environment.results.wind.output.proposals.length,'The actual room must offer a reviewable wall proposal');
  await page.locator('#env-wind-bearing').fill('180');
  await page.locator('#env-wind-speed').fill('5');
  await submit('wind');
  const windSecond=await project(),roseSecond=await text('env-wind-rose'),proposalsSecond=await text('env-window-proposals');
  assert.notEqual(roseFirst,roseSecond);
  assert.notEqual(proposalsFirst,proposalsSecond);
  assert.equal(windSecond.revision,windFirst.revision+1);
  await page.locator('[data-env-preview]').first().click();
  await history('undo');
  assert.equal(await page.locator('#env-wind-bearing').inputValue(),'0');
  check('Wind Undo restores the rose and proposal list',await text('env-wind-rose')===roseFirst&&await text('env-window-proposals')===proposalsFirst);
  check('Wind Undo revokes the newer proposal preview',await page.locator('#env-window-apply').count()===0);
  await history('redo');
  check('Wind Redo restores the rose and proposal list',await text('env-wind-rose')===roseSecond&&await text('env-window-proposals')===proposalsSecond);
  await replace(windFirst);
  check('Same-ID replacement restores the saved wind display',await text('env-wind-rose')===roseFirst&&await text('env-window-proposals')===proposalsFirst);
  const missingWind=structuredClone(windFirst);delete missingWind.environment.results.wind;
  await replace(missingWind);
  check('Missing saved wind evidence clears the rose and proposals',await page.locator('#env-wind-rose svg,[data-env-preview],#env-window-apply').count()===0);
  assert.match(await text('env-wind-status'),/unavailable|stale/i);
  const incompleteWind=structuredClone(windFirst);incompleteWind.environment.results.wind.output.rose={};
  await replace(incompleteWind);
  check('Incomplete stored wind output is visibly unsupported',/incomplete|unsupported/.test(await text('env-wind-status'))&&await page.locator('#env-wind-rose svg,[data-env-preview]').count()===0);
  await replace(windFirst);
  await page.locator('#env-wind-speed').fill('7');
  const otherWind=structuredClone(windFirst);otherWind.id+='-other';
  await replace(otherWind);await replace(windFirst);
  assert.equal(await page.locator('#env-wind-speed').inputValue(),'7');
  check('Restored pending wind fields never inherit saved evidence',await page.locator('#env-wind-rose svg,[data-env-preview]').count()===0);
  await passive(()=>discard('wind'));
  check('Discarding wind fields restores matching saved evidence',await text('env-wind-rose')===roseFirst&&await text('env-window-proposals')===proposalsFirst);
  await page.locator('[data-env-preview]').first().click();
  const previewCommand=JSON.parse(await page.locator('#env-window-preview pre').textContent());
  await passive(()=>page.evaluate(()=>HomePlanner.execute({type:'rename-project',name:'Environment lifecycle fixture'})));
  assert.deepEqual(JSON.parse(await page.locator('#env-window-preview pre').textContent()),previewCommand,'A rename must preserve a still-current preview');
  await page.locator('#env-window-dismiss').click();

  await route('site/context');
  await page.locator('#env-weather-file').setInputFiles({name:'synthetic-environment-history.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({kind:'scenario',source:{label:'Synthetic lifecycle fixture, not observations'},
      records:[{timestamp:'2024-06-21T04:00:00Z',durationSeconds:3600,dniWm2:500,dhiWm2:100,ghiWm2:600,windSpeedMps:3,windFromDeg:90},
        {timestamp:'2024-06-21T05:00:00Z',durationSeconds:3600,dniWm2:550,dhiWm2:110,ghiWm2:650,windSpeedMps:4,windFromDeg:90}]}))});
  await page.waitForFunction(()=>!!HomePlanner.getProject().environment.weather);
  await route('environment/solar');
  await page.locator('#env-radiation-mode').selectOption('weather');
  await submit('solar');
  const weatherSolar=await text('env-solar-results');
  await route('environment/airflow');
  await page.locator('#env-wind-source').selectOption('weather');
  await submit('wind');
  const weatherRose=await text('env-wind-rose'),weatherSnapshot=await project();
  await route('site/context');
  await page.locator('#env-weather-clear').click();
  assert.equal((await project()).environment.weather,null);
  check('Clear weather withdraws dependent solar and wind displays',
    await page.locator('#env-solar-results table,#env-wind-rose svg,[data-env-preview]').count()===0);
  await history('undo');
  assert.deepEqual((await project()).environment.weather,weatherSnapshot.environment.weather);
  check('Undo Clear weather restores matching solar and wind displays',
    await text('env-solar-results')===weatherSolar&&await text('env-wind-rose')===weatherRose);
  await route('environment/solar');
  await submit('solar');
  await route('environment/airflow');
  await submit('wind');
  const verifiedWeather=await project(),divergentWeather=structuredClone(verifiedWeather);
  divergentWeather.environment.weather.records[0].dniWm2=750;
  divergentWeather.environment.weather.records[0].windFromDeg=270;
  await replace(divergentWeather);
  check('Changed records with the same weather ID cannot reuse old evidence',
    await page.locator('#env-solar-results table,#env-wind-rose svg,[data-env-preview]').count()===0);
  await route('report/exports');
  await page.evaluate(()=>{
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
    URL.createObjectURL=blob=>{window.__environmentExportText=blob.text();return 'blob:environment-history-fixture';};
    HTMLAnchorElement.prototype.click=function(){
      if(this.download!=='homeplanner-environment-analysis-v1.json')return click.call(this);
    };
    window.__restoreEnvironmentExport=()=>{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;};
  });
  try{
    await passive(()=>page.locator('#env-export').click());
    const exported=await page.evaluate(async()=>JSON.parse(await window.__environmentExportText));
    for(const name of ['solar','wind']){
      assert.equal(exported.environment.results[name].currentGeometry,true);
      assert.equal(exported.environment.results[name].currentInputs,false);
      assert.match(exported.environment.results[name].staleReason,/inputs differ/);
    }
    check('Analysis export flags same-ID changed-weather evidence as stale',true);
  }finally{await page.evaluate(()=>window.__restoreEnvironmentExport());}
  await replace(weatherSnapshot);

  await route('environment/solar');
  await page.locator('#env-record-index').fill('2');
  await page.locator('#env-use-record').click();
  assert.equal(await page.locator('#env-solar-time').inputValue(),'10:00');
  check('Use record midpoint registers an owner-qualified solar draft',await page.evaluate(()=>
    HomePlannerDrafts.pending(HomePlanner).some(scope=>scope.entityId==='env-solar-form')));
  const otherWeather=structuredClone(weatherSnapshot);otherWeather.id+='-other';
  await replace(otherWeather);await replace(weatherSnapshot);
  check('A record-midpoint solar draft survives a project round trip',await page.locator('#env-solar-time').inputValue()==='10:00');
  await discard('solar');
  await page.locator('#env-radiation-mode').selectOption('none');
  await page.locator('#env-solar-date').fill('2025-06-21');
  await submit('solar');
  const monthlyBefore=await project();
  const resumeUndo=await holdMonth();
  await history('undo');
  const monthlyRestored=await project();
  assert.equal(monthlyRestored.environment.solar.date,'2024-06-21');
  await passive(resumeUndo);
  check('Undo during monthly Solar rejects publication from the superseded selection',
    JSON.stringify(await project())===JSON.stringify(monthlyRestored));
  check('Cancelled monthly Solar does not leave a completed or running display',
    await page.locator('#env-monthly-results table').count()===0&&!/completed|completed locally/i.test(await text('env-solar-status')));
  await replace(monthlyBefore);
  await page.locator('#env-monthly').click();
  await page.waitForFunction(()=>!!HomePlanner.getProject().environment.results.monthlySolar&&!document.getElementById('env-monthly').disabled);
  const monthlyComplete=await project(),monthlyText=await text('env-monthly-results');
  assert.equal(monthlyComplete.revision,monthlyBefore.revision+1,'Monthly snapshots and their captured inputs share one transaction');
  assert.equal(monthlyComplete.environment.results.monthlySolar.input.year,2025);
  assert.equal(monthlyComplete.environment.results.monthlySolar.output.rows.length,36);
  assert.equal(await page.locator('#env-monthly-results tbody tr').count(),36);
  await history('undo');
  check('Undo removes the saved monthly display without recalculating',await page.locator('#env-monthly-results table').count()===0);
  await history('redo');
  check('Redo restores the saved monthly display without recalculating',await text('env-monthly-results')===monthlyText);
  await replace(monthlyBefore);
  await replace(monthlyComplete);
  check('Same-ID replacement restores the matching monthly display',await text('env-monthly-results')===monthlyText);
  const resumeReplacement=await holdMonth(),changedScope=structuredClone(monthlyComplete);
  changedScope.environment.solar.scope='all';
  await replace(changedScope);
  const scopeRestored=await project();
  await passive(resumeReplacement);
  check('Same-ID replacement cancels publication from the previous monthly scope',
    JSON.stringify(await project())===JSON.stringify(scopeRestored)&&await page.locator('#env-monthly-results table').count()===0);
  await replace(monthlyComplete);
  await page.locator('#env-solar-date').fill('2026-06-21');
  const resumeDiscard=await holdMonth(),beforeDiscard=await project();
  await passive(()=>discard('solar'));
  await passive(resumeDiscard);
  check('Discarding a running monthly draft preserves the saved input/result snapshot',
    JSON.stringify(await project())===JSON.stringify(beforeDiscard)&&await text('env-monthly-results')===monthlyText);
  await page.locator('#env-solar-date').fill('2026-06-21');
  const monthlyDraftBefore=await project();
  await page.locator('#env-monthly').click();
  await page.waitForFunction(()=>HomePlanner.getProject().environment.results.monthlySolar?.input.year===2026&&!document.getElementById('env-monthly').disabled);
  const monthlyDraft=await project();
  assert.equal(monthlyDraft.revision,monthlyDraftBefore.revision+1);
  assert.deepEqual(monthlyDraft.environment.solar,monthlyDraftBefore.environment.solar,'Monthly comparison does not silently apply the separate instantaneous Solar draft');
  check('Explicit monthly comparison retains and records its reviewed pending controls',
    await page.locator('#env-solar-form').getAttribute('data-dirty')==='true'&&monthlyDraft.environment.results.monthlySolar.input.selection.date==='2026-06-21'&&
    await page.locator('#env-monthly-results tbody tr').count()===36);
  await passive(()=>discard('solar'));
  check('Discarding a different-year draft withdraws its monthly evidence',await page.locator('#env-monthly-results table').count()===0);
  await replace(monthlyComplete);
  assert.ok(await page.evaluate(()=>window.__environmentCalls['BuildingPhysics.shadowAt']>=72),'The browser must have exercised the real monthly geometry calculations');
  if(failures.length)throw new Error(`Environment lifecycle regressions:\n${failures.map(name=>`- ${name}`).join('\n')}`);
  return checks;
}

module.exports=async function environmentHistory(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      window.__environmentCalls={};
      for(const [name,methods] of Object.entries({HomeSun:['calculate'],EnvironmentData:['windRose'],
        BuildingPhysics:['shadowAt','surfaceExposure','assemblyProperties','solveAirflow','simulateThermal']})){
        let current;
        Object.defineProperty(window,name,{configurable:true,get:()=>current,set(api){
          current={...api};
          for(const method of methods)current[method]=function(...args){
            if(new Error().stack.includes('environment-ui.js')){
              const key=`${name}.${method}`;window.__environmentCalls[key]=(window.__environmentCalls[key]||0)+1;
            }
            return api[method](...args);
          };
          Object.freeze(current);
        }});
      }
    });
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'1',bedCount:'0',
        kitchenCount:'0',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'0',balconyCount:'0'}))
        document.getElementById(id).value=value;
      render();HomePlanner.acceptLegacy();HomePlannerWorkspace.navigate('environment/models');
      document.querySelectorAll('#env-models-section details').forEach(details=>{details.open=true;});
    });
    const lifecycle=await solarWindHistory(page);
    await page.evaluate(()=>{
      HomePlannerWorkspace.navigate('environment/models');
      document.querySelectorAll('#env-models-section details').forEach(details=>{details.open=true;});
    });
    const outputs=[];
    for(const name of ['pressure','thermal']){
      await page.locator(`#env-${name}-template`).click();
      const prepared=await page.locator(`#env-${name}-input`).inputValue(),input=JSON.parse(prepared);
      assert.ok(input.zones.length>0,'The fixture must use actual current-plan rooms');
      if(name==='pressure'){
        input.densityKgM3=1.2;
        input.links.forEach(link=>{link.cd=0.65;link.pressurePa=0;});
      }else{
        input.zones.forEach(zone=>{zone.capacityJ_K=1000;zone.initialC=20;zone.outsideConductanceW_K=0;});
        input.links.forEach(link=>{link.conductanceW_K=0;});
        input.steps=[{durationSeconds:60,outdoorC:20,gainsW:Object.fromEntries(input.zones.map(zone=>[zone.id,10]))}];
      }
      const submit=async value=>{
        await page.locator(`#env-${name}-input`).fill(JSON.stringify(value,null,2));
        await page.locator(`#env-${name}-notes`).fill('Explicit synthetic reference inputs; no measured-building claim.');
        await page.locator(`#env-${name}-ack`).check();
        await page.locator(`#env-${name}-form button[type="submit"]`).click();
        await page.waitForFunction(id=>document.getElementById(id).dataset.dirty!=='true',`env-${name}-form`);
        assert.equal(await page.locator(`#env-${name}-error`).isVisible(),false);
      };
      const before=await page.evaluate(()=>HomePlanner.getProject());
      await submit(input);
      const first=await page.evaluate(()=>HomePlanner.getProject());
      assert.equal(first.revision,before.revision+1,`${name} Evaluate must be one shared transaction`);
      assert.deepEqual(first.environment[name].input,input);
      assert.deepEqual(first.environment.results[name].input,input);
      const firstText=await page.locator(`#env-${name}-result`).innerText();
      assert.match(firstText,name==='pressure'?/Numerical network converged/:/Hypothetical RC-state temperatures/);
      const secondInput=JSON.parse(JSON.stringify(input));
      if(name==='pressure')secondInput.densityKgM3=1.3;
      else secondInput.zones.forEach(zone=>{zone.initialC=30;});
      await submit(secondInput);
      const second=await page.evaluate(()=>HomePlanner.getProject());
      assert.equal(second.revision,first.revision+1);
      await page.evaluate(()=>HomePlanner.undo());
      assert.deepEqual(await page.evaluate(name=>HomePlanner.getProject().environment[name],name),first.environment[name]);
      assert.deepEqual(JSON.parse(await page.locator(`#env-${name}-input`).inputValue()),input);
      assert.equal(await page.locator(`#env-${name}-result`).innerText(),firstText);
      await page.evaluate(()=>HomePlanner.redo());
      assert.deepEqual(JSON.parse(await page.locator(`#env-${name}-input`).inputValue()),secondInput);
      outputs.push({name,oneEvaluateUndo:true,matchingResultRestored:true});
    }
    await page.locator('#env-thermal-input').fill('{');
    await page.locator('#env-thermal-ack').check();
    const prior=await page.evaluate(()=>HomePlanner.getProject());
    await page.locator('#env-thermal-form button[type="submit"]').click();
    assert.match(await page.locator('#env-thermal-error').innerText(),/not valid JSON/);
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getProject()),prior,'A failed calculation must not store partial inputs');
    await page.evaluate(()=>HomePlanner.execute({type:'rename-project',name:'Unrelated rename'}));
    assert.equal(await page.locator('#env-thermal-input').inputValue(),'{');
    const ground=await page.evaluate(()=>{
      const id=HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({type:'add-floor',name:'Upper',copyFromId:id});
      return id;
    });
    assert.notEqual(await page.locator('#env-thermal-input').inputValue(),'{');
    await page.evaluate(id=>HomePlanner.execute({type:'select-floor',id}),ground);
    assert.equal(await page.locator('#env-thermal-input').inputValue(),'{','Pending scenario returns to its original floor');
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#env-thermal-form-reload').click();
    assert.notEqual(await page.locator('#env-thermal-input').inputValue(),'{');
    assert.match(await page.locator('#env-thermal-result').innerText(),/No matching current result/,
      'Adding a storey changes the captured geometry; clearing a draft must not revive old geometry evidence');
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getProject().environment.results.thermal),
      prior.environment.results.thermal,'Stale evidence remains available with its original inputs and provenance');
    assert.deepEqual(errors,[]);
    return {lifecycle,outputs,noAutomaticNumericalRuns:true,failedApplyPreservesProject:true,draftsSurviveRenameAndFloorSwitch:true,explicitDiscard:true};
  }finally{await context.close();}
};
