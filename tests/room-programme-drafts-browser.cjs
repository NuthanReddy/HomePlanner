const assert=require('node:assert/strict');

module.exports=async function programmeDrafts(browser,url){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url,{waitUntil:'load'});
    await page.evaluate(()=>{
      document.getElementById('face').value='N';buildRoadInputs();
      for(const [id,value] of Object.entries({dunit:'1',pEW:'22',pNS:'22',livingCount:'0',bedCount:'3',
        kitchenCount:'0',bathCount:'0',poojaCount:'0',liftCount:'0',stairCount:'0',balconyCount:'0'}))
        document.getElementById(id).value=value;
      render();HomePlanner.acceptLegacy();
      for(let node=document.getElementById('bedCount');node;node=node.parentElement)
        if(node.tagName==='DETAILS')node.open=true;
    });
    const before=await page.evaluate(()=>({
      project:HomePlanner.getProject(),
      rooms:HomePlanner.getScene().rooms,
      identities:JSON.parse(JSON.stringify(roomIdentityState))
    }));
    assert.equal(before.rooms.length,3);
    await page.locator('#bedCount').fill('');
    const pending=await page.evaluate(()=>({
      project:HomePlanner.getProject(),
      rooms:HomePlanner.getScene().rooms,
      identities:JSON.parse(JSON.stringify(roomIdentityState))
    }));
    assert.deepEqual(pending,before,'Clearing a quantity while typing must not erase rooms, identities or history');
    assert.deepEqual(errors,[]);
    return {emptyQuantityPreservesProject:true};
  }finally{await context.close();}
};
