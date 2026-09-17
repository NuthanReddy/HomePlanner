const assert=require('node:assert/strict');

module.exports=async function movementSmoke(browser,url,{width=1440,touch=false}={}){
  const context=await browser.newContext({viewport:{width,height:1100},isMobile:touch,hasTouch:touch});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
  try{
    const client=touch?await context.newCDPSession(page):null;
    let pointer=null;
    const down=async point=>{
      pointer=point;
      if(touch)await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
      else{await page.mouse.move(point.x,point.y);await page.mouse.down();}
    };
    const move=async(point,steps=14)=>{
      if(touch){
        const from=pointer;
        for(let i=1;i<=steps;i++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',
          touchPoints:[{x:from.x+(point.x-from.x)*i/steps,y:from.y+(point.y-from.y)*i/steps,id:1}]});
      }else await page.mouse.move(point.x,point.y,{steps});
      pointer=point;
    };
    const up=async()=>{
      if(touch)await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      else await page.mouse.up();
      pointer=null;
    };
    await page.goto(url,{waitUntil:'load'});
    const fixture=await page.evaluate(()=>{
      document.getElementById('face').value='N';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'30',pNS:'30',livingCount:'1',
        bedCount:'1',kitchenCount:'1',bathCount:'0',poojaCount:'0',liftCount:'1',stairCount:'1'}))
      {
        const input=document.getElementById(id);
        if(input.hasAttribute('data-room-setting'))HomePlannerRoomInputs.writeCommitted(input,value);
        else input.value=value;
      }
      render();
      const ctx=window.__roomPlanner,c=ctx.g.core,x=c.x,y=c.y;
      roomSaveManualLayout(ctx);
      const saved=roomManualLayouts.get(ctx.signature);
      saved.rooms={
        'living-1':{x:x+INT_WALL/2,y:y+INT_WALL/2,w:10,h:4},
        'bed-1':{x:x+5,y:y+6,w:3,h:3},
        'kitchen-1':{x:x+0.12,y:y+6,w:3,h:3},
        'lift-1':{x:x+16,y:y+6,w:1.5,h:2},
        'stair-1':{x:x+16,y:y+11,w:2,h:3}
      };
      saved.preserveRooms=true;saved.furniture={};saved.openings=[];saved.wallOpenings=[];
      renderRoomPlanner(window.__last);HomePlanner.acceptLegacy();
      return {goal:{x:x+10,y:y+6},overlap:{x:x+5,y:y+6},core:c};
    });
    const rect=sourceId=>page.evaluate(id=>window.__roomPlanner.plan.placed.find(p=>p.req.id===id).carpet,sourceId);
    const screen=async goal=>{
      await page.locator('#roomPlanViewport').scrollIntoViewIfNeeded();
      return page.evaluate(({x,y})=>{
        const box=window.__roomView.box({x,y,w:0,h:0}),svg=document.getElementById('roomPlan');
        const point=new DOMPoint(box.x,box.y).matrixTransform(svg.getScreenCTM());
        return {x:point.x,y:point.y};
      },goal);
    };
    const start=await rect('kitchen-1'),bedroom=await rect('bed-1');
    const before=await page.evaluate(()=>HomePlanner.getProject().revision);
    const origin=await screen({x:start.x+start.w/2,y:start.y+start.h/2});
    const blocker=await screen({x:fixture.overlap.x+start.w/2,y:fixture.overlap.y+start.h/2});
    const target=await screen({x:fixture.goal.x+start.w/2,y:fixture.goal.y+start.h/2});
    await page.evaluate(()=>{
      window.__movementEvents=[];
      for(const type of ['pointerdown','pointercancel','pointerup'])
        document.addEventListener(type,event=>window.__movementEvents.push({type,pointerType:event.pointerType,
          x:event.clientX,y:event.clientY,target:event.target.outerHTML.slice(0,160)}),true);
    });
    await down(origin);
    await move(blocker);
    try{
      await page.waitForFunction(()=>document.querySelector('.room-move-preview')?.getAttribute('aria-invalid')==='true',{},{timeout:5000});
    }catch(error){
      throw new Error(JSON.stringify({width,touch,origin,blocker,target,
        state:await page.evaluate(()=>({events:window.__movementEvents,
          preview:document.querySelector('.room-move-preview')?.outerHTML,hint:document.getElementById('roomEditHint').textContent}))}));
    }
    assert.deepEqual(await rect('kitchen-1'),start,'Intermediate collision mutated the kitchen');
    assert.equal(await page.evaluate(()=>HomePlanner.getProject().revision),before);
    await move(target);
    await page.waitForFunction(()=>document.querySelector('.room-move-preview')?.getAttribute('aria-invalid')==='false');
    await up();
    const landed=await rect('kitchen-1');
    close(landed.x,fixture.goal.x,1e-5);close(landed.y,fixture.goal.y,1e-5);
    assert.deepEqual(await rect('bed-1'),bedroom);
    assert.equal(await page.evaluate(()=>HomePlanner.getProject().revision),before+1);
    await page.evaluate(()=>HomePlanner.undo());
    assert.deepEqual(await rect('kitchen-1'),start);
    const revisionAfterUndo=await page.evaluate(()=>HomePlanner.getProject().revision);
    await down(origin);
    await move(target,12);
    await page.waitForFunction(()=>!!document.querySelector('.room-move-preview'));
    if(touch)await client.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    else{await page.keyboard.press('Escape');await up();}
    assert.deepEqual(await rect('kitchen-1'),start);
    assert.equal(await page.evaluate(()=>HomePlanner.getProject().revision),revisionAfterUndo);
    assert.equal(await page.locator('.room-move-preview').count(),0);
    await page.evaluate(()=>{
      HomePlanner.selectSource('room','stair-1');
      document.getElementById('plannerInspector').open=true;
    });
    const stairStart=await rect('stair-1');
    await page.locator('#hp-editor-room-x').fill(String(fixture.core.x+3.5));
    await page.locator('#hp-editor-room-x').press('Enter');
    await page.locator('#hp-editor-room-y').fill(String(fixture.core.y+0.5));
    await page.locator('#hp-editor-room-y').press('Enter');
    const stairPlaced=await rect('stair-1');
    close(stairPlaced.x,fixture.core.x+3.5);close(stairPlaced.y,fixture.core.y+0.5);
    assert.notDeepEqual(stairPlaced,stairStart);
    const reservation=await page.evaluate(()=>{
      const scene=HomePlanner.getScene(),living=scene.rooms.find(r=>r.sourceId==='living-1');
      const staircase=scene.rooms.find(r=>r.sourceId==='stair-1');
      return {usable:living.usableAreaM2,reserved:living.reservedAreaM2,
        footprint:staircase.reservationFootprint,errors:scene.diagnostics.filter(item=>item.level==='error'),
        openStair:staircase.stairEnclosure==='open',
        stairWalls:scene.walls.filter(wall=>wall.roomIds.includes(staircase.id)).length,
        automaticDoor:scene.openings.some(opening=>opening.roomId===staircase.id&&!opening.hosted)};
    });
    assert.ok(reservation.usable<40&&reservation.reserved>0);
    close(reservation.usable+reservation.reserved,40);
    assert.deepEqual(reservation.errors,[]);
    assert.equal(reservation.openStair,true);
    assert.equal(reservation.stairWalls,0,'A new open stair must not acquire a generated walled-room enclosure');
    assert.equal(reservation.automaticDoor,false,'An open stair must not acquire an automatic room door');
    const saved=await page.evaluate(()=>HomePlanner.exportProject());
    await page.evaluate(text=>{HomePlanner.newProject();HomePlanner.importProject(text);},saved);
    assert.deepEqual(await rect('stair-1'),stairPlaced);
    const restoredReserved=await page.evaluate(()=>HomePlanner.getScene().rooms.find(r=>r.sourceId==='living-1').reservedAreaM2);
    close(restoredReserved,reservation.reserved);
    assert.deepEqual(errors,[]);
    return {width,touch,jumpPastRoom:true,previewDoesNotMutate:true,oneUndo:true,cancellation:true,
      freeStaircaseCoordinates:true,reservedArea:reservation.reserved,saveRestore:true,errors};
  }finally{await context.close();}
};
