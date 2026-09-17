const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

function load(){
  const ctx=vm.createContext({
    ROOM_EPS:1e-7,roomClamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
    roomFurnitureClearances:plan=>plan.clearances||[],
    roomCommitFurniture(context,f,parent,rect){Object.assign(f,rect);return true;},
    roomEditBlocked(context,message){context.editError=message;return false;},
    $:()=>({innerHTML:''})
  });
  for(const name of ['roomRectInside','roomIntersects','roomFurnitureCandidateValid','roomFindFurniturePosition','roomRotateFurniture','roomEscapeMarkup'])
    vm.runInContext(html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0],ctx);
  return ctx;
}
function fixture(overrides={}){
  const parent={req:{id:'room',label:'Bedroom'},carpet:{x:0,y:0,w:5,h:4}};
  const furniture={id:'bed',roomId:'room',type:'bed',label:'Bed',x:2,y:0.5,w:1,h:3,headLocal:'N',pinned:false,...overrides};
  const item={kind:'furniture',furniture,parent};
  return {parent,furniture,item,context:{plan:{furniture:[furniture],clearances:[]}}};
}

test('blocked pivot rotation finds another valid position without moving other objects',()=>{
  const api=load(),f=fixture();
  const blocker={id:'cupboard',roomId:'room',x:3.1,y:0.4,w:1.5,h:3};
  f.context.plan.furniture.push(blocker);
  const before=plain(blocker);
  assert.equal(api.roomRotateFurniture(f.context,f.item),true);
  assert.equal(f.furniture.w,3);assert.equal(f.furniture.h,1);
  assert.equal(f.furniture.headLocal,'E');assert.equal(f.furniture.pinned,true);
  assert.ok(f.furniture.x<=0.1+1e-7);
  assert.equal(api.roomFurnitureCandidateValid(f.context.plan,f.parent,f.furniture),true);
  assert.deepEqual(blocker,before);
});

test('rotation avoids door and reserved-service clearance areas',()=>{
  const api=load(),f=fixture({x:0.2,y:0.2,w:1,h:2});
  f.parent.carpet={x:0,y:0,w:4,h:3};
  f.context.plan.clearances=[{x:0,y:0,w:2,h:2}];
  assert.equal(api.roomRotateFurniture(f.context,f.item),true);
  assert.equal(api.roomIntersects(f.furniture,f.context.plan.clearances[0]),false);
  assert.equal(api.roomRectInside(f.furniture,f.parent.carpet),true);
});

test('an unsuccessful rotation retains the original geometry and head direction',()=>{
  const api=load(),f=fixture({x:0,y:0,w:1,h:2});
  f.parent.carpet={x:0,y:0,w:3,h:3};
  f.context.plan.furniture.push({id:'a',roomId:'room',x:1,y:0,w:2,h:3},{id:'b',roomId:'room',x:0,y:2,w:1,h:1});
  const before=plain(f.furniture);
  assert.equal(api.roomRotateFurniture(f.context,f.item),false);
  assert.deepEqual(f.furniture,before);
  assert.match(f.context.editError,/could not find a valid rotated placement/);
});

test('a rotated footprint wider than its room is rejected without resizing it',()=>{
  const api=load(),f=fixture({w:1,h:3});
  f.parent.carpet.w=2;
  const before=plain(f.furniture);
  assert.equal(api.roomRotateFurniture(f.context,f.item),false);
  assert.deepEqual(f.furniture,before);
});

test('door-sector checks retain usable space outside the actual arc',()=>{
  const api=load(),f=fixture({x:0,y:0,w:0.5,h:0.8});
  f.parent.carpet={x:0,y:0,w:2,h:2};
  f.context.plan.clearances=[{x:0,y:0,w:1.5,h:1.5,doorSector:{hinge:{x:0,y:0},radiusM:1.5}}];
  assert.equal(api.roomRotateFurniture(f.context,f.item),true);
  assert.equal(api.roomIntersects(f.furniture,f.context.plan.clearances[0]),false);
});
