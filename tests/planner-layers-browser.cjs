const assert=require('node:assert/strict');

module.exports=async function layerControls(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    const open3D=async()=>{
      await page.evaluate(()=>HomePlannerWorkspace.navigate('design/layout'));
      if(!await page.evaluate(()=>HomePlanner3D.instance?.isOpen))
        await page.locator('#planner3d [data-hp3d="open"]').click();
      await page.waitForFunction(()=>HomePlanner3D.instance?.isOpen);
    };
    await open3D();
    for(const key of ['structure','services','drainage','lightStudy'])
      assert.equal(await page.locator(`#planner3d [data-hp3d="${key}"]`).isDisabled(),true,
        `An empty ${key} layer must not pretend to run a calculation`);
    const status=await page.locator('#planner3d [data-hp3d="status"]').innerText();
    assert.doesNotMatch(status,/Plumbing engineering|Drainage engineering/);
    assert.equal(await page.locator('#planner3d [data-hp3d="structure-count"]').innerText(),'(0 records)');
    await page.locator('#planner3d [data-hp3d="structure-setup"]').click();
    assert.equal(await page.locator('#workspaceStructure').isVisible(),true);
    await open3D();
    await page.locator('#planner3d [data-hp3d="services-setup"]').click();
    assert.equal(await page.locator('#workspacePlumbing').isVisible(),true);
    await open3D();
    await page.locator('#planner3d [data-hp3d="drainage-setup"]').click();
    assert.equal(await page.locator('#workspaceDrainage').isVisible(),true);
    await open3D();
    await page.locator('#planner3d [data-hp3d="lightStudy-setup"]').click();
    assert.equal(await page.locator('#workspaceLight').isVisible(),true);
    await page.setViewportSize({width:430,height:1000});
    await open3D();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors,[]);
    return {emptyLayersDisabled:true,counts:true,workingSetupLinks:true,conciseStatus:true,mobileFits:true};
  }finally{await context.close();}
};
