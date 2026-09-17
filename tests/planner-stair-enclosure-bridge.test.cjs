'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Model=require('../planner-model.js');
const {createController}=require('../planner-bridge.js');
const {createFixture}=require('./fixtures/drawing-fixtures.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(style){
  const project=createFixture('multiple-floors').project;
  project.legacy.context.plan.placed.push({
    req:{id:'stair-1',type:'staircase',label:'Existing staircase',reserveFootprint:true,
      sourceNote:{keep:null},...(style===undefined?{}:{stairEnclosure:style})},
    carpet:{x:2,y:2,w:1,h:1.4},module:{x:1.95,y:1.95,w:1.1,h:1.5}
  });
  let live=copy(project.legacy),moves=0,saves=0,dropStyle=false;
  const root={__roomPlanner:live.context};
  const source=fs.readFileSync(path.join(__dirname,'..','planner-bridge.js'),'utf8');
  const start=source.indexOf('    edit(command,entity,doc){'),end=source.indexOf('    addOpening(command,wall){',start);
  assert.ok(start>=0&&end>start);
  const browserAdapter=vm.runInNewContext(`({${source.slice(start,end)}})`,{
    root,
    finite(value,label,positive=false){
      if(!Number.isFinite(value)||positive&&value<=0)throw new Error(`${label} must be finite and valid.`);
      return value;
    },
    roomCommitManual(ctx,room,rect){
      moves++;
      if(rect.x<0){ctx.editError='Synthetic invalid destination';return false;}
      const dx=rect.x-room.carpet.x,dy=rect.y-room.carpet.y;
      room.carpet=copy(rect);room.module={...room.module,x:room.module.x+dx,y:room.module.y+dy};
      return true;
    },
    roomSaveManualLayout(ctx){
      saves++;
      live.manualLayouts=[['fixture', {rooms:Object.fromEntries(ctx.plan.placed.map(room=>[room.req.id,{
        ...room.carpet,...(room.req.stairEnclosure===undefined?{}:{stairEnclosure:room.req.stairEnclosure})
      }]))}]];
    }
  },{filename:'planner-bridge-browser-stair-edit.js'});
  const adapter={
    capture:()=>copy(live),
    restore(value){live=copy(value);root.__roomPlanner=live.context;},
    render(){
      if(dropStyle){
        dropStyle=false;
        delete live.context.plan.placed.find(room=>room.req.id==='stair-1').req.stairEnclosure;
      }
    },
    edit:browserAdapter.edit
  };
  const planner=createController(adapter,Model);
  planner.replaceProject(project);
  return {planner,adapter,get moves(){return moves;},get saves(){return saves;},
    dropOnRender(){dropStyle=true;}};
}
const stair=planner=>planner.getScene().rooms.find(room=>room.type==='staircase');
const request=planner=>planner.getProject().legacy.context.plan.placed.find(room=>room.req.id==='stair-1').req;

for(const original of [undefined,'enclosed'])
  test(`explicit staircase enclosure change preserves footprints and metadata from ${original??'missing'} style`,()=>{
    const f=fixture(original),before=f.planner.getProject(),old=stair(f.planner);
    const rooms=f.planner.getScene().rooms,events=[];
    f.planner.subscribe(event=>events.push(event.type));
    f.planner.execute({type:'update-room',id:old.id,rect:old.rect,stairEnclosure:'open'});
    assert.equal(f.planner.getProject().revision,before.revision+1);
    assert.equal(stair(f.planner).stairEnclosure,'open');
    for(const key of ['rect','module','reservationFootprint'])assert.deepEqual(stair(f.planner)[key],old[key]);
    for(const room of rooms.filter(room=>room.id!==old.id)){
      const after=f.planner.getScene().rooms.find(item=>item.id===room.id);
      assert.deepEqual(after.rect,room.rect);assert.deepEqual(after.module,room.module);
    }
    assert.deepEqual(request(f.planner).sourceNote,{keep:null});
    assert.equal(f.planner.getProject().legacy.manualLayouts[0][1].rooms['stair-1'].stairEnclosure,'open');
    assert.equal(f.moves,0,'Changing only enclosure must not recalculate the editable footprint as a move');
    assert.equal(f.saves,1);
    assert.deepEqual(events,['change']);
    const applied=f.planner.getProject();
    f.planner.execute({type:'update-room',id:old.id,rect:old.rect,stairEnclosure:'open'});
    assert.equal(f.planner.getProject(),applied);
    assert.equal(f.saves,1);
    f.planner.undo();
    assert.equal(request(f.planner).stairEnclosure,original);
    assert.equal(Object.hasOwn(request(f.planner),'stairEnclosure'),original!==undefined);
    assert.equal(f.planner.canUndo(),false);
    f.planner.redo();
    const restored=fixture(original).planner;
    restored.importProject(f.planner.exportProject());
    assert.equal(stair(restored).stairEnclosure,'open');
    assert.deepEqual(stair(restored).reservationFootprint,old.reservationFootprint);
    const inactive=before.floors.find(floor=>floor.id!==before.activeFloorId);
    assert.deepEqual(restored.getProject().floors.find(floor=>floor.id===inactive.id),inactive);
  });

test('style-only requests can retain the current rectangle, while absent style leaves legacy movement unchanged',()=>{
  const f=fixture(),before=stair(f.planner);
  f.planner.execute({type:'update-room',id:before.id,rect:{...before.rect,x:before.rect.x+.1}});
  assert.equal(Object.hasOwn(request(f.planner),'stairEnclosure'),false);
  assert.equal(f.moves,1);
  const current=stair(f.planner);
  f.planner.execute({type:'update-room',id:current.id,stairEnclosure:'enclosed'});
  assert.equal(stair(f.planner).stairEnclosure,'enclosed');
  assert.deepEqual(stair(f.planner).rect,current.rect);
  assert.equal(f.moves,1);
});

test('invalid enclosure values and non-stair targets cannot mutate requests, snapshots or history',()=>{
  const f=fixture('enclosed'),before=f.planner.exportProject(),selected=stair(f.planner);
  for(const value of [null,false,'','roofless',4])
    assert.throws(()=>f.planner.execute({type:'update-room',id:selected.id,rect:selected.rect,stairEnclosure:value}),/open or enclosed/);
  const room=f.planner.getScene().rooms.find(item=>item.type==='living');
  assert.throws(()=>f.planner.execute({type:'update-room',id:room.id,rect:room.rect,stairEnclosure:'open'}),/only.*staircase/);
  assert.throws(()=>f.planner.execute({type:'rename-project',name:'No change',stairEnclosure:'open'}),/only.*staircase/);
  assert.equal(f.planner.exportProject(),before);
  assert.equal(f.saves,0);
  assert.equal(f.planner.canUndo(),false);
});

test('failed movement or lost enclosure reconstruction restores the previous authored style and geometry',()=>{
  const f=fixture('enclosed'),old=stair(f.planner),before=f.planner.exportProject();
  assert.throws(()=>f.planner.execute({type:'update-room',id:old.id,rect:{...old.rect,x:-1},stairEnclosure:'open'}),/invalid destination/);
  assert.equal(f.planner.exportProject(),before);
  assert.equal(request(f.planner).stairEnclosure,'enclosed');
  f.dropOnRender();
  assert.throws(()=>f.planner.execute({type:'update-room',id:old.id,rect:old.rect,stairEnclosure:'open'}),/enclosure was not retained/);
  assert.equal(f.planner.exportProject(),before);
  assert.equal(f.planner.canUndo(),false);
});
