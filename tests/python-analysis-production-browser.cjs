const assert=require('node:assert/strict');

module.exports=async function pythonProduction(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/analysis/'))requests.push(request.url());});
  try{
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      const weather=EnvironmentData.parseWeatherJSON(JSON.stringify({
        kind:'scenario',source:{label:'Synthetic production-workflow reference',elevationM:542},
        latitude:17.385,longitude:78.4867,
        records:[{timestamp:'2026-06-21T06:30:00Z',durationSeconds:3600,temperatureC:25,rhPct:50,pressurePa:95000}]
      }));
      HomePlanner.execute({type:'set-environment',patch:{weather}});
      HomePlannerWorkspace.navigate('environment/airflow');
    });
    assert.equal(requests.length,0,'Loading and navigating must not call the Python service');
    assert.equal(await page.locator('#python-density-analysis').isVisible(),true);
    await page.locator('#hp-python-density-mode').selectOption('weather');
    const before=await page.evaluate(()=>HomePlanner.getProject());
    const response=page.waitForResponse(item=>item.url().endsWith('/api/analysis/air-density'));
    await page.locator('#hp-python-density-calculate').click();
    const density=await (await response).json();
    assert.equal(density.engine.name,'PsychroLib');
    await page.waitForFunction(()=>document.querySelector('#python-density-analysis .hp-python-analysis').dataset.state==='current');
    assert.equal(await page.evaluate(()=>document.getElementById('workspaceAirflow').homePlannerAirflow.getState().draft.densityKgM3),
      density.output.densityKgM3);
    assert.ok(density.output.densityKgM3>1&&density.output.densityKgM3<1.2);
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getProject()),before);
    await page.evaluate(()=>HomePlannerWorkspace.navigate('environment/sun'));
    assert.equal(await page.locator('#python-density-analysis').isVisible(),false);
    assert.equal(await page.locator('#python-solar-analysis').isVisible(),true);
    await page.locator('#hp-python-solar-mode').selectOption('weather');
    await page.locator('#sunDate').fill('2026-06-21');
    await page.locator('#sunTime').fill('12:00');
    const solarResponse=page.waitForResponse(item=>item.url().endsWith('/api/analysis/solar-position'));
    await page.locator('#hp-python-solar-calculate').click();
    const solar=await (await solarResponse).json();
    assert.equal(solar.engine.name,'pvlib');
    await page.waitForFunction(()=>document.querySelector('#python-solar-analysis .hp-python-analysis').dataset.state==='current');
    assert.equal(await page.locator('#hp-python-solar-output svg').count(),1);
    assert.ok(solar.output.selected.geometricElevationDeg>70);
    assert.equal(solar.output.day.durationHours,24);
    const calls=requests.length;
    await page.locator('#sunTime').fill('00:00');
    await page.waitForFunction(()=>document.querySelector('#python-solar-analysis .hp-python-analysis').dataset.state==='stale');
    assert.equal(requests.length,calls,'Changing the clock must not silently rerun Python');
    const nightResponse=page.waitForResponse(item=>item.url().endsWith('/api/analysis/solar-position'));
    await page.locator('#hp-python-solar-calculate').click();
    const night=await (await nightResponse).json();
    assert.ok(night.output.selected.geometricElevationDeg<0);
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getProject()),before);
    assert.deepEqual(errors,[]);
    return {densityEngine:density.engine,solarEngine:solar.engine,actualDensity:density.output.densityKgM3,
      currentAirflowDraftUpdated:true,projectPreserved:true,solarChart:true,night:true,explicitRequestsOnly:true};
  }finally{await context.close();}
};
