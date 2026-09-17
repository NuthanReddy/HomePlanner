(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerServices=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EPS=1e-7,systems=['water','waste','rain'];
  const circuits={water:['cold','hot'],waste:['soil','waste','vent'],rain:['storm']};
  const key=(floorId,id)=>JSON.stringify([floorId,id]);
  const refKey=ref=>key(ref.floorId,ref.entityId);
  const point=value=>value&&['x','y','z'].every(axis=>Number.isFinite(value[axis]));
  const copyPoint=p=>({x:p.x,y:p.y,z:p.z});
  const resolved=a=>a?.status==='resolved'&&point(a.point)?copyPoint(a.point):null;
  const positive=value=>Number.isFinite(value)&&value>0;
  function freeze(root){
    const pending=[root];
    while(pending.length){
      const value=pending.pop();
      if(value&&typeof value==='object'&&!Object.isFrozen(value)){
        Object.freeze(value);for(const child of Object.values(value))pending.push(child);
      }
    }
    return root;
  }
  function build(drawing,options={}){
    if(!drawing||drawing.version!==1||drawing.kind!=='DrawingScene'||!Array.isArray(drawing.authored)||
      !Array.isArray(drawing.scenes))throw new TypeError('Expected a version 1 DrawingScene from HomePlannerProjection.build.');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='systems'))
      throw new TypeError('Services options accept only systems.');
    const selected=Object.hasOwn(options,'systems')?options.systems:systems;
    if(!Array.isArray(selected)||selected.some(s=>!systems.includes(s))||new Set(selected).size!==selected.length)
      throw new TypeError('systems must be a unique array of water, waste and/or rain.');
    const limit=message=>{throw new RangeError(`Service foundation limit exceeded: ${message}. Partition the input explicitly.`);};
    if(drawing.authored.length>70000||drawing.scenes.length>1000)limit('70000 authored records / 1000 scenes');
    let nodeCount=0,routeCount=0,fixtureCount=0,segmentCount=0;
    for(const e of drawing.authored){
      if(e.collection==='serviceNodes')nodeCount++;
      if(e.collection==='fixtures')fixtureCount++;
      if(e.collection==='serviceRoutes'){routeCount++;segmentCount+=e.record.via.length+1;}
    }
    if(nodeCount>10000||routeCount>10000||fixtureCount>10000||segmentCount>100000)
      limit('10000 nodes, routes or fixtures / 100000 route segments');
    const nodes=[],routes=[],fixtures=[],findings=[],nodeMap=new Map(),fixtureMap=new Map(),entries=new Map();
    const adjacency=new Map(),attachedFixtures=new Set(),sceneMap=new Map();
    function finding(code,e,message,related=[]){
      if(e&&!e.issues.includes(code))e.issues.push(code);
      findings.push({code,severity:code==='network-cycle'?'info':'warning',floorId:e?.floorId??null,
        entityIds:e?[e.id,...related]:related,message});
    }
    finding('engineering-not-assessed',null,
      'Authored connectivity and axis geometry only. No pressure, demand, capacity, sizing, flow, drainage fall validation, code compliance or engineering adequacy is computed.');
    finding('unsupported-equipment',null,
      'Pumps, tanks, roof vent terminals and fitting internals are unsupported. Equipment fixtures are unclassified intent, not engineered devices.');
    finding('coordination-incomplete',null,
      'Axis-only coordination is partial, not a clearance or penetration design. Unknown sizes, source geometry assumptions and unrepresented construction prevent a coordination pass.');
    for(const scene of drawing.scenes){
      if(scene.coordinateSpace!=='site-local'||!Array.isArray(scene.walls))
        throw new TypeError('Services require projected site-local scenes.');
      sceneMap.set(scene.floorId,scene);
    }
    function anchorIssues(e,entry){
      for(const a of entry.anchors||[])if(a?.status!=='resolved'||!point(a.point)){
        finding(a?.code||'unresolved-anchor',e,'A supplied anchor is unresolved; repair its host or location.');
        if(a?.causeCode)finding(a.causeCode,e,'The anchor host dependency could not be resolved.');
      }
      if(entry.anchorStatus!=='resolved')finding('unresolved-anchor',e,'The shared projection marks this intent unresolved.');
    }
    function physicalIssues(e){
      if(e.circuit===null)finding('unknown-circuit',e,'Circuit is unresolved; no cold, soil or other default is selected.');
      if(!positive(e.diameterMm))finding('unknown-diameter',e,'Pipe diameter is unknown; use a line/marker only, never a default pipe thickness.');
    }
    for(const entry of drawing.authored){
      const r=entry.record;
      if(entry.collection==='fixtures'){
        const f={id:r.id,floorId:entry.floorId,kind:r.kind,anchor:entry.anchorStatus==='resolved'?resolved(entry.anchors[0]):null,
          widthM:r.widthM,depthM:r.depthM,heightM:r.heightM,issues:[]};
        fixtures.push(f);fixtureMap.set(key(f.floorId,f.id),f);anchorIssues(f,entry);
        if(!f.anchor)finding('unknown-level',f,'Fixture position and connection level are unresolved.');
        if(['widthM','depthM','heightM'].some(k=>!positive(f[k])))
          finding('unknown-fixture-size',f,'Fixture dimensions remain unknown; no connection ports or extents are invented.');
        if(f.kind==='equipment')finding('unsupported-equipment',f,'Equipment type and device internals are not modeled.');
      }
      if(entry.collection!=='serviceNodes'||!selected.includes(r.system))continue;
      const n={id:r.id,floorId:entry.floorId,system:r.system,kind:r.kind,role:r.role??null,label:r.label??null,
        circuit:r.circuit??null,anchor:entry.anchorStatus==='resolved'?resolved(entry.anchors[0]):null,
        diameterMm:r.diameterMm,invertM:r.invertM,issues:[]};
      const k=key(n.floorId,n.id);
      if(nodeMap.has(k))throw new TypeError('Duplicate service node reference.');
      nodes.push(n);nodeMap.set(k,n);entries.set(k,entry);adjacency.set(k,[]);
      anchorIssues(n,entry);physicalIssues(n);
      if(!n.anchor)finding('unknown-level',n,'Node anchor elevation is unresolved.');
      if(n.invertM===null)finding('unknown-invert',n,'Project-relative invert is not supplied; it is independent of the anchor.');
      if(n.anchor&&Number.isFinite(n.invertM)&&n.invertM>n.anchor.z+EPS)
        finding('invert-anchor-conflict',n,'Supplied invert is above the route anchor/axis. Review the independent level inputs; the anchor is not moved.');
      if((n.role==='valve'&&n.system!=='water')||(['trap','cleanout','floor-trap','gully-trap','chamber'].includes(n.role)&&
        (n.system==='water'||n.circuit==='vent'))||(n.kind==='supply'&&n.system!=='water')||
        (n.kind==='outlet'&&n.system==='water')||
        (['roof-outlet','downpipe'].includes(n.role)&&n.system!=='rain')||
        (n.role==='floor-trap'&&n.system!=='waste'))
        finding('unusual-service-purpose',n,'Base kind/fitting purpose is unusual for this circuit; no device behavior is inferred.');
      if(n.system==='rain')finding('rain-coordination-deferred',n,'Stormwater coordination and discharge design belong to a later phase.');
    }
    for(const n of nodes){
      const entry=entries.get(key(n.floorId,n.id)),a=entry.record.anchor;
      if(a?.kind==='entity'&&a.entityKind==='fixture'){
        const k=refKey(a);
        if(fixtureMap.has(k))attachedFixtures.add(k);
        else finding('missing-fixture-host',n,'The explicitly referenced fixture is missing.');
      }else if(n.role==='port')finding('unhosted-fixture-port',n,'A port has no explicit entity anchor to a fixture; its location does not establish a fixture connection.');
    }
    const rawNodeMap=new Map(drawing.authored.filter(e=>e.collection==='serviceNodes')
      .map(e=>[key(e.floorId,e.record.id),e]));
    for(const entry of drawing.authored){
      const r=entry.record;
      if(entry.collection!=='serviceRoutes'||!selected.includes(r.system))continue;
      const points=Array.from({length:r.via.length+2},(_,i)=>resolved(entry.anchors[i]));
      const route={id:r.id,floorId:entry.floorId,system:r.system,label:r.label??null,circuit:r.circuit??null,
        from:{...r.from},to:{...r.to},via:[],points,diameterMm:r.diameterMm,slope:r.slope,
        lengthM:null,isRiser:false,issues:[]};
      routes.push(route);anchorIssues(route,entry);physicalIssues(route);
      const ends=[nodeMap.get(refKey(r.from)),nodeMap.get(refKey(r.to))];
      for(let i=0;i<2;i++){
        const ref=i?r.to:r.from,n=ends[i],raw=rawNodeMap.get(refKey(ref));
        if(!raw){
          points[i?points.length-1:0]=null;
          finding('dangling-node',route,'A route endpoint is not an existing service node.',[ref.entityId]);
          if(!sceneMap.has(ref.floorId))finding('unresolved-endpoint-floor',route,'Endpoint floor is absent or has no registered geometry.');
        }else if(raw.record.system!==r.system){
          points[i?points.length-1:0]=null;
          finding('service-system-mismatch',route,'Endpoint belongs to a different system; no connection is made.',[ref.entityId]);
        }else if(!n?.anchor)points[i?points.length-1:0]=null;
      }
      route.via=points.slice(1,-1);
      const knownCircuits=new Set([route.circuit,...ends.map(n=>n?.circuit)].filter(c=>c!==null&&c!==undefined));
      if(knownCircuits.size>1)finding('circuit-mismatch',route,'Known route/endpoint circuits contradict; no automatic rewiring or blending is performed.');
      if(ends.some(n=>n?.system===route.system&&n.circuit===null))
        finding('unknown-endpoint-circuit',route,'An endpoint circuit remains unresolved.');
      if(route.system!=='water'&&route.slope===null)
        finding('unknown-slope',route,'Entered fall/run intent is unknown; geometric drainage profiles are not evaluated here.');
      if(route.system==='rain')finding('rain-coordination-deferred',route,'Stormwater coordination is deferred.');
      let length=0,complete=entry.anchorStatus==='resolved'&&points.every(Boolean);
      for(let i=1;i<points.length;i++){
        const a=points[i-1],b=points[i];if(!a||!b)continue;
        const distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
        if(distance<=EPS)finding('zero-length-segment',route,`Segment ${i} is coincident or below the 1e-7 m geometry tolerance.`);
        if(distance>0&&length+distance===length){complete=false;finding('geometry-precision-limit',route,'A segment is lost at the accumulated numeric precision; length is unresolved.');}
        length+=distance;
        if(Math.abs(b.z-a.z)>EPS&&Math.hypot(b.x-a.x,b.y-a.y)<=EPS)route.isRiser=true;
      }
      if(complete&&Number.isFinite(length))route.lengthM=length;
      else finding('incomplete-route',route,'Full ordered endpoint/via geometry is unresolved; no partial length is reported as a total.');
      if(r.from.floorId!==r.to.floorId){
        route.isRiser=true;
        finding('inter-floor-proposal',route,'Cross-floor route is a straight-segment proposal through its supplied points, not designed floor penetrations or intermediate landings.');
        if(points[0]&&points.at(-1)&&Math.abs(points[0].z-points.at(-1).z)<=EPS)
          finding('inter-floor-level-conflict',route,'Different endpoint floors have equal anchor elevations; review intended continuity.');
      }
      if(ends.every(n=>n&&n.system===route.system)&&!route.issues.includes('circuit-mismatch')){
        const a=refKey(r.from),b=refKey(r.to);
        adjacency.get(a).push({other:b,route});adjacency.get(b).push({other:a,route});
      }
      if(ends[1]?.kind==='supply'&&route.system==='water')
        finding('supply-direction-conflict',route,'Proposed from-to direction enters a supply endpoint; no hydraulic flow is solved.');
      if(ends[0]?.kind==='outlet'&&route.system!=='water')
        finding('outlet-direction-conflict',route,'Proposed from-to direction leaves a discharge endpoint; review authored intent.');
    }
    // Weak components describe authored topology only; unknown geometry never becomes a valid hydraulic edge.
    const visited=new Set();
    for(const n of nodes){
      const start=key(n.floorId,n.id);if(visited.has(start))continue;
      const queue=[start],members=[],edges=new Set(),known=new Set();visited.add(start);
      for(let i=0;i<queue.length;i++){
        const k=queue[i],member=nodeMap.get(k);members.push(member);
        if(member.circuit!==null)known.add(member.circuit);
        for(const edge of adjacency.get(k)){
          edges.add(edge.route);
          if(edge.route.circuit!==null)known.add(edge.route.circuit);
          if(!visited.has(edge.other)){visited.add(edge.other);queue.push(edge.other);}
        }
      }
      if(known.size>1)for(const member of members)
        finding('mixed-circuit-component',member,'This component joins conflicting known circuits through unresolved circuit intent.');
      if(edges.size>=members.length)finding('network-cycle',n,'Authored topology contains a cycle. Water loops may be intentional; this is not a blanket error or solved flow.');
      const required=n.system==='water'?'supply':'outlet';
      if(!members.some(m=>m.kind===required))finding(`missing-${required}`,n,
        `This individual ${n.system} component has no explicit ${required} endpoint. No root or external connection is assumed.`);
      for(const member of members)if(!adjacency.get(key(member.floorId,member.id)).length)
        finding(member.kind==='fixture'||member.role==='port'?'disconnected-fixture-port':'disconnected-node',
          member,'No compatible authored route connects this node; proximity never creates an edge.');
    }
    for(const f of fixtures)if(!attachedFixtures.has(key(f.floorId,f.id)))
      finding('fixture-without-service-port',f,'No selected-system node explicitly references this fixture; connections are not synthesized.');
    coordinate(drawing,routes,finding,limit);
    return freeze({version:1,projectId:drawing.projectId,revision:drawing.revision,inputFingerprint:drawing.inputFingerprint,
      nodes,routes,fixtures,findings,engineeringStatus:'not-assessed'});
  }
  function coordinate(drawing,routes,finding,limit){
    const boxes=[];let walls=0,sections=0,checks=0;
    function box(id,floorId,origin,ux,uy,length,width,height){
      if(!point(origin)||![length,width,height].every(positive)||!Number.isFinite(ux)||!Number.isFinite(uy)){
        finding('coordination-geometry-unknown',null,'A wall/member lacks usable extents; axis coordination is unknown.',[id]);return;
      }
      if(origin.z+height===origin.z||origin.x+ux*length===origin.x&&origin.y+uy*length===origin.y){
        finding('coordination-geometry-unknown',null,'Member extents collapse in numeric precision.',[id]);return;
      }
      boxes.push({id,floorId,origin,ux,uy,length,width,height});
      if(boxes.length>30000)limit('30000 coordination solids');
    }
    for(const scene of drawing.scenes)for(const wall of scene.walls){
      if(++walls>20000)limit('20000 walls');
      if(wall.removed)continue;
      const a=wall.start,b=wall.end,len=Math.hypot(b.x-a.x,b.y-a.y),ux=(b.x-a.x)/len,uy=(b.y-a.y)/len;
      if(!Array.isArray(wall.solidSections)){
        finding('coordination-geometry-unknown',null,'Wall solid sections are unavailable.',[wall.id]);continue;
      }
      for(const s of wall.solidSections){
        if(++sections>30000)limit('30000 wall sections');
        box(wall.id,scene.floorId,{x:a.x+ux*s.startM,y:a.y+uy*s.startM,z:wall.baseM+s.sillM},
          ux,uy,s.endM-s.startM,wall.thicknessM,s.heightM);
      }
    }
    for(const e of drawing.authored)if(e.collection==='structural'&&e.record.kind!=='grid'){
      const r=e.record,a=e.anchorStatus==='resolved'?resolved(e.anchors[0]):null;
      if(r.kind==='beam'){
        const b=resolved(e.anchors[1]),length=a&&b?Math.hypot(b.x-a.x,b.y-a.y):0;
        if(a&&b&&length>EPS&&Math.abs(a.z-b.z)<=EPS)
          box(r.id,e.floorId,a,(b.x-a.x)/length,(b.y-a.y)/length,length,r.widthM,r.depthM);
        else finding('coordination-geometry-unknown',null,'Structural beam axis or slope is unresolved/unsupported.',[r.id]);
      }else box(r.id,e.floorId,a?{x:a.x-r.widthM/2,y:a.y,z:a.z}:null,1,0,r.widthM,r.depthM,r.heightM);
    }
    // Explicit pair budget bounds worst-case dense coordination without silently dropping candidates.
    for(const r of routes){
      const hit=new Set();
      for(let i=1;i<r.points.length;i++){
        const a=r.points[i-1],b=r.points[i];if(!a||!b)continue;
        for(const box of boxes){
          if(++checks>1000000)limit('1000000 axis/solid comparisons');
          if(hit.has(key(box.floorId,box.id)))continue;
          const local=p=>({x:(p.x-box.origin.x)*box.ux+(p.y-box.origin.y)*box.uy,
            y:-(p.x-box.origin.x)*box.uy+(p.y-box.origin.y)*box.ux,z:p.z-box.origin.z});
          if(intersects(local(a),local(b),[0,-box.width/2,0],[box.length,box.width/2,box.height])){
            hit.add(key(box.floorId,box.id));
            finding('possible-penetration-conflict',r,'Pipe axis touches/crosses a wall or conceptual structural solid without a supplied service penetration design.',[box.id]);
          }
        }
      }
    }
  }
  function intersects(a,b,min,max){
    let low=0,high=1;
    for(let i=0;i<3;i++){
      const axis=['x','y','z'][i],delta=b[axis]-a[axis];
      if(Math.abs(delta)<=EPS){if(a[axis]<min[i]-EPS||a[axis]>max[i]+EPS)return false;continue;}
      let enter=(min[i]-EPS-a[axis])/delta,exit=(max[i]+EPS-a[axis])/delta;
      if(enter>exit)[enter,exit]=[exit,enter];
      low=Math.max(low,enter);high=Math.min(high,exit);if(low>high)return false;
    }
    return true;
  }
  return Object.freeze({build});
});
