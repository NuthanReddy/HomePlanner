const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('manual layouts are restored directly rather than regenerated before restoration',()=>{
  const save=html.match(/function roomSaveManualLayout\([^]*?\n\}/)[0];
  const render=html.match(/function renderRoomPlanner\([^]*?\n\}/)[0];
  assert.match(save,/preserveRooms:true/);
  assert.match(save,/unplacedRoomIds/);
  assert.match(render,/savedLayout\?\.preserveRooms\s*\?\s*\{placed:\[\]/);
  assert.match(render,/roomPreserveProgrammeChange/);
});

test('the drawing toolbar includes canonical undo and redo controls',()=>{
  assert.match(html,/<button[^>]*id="roomUndo"[^>]*>Undo<\/button>/);
  assert.match(html,/<button[^>]*id="roomRedo"[^>]*>Redo<\/button>/);
  const init=html.match(/function initRoomViewport\([^]*?\n\}/)[0];
  assert.match(init,/planner\[action\]\(\)/);
  assert.match(init,/subscribe\(syncHistory\)/);
});

test('layout JSON buttons reuse the complete-project persistence request flow',()=>{
  assert.match(html,/<button[^>]*id="roomImportJSON"/);
  assert.match(html,/<button[^>]*id="roomExportJSON"/);
  const init=html.match(/function initRoomViewport\([^]*?\n\}/)[0];
  assert.match(init,/requestImportJSON/);
  assert.match(init,/requestExportJSON/);
  assert.match(init,/homePlannerPersistence/);
  assert.doesNotMatch(init,/JSON\.stringify|createObjectURL/);
});

test('restoring furniture preserves unknown direction and omitted default pin metadata',()=>{
  const source=html.match(/function roomRestoreFurnitureFlags\([^]*?\n\}/)[0];
  const original={id:'bed',x:1,y:2,w:1.5,h:2};
  const project={legacy:{context:{plan:{furniture:[original]}}}};
  const api=vm.createContext({HomePlanner:{getProject:()=>project}});
  vm.runInContext(source,api);
  const candidate={...original,headLocal:'S',pinned:true},saved={pinned:false};
  api.roomRestoreFurnitureFlags(candidate,saved);
  assert.equal(Object.hasOwn(candidate,'headLocal'),false);
  assert.equal(Object.hasOwn(candidate,'pinned'),false);
  assert.deepEqual(candidate,original);
  assert.deepEqual(saved,{pinned:false});
  api.roomRestoreFurnitureFlags(candidate,{headLocal:'S',pinned:true});
  assert.equal(candidate.headLocal,'S');assert.equal(candidate.pinned,true);
  original.pinned=true;original.headLocal='S';
  api.roomRestoreFurnitureFlags(candidate,{pinned:false});
  assert.equal(candidate.pinned,false);assert.equal(candidate.headLocal,'S');
});

async function browserSmoke(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const snapshot=()=>page.evaluate(()=>({
    rooms:HomePlanner.getScene().rooms.map(room=>({id:room.id,sourceId:room.sourceId,rect:room.rect})),
    furniture:HomePlanner.getScene().furniture.map(item=>({id:item.id,rect:item.rect})),
    revision:HomePlanner.getProject().revision
  }));
  try{
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      document.getElementById('face').value='N';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'30',pNS:'30',livingCount:'1',bedCount:'2',
        kitchenCount:'1',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'1',balconyCount:'0'}))
      {
        const input=document.getElementById(id);
        if(input.hasAttribute('data-room-setting'))HomePlannerRoomInputs.writeCommitted(input,value);
        else input.value=value;
      }
      render();HomePlanner.acceptLegacy();
      const original=roomPackProgram;
      window.__repackCalls=0;
      window.roomPackProgram=function(...args){window.__repackCalls++;return original(...args);};
      document.querySelector('.component-pane').open=true;
    });
    const original=await snapshot();
    await page.evaluate(()=>{
      const scene=HomePlanner.getScene(),stair=scene.rooms.find(room=>room.type==='staircase');
      const core=window.__roomPlanner.g.core;
      HomePlanner.execute({type:'update-room',id:stair.id,
        rect:{...stair.rect,x:core.x+(core.w-stair.rect.w)/2,y:core.y+(core.h-stair.rect.h)/2}});
    });
    const moved=await snapshot();
    assert.equal(await page.evaluate(()=>window.__repackCalls),0,'Moving a staircase regenerated the full plan');
    assert.deepEqual(moved.rooms.filter(room=>!room.sourceId.startsWith('stair-')),
      original.rooms.filter(room=>!room.sourceId.startsWith('stair-')));
    assert.deepEqual(moved.furniture,original.furniture,'Moving a staircase silently rearranged furniture');
    assert.equal(moved.revision,original.revision+1);
    assert.equal(await page.locator('#roomUndo').isEnabled(),true);
    await page.locator('#roomUndo').click();
    assert.deepEqual((await snapshot()).rooms,original.rooms);
    await page.locator('#roomRedo').click();
    assert.deepEqual((await snapshot()).rooms,moved.rooms);
    await page.evaluate(()=>{
      const furniture=HomePlanner.getScene().furniture.find(item=>item.type==='bed');
      HomePlanner.execute({type:'update-furniture',id:furniture.id,
        rect:{...furniture.rect,w:furniture.rect.w*0.8,h:furniture.rect.h*0.8}});
      window.__repackCalls=0;
    });
    const beforeAddition=await snapshot();
    await page.locator('[data-room-source="poojaCount"]').click();
    const afterAddition=await snapshot();
    assert.ok(afterAddition.rooms.some(room=>room.sourceId==='pooja-1'),'New Pooja room was not placed');
    for(const room of beforeAddition.rooms)
      assert.deepEqual(afterAddition.rooms.find(item=>item.id===room.id),room,'Adding a room changed a prior room footprint');
    for(const item of beforeAddition.furniture)
      assert.deepEqual(afterAddition.furniture.find(current=>current.id===item.id),item,'Adding a room changed manual furniture dimensions');
    assert.equal(await page.evaluate(()=>window.__repackCalls),0,'Adding a room invoked whole-plan packing');
    await page.evaluate(()=>{
      const saved=HomePlanner.exportProject();
      HomePlanner.newProject();HomePlanner.importProject(saved);
    });
    assert.deepEqual((await snapshot()).rooms,afterAddition.rooms);
    assert.deepEqual((await snapshot()).furniture,afterAddition.furniture);
    assert.deepEqual(errors,[]);
    return {stairMovePreservesOthers:true,toolbarUndoRedo:true,incrementalPoojaAddition:true,
      dimensionsPreserved:true,saveRestore:true,errors};
  }finally{await context.close();}
}
module.exports.browserSmoke=browserSmoke;
