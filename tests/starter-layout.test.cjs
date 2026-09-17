const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const edges={
  N:{N:'N',E:'E',S:'S',W:'W'},E:{N:'E',E:'S',S:'W',W:'N'},
  S:{N:'S',E:'W',S:'N',W:'E'},W:{N:'W',E:'N',S:'E',W:'S'}
};
function load(){
  const ctx=vm.createContext({ROOM_EPS:1e-7,roomLocalEdgeGlobal:(edge,front)=>edges[front][edge]});
  for(const name of ['roomPreferredDirections','roomDirectionPenalty','roomDirectionsSatisfied','roomExteriorEdges'])
    vm.runInContext(html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0],ctx);
  return ctx;
}
test('fresh browser programme has one bedroom, one kitchen and two bathrooms',()=>{
  for(const [id,count] of [['bedCount',1],['kitchenCount',1],['bathCount',2],['livingCount',0]])
    assert.match(html,new RegExp(`<input id="${id}"[^>]*value="${count}"`));
});
test('compass preferences are geographic rather than hard-coded screen/local sides',()=>{
  const api=load();
  for(const front of Object.keys(edges)){
    const g={frontEdge:front,core:{x:1,y:2,w:12,h:16},coreX:1,coreY:2,coreW:12,coreD:16};
    const corners=['NW','NE','SW','SE'].map(local=>({
      x:local.includes('W')?1:11,y:local.includes('N')?2:16,w:2,h:2
    }));
    const kitchen={type:'kitchen'};
    const best=corners.reduce((a,b)=>api.roomDirectionPenalty(kitchen,a,g)<api.roomDirectionPenalty(kitchen,b,g)?a:b);
    assert.equal(api.roomDirectionsSatisfied({req:kitchen,module:best},g),true,front);
    assert.ok(api.roomExteriorEdges(best,g).map(edge=>edges[front][edge]).includes('S'));
    assert.ok(api.roomExteriorEdges(best,g).map(edge=>edges[front][edge]).includes('E'));
    const allowed=corners.filter(module=>api.roomDirectionsSatisfied({req:{type:'bedroom'},module},g));
    assert.equal(allowed.length,2);
    assert.ok(allowed.every(module=>api.roomExteriorEdges(module,g).map(edge=>edges[front][edge]).includes('N')));
  }
});

async function browserSmoke(browser,url){
  const results=[];
  for(const front of ['N','E','S','W']){
    const context=await browser.newContext({viewport:{width:1366,height:1000}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(url,{waitUntil:'load'});
      await page.evaluate(direction=>{
        document.getElementById('face').value=direction;
        buildRoadInputs();render();HomePlanner.acceptLegacy();
      },front);
      const result=await page.evaluate(()=>{
        const ctx=window.__roomPlanner;
        return {counts:ctx.cfg.counts,rooms:ctx.plan.placed.map(p=>({
          id:p.req.id,type:p.req.type,edges:roomExteriorEdges(p.module,ctx.g).map(edge=>roomLocalEdgeGlobal(edge,ctx.g.frontEdge)),
          preferred:roomDirectionsSatisfied(p,ctx.g)
        })),unmet:ctx.plan.unmet.map(req=>req.id),inaccessible:ctx.plan.circulation.inaccessible.map(p=>p.req.id)};
      });
      assert.equal(result.counts.bedroom,1);assert.equal(result.counts.kitchen,1);assert.equal(result.counts.bathroom,2);
      assert.equal(result.rooms.length,4,JSON.stringify({front,...result}));
      assert.ok(result.rooms.every(room=>room.preferred),JSON.stringify({front,...result}));
      assert.deepEqual(result.inaccessible,[],JSON.stringify({front,...result}));
      const empty=await page.evaluate(()=>{
        HomePlanner.execute({type:'add-floor',name:'Explicit empty floor'});
        return HomePlanner.getScene().rooms.length;
      });
      assert.equal(empty,0,'Add empty floor must not acquire the starter programme');
      const stair=await page.evaluate(()=>{
        roomAddLibraryItem('stairCount');
        const ctx=window.__roomPlanner,placed=ctx.plan.placed.find(p=>p.req.type==='staircase');
        return {rect:placed.carpet,passages:ctx.plan.stairPassages};
      });
      assert.ok(stair.rect.w>=stair.rect.h,'Default staircase long axis must follow the local frontage direction');
      assert.equal(stair.passages.length,1);
      assert.deepEqual(errors,[]);
      results.push({front,rooms:result.rooms,emptyFloorPreserved:true});
    }finally{await context.close();}
  }
  return results;
}
module.exports.browserSmoke=browserSmoke;
