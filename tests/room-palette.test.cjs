const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('room palette exposes separate add and right-hand disclosure controls',()=>{
  const decorate=html.match(/function roomDecorateLibraryItems\([^]*?\n\}/)[0];
  assert.match(decorate,/add\.className='library-add'/);
  assert.match(decorate,/summary\.draggable=true/);
  assert.match(decorate,/toggle\.className='library-toggle'/);
  assert.match(decorate,/aria-expanded/);
  assert.match(decorate,/aria-controls/);
  assert.match(decorate,/event\.preventDefault\(\);event\.stopPropagation\(\)/);
  assert.doesNotMatch(decorate,/room-library-drag/);
});

test('generic disclosures use expand/collapse indicators instead of question-mark prefixes',()=>{
  assert.doesNotMatch(html,/summary::before\s*\{content:'\?\s*'/);
  assert.match(html,/summary::before\{content:'\\25B8\\00A0'/);
  assert.match(html,/details\[open\]>summary::before\{content:'\\25BE\\00A0'/);
});

// Run in a disposable browser/context; the caller supplies existing Playwright tooling.
async function browserSmoke(browser,url){
  const check=(condition,message)=>assert.ok(condition,message);
  return Promise.all([1440,390].map(async width=>{
    const context=await browser.newContext({viewport:{width,height:1000}});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    try{
      await page.goto(url,{waitUntil:'load'});
      await page.evaluate(()=>{
        document.getElementById('face').value='N';buildRoadInputs();
        for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'0',bedCount:'0',liftCount:'0'}))
        {
          const input=document.getElementById(id);
          if(input.hasAttribute('data-room-setting'))HomePlannerRoomInputs.writeCommitted(input,value);
          else input.value=value;
        }
        render();HomePlanner.acceptLegacy();
        document.querySelector('.component-pane').open=true;
      });
      const add=page.locator('[data-room-source="bedCount"]');
      const tile=add.locator('..'),details=tile.locator('..'),arrow=tile.locator('.library-toggle');
      await add.click();
      assert.equal(await page.locator('#bedCount').inputValue(),'1');
      assert.equal(await details.getAttribute('open'),null);
      await arrow.click();
      check(await details.getAttribute('open')!==null,'Arrow did not open room settings');
      assert.equal(await page.locator('#bedCount').inputValue(),'1');
      assert.equal(await arrow.getAttribute('aria-expanded'),'true');
      const bounds=await tile.boundingBox(),arrowBounds=await arrow.boundingBox();
      check(arrowBounds.x>bounds.x+bounds.width*0.6,'Arrow is not on the right');
      await page.locator('#bedMinW').fill('8');
      assert.equal(await page.locator('#bedCount').inputValue(),'1');
      await arrow.click();
      if(width>=1280){
        await add.dragTo(page.locator('#roomPlan'),{targetPosition:{x:100,y:100}});
      }else await add.click();
      assert.equal(await page.locator('#bedCount').inputValue(),'2','Tile drag/click should add exactly one room');
      assert.equal(await details.getAttribute('open'),null);
      await add.focus();await add.press('Enter');
      assert.equal(await page.locator('#bedCount').inputValue(),'3');
      await arrow.focus();await arrow.press('Space');
      check(await details.getAttribute('open')!==null,'Keyboard arrow did not expand');
      assert.equal(await page.locator('#bedCount').inputValue(),'3');
      const drawer=page.locator('details.component-pane'),heading=drawer.locator(':scope > summary');
      await heading.click({position:{x:12,y:15}});
      check(await drawer.getAttribute('open')!==null,'General drawer-header click should not toggle it');
      await page.locator('[data-room-source="livingCount"]').click();
      const furniture=page.locator('.library-section');
      if(await furniture.getAttribute('open')===null)await furniture.locator(':scope > summary .library-toggle').click();
      await page.locator('#componentPicker').selectOption('chair');
      const chair=page.locator('.component-item[data-component="chair"]');
      await chair.click();
      assert.equal(await chair.getAttribute('aria-pressed'),'true');
      await page.locator('#roomPlanViewport').scrollIntoViewIfNeeded();
      const point=await page.evaluate(()=>{
        const ctx=window.__roomPlanner,room=ctx.plan.placed.find(item=>item.req.type==='living');
        const goal={x:room.carpet.x+room.carpet.w/2,y:room.carpet.y+room.carpet.h/2};
        const view=window.__roomView,a=view.toLocal(0,0),b=view.toLocal(1,0),c=view.toLocal(0,1);
        const bx=b.x-a.x,by=b.y-a.y,cx=c.x-a.x,cy=c.y-a.y,det=bx*cy-by*cx;
        const dx=goal.x-a.x,dy=goal.y-a.y;
        const point=new DOMPoint((dx*cy-dy*cx)/det,(bx*dy-by*dx)/det);
        const svg=document.getElementById('roomPlan'),viewport=document.getElementById('roomPlanViewport');
        let screen=point.matrixTransform(svg.getScreenCTM());
        const bounds=viewport.getBoundingClientRect();
        viewport.scrollLeft+=screen.x-bounds.x-bounds.width/2;
        viewport.scrollTop+=screen.y-bounds.y-bounds.height/2;
        screen=point.matrixTransform(svg.getScreenCTM());
        window.scrollBy(0,screen.y-innerHeight/2);
        screen=point.matrixTransform(svg.getScreenCTM());
        if(!document.elementFromPoint(screen.x,screen.y)?.closest('#roomPlan'))
          throw new Error(`The test placement point is not visible at ${screen.x}, ${screen.y}`);
        return {x:screen.x,y:screen.y};
      });
      await page.mouse.click(point.x,point.y);
      check(await page.evaluate(()=>window.__roomPlanner.plan.furniture.some(item=>item.type==='chair')),
        `Clicking the component then the plan did not place it: ${JSON.stringify(await page.evaluate(()=>({
          status:document.getElementById('componentStatus').textContent,
          active:document.querySelector('.component-item[aria-pressed="true"]')?.dataset.component,
          furniture:window.__roomPlanner.plan.furniture.map(item=>({type:item.type,roomId:item.roomId})),
          error:document.querySelector('#hp-editor-inspector-error').textContent
        })))}`);
      assert.equal(await chair.getAttribute('aria-pressed'),'false');
      await chair.click();await page.keyboard.press('Escape');
      assert.equal(await chair.getAttribute('aria-pressed'),'false');
      assert.deepEqual(errors,[]);
      return {width,tileClick:true,rightArrowOnly:true,fullTileDrag:width>=1280,keyboard:true,componentClickPlacement:true,escape:true};
    }finally{await context.close();}
  }));
}
module.exports.browserSmoke=browserSmoke;
