const assert=require('node:assert/strict');

module.exports=async function environmentHistory(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'1',bedCount:'0',
        kitchenCount:'0',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'0',balconyCount:'0'}))
        document.getElementById(id).value=value;
      render();HomePlanner.acceptLegacy();HomePlannerWorkspace.navigate('environment/models');
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
    return {outputs,failedApplyPreservesProject:true,draftsSurviveRenameAndFloorSwitch:true,explicitDiscard:true};
  }finally{await context.close();}
};
