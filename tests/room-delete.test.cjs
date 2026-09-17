const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Model=require('../planner-model.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

function identities(){
  const ctx=vm.createContext({roomIdentityState:{}});
  for(const name of ['roomStableIds','roomIdentitySignature','makeRoomRequests','roomOrder']){
    const source=html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    vm.runInContext(source[0],ctx);
  }
  return ctx;
}

test('deleted room identities are not reused or assigned to a surviving sibling',()=>{
  const ctx=identities();
  assert.deepEqual(plain(ctx.roomStableIds('bed',3)),['bed-1','bed-2','bed-3']);
  ctx.roomIdentityState.bed.ids.splice(1,1);
  assert.deepEqual(plain(ctx.roomStableIds('bed',2)),['bed-1','bed-3']);
  assert.deepEqual(plain(ctx.roomStableIds('bed',3)),['bed-1','bed-3','bed-4']);
  assert.deepEqual(plain(ctx.roomIdentitySignature()),{bed:['bed-1','bed-3','bed-4']});
});

test('default room identities keep existing manual-layout signatures compatible',()=>{
  const ctx=identities();
  ctx.roomStableIds('living',1);ctx.roomStableIds('bed',3);
  assert.equal(ctx.roomIdentitySignature(),undefined);
  const before=plain(ctx.roomIdentityState);
  ctx.roomStableIds('bed',3);
  assert.deepEqual(plain(ctx.roomIdentityState),before);
});

test('manual layout identity signatures do not depend on imported object-key order',()=>{
  const ctx=identities();
  ctx.roomIdentityState={kitchen:{next:4,ids:['kitchen-3']},bed:{next:4,ids:['bed-3']}};
  const signature=JSON.stringify(ctx.roomIdentitySignature());
  ctx.roomIdentityState={bed:ctx.roomIdentityState.bed,kitchen:ctx.roomIdentityState.kitchen};
  assert.equal(JSON.stringify(ctx.roomIdentitySignature()),signature);
});

test('bathroom identity and host do not silently switch to another bedroom after deletion',()=>{
  const ctx=identities(),range={minW:1,minD:1,maxW:2,maxD:2};
  ctx.INT_WALL=0.12;
  const cfg={counts:{living:1,bedroom:2,kitchen:0,pooja:0,bathroom:3,lift:0,staircase:0},
    living:range,bed:range,kitchen:range,pooja:range,bathroom:range,lift:range,staircase:range};
  ctx.makeRoomRequests(cfg);
  ctx.roomIdentityState.bed.ids.splice(0,1);cfg.counts.bedroom=1;
  const requests=ctx.makeRoomRequests(cfg);
  assert.deepEqual(plain(requests.filter(req=>req.type==='bedroom').map(req=>req.id)),['bed-2']);
  assert.equal(requests.find(req=>req.id==='bath-2').bedroomId,'bed-1');
  assert.equal(requests.find(req=>req.id==='bath-3').bedroomId,'bed-2');
  assert.ok(ctx.roomOrder(requests,'service').some(req=>req.id==='bath-2'),'Orphaned bathroom must remain reviewable');
});

test('room identity state is optional, version-compatible and strictly validated on project import',()=>{
  const project=Model.createProject();
  project.legacy.roomIdentities={bed:{next:5,ids:['bed-1','bed-3','bed-4']}};
  assert.deepEqual(Model.parseProject(JSON.stringify(project)).legacy.roomIdentities,project.legacy.roomIdentities);
  for(const invalid of [
    {bed:{next:3,ids:['bed-3']}},
    {bed:{next:4,ids:['bed-1','bed-1']}},
    {bed:{next:4,ids:['living-1']}},
    {bed:{next:NaN,ids:[]}},
    {bed:{next:3,ids:['bed-01']}},
    {unsupported:{next:1,ids:[]}}
  ]){
    project.legacy.roomIdentities=invalid;
    assert.throws(()=>Model.validateProject(project));
  }
});

async function browserSmoke(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      document.getElementById('face').value='N';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'1',bedCount:'3',
        kitchenCount:'0',bathCount:'0',liftCount:'0',stairCount:'0'}))document.getElementById(id).value=value;
      render();HomePlanner.acceptLegacy();
      const floorId=HomePlanner.getProject().activeFloorId;
      HomePlanner.execute({type:'upsert-authored',collection:'annotations',
        value:{id:floorId+':authored:deleted-room-note',text:'Keep for host review',
          anchor:{kind:'entity',floorId,entityKind:'room',entityId:floorId+':bed-2'}}});
      HomePlanner.selectSource('room','bed-2');
      document.getElementById('plannerInspector').open=true;
    });
    const original=await page.evaluate(()=>({
      rooms:HomePlanner.getScene().rooms.map(room=>({id:room.id,sourceId:room.sourceId,rect:room.rect})),
      furniture:HomePlanner.getScene().furniture,
      revision:HomePlanner.getProject().revision
    }));
    const remove=page.locator('#plannerInspector [data-hp-editor-action="delete-room"]');
    await remove.click();
    assert.equal(await page.locator('#bedCount').inputValue(),'3');
    await page.locator('#plannerInspector [data-hp-editor-action="cancel-confirmation"]').click();
    assert.equal(await page.locator('#bedCount').inputValue(),'3');
    await remove.click();
    await page.locator('#plannerInspector [data-hp-editor-action="confirm"]').click();
    const deleted=await page.evaluate(()=>({
      rooms:HomePlanner.getScene().rooms.map(room=>({id:room.id,sourceId:room.sourceId,rect:room.rect})),
      furniture:HomePlanner.getScene().furniture,
      revision:HomePlanner.getProject().revision
    }));
    assert.equal(await page.locator('#bedCount').inputValue(),'2');
    assert.equal(deleted.revision,original.revision+1);
    assert.deepEqual(deleted.rooms,original.rooms.filter(room=>room.sourceId!=='bed-2'));
    assert.ok(!deleted.furniture.some(item=>item.roomId.endsWith(':bed-2')));
    assert.ok(await page.evaluate(()=>{
      const note=HomePlanner.getDrawingScene().authored.find(item=>item.record.id.endsWith(':deleted-room-note'));
      return note?.anchorStatus==='unresolved'&&note.record.text==='Keep for host review';
    }),'Independent annotation should remain unresolved, not disappear or attach to a sibling');
    await page.evaluate(()=>HomePlanner.undo());
    assert.equal(await page.locator('#bedCount').inputValue(),'3');
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getScene().furniture),original.furniture);
    await page.evaluate(()=>HomePlanner.redo());
    await page.evaluate(()=>{
      const saved=HomePlanner.exportProject();
      HomePlanner.newProject();HomePlanner.importProject(saved);
    });
    assert.deepEqual(await page.evaluate(()=>HomePlanner.getScene().rooms.map(room=>room.sourceId)),deleted.rooms.map(room=>room.sourceId));
    await page.locator('[data-room-source="bedCount"]').click();
    assert.ok(await page.evaluate(()=>HomePlanner.getScene().rooms.some(room=>room.sourceId==='bed-4')));
    assert.ok(await page.evaluate(()=>!HomePlanner.getScene().rooms.some(room=>room.sourceId==='bed-2')));
    assert.deepEqual(errors,[]);
    return {deleteSelected:true,siblingsPreserved:true,undo:true,redo:true,import:true,identityNotReused:true,errors};
  }finally{await context.close();}
}
module.exports.browserSmoke=browserSmoke;
