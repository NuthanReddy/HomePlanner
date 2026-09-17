const assert=require('node:assert/strict');

module.exports=async function staircaseView(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    const before=await page.evaluate(()=>{
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'1',bedCount:'0',
        kitchenCount:'0',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'0',balconyCount:'0'}))
      {
        const input=document.getElementById(id);
        if(input.hasAttribute('data-room-setting'))HomePlannerRoomInputs.writeCommitted(input,value);
        else input.value=value;
      }
      render();HomePlanner.acceptLegacy();
      document.querySelector('.component-pane').open=true;
      return HomePlanner.getScene().rooms.map(room=>({id:room.id,rect:room.rect}));
    });
    await page.locator('[data-room-source="stairCount"]').click();
    const state=await page.evaluate(()=>{
      const scene=HomePlanner.getScene(),stair=scene.rooms.find(room=>room.type==='staircase');
      HomePlanner.select(null);
      return {stair,rooms:scene.rooms.map(room=>({id:room.id,rect:room.rect})),
        walls:scene.walls.filter(wall=>wall.roomIds.includes(stair.id)),
        doors:scene.openings.filter(opening=>opening.roomId===stair.id&&opening.kind!=='passage'),
        approaches:window.__roomPlanner.plan.stairApproaches};
    });
    assert.equal(state.stair.stairEnclosure,'open');
    assert.deepEqual(state.walls,[]);
    assert.deepEqual(state.doors,[]);
    for(const room of before)assert.deepEqual(state.rooms.find(item=>item.id===room.id),room);
    assert.equal(await page.locator('[data-stair-symbol="stair-1"]').count(),1);
    assert.equal(await page.locator('[data-stair-symbol="stair-1"] [data-stair-tread]').count(),12);
    assert.match(await page.locator('[data-stair-symbol="stair-1"]').textContent(),/UP/);
    assert.equal(await page.locator('[data-stair-guide]').count(),0,'Unselected stairs must not cover the plan with clearance bands');
    await page.evaluate(id=>HomePlanner.select({kind:'room',id}),state.stair.id);
    assert.equal(await page.locator('[data-stair-guide="entry"]').getAttribute('fill'),'none');
    assert.equal(await page.locator('[data-stair-guide="side"]').getAttribute('fill'),'none');
    assert.equal(state.approaches.length,1);
    const approach=state.approaches[0].rect,foot=state.stair.reservationFootprint;
    assert.ok(approach.w*approach.h<foot.w*foot.h,'Entry clearance must be bounded, not the entire surrounding flex-space');
    await page.evaluate(()=>{document.getElementById('plannerInspector').open=true;});
    const revision=await page.evaluate(()=>HomePlanner.getProject().revision);
    await page.locator('#hp-editor-stair-enclosure').selectOption('enclosed');
    const enclosed=await page.evaluate(()=>{
      const scene=HomePlanner.getScene(),stair=scene.rooms.find(room=>room.type==='staircase');
      return {stair,walls:scene.walls.filter(wall=>wall.roomIds.includes(stair.id)),revision:HomePlanner.getProject().revision};
    });
    assert.equal(enclosed.stair.stairEnclosure,'enclosed');
    assert.ok(enclosed.walls.length>0);
    assert.deepEqual(enclosed.stair.rect,state.stair.rect);
    assert.deepEqual(enclosed.stair.reservationFootprint,state.stair.reservationFootprint);
    assert.equal(enclosed.revision,revision+1);
    await page.locator('#hp-editor-stair-enclosure').selectOption('open');
    assert.equal(await page.evaluate(()=>HomePlanner.getScene().walls.filter(wall=>
      wall.roomIds.some(id=>id.endsWith(':stair-1'))).length),0);
    await page.locator('#roomUndo').click();
    assert.equal(await page.evaluate(()=>HomePlanner.getScene().rooms.find(room=>room.type==='staircase').stairEnclosure),'enclosed');
    await page.locator('#roomRedo').click();
    assert.equal(await page.evaluate(()=>HomePlanner.getScene().rooms.find(room=>room.type==='staircase').stairEnclosure),'open');
    const saved=await page.evaluate(()=>HomePlanner.exportProject());
    await page.evaluate(value=>{HomePlanner.newProject();HomePlanner.importProject(value);},saved);
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getScene().rooms.map(room=>({id:room.id,rect:room.rect}))),state.rooms);
    assert.equal(await page.evaluate(()=>HomePlanner.getScene().rooms.find(room=>room.type==='staircase').stairEnclosure),'open');
    assert.deepEqual(errors,[]);
    return {openByDefault:true,noAutomaticDoorOrEnclosure:true,schematicFlightsLandingAndUp:true,
      selectedOnlyUnfilledGuides:true,boundedEntry:true,otherRoomsPreserved:true,reversibleEnclosure:true,jsonRoundTrip:true};
  }finally{await context.close();}
};
