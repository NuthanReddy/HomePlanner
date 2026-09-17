const assert=require('node:assert/strict');

module.exports=async function serviceAccessSmoke(browser,url,{width=1440}={}){
  const context=await browser.newContext({viewport:{width,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const snapshot=()=>page.evaluate(()=>({
    rooms:HomePlanner.getScene().rooms.map(room=>({id:room.id,sourceId:room.sourceId,rect:room.rect})),
    furniture:HomePlanner.getScene().furniture.map(item=>({id:item.id,rect:item.rect})),
    revision:HomePlanner.getProject().revision
  }));
  try{
    await page.goto(url,{waitUntil:'load'});
    const originalPassage=await page.evaluate(()=>{
      document.getElementById('face').value='E';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'30',pNS:'30',livingCount:'0',bedCount:'1',
        kitchenCount:'1',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'1',balconyCount:'0'}))
        document.getElementById(id).value=value;
      render();
      const ctx=window.__roomPlanner,c=ctx.g.core,half=INT_WALL/2;
      roomSaveManualLayout(ctx);
      const saved=roomManualLayouts.get(ctx.signature);
      saved.rooms={
        'stair-1':{x:c.x+INT_WALL,y:c.y+INT_WALL,w:3,h:1.5},
        'bed-1':{x:c.x+half,y:c.y+2,w:c.w/2-INT_WALL,h:c.h-2-half},
        'kitchen-1':{x:c.x+c.w/2+half,y:c.y+2,w:c.w/2-INT_WALL,h:c.h-2-half}
      };
      saved.preserveRooms=true;saved.furniture={};saved.furnitureRooms=[];saved.openings=[];saved.wallOpenings=[];
      renderRoomPlanner(window.__last);HomePlanner.acceptLegacy();
      document.querySelector('.component-pane').open=true;
      const current=window.__roomPlanner,access=current.plan.circulation.accessByRoom.get('stair-1');
      const pack=roomPackProgram;
      window.__serviceRepackCalls=0;
      window.roomPackProgram=function(...args){window.__serviceRepackCalls++;return pack(...args);};
      return {type:access?.targetType,rect:access?.target,guides:current.plan.stairPassages};
    });
    assert.equal(originalPassage.type,'passage','The fixture staircase must exit into the front-side internal passage');
    const before=await snapshot();
    await page.locator('[data-room-source="liftCount"]').click();
    const added=await snapshot();
    const placement=await page.evaluate(passage=>{
      const ctx=window.__roomPlanner,lift=ctx.plan.placed.find(p=>p.req.type==='lift');
      if(!lift)return {placed:false,unmet:ctx.plan.unmet.map(req=>req.id)};
      const bounds=roomOccupiedBounds(lift),access=ctx.plan.circulation.accessByRoom.get(lift.req.id);
      const facing=roomSharedOpening(bounds,passage,ROOM_DOOR_WIDTH,ROOM_DOOR_MIN,.001);
      return {placed:true,bounds,rect:lift.carpet,passageClear:!roomIntersects(bounds,passage),
        guideClear:roomServiceKeepClear(ctx.plan,ctx.g).every(guide=>!roomIntersects(bounds,guide.rect)),
        facingEdge:facing?.edge,doorEdge:access?.edge,accessType:access?.targetType,
        modelErrors:HomePlanner.getScene().diagnostics.filter(item=>item.level==='error')};
    },originalPassage.rect);
    assert.equal(placement.placed,true,JSON.stringify(placement));
    assert.equal(placement.passageClear,true);
    assert.equal(placement.guideClear,true);
    assert.ok(placement.facingEdge,'The lift must stand alongside the shared passage');
    assert.equal(placement.doorEdge,placement.facingEdge,'The generated lift door must face the passage');
    assert.deepEqual(placement.modelErrors,[]);
    for(const room of before.rooms)
      assert.deepEqual(added.rooms.find(item=>item.id===room.id),room,'Adding a lift moved or resized another room');
    for(const item of before.furniture)
      assert.deepEqual(added.furniture.find(current=>current.id===item.id),item,'Adding a lift changed an existing furniture rectangle');
    assert.equal(added.revision,before.revision+1);
    assert.equal(await page.evaluate(()=>window.__serviceRepackCalls),0);
    await page.evaluate(()=>HomePlanner.undo());
    assert.deepEqual((await snapshot()).rooms,before.rooms);
    await page.evaluate(()=>HomePlanner.redo());
    assert.deepEqual((await snapshot()).rooms,added.rooms);
    const stable=await snapshot();
    await page.evaluate(()=>{
      HomePlanner.selectSource('room','lift-1');
      document.getElementById('plannerInspector').open=true;
    });
    await page.locator('#hp-editor-room-y').fill(String(originalPassage.rect.y+0.15));
    await page.locator('#hp-editor-room-y').press('Enter');
    assert.deepEqual(await snapshot(),stable,'A passage-blocking numeric move changed the project');
    const errorsShown=await page.locator('#plannerInspector [role="alert"]:visible').allTextContents();
    assert.match(errorsShown.join('\n'),/block a staircase passage/,
      'A rejected numeric edit must expose its reason in the active inspector');
    await page.evaluate(()=>{
      const saved=HomePlanner.exportProject();
      HomePlanner.newProject();HomePlanner.importProject(saved);
    });
    assert.deepEqual((await snapshot()).rooms,added.rooms);
    assert.deepEqual((await snapshot()).furniture,added.furniture);
    assert.deepEqual(errors,[]);
    return {width,sharedPassageClear:true,liftFacesPassage:true,retainedRooms:true,retainedFurniture:true,
      undoRedo:true,blockedNumericMovePreserved:true,jsonRoundTrip:true};
  }finally{await context.close();}
};
