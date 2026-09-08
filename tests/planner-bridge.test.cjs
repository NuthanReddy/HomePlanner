const test=require('node:test');
const assert=require('node:assert/strict');
const {createController,remapFloor}=require('../planner-bridge.js');
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  let live={controls:{bedCount:{value:'1'}},manualLayouts:[],context:null};
  const Model={
    createProject:()=>({schemaVersion:1,id:'project-one',revision:0,
      site:{latitude:17,longitude:78,timeZone:'Asia/Kolkata'},
      building:{wallHeightM:2.7,floorElevationM:0,roofThicknessM:.15},
      activeFloorId:'floor-one',floors:[{id:'floor-one',name:'Ground',heightM:3}],
      wallEdits:{},doorEdits:{},windowEdits:{},furnitureEdits:{},obstacles:[],electrical:[],environment:{}}),
    validateProject(doc){
      assert.equal(doc.schemaVersion,1);
      assert.ok(Math.abs(doc.site.latitude)<=90,'Invalid latitude');
      assert.ok(doc.floors.length>0);
      assert.ok(doc.floors.some(f=>f.id===doc.activeFloorId));
      return doc;
    },
    parseProject(text){const doc=JSON.parse(text);this.validateProject(doc);return doc;},
    buildScene(context,doc){
      const i=doc.floors.findIndex(f=>f.id===doc.activeFloorId);
      return {floorId:doc.activeFloorId,
        floorElevationM:doc.building.floorElevationM+doc.floors.slice(0,i).reduce((s,f)=>s+f.heightM,0),
        floor:{x:0,y:0,w:10,h:12},
        rooms:context.plan.placed.map(p=>({id:doc.activeFloorId+':'+p.id,sourceId:p.id,rect:p.rect})),
        walls:[{id:doc.activeFloorId+':wall',start:{x:0,y:0},end:{x:5,y:0},exterior:false,structuralRole:'unknown'}],
        furniture:[],openings:[]};
    }
  };
  const adapter={
    capture:()=>copy(live),
    restore(value){live=copy(value);},
    render(){
      const rect=live.context?.plan?.placed[0]?.rect||{x:1,y:1,w:3,h:4};
      live.context={plate:{},cfg:{ceilingHeight:2.7},g:{W:10,D:12},
        plan:{placed:+live.controls.bedCount.value?[{id:'bed-1',rect}]:[]}};
    },
    edit(command){live.context.plan.placed[0].rect=copy(command.rect);},
    setCeiling(){},restoreWall(){},resetLayout(){live.manualLayouts=[];},
    addWindow(){}
  };
  adapter.render();
  return {controller:createController(adapter,Model),adapter};
}

test('shared snapshots and selection do not create geometry edits',()=>{
  const {controller}=fixture(),before=controller.getProject().revision;
  let type;
  controller.subscribe(event=>{type=event.type;});
  controller.select({kind:'room',id:'floor-one:bed-1'});
  assert.equal(type,'selection');
  assert.equal(controller.getProject().revision,before);
  assert.equal(controller.canUndo(),false);
  assert.ok(Object.isFrozen(controller.getProject().site));
  assert.ok(Object.isFrozen(controller.getScene()));
});

test('room changes commit once and history restores exact geometry',()=>{
  const {controller}=fixture(),rect={x:2,y:2,w:4,h:5};
  controller.execute({type:'update-room',id:'floor-one:bed-1',rect});
  assert.deepEqual(controller.getScene().rooms[0].rect,rect);
  controller.undo();
  assert.deepEqual(controller.getScene().rooms[0].rect,{x:1,y:1,w:3,h:4});
  controller.redo();
  assert.deepEqual(controller.getScene().rooms[0].rect,rect);
});

test('invalid commands roll back document and adapter state',()=>{
  const {controller}=fixture(),before=controller.exportProject();
  assert.throws(()=>controller.execute({type:'update-site',patch:{latitude:120}}));
  assert.equal(controller.exportProject(),before);
  assert.equal(controller.canUndo(),false);
});

test('solar inputs are retained in project export instead of remaining DOM-only',()=>{
  const {controller}=fixture(),sunSelection={date:'2026-06-21',time:'14:15',occurrence:''};
  controller.execute({type:'update-solar-inputs',
    site:{latitude:-33.8,longitude:151.2,timeZone:'Australia/Sydney'},sunSelection});
  const doc=JSON.parse(controller.exportProject());
  assert.deepEqual(doc.environment.sunSelection,sunSelection);
  assert.equal(doc.site.timeZone,'Australia/Sydney');
});

test('floors retain independent rooms, electrical points and elevations',()=>{
  const {controller}=fixture();
  controller.execute({type:'set-electrical',value:[{id:'floor-one:point',wallId:'floor-one:wall'}]});
  controller.execute({type:'add-floor',name:'Upper'});
  const second=controller.getProject().activeFloorId;
  assert.equal(controller.getScene().rooms.length,0);
  assert.deepEqual(controller.getProject().electrical,[]);
  assert.equal(controller.getScene().floorElevationM,3);
  controller.execute({type:'select-floor',id:'floor-one'});
  assert.equal(controller.getScene().rooms.length,1);
  assert.equal(controller.getProject().electrical[0].id,'floor-one:point');
  controller.execute({type:'select-floor',id:second});
  controller.execute({type:'update-floor',id:'floor-one',patch:{heightM:3.5}});
  assert.equal(controller.getScene().floorElevationM,3.5);
});

test('floor duplication remaps semantic attachments instead of sharing their IDs',()=>{
  const {controller}=fixture();
  controller.execute({type:'open-wall',id:'floor-one:wall',full:true,confirmConceptual:true});
  controller.execute({type:'set-electrical',value:[{id:'floor-one:point',wallId:'floor-one:wall'}]});
  controller.execute({type:'add-floor',copyFromId:'floor-one'});
  const id=controller.getProject().activeFloorId;
  assert.equal(controller.getScene().rooms.length,1);
  assert.ok(controller.getProject().wallEdits[id+':wall']);
  assert.equal(controller.getProject().electrical[0].wallId,id+':wall');
  assert.notEqual(id,'floor-one');
});

test('project import/export preserves storeys and a failed import preserves current work',()=>{
  const {controller}=fixture();
  controller.execute({type:'add-floor',copyFromId:'floor-one',name:'Upper'});
  const text=controller.exportProject();
  const other=fixture().controller;
  other.importProject(text);
  assert.equal(other.getScenes().length,2);
  assert.equal(other.getProject().activeFloorId,controller.getProject().activeFloorId);
  const before=other.exportProject();
  assert.throws(()=>other.importProject('{"schemaVersion":999}'));
  assert.equal(other.exportProject(),before);
  assert.throws(()=>other.importProject('{bad json'));
  assert.equal(other.exportProject(),before);
});

test('the last floor cannot be deleted and a new project gets fresh scope IDs',()=>{
  const {controller}=fixture(),id=controller.getProject().id;
  assert.throws(()=>controller.execute({type:'delete-floor',id:'floor-one'}),/at least one/);
  controller.newProject();
  assert.notEqual(controller.getProject().id,id);
  assert.notEqual(controller.getProject().activeFloorId,'floor-one');
});

test('cancelled legacy drag restores its starting layout without a history entry',()=>{
  const {controller,adapter}=fixture();
  controller.beginLegacyGesture();
  adapter.edit({rect:{x:5,y:5,w:1,h:1}});
  controller.endLegacyGesture(true);
  assert.deepEqual(controller.getScene().rooms[0].rect,{x:1,y:1,w:3,h:4});
  assert.equal(controller.canUndo(),false);
});

test('floor remapping only changes scoped identifiers, not unrelated text',()=>{
  const output=remapFloor({id:'a:room',label:'a pleasant room',map:{'a:wall':'a:door'}},'a','b');
  assert.deepEqual(output,{id:'b:room',label:'a pleasant room',map:{'b:wall':'b:door'}});
  assert.deepEqual(remapFloor({id:'a:room',label:'a:my room',notes:'a:keep this text',roomIds:['a:bed']},'a','b'),
    {id:'b:room',label:'a:my room',notes:'a:keep this text',roomIds:['b:bed']});
});
