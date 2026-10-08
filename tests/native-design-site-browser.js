async (page) => {
  const context = await page.context().browser().newContext();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    const legacy = await context.newPage();
    await legacy.goto('http://127.0.0.1:5174/index.html', {waitUntil:'domcontentloaded'});
    await legacy.waitForFunction(() => window.HomePlanner?.getScene()?.rooms.length);
    const fixture = await legacy.evaluate(() => ({
      result: window.__last, project: window.HomePlanner.getProject(),
      rooms: window.HomePlanner.getScene().rooms.map(item=>({sourceId:item.sourceId,rect:item.rect})),
    }));
    const native = await context.newPage();
    const errors = [];
    native.on('pageerror', error => errors.push(error.message));
    await native.goto('http://127.0.0.1:5174/platform.html', {waitUntil:'domcontentloaded'});
    await native.evaluate(async fixture => {
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:DOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {NativeDesign}=await import('/src/platform/NativeDesign.tsx');
      const r=fixture.result;
      const site={
        width:r.grossEW,depth:r.grossNS,units:'m',facing:r.face,roads:r.roads,
        road_units:{N:'m',E:'m',S:'m',W:'m'},category:r.cat,use:r.use,
        height_m:r.selH,floor_height_m:r.ffh,floors:r.floors,stilt:r.stilt,tdr:r.tdr,
        compounding:r.devOn,custom_setbacks:r.customSetbacks,
        latitude:fixture.project.site.latitude,longitude:fixture.project.site.longitude,
        time_zone:fixture.project.site.timeZone,location_source:'manual',obstacles:[],
      };
      const record={project_id:'isolated-account',version:1,document:{schema_version:1,site,costs:{},materials:{}}};
      const feasibility={
        status:'computed',gross:{x:0,y:0,width:r.grossEW,depth:r.grossNS},
        net:{x:0,y:0,width:r.extEW,depth:r.extNS},
        envelope:{x:r.E.W,y:r.E.N,width:r.F.bw,depth:r.F.bd},
        front:r.frontEdge,setbacks_m:r.E,required_setbacks_m:r.requiredE,usable_m2:r.usable,
        floors:r.floors,max_floors:r.maxFloors,high_rise:r.highRise,non_compliant:r.nonCompliant,
      };
      window.siteFixture={record,evaluation:{project_id:record.project_id,version:1,feasibility,costs:{},utilization:{}}};
      window.nativeCache={document:null};
      const host=document.createElement('div');document.body.append(host);
      window.nativeHost=host;
      window.nativeRoot=DOM.createRoot(host);
      window.renderFixture=evaluation=>window.nativeRoot.render(React.createElement(NativeDesign,{
        cache:window.nativeCache,...window.siteFixture,onPlannerChange:planner=>window.nativePlanner=planner,
        evaluation,
      }));
      window.renderFixture({...window.siteFixture.evaluation,feasibility:{
        ...feasibility,envelope:{x:0,y:0,width:.2,depth:.2},usable_m2:.04,
      }});
    }, fixture);
    await native.getByRole('button',{name:'Create layout from applied Site',exact:true}).click();
    await native.locator('.native-design > [role="alert"]').waitFor();
    check(await native.evaluate(()=>!window.nativeCache.document&&!window.nativePlanner),
      'An unrepresentable envelope created a false successful project.');
    await native.evaluate(()=>window.renderFixture(window.siteFixture.evaluation));
    await native.getByRole('button',{name:'Create layout from applied Site',exact:true}).click();
    await native.waitForTimeout(1200);
    const mounted = await native.evaluate(()=>({
      error:document.querySelector('.native-design > [role="alert"]')?.textContent,
      rooms:window.nativePlanner?.getScene()?.rooms.map(item=>({sourceId:item.sourceId,rect:item.rect})),
      source:window.nativePlanner?.getProject().nativeSiteSource,
    }));
    check(!mounted.error, mounted.error);
    check(mounted.rooms?.length===fixture.rooms.length, 'Native starter room count differs from incumbent.');
    for(const room of fixture.rooms)
      check(JSON.stringify(mounted.rooms.find(item=>item.sourceId===room.sourceId)?.rect)===JSON.stringify(room.rect),
        `Incumbent generation parity failed for ${room.sourceId}.`);
    check(mounted.source.accountProjectId==='isolated-account'&&mounted.source.registration.acknowledged,
      'Known Site registration provenance was not retained.');
    await native.getByRole('button',{name:'Rooms & settings',exact:true}).click();
    const toggles=await native.locator('.native-design [aria-label]').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label')));
    check(toggles.includes('Expand Bedroom settings'),`Library did not mount: ${JSON.stringify(toggles)}`);
    await native.getByRole('button',{name:'Expand Bedroom settings',exact:true}).click();
    const before=await native.evaluate(()=>({
      revision:window.nativePlanner.getProject().revision,
      rooms:window.nativePlanner.getScene().rooms.map(item=>({id:item.id,rect:item.rect})),
    }));
    await native.locator('#bedMaxW').fill('13');
    check(await native.evaluate(()=>window.nativePlanner.getProject().revision)===before.revision,
      'Unapplied programme input committed.');
    await native.locator('#bedMaxW').press('Enter');
    await native.waitForTimeout(200);
    const applied=await native.evaluate(()=>({
      revision:window.nativePlanner.getProject().revision,
      rooms:window.nativePlanner.getScene().rooms.map(item=>({id:item.id,rect:item.rect})),
    }));
    check(applied.revision===before.revision+1,'Programme Apply did not produce one history entry.');
    check(JSON.stringify(applied.rooms)===JSON.stringify(before.rooms),'A default-size edit moved existing rooms.');
    await native.getByRole('button',{name:'Add Lift',exact:true}).click();
    await native.waitForTimeout(150);
    const added=await native.evaluate(()=>({
      counts:window.nativePlanner.getProject().legacy.context.cfg.counts,
      rooms:window.nativePlanner.getScene().rooms,
    }));
    check(added.counts.lift===1,'The incumbent library add was not applied.');
    for(const room of before.rooms)
      check(JSON.stringify(added.rooms.find(item=>item.id===room.id)?.rect)===JSON.stringify(room.rect),
        'Adding a service rearranged an existing room.');
    const selected=await native.evaluate(()=>{
      const planner=window.nativePlanner,room=planner.getScene().rooms.find(item=>item.type==='lift');
      if(!room)return {error:'Added lift did not fit the test fixture.'};
      const revision=planner.getProject().revision;
      planner.select({kind:'room',id:room.id});
      return {revision,id:room.id};
    });
    check(!selected.error,selected.error);
    await native.getByRole('button',{name:'Delete selected…',exact:true}).click();
    check(await native.evaluate(()=>window.nativePlanner.getProject().revision)===selected.revision,
      'Opening the deletion review changed geometry.');
    await native.getByRole('button',{name:'Confirm room deletion',exact:true}).click();
    const deleted=await native.evaluate(selected=>({
      revision:window.nativePlanner.getProject().revision,previous:selected.revision,
      removed:!window.nativePlanner.getScene().rooms.some(item=>item.id===selected.id),
    }),selected);
    check(!deleted.error&&deleted.removed&&deleted.revision===deleted.previous+1,'Incumbent selected-room deletion failed.');
    await native.evaluate(()=>window.nativePlanner.undo());
    check(await native.evaluate(()=>window.nativePlanner.getScene().rooms.some(item=>item.type==='lift')),
      'Undo did not restore the deleted service.');
    const compatible=await native.evaluate(()=>{
      const planner=window.nativePlanner,inactiveId=planner.getProject().activeFloorId;
      planner.execute({type:'add-floor',copyFromId:inactiveId});
      const before=planner.getProject(),rooms=JSON.stringify(planner.getScene().rooms),
        inactive=JSON.stringify(before.floors.find(floor=>floor.id===inactiveId)),
        candidate=structuredClone(before.nativeSiteSource);
      candidate.workspaceVersion++;candidate.fingerprint+='-compatible';
      candidate.site.latitude+=.01;
      planner.execute({type:'link-native-site',source:candidate});
      const after=planner.getProject(),preserved=rooms===JSON.stringify(planner.getScene().rooms)
        &&inactive===JSON.stringify(after.floors.find(floor=>floor.id===inactiveId));
      planner.undo();
      const undone=planner.getProject();
      return {preserved,oneRevision:after.revision===before.revision+1,
        sourceApplied:after.site.latitude===candidate.site.latitude,
        undoExact:JSON.stringify({...undone,revision:before.revision,updatedAt:before.updatedAt})===JSON.stringify(before)};
    });
    check(compatible.preserved&&compatible.oneRevision&&compatible.sourceApplied&&compatible.undoExact,
      `Compatible Site change/floor preservation failed: ${JSON.stringify(compatible)}`);
    const source=await native.evaluate(()=>window.nativePlanner.getProject().nativeSiteSource);
    const linked=await native.evaluate(source=>{
      const before=window.nativePlanner.exportProject();
      const candidate=structuredClone(source);
      candidate.result.F={bw:1,bd:1};candidate.result.usable=1;
      try{window.nativePlanner.execute({type:'link-native-site',source:candidate});return {accepted:true};}
      catch(error){return {accepted:false,error:error.message,preserved:before===window.nativePlanner.exportProject()};}
    },source);
    check(!linked.accepted&&linked.preserved,'An incompatible Site envelope overwrote the manually retained layout.');
    check(!errors.length, errors.join('; '));
    await native.evaluate(()=>window.nativeRoot.unmount());
    await native.evaluate(async()=>{
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:DOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {NativeDesign}=await import('/src/platform/NativeDesign.tsx');
      window.nativeRoot=DOM.createRoot(window.nativeHost);
      window.nativeRoot.render(React.createElement(NativeDesign,{
        cache:window.nativeCache,...window.siteFixture,onPlannerChange:planner=>window.nativePlanner=planner,
      }));
    });
    await native.waitForFunction(()=>window.nativePlanner?.getScene()?.rooms.length);
    check(!errors.length,errors.join('; '));
    check(!await native.locator('.native-design > [role="alert"]').count(),'Remount failed to restore the saved controls.');
    await native.evaluate(()=>window.nativeRoot.unmount());
    return {generationParity:true,programmeDraft:true,oneApplyRevision:true,
      addedServicePreservesRooms:true,selectedRoomDeleteUndo:true,compatibleSiteUndo:true,
      inactiveFloorPreserved:true,initialFailureRetry:true,remount:true,registration:true,incompatibleSitePreserved:true,errors};
  } finally { await context.close(); }
}
