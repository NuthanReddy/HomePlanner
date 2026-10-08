async page => {
  const context=await page.context().browser().newContext();
  const check=(value,message)=>{if(!value)throw new Error(message);};
  try {
    const legacy=await context.newPage();
    await legacy.goto('http://127.0.0.1:5175/index.html');
    await legacy.waitForFunction(()=>window.HomePlanner?.getScene()?.rooms.length);
    const fixture=await legacy.evaluate(()=>{
      const r=structuredClone(window.__last),project=window.HomePlanner.getProject();
      r.splitOn=true;r.axis=r.frontEdge;
      const ns=r.axis==='N'||r.axis==='S',frontage=ns?r.extEW:r.extNS,depth=ns?r.extNS:r.extEW;
      r.split=splitPair(frontage,depth,.5,r.roads[r.axis],r.cat,r.ffh);
      window.__last=r;
      const plans={};
      for(const id of ['A','B']){
        renderRoomPlanner(r);document.getElementById('roomTarget').value=id;renderRoomPlanner(r);
        plans[id]=window.__roomPlanner.plan.placed.map(item=>({id:item.req.id,carpet:item.carpet}));
      }
      return {r,project,plans};
    });
    const native=await context.newPage(),errors=[];
    native.on('pageerror',error=>errors.push(error.message));
    await native.goto('http://127.0.0.1:5175/platform.html');
    await native.evaluate(async ({r,project})=>{
      const {loadDesignRuntime}=await import('/src/platform/design-runtime.ts');
      const runtime=await loadDesignRuntime(),controls=runtime.Controls;
      const host=document.createElement('div');
      host.innerHTML=`${controls.settings}${controls.palette}<p id="roomEditHint"></p><button id="roomReset"></button><p id="componentStatus"></p><svg id="roomPlan"></svg>`;
      document.body.append(host);
      const source={version:1,accountProjectId:'split-fixture',workspaceVersion:1,fingerprint:'split',
        site:{latitude:project.site.latitude,longitude:project.site.longitude,time_zone:project.site.timeZone},
        result:r,registration:{grossNorthWestX:0,grossNorthWestY:0,baseOffsetM:0,acknowledged:true},
        plateRegistrations:Object.fromEntries(['whole','A','B'].map(id=>[id,{
          grossNorthWestX:id==='B'?-r.split.A.frontage:0,grossNorthWestY:0,baseOffsetM:0,acknowledged:true,
        }]))};
      window.splitMount=runtime.Design.mount(host.querySelector('svg'),host,null,{
        ...runtime,siteSource:source,
      });
    },fixture);
    for(const id of ['A','B']){
      await native.locator('#roomTarget').selectOption(id);
      const result=await native.evaluate(()=>{
        const project=window.splitMount.planner.getProject(),ctx=window.splitMount.getContext();
        return {plate:ctx.plate.id,source:project.nativeSiteSource,
          rooms:ctx.plan.placed.map(item=>({id:item.req.id,carpet:item.carpet}))};
      });
      check(result.plate===id&&result.source.plateId===id,'Split selection/source ownership not captured.');
      check(JSON.stringify(result.rooms)===JSON.stringify(fixture.plans[id]),`Split ${id} incumbent generation differs.`);
    }
    check(!errors.length,errors.join('; '));
    await native.evaluate(()=>window.splitMount.destroy());
    return {splitAParity:true,splitBParity:true,plateProvenance:true,errors};
  } finally {await context.close();}
}
