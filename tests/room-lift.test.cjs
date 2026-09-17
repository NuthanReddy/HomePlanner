const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Regions=require('../planner-regions.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

function load(){
  const context=vm.createContext({
    RoomRegions:Regions,ROOM_EPS:1e-7,ROOM_PASSAGE_MIN:0.9,ROOM_DOOR_MIN:0.68,ROOM_DOOR_WIDTH:0.9,
    INT_WALL:0.12,EXT_WALL:0.25,FT:0.3048,roomManualLayouts:new Map(),roomIdentityState:{},
    roomClamp:(n,min,max)=>Math.min(max,Math.max(min,n)),
    roomLocalEdgeGlobal:edge=>edge,f1:n=>n.toFixed(1),window:{},
    roomRecalculatePlan:plan=>plan,roomHardAdjacencyValid:()=>true,
    roomAssignBalconies(){},roomCirculationAnalysis:()=>({inaccessible:[]})
  });
  for(const name of ['deriveRoomGeometry','roomRectInside','roomIntersects','roomCarpetModule',
    'roomEdgeSegment','roomSharedOpening','roomCorridorOpenings','roomOccupiedBounds','roomPlacementConflict',
    'roomModuleInside','roomModuleClear','roomMoveCandidate',
    'roomResizeCandidate','roomApplyManualLayout','roomOrder','roomStableIds']){
    const source=html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(source,`Missing ${name}`);vm.runInContext(source[0],context);
  }
  return context;
}

function config(side='right',stairs=0){
  return {corridors:{front:1.2,back:0.9,side:0.9},counts:{lift:1,staircase:stairs,balcony:0},
    lift:{minW:1.5,maxW:1.5,minD:1.7,maxD:1.7},
    staircase:{minW:1.5,maxW:1.5,minD:3,maxD:3},side,balconyDepth:1.2,
    bed:{minW:3,maxW:4}};
}
function geometry(api,side='right',stairs=0){
  return api.deriveRoomGeometry({width:12,depth:14,frontEdge:'N',localSetbacks:{N:3}},config(side,stairs),[]);
}
const item=rect=>({kind:'room',room:{req:{id:'lift-1',type:'lift',label:'Lift 1'}},rect});
const inside=(api,rect,bounds)=>api.roomRectInside(api.roomCarpetModule(rect),bounds);

test('a lift no longer consumes a corridor overlay or widens the side strip',()=>{
  const api=load(),g=geometry(api);
  assert.equal(g.S,0.9);
  assert.equal(g.serviceZone,null);
  assert.equal(g.outerW,12-0.9);
  const withStairs=geometry(api,'right',1);
  assert.equal(withStairs.S,0.9);
  assert.equal(withStairs.serviceZone,null);
});

test('lift validity requires its full module inside the dwelling, not merely inside the plot',()=>{
  const api=load();
  for(const side of ['left','right']){
    const g=geometry(api,side),req={type:'lift'};
    const valid={x:g.core.x,y:g.core.y,w:1.62,h:1.82};
    assert.equal(api.roomModuleInside(valid,g,req),true);
    const corridor={x:side==='left'?0:12-g.S,y:g.F,w:g.S,h:1.82};
    assert.equal(api.roomRectInside(corridor,{x:0,y:0,w:g.W,h:g.D}),true);
    assert.equal(api.roomModuleInside(corridor,g,req),false);
    assert.equal(api.roomModuleInside({...valid,x:g.core.x-0.01},g,req),false);
    assert.equal(api.roomModuleInside({...valid,x:g.core.x+2,y:g.core.y+2},g,req),true);
    assert.equal(api.roomModuleClear(valid,'lift-1',req,{placed:[{req:{id:'room-1'},module:valid}]},g),false);
  }
});

test('dragging lifts is clamped on every side of the dwelling and allows horizontal movement',()=>{
  const api=load();
  for(const side of ['left','right']){
    const g=geometry(api,side),start={x:g.core.x+0.06,y:g.core.y+0.06,w:1.5,h:1.7};
    const lift=item(start);
    const moved=api.roomMoveCandidate(lift,start,2,0,g);
    assert.equal(moved.x,start.x+2);
    for(const [dx,dy] of [[-100,0],[100,0],[0,-100],[0,100],[-100,-100],[100,100]]){
      const candidate=api.roomMoveCandidate(lift,start,dx,dy,g);
      assert.ok(inside(api,candidate,g.core),`${side} ${dx},${dy}`);
    }
  }
});

test('resizing a lift never extends its wall allowance beyond the built-up core',()=>{
  const api=load();
  for(const side of ['left','right']){
    const g=geometry(api,side),start={x:g.core.x+1,y:g.core.y+1,w:1.5,h:1.7};
    for(const [edge,dx,dy] of [['W',-100,0],['E',100,0],['N',0,-100],['S',0,100]]){
      const candidate=api.roomResizeCandidate(item(start),start,dx,dy,g,edge);
      assert.ok(inside(api,candidate,g.core),`${side} ${edge}`);
    }
    const wider=api.roomResizeCandidate(item(start),start,0.5,0,g,'E');
    assert.equal(wider.x,start.x);
    assert.ok(Math.abs(wider.w-2)<1e-10);
  }
});

test('an interior lift no longer needs a corridor anchor but must still fit the dwelling',()=>{
  const api=load(),cfg=config();
  cfg.corridors={front:0,back:0,side:0};
  const g=api.deriveRoomGeometry({width:12,depth:14,frontEdge:'N'},cfg,[]);
  assert.equal(api.roomModuleInside({x:g.core.x,y:g.core.y,w:1.62,h:1.82},g,{type:'lift'}),true);
  const ordinary=geometry(api);
  assert.equal(api.roomModuleInside({x:ordinary.core.x,y:ordinary.core.y,w:100,h:100},ordinary,{type:'lift'}),false);
});

test('automatic ordering reserves inside-dwelling lift space before filling ordinary rooms',()=>{
  const api=load(),range={minW:2,minD:2};
  const requests=[
    {id:'living-1',type:'living',priority:0,seq:0,range},
    {id:'bed-1',type:'bedroom',priority:1,seq:1,range},
    {id:'lift-1',type:'lift',priority:5,seq:2,range}
  ];
  for(const mode of ['large','service','privacy'])
    assert.equal(api.roomOrder(requests,mode)[0].id,'lift-1');
});

test('balcony geometry keeps surviving identities after a middle deletion and does not reuse the removed ID',()=>{
  const api=load(),cfg=config();
  cfg.counts.balcony=3;
  const plate={width:18,depth:18,frontEdge:'N'},first=api.deriveRoomGeometry(plate,cfg,[]);
  assert.deepEqual(clone(first.balconies.map(b=>b.id)),['balcony-1','balcony-2','balcony-3']);
  api.roomIdentityState.balcony.ids.splice(1,1);cfg.counts.balcony=2;
  const remaining=api.deriveRoomGeometry(plate,cfg,[]);
  assert.deepEqual(clone(remaining.balconies.map(b=>b.id)),['balcony-1','balcony-3']);
  assert.deepEqual(clone(remaining.balconies.map(b=>b.label)),['Balcony 1','Balcony 3']);
  cfg.counts.balcony=3;
  assert.deepEqual(clone(api.deriveRoomGeometry(plate,cfg,[]).balconies.map(b=>b.id)),
    ['balcony-1','balcony-3','balcony-4']);
});

test('a saved outside lift position is not silently accepted or erased',()=>{
  const api=load(),g=geometry(api),generated={x:g.core.x+0.06,y:g.core.y+0.06,w:1.5,h:1.7};
  const room={req:{id:'lift-1',type:'lift',label:'Lift 1'},carpet:generated,module:api.roomCarpetModule(generated)};
  const saved={rooms:{'lift-1':{x:11,y:2,w:1.5,h:1.7}}},before=clone(saved);
  api.roomManualLayouts.set('saved',saved);
  const plan=api.roomApplyManualLayout({placed:[room]},g,'saved');
  assert.ok(inside(api,plan.placed[0].carpet,g.core));
  assert.match(plan.manualWarning,/saved lift position is outside.*previous saved layout is retained/);
  assert.deepEqual(saved,before);
});
