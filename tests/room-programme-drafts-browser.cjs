const assert=require('node:assert/strict');

module.exports=async function programmeDrafts(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    assert.equal(await page.evaluate(()=>!!window.HomePlannerRoomInputs&&
      !!document.getElementById('roomProgrammeDrafts')?.homePlannerRoomInputs),true,
    'Production must load/bind planner-room-inputs.js and provide #roomProgrammeDrafts; this test never injects those hooks');
    await page.evaluate(()=>{
      document.getElementById('face').value='N';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22'}))
        document.getElementById(id).value=value;
      for(const [id,value] of Object.entries({livingCount:0,bedCount:3,kitchenCount:0,bathCount:0,
        poojaCount:0,liftCount:0,stairCount:0,balconyCount:0}))
        HomePlannerRoomInputs.writeCommitted(id,value);
      render();HomePlanner.acceptLegacy();
      for(let node=document.getElementById('bedCount');node;node=node.parentElement)
        if(node.tagName==='DETAILS')node.open=true;
    });
    const state=()=>page.evaluate(()=>({
      project:HomePlanner.getProject(),rooms:HomePlanner.getScene().rooms,
      furniture:HomePlanner.getScene().furniture,identities:JSON.parse(JSON.stringify(roomIdentityState))
    }));
    const draftState=()=>page.evaluate(()=>document.getElementById('roomProgrammeDrafts').homePlannerRoomInputs.getState());
    const action=name=>page.locator(`#roomProgrammeDrafts [data-room-programme-action="${name}"]`);
    const before=await state();
    assert.equal(before.rooms.length,3);
    await page.locator('#bedCount').fill('');
    await page.locator('#bedCount').press('Tab');
    assert.deepEqual(await state(),before,'Clearing a quantity or leaving the field must not erase rooms, identities or history');
    assert.equal((await draftState()).pending.find(item=>item.id==='bedCount').raw,'');
    await action('apply').click();
    assert.deepEqual(await state(),before,'Invalid Apply must preserve the full project and geometry');
    assert.equal(await page.locator('#bedCount').inputValue(),'');
    assert.equal(await page.locator('#roomProgrammeError').isVisible(),true);
    for(const text of ['1','12','-']){
      await page.locator('#bedCount').fill(text);
      assert.deepEqual(await state(),before,'Intermediate/multi-digit text must remain only a draft');
    }
    checks.push('raw quantity drafts, blur and invalid Apply preserve complete geometry/IDs');

    await page.evaluate(async()=>document.getElementById('plannerPersistence').homePlannerPersistence.saveNow());
    const saved=await page.evaluate(()=>{
      const persistence=document.getElementById('plannerPersistence').homePlannerPersistence;
      return {state:persistence.getState(),exported:JSON.parse(persistence.exportJSON().text)};
    });
    assert.equal(saved.state.draftCount,1);
    assert.equal(saved.state.dirty,false);
    assert.equal(saved.exported.legacy.controls.bedCount.value,'3');
    assert.deepEqual(saved.exported,before.project);
    checks.push('Save and JSON export include committed values, while pending input remains reported');

    await page.locator('#bedCount').fill('4');
    await page.locator('#bedMinW').fill('9.5');
    await page.evaluate(()=>{
      window.__programmeEvents=[];
      window.__programmeUnsubscribe=HomePlanner.subscribe(event=>window.__programmeEvents.push(event.type));
    });
    await action('apply').click();
    assert.equal((await draftState()).error,'');
    const applied=await state();
    assert.equal(applied.project.revision,before.project.revision+1);
    assert.equal(applied.project.legacy.controls.bedCount.value,'4');
    assert.equal(applied.project.legacy.controls.bedMinW.value,'9.5');
    assert.equal(applied.rooms.length,4);
    for(const room of before.rooms){
      const next=applied.rooms.find(item=>item.id===room.id);
      assert.deepEqual(next.rect,room.rect);assert.deepEqual(next.module,room.module);
    }
    assert.deepEqual(applied.furniture.filter(item=>before.furniture.some(prior=>prior.id===item.id)),before.furniture);
    assert.deepEqual(await page.evaluate(()=>window.__programmeEvents),['change']);
    assert.equal((await draftState()).pending.length,0);
    await page.locator('#bedCount').press('Enter');
    assert.deepEqual(await state(),applied,'A no-op Enter must not create another edit');
    await page.evaluate(()=>window.__programmeUnsubscribe());
    checks.push('one Apply commits quantity/defaults together and retains existing room/furniture footprints');

    await page.locator('#bedCount').fill('4.5');
    await page.locator('#bedMinW').fill('20');
    await action('apply').click();
    assert.deepEqual(await state(),applied);
    const invalid=await draftState();
    assert.ok(invalid.issues.bedCount);
    assert.ok(invalid.issues.bedMinW);
    assert.equal(invalid.pending.length,2);
    await action('discard').click();
    assert.equal(await page.locator('#bedCount').inputValue(),'4');
    await page.locator('#roomUndo').click();
    const undone=await state();
    assert.deepEqual(undone.rooms,before.rooms);
    assert.deepEqual(undone.furniture,before.furniture);
    assert.deepEqual(undone.identities,before.identities);
    assert.equal(undone.project.legacy.controls.bedMinW.value,before.project.legacy.controls.bedMinW.value);
    await page.locator('#roomRedo').click();
    assert.deepEqual((await state()).rooms,applied.rooms,await page.locator('#roomEditHint').innerText());
    checks.push('invalid integer/range batches remain drafts; Discard and one-step Undo/Redo preserve identities');

    await page.locator('#bedCount').fill('');
    const floorIds=await page.evaluate(()=>{
      const first=HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({type:'add-floor',copyFromId:first,name:'Programme draft owner'});
      return {first,second:HomePlanner.getProject().activeFloorId};
    });
    assert.equal(await page.locator('#bedCount').inputValue(),'4');
    await page.locator('#bedCount').fill('2');
    await page.locator('#hp-editor-floor-select').selectOption(floorIds.first);
    assert.equal(await page.locator('#bedCount').inputValue(),'');
    assert.equal((await state()).project.legacy.controls.bedCount.value,'4');
    await action('discard').click();
    await page.locator('#hp-editor-floor-select').selectOption(floorIds.second);
    assert.equal(await page.locator('#bedCount').inputValue(),'2');
    assert.equal((await state()).project.legacy.controls.bedCount.value,'4');
    await page.locator('#bedCount').press('Enter');
    assert.equal((await state()).rooms.length,2);
    assert.equal((await state()).project.floors.find(floor=>floor.id===floorIds.first).legacy.controls.bedCount.value,'4');
    checks.push('floor drafts park and restore without crossing owner boundaries or committing on blur');

    await page.locator('#bedCount').fill('3');
    await page.locator('#roomUndo').click();
    assert.equal((await state()).project.legacy.controls.bedCount.value,'4');
    assert.equal(await page.locator('#bedCount').inputValue(),'3');
    assert.equal((await draftState()).pending[0].conflict,true);
    assert.equal(await action('apply').isDisabled(),true);
    await action('review').click();
    await action('apply').click();
    assert.equal((await state()).rooms.length,3);
    checks.push('same-owner Undo requires explicit review before applying a draft against changed saved values');

    await page.locator('#bedMinW').fill('');
    const original=await page.evaluate(()=>HomePlanner.exportProject());
    await page.evaluate(()=>HomePlanner.newProject());
    assert.equal((await draftState()).pending.length,0);
    await page.evaluate(text=>HomePlanner.importProject(text),original);
    assert.equal(await page.locator('#bedMinW').inputValue(),'');
    assert.equal((await state()).project.legacy.controls.bedMinW.value,JSON.parse(original).legacy.controls.bedMinW.value);
    assert.deepEqual((await state()).project,JSON.parse(original));
    await action('discard').click();
    checks.push('project replacement/JSON restore keep drafts under their original project/floor without capturing raw text');
    assert.deepEqual(errors,[]);
    return {emptyQuantityPreservesProject:true,checks,errors};
  }finally{await context.close();}
};
