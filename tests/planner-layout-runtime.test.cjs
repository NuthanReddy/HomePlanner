const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Runtime=require('../planner-layout-runtime.js');
const source=fs.readFileSync(path.join(__dirname,'..','planner-layout-runtime.js'),'utf8').replace(/\r/g,'');

class Target{
  constructor(){this.listeners=[];this.dataset={};this.innerHTML='';this.textContent='';this.isConnected=true;}
  addEventListener(type,callback,options){this.listeners.push({type,callback,options});}
  removeEventListener(type,callback,options){
    this.listeners=this.listeners.filter(item=>item.type!==type||item.callback!==callback||item.options!==options);
  }
  emit(type,event={}){
    event={type,preventDefault(){},stopPropagation(){},...event};
    for(const item of this.listeners.filter(item=>item.type===type))item.callback(event);
  }
  contains(){return false;}
  querySelector(){return null;}
  appendChild(){}
  setAttribute(){}
  remove(){this.isConnected=false;}
  setPointerCapture(){}
  releasePointerCapture(){}
}
function fixture(editing=true){
  const frames=new Map(),controls={roomEditHint:new Target(),roomReset:new Target(),showPlanDims:{checked:true}};
  let nextFrame=0,view=null,planner=null,context=null,commits=0;
  const document=new Target();
  document.createElementNS=()=>new Target();
  document.defaultView={
    CSS:{escape:value=>value},setTimeout,clearTimeout,
    requestAnimationFrame:callback=>{frames.set(++nextFrame,callback);return nextFrame;},
    cancelAnimationFrame:id=>frames.delete(id)
  };
  const host=new Target();
  host.ownerDocument=document;host.namespaceURI='http://www.w3.org/2000/svg';
  host.classList={add(){},remove(){}};
  const adapter={
    FT:.3048,M2SF:10.76391041671,ROOM_EPS:1e-7,
    ROOM_COLORS:{bedroom:'#bed',lift:'#lift',staircase:'#stair',corridor:'#corridor',flex:'#flex'},
    DIRNAME:{N:'North',E:'East',S:'South',W:'West'},
    getElement:id=>controls[id],getContext:()=>context,getPlanner:()=>planner,
    getModel:()=>null,getLastResult:()=>null,setView:value=>{view=value;},
    getInternalWallM:()=>.12,resetLayout(){},
    roomEscapeMarkup:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    roomEdgeSegment:(r,e,len)=>e==='N'||e==='S'
      ?{x1:r.x+(r.w-len)/2,y1:r.y+(e==='S'?r.h:0),x2:r.x+(r.w+len)/2,y2:r.y+(e==='S'?r.h:0)}
      :{x1:r.x+(e==='E'?r.w:0),y1:r.y+(r.h-len)/2,x2:r.x+(e==='E'?r.w:0),y2:r.y+(r.h+len)/2},
    roomStairEntryEdge:()=> 'N',roomUsableArea:p=>(p.usableRegions??[p.carpet]).reduce((sum,r)=>sum+r.w*r.h,0),
    roomFurnitureResizable:()=>false,f0:value=>value.toFixed(0),f1:value=>value.toFixed(1)
  };
  for(const name of Runtime.requiredHelpers)adapter[name]??=()=>{};
  adapter.roomPointerLocal=(_host,event)=>({x:event.clientX,y:event.clientY});
  adapter.roomFindEditable=(_context,id)=>({
    id,kind:'room',rect:context.plan.placed[0].carpet,room:context.plan.placed[0]
  });
  adapter.roomOccupiedBounds=item=>item.carpet;
  adapter.roomCarpetModule=rect=>rect;
  adapter.roomMoveCandidate=(_item,rect,dx,dy)=>({...rect,x:rect.x+dx,y:rect.y+dy});
  adapter.roomEditableError=()=>null;
  adapter.roomCommitEditable=(_context,item,rect)=>{commits++;item.room.carpet=rect;return true;};
  adapter.renderRoomPlanner=()=>instance.render();
  context={
    signature:'synthetic',cfg:{},
    plate:{frontEdge:'N',label:'Synthetic plate'},
    g:{W:20,D:15,outerX:1,outerY:1,outerW:18,outerD:13,core:{x:1.2,y:1.2,w:17.6,h:12.6},
      corridors:[],balconies:[],balconyPolicy:{allowed:false}},
    plan:{placed:[{req:{id:'bed-1',label:'Bedroom',type:'bedroom'},
      carpet:{x:2,y:2,w:8,h:6},module:{x:1.94,y:1.94,w:8.12,h:6.12},
      usableRegions:[{x:2,y:2,w:3,h:6}],reservedAreaM2:30}],furniture:[],openings:{doors:[],windows:[]}}
  };
  const instance=Runtime.mount(host,adapter,{editing});
  return {
    instance,adapter,host,document,controls,frames,
    get context(){return context;},set context(value){context=value;},
    get view(){return view;},
    set planner(value){planner={sceneForRender:()=>null,getSelection:()=>null,...value};},
    get commits(){return commits;},
    flush(){for(const [id,callback] of frames){frames.delete(id);callback();}}
  };
}

test('incumbent renderer and stair glyph moved unchanged except explicit wall-thickness reader',()=>{
  // Extraction baseline: index.html before this refactor, normalized to LF.
  for(const [name,digest] of [
    ['roomSvgPlan','b4a56923494ec7bb057dc2fd3c07e38cf4f296f956657c393e0626606595d319'],
    ['roomStairGlyph','b5ba2ead21df6b6f6f951e514a69e17361da0bf8cdd0b13e87e47922c753a40b']
  ]){
    const extracted=source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]
      .replace('adapter.getInternalWallM()*scale','INT_WALL*scale');
    assert.equal(crypto.createHash('sha256').update(extracted).digest('hex'),digest,name);
  }
});

test('legacy entry points delegate to the reusable mount instead of retaining another renderer',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/<script src="planner-layout-runtime.js"><\/script>/);
  assert.match(html,/HomePlannerLayoutRuntime\.mount\(\$\('roomPlan'\),roomLayoutRuntimeAdapter\(\)\)/);
  assert.match(html,/function roomSvgPlan\(plate,g,plan\)\{\s*roomLayoutRuntime\.render\(\{plate,g,plan\}\);/);
  assert.doesNotMatch(html,/function roomStairGlyph/);
});

test('renders actual supplied context, reservations and all cardinal view transforms without global planner',()=>{
  const f=fixture(false),before=JSON.stringify(f.context);
  for(const frontEdge of ['N','E','S','W']){
    f.context.plate.frontEdge=frontEdge;
    f.instance.render();
    assert.match(f.host.innerHTML,/194 sq ft usable/);
    assert.match(f.host.innerHTML,new RegExp(`${f.adapter.DIRNAME[frontEdge].toUpperCase()} FRONT / ROAD`));
    const local={x:4.123,y:6.789},screen=f.view.point(local.x,local.y);
    const restored=f.view.toLocal(screen.x,screen.y);
    assert.ok(Math.abs(restored.x-local.x)<1e-10&&Math.abs(restored.y-local.y)<1e-10);
  }
  f.context.plate.frontEdge='N';
  assert.equal(JSON.stringify(f.context),before);
  f.context.plan.placed[0].usableRegions=[];
  f.instance.render();
  assert.doesNotMatch(f.host.innerHTML,/194 sq ft usable/);
  assert.doesNotMatch(f.host.innerHTML,/fill="#bed"/);
  f.instance.destroy();
  assert.equal(f.view,null);
});

test('uses shared effective wall/opening layers and current configuration by reference',()=>{
  const f=fixture(false),calls=[];
  const scene={rooms:[]};
  f.planner={
    sceneForRender(...args){calls.push(args);return scene;},
    getSelection:()=>null,
    renderLayer(s,point,scale,layer){assert.equal(s,scene);return `<g data-layer="${layer}"/>`;}
  };
  f.instance.render();
  assert.deepEqual(calls[0],[f.context.plate,f.context.g,f.context.plan,f.context.cfg]);
  assert.match(f.host.innerHTML,/data-layer="walls"/);
  assert.match(f.host.innerHTML,/data-layer="openings"/);
  f.context.g={error:'No supplied plate'};
  f.instance.render();
  assert.equal(f.view,null);
  assert.match(f.host.innerHTML,/No supplied plate/);
  f.instance.destroy();
});

function beginDrag(f){
  const target={dataset:{roomId:'bed-1',action:'move'},closest(selector){
    return selector==='[data-room-id][data-action]'?this:null;
  }};
  f.host.emit('pointerdown',{button:0,pointerId:1,clientX:3,clientY:3,target});
  f.host.emit('pointermove',{pointerId:1,clientX:8,clientY:3});
}

test('gesture previews never commit, release commits once, Escape cancels, teardown removes every listener',()=>{
  const f=fixture(),history=[];
  const project={id:'p',activeFloorId:'f',revision:1};
  f.planner={getProject:()=>project,beginLegacyGesture:()=>history.push('begin'),
    endLegacyGesture:cancel=>history.push(cancel?'cancel':'end')};
  f.instance.render();
  beginDrag(f);f.flush();
  assert.equal(f.commits,0);
  assert.equal(f.context.plan.placed[0].carpet.x,2);
  f.host.emit('pointerup',{pointerId:1});
  assert.equal(f.commits,1);
  assert.deepEqual(history,['begin','end']);
  beginDrag(f);f.flush();
  f.document.emit('keydown',{key:'Escape'});
  assert.equal(f.commits,1);
  assert.equal(history.at(-1),'cancel');
  beginDrag(f);
  assert.equal(f.frames.size,1);
  f.instance.destroy();f.instance.destroy();
  assert.equal(f.frames.size,0);
  assert.equal(history.at(-1),'cancel');
  assert.equal(f.host.listeners.length+f.document.listeners.length+f.controls.roomReset.listeners.length,0);
  assert.equal(f.view,null);
  assert.throws(()=>f.instance.render(),/destroyed/);
  const remounted=Runtime.mount(f.host,f.adapter);
  remounted.destroy();
});

test('stale revision or changed floor discards the gesture instead of committing its preview',()=>{
  for(const changed of [{revision:2},{activeFloorId:'other'}]){
    const f=fixture(),project={id:'p',activeFloorId:'f',revision:1};
    f.planner={getProject:()=>({...project}),beginLegacyGesture(){},endLegacyGesture(){}};
    f.instance.render();beginDrag(f);f.flush();
    Object.assign(project,changed);
    f.host.emit('pointerup',{pointerId:1});
    assert.equal(f.commits,0);
    assert.match(f.controls.roomEditHint.textContent,/preview was discarded/);
    f.instance.destroy();
  }
});

test('fails explicitly for absent adapters/controls and duplicate hosts; render-only needs no gesture dependencies',()=>{
  const f=fixture(false);
  assert.throws(()=>Runtime.mount(f.host,f.adapter),/Destroy the existing/);
  f.instance.destroy();
  assert.throws(()=>Runtime.mount(f.host,{}),/getElement/);
  const rendererAdapter={};
  for(const name of [...Runtime.rendererCallbacks,...Runtime.rendererHelpers,'FT','M2SF','ROOM_EPS','ROOM_COLORS','DIRNAME'])
    rendererAdapter[name]=f.adapter[name];
  const renderer=Runtime.mount(f.host,rendererAdapter,{editing:false});
  renderer.render();renderer.destroy();
  assert.equal(f.host.listeners.length+f.document.listeners.length,0);
  assert.throws(()=>Runtime.mount(f.host,rendererAdapter),/getModel/);
  assert.throws(()=>Runtime.mount(f.host,{...f.adapter,getElement:()=>null}),/actual roomEditHint/);
});

// Caller supplies Playwright and a local server; every page is disposable.
module.exports.browserSmoke=async function browserSmoke(browser,url){
  const context=await browser.newContext();
  try{
    const raw=async file=>{
      const response=await context.request.get(new URL(`${file}?raw`,url).href);
      assert.equal(response.status(),200);
      const text=await response.text();
      return text.startsWith('export default ')?Function(text.replace(/^export default /,'return '))():text;
    };
    // Vite injects an ESM import into this unchanged classic script; use its raw
    // contents for the fixture so that unrelated dev-server behavior stays out.
    const three=await raw('planner-3d.js');
    await context.route('**/planner-3d.js',route=>route.fulfill({contentType:'application/javascript',body:three}));
    const fixturePage=await context.newPage();
    await fixturePage.goto(url,{waitUntil:'load'});
    const captured=await fixturePage.evaluate(()=>{
      const adapter=roomLayoutRuntimeAdapter();
      const names=[...HomePlannerLayoutRuntime.rendererHelpers,'roomOccupiedBounds'];
      return {
        context:window.__roomPlanner,
        constants:{FT,M2SF,ROOM_EPS,ROOM_COLORS,DIRNAME,internalWallM:INT_WALL},
        resizable:[...ROOM_RESIZABLE_FURNITURE],
        functions:Object.fromEntries(names.map(name=>[name,adapter[name].toString()]))
      };
    });
    const surfacePage=await context.newPage(),errors=[];
    surfacePage.on('pageerror',error=>errors.push(error.message));
    await surfacePage.setContent('<svg id="surface" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560"></svg>');
    await surfacePage.addScriptTag({content:await raw('planner-regions.js')});
    await surfacePage.addScriptTag({content:await raw('planner-layout-runtime.js')});
    const result=await surfacePage.evaluate(captured=>{
      const {FT,M2SF,ROOM_EPS,ROOM_COLORS,DIRNAME,internalWallM}=captured.constants;
      const declarations=Object.entries(captured.functions).map(([name,source])=>`const ${name}=${source};`).join('\n');
      const helpers=Function('RoomRegions','ROOM_RESIZABLE_FURNITURE',`${declarations}\nreturn {${Object.keys(captured.functions).join(',')}};`)(
        HomePlannerRegions,new Set(captured.resizable));
      const svg=document.getElementById('surface');
      let view;
      const adapter={
        FT,M2SF,ROOM_EPS,ROOM_COLORS,DIRNAME,...helpers,
        getElement:()=>null,getContext:()=>captured.context,getPlanner:()=>null,
        setView:value=>{view=value;},getInternalWallM:()=>internalWallM
      };
      const mount=HomePlannerLayoutRuntime.mount(svg,adapter,{editing:false});
      mount.render();
      const before=svg.innerHTML;
      const local={x:captured.context.g.core.x,y:captured.context.g.core.y};
      const screen=view.point(local.x,local.y),restored=view.toLocal(screen.x,screen.y);
      const result={
        rooms:svg.querySelectorAll('g[data-room-id]').length,
        expectedRooms:captured.context.plan.placed.length+captured.context.g.balconies.length+captured.context.plan.furniture.length,
        markup:before.length,
        invertible:Math.abs(restored.x-local.x)<1e-10&&Math.abs(restored.y-local.y)<1e-10,
        hasLegacyApplication:!!window.HomePlanner||!!document.getElementById('roomPlan'),
        iframes:document.querySelectorAll('iframe').length
      };
      mount.destroy();
      result.cleared=view===null;
      const remount=HomePlannerLayoutRuntime.mount(svg,adapter,{editing:false});
      remount.render();
      result.identicalAfterRemount=svg.innerHTML===before;
      remount.destroy();
      return result;
    },captured);
    assert.equal(result.rooms,result.expectedRooms);
    assert.ok(result.markup>1000);
    assert.equal(result.invertible,true);
    assert.equal(result.hasLegacyApplication,false);
    assert.equal(result.iframes,0);
    assert.equal(result.cleared,true);
    assert.equal(result.identicalAfterRemount,true);
    assert.deepEqual(errors,[]);
    return result;
  }finally{await context.close();}
};
