const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

function load(){
  const map={
    N:{N:'N',E:'E',S:'S',W:'W'},E:{N:'E',E:'S',S:'W',W:'N'},
    S:{N:'S',E:'W',S:'N',W:'E'},W:{N:'W',E:'N',S:'E',W:'S'}
  };
  const context=vm.createContext({
    ROOM_EPS:1e-7,ROOM_EDGE_MAP:map,
    roomClamp:(value,min,max)=>Math.max(min,Math.min(max,value)),
    roomFurnitureClearances:()=>[],
    roomCommitFurniture:(ctx,f,parent,rect)=>{Object.assign(f,rect);return true;},
    $:()=>({innerHTML:''})
  });
  for(const name of ['roomRectInside','roomIntersects','roomLocalEdgeGlobal','roomFurnitureWallCandidates',
    'roomFurnitureDefaults','roomRotateFurniture','roomEscapeMarkup']){
    const match=html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match,`${name} must remain available`);
    vm.runInContext(match[0],context);
  }
  return context;
}

test('automatic bed heads prefer geographic south for every road front',()=>{
  const api=load();
  for(const frontEdge of ['N','E','S','W']){
    const cfg={frontEdge,furniture:{bed:{w:1.5,d:2,label:'Test'},cupboardLength:1.2,cupboardDepth:.6}};
    const p={req:{id:'bed-1',label:'Bedroom'},carpet:{x:0,y:0,w:8,h:8}};
    const bed=api.roomFurnitureDefaults(p,cfg,{}).out.find(item=>item.type==='bed');
    assert.equal(api.roomLocalEdgeGlobal(bed.headLocal,frontEdge),'S');
  }
});

test('bed auto-placement falls back to west when the south-facing footprint cannot fit',()=>{
  const api=load(),cfg={frontEdge:'E',furniture:{bed:{w:1.5,d:2,label:'Test'},cupboardLength:1.2,cupboardDepth:.6}};
  const p={req:{id:'bed-1',label:'Bedroom'},carpet:{x:0,y:0,w:1.7,h:8}};
  const bed=api.roomFurnitureDefaults(p,cfg,{}).out.find(item=>item.type==='bed');
  assert.equal(api.roomLocalEdgeGlobal(bed.headLocal,'E'),'W');
});

test('four rotations retain all bed head polarities, including a 180 degree turn',()=>{
  const api=load(),furniture={x:4,y:4,w:2,h:3,type:'bed',label:'Bed',headLocal:'N'};
  const item={kind:'furniture',furniture,parent:{carpet:{x:0,y:0,w:12,h:12}}};
  for(const head of ['E','S','W','N']){
    assert.equal(api.roomRotateFurniture({},item),true);
    assert.equal(furniture.headLocal,head);
  }
  assert.equal(furniture.w,2);assert.equal(furniture.h,3);
  assert.equal(furniture.x,4);assert.equal(furniture.y,4);
});

test('swing-sector collision includes the arc interior but excludes the bounding-box corner',()=>{
  const api=load();
  const sector={x:0,y:0,w:2,h:2,doorSector:{hinge:{x:0,y:0},radiusM:2}};
  assert.equal(api.roomIntersects({x:1,y:1,w:.1,h:.1},sector),true);
  assert.equal(api.roomIntersects({x:1.8,y:1.8,w:.1,h:.1},sector),false);
  assert.equal(api.roomIntersects({x:2,y:0,w:.1,h:.1},sector),false);
});

test('imported labels and attribute IDs are escaped as text, not executable markup',()=>{
  const api=load();
  assert.equal(api.roomEscapeMarkup('<image onerror="x" /> & \'label\''),
    '&lt;image onerror=&quot;x&quot; /&gt; &amp; &#39;label&#39;');
});
