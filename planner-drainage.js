(function(root,factory){
  'use strict';
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./planner-services.js'));
  else root.HomePlannerDrainage=factory(root.HomePlannerServices);
})(typeof globalThis!=='undefined'?globalThis:this,function(Services){
  'use strict';
  const EPS=1e-7,FALL_TOLERANCE_M=1e-6;
  const key=(floorId,id)=>JSON.stringify([floorId,id]);
  const entityKey=e=>key(e.floorId,e.id);
  const refKey=r=>key(r.floorId,r.entityId);
  const finite=Number.isFinite,positive=v=>finite(v)&&v>0;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const known=v=>finite(v)?v:null;
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
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='systems'))
      throw new TypeError('Drainage options accept only systems.');
    const selected=Object.hasOwn(options,'systems')?options.systems:['waste','rain'];
    if(!Array.isArray(selected)||selected.some(s=>!['waste','rain'].includes(s))||new Set(selected).size!==selected.length)
      throw new TypeError('systems must be a unique array of waste and/or rain.');
    if(!Services?.build)throw new Error('Load HomePlannerServices before HomePlannerDrainage.');
    // Keep all disciplines for coordination; selection must not hide a crossing water pipe.
    const base=Services.build(drawing),entries=new Map();
    for(const e of drawing.authored)if(['serviceNodes','serviceRoutes'].includes(e.collection))
      entries.set(key(e.floorId,e.record.id),e);
    const nodes=base.nodes.filter(n=>selected.includes(n.system)).map(copy);
    const routes=base.routes.filter(r=>selected.includes(r.system)).map(copy);
    const nodeMap=new Map(nodes.map(n=>[entityKey(n),n]));
    const routeMap=new Map(routes.map(r=>[entityKey(r),r]));
    const owners=new Map([...nodeMap,...routeMap]),findings=[];
    const limit=message=>{throw new RangeError(`Drainage foundation limit exceeded: ${message}. Partition the input explicitly.`);};
    let comparisons=0;
    const check=(count=1)=>{comparisons+=count;if(comparisons>1000000)limit('1000000 coordination comparisons');};
    function finding(code,e,message,related=[]){
      if(e&&!e.issues.includes(code))e.issues.push(code);
      for(const ref of related){
        const other=owners.get(entityKey(ref));
        if(other&&!other.issues.includes(code))other.issues.push(code);
      }
      findings.push({code,severity:'warning',floorId:e?.floorId??null,
        entityIds:e?[e.id,...related.map(r=>r.id)]:related.map(r=>r.id),message,
        componentId:e?.componentId??null,
        entityRefs:[...(e?[e]:[]),...related].map(r=>({floorId:r.floorId,entityId:r.id}))});
    }
    for(const n of nodes){
      const raw=entries.get(entityKey(n)).record;
      for(const field of ['groundM','finishedFloorM','levelSource','levelReference','accessRadiusM','discharge'])
        n[field]=copy(raw[field]??null);
      n.componentId=null;
      n.invertBelowGroundM=finite(n.groundM)&&finite(n.invertM)?n.groundM-n.invertM:null;
      n.finishedFloorAboveGroundM=finite(n.finishedFloorM)&&finite(n.groundM)?n.finishedFloorM-n.groundM:null;
    }
    for(const r of routes){
      const raw=entries.get(entityKey(r)).record;
      r.viaInvertsM=raw.viaInvertsM?raw.viaInvertsM.slice():r.via.map(()=>null);
      r.slopeSource=raw.slopeSource??null;r.slopeReference=raw.slopeReference??null;
      r.clearanceM=raw.clearanceM??null;r.componentId=null;
    }
    // Match the shared core's weak-component edge rules, without merging sanitary and storm.
    const adjacency=new Map(nodes.map(n=>[entityKey(n),[]]));
    for(const r of routes){
      const a=nodeMap.get(refKey(r.from)),b=nodeMap.get(refKey(r.to));
      if(!a||!b||a.system!==r.system||b.system!==r.system||r.issues.includes('circuit-mismatch'))continue;
      adjacency.get(entityKey(a)).push({node:b,route:r});
      adjacency.get(entityKey(b)).push({node:a,route:r});
    }
    const components=[];
    for(const n of nodes){
      if(n.componentId!==null)continue;
      const componentId=entityKey(n),members=[n];n.componentId=componentId;
      for(let i=0;i<members.length;i++)for(const edge of adjacency.get(entityKey(members[i]))){
        edge.route.componentId=componentId;
        if(edge.node.componentId===null){edge.node.componentId=componentId;members.push(edge.node);}
      }
      components.push(members);
    }
    for(const f of base.findings){
      if(f.code==='rain-coordination-deferred')continue;
      const owner=f.floorId!==null?owners.get(key(f.floorId,f.entityIds[0])):null;
      if(f.floorId!==null&&!owner)continue;
      const cloned=copy(f);
      if(f.code==='engineering-not-assessed')
        cloned.message='Supplied drainage levels and geometric intent only. No hydraulic capacity, sizing, compliance, infiltration, septic design or flood safety is assessed.';
      if(f.code==='unknown-slope')cloned.message='Supplied fall/run intention is unknown; measured geometry does not invent a design slope.';
      findings.push({...cloned,componentId:owner?.componentId??null,
        entityRefs:owner?[{floorId:owner.floorId,entityId:owner.id}]:[]});
    }
    for(const e of [...nodes,...routes])e.issues=e.issues.filter(c=>c!=='rain-coordination-deferred');
    finding('plot-frame-assumption',null,'Bounds use the projected rectangular plot frame, not the buildable floor/setback plate. This is not a surveyed legal boundary.');
    for(const members of components){
      const first=members[0],outlets=members.filter(n=>n.kind==='outlet');
      if(!outlets.length){
        finding('unknown-discharge-destination',first,'This component has no explicit outlet destination; no sewer or other connection is assumed.');
        finding('unknown-outfall-level',first,'This component has no supplied outlet invert; no external level is assumed.');
      }
      for(const n of outlets){
        if(n.discharge===null)finding('unknown-discharge-destination',n,'This component outlet has no selected discharge destination; no sewer is inferred.');
        else finding('discharge-not-assessed',n,'Selected destination and reference are unverified intent, not permission, receiving capacity, infiltration, septic sizing or flood safety.');
        if(!finite(n.invertM))finding('unknown-outfall-level',n,'This component outlet invert is unknown, independently of its anchor elevation.');
      }
    }
    const scenes=new Map(drawing.scenes.map(s=>[s.floorId,s]));
    function bounds(e,points){
      const plot=scenes.get(e.floorId)?.plot;
      if(!plot||![plot.x,plot.y,plot.w,plot.h].every(finite)||!positive(plot.w)||!positive(plot.h)){
        finding('unknown-plot-boundary',e,'No registered rectangular property boundary is available.');return;
      }
      if(points.some(p=>!p))finding('incomplete-property-check',e,'Unknown locations prevent a complete property-boundary check.');
      if(points.some(p=>p&&(p.x<plot.x-EPS||p.y<plot.y-EPS||p.x>plot.x+plot.w+EPS||p.y>plot.y+plot.h+EPS)))
        finding('outside-property-boundary',e,'An authored point lies outside the actual rectangular plot. External connections need explicit boundary/permission review; no setback or buildable-plate restriction is imposed.');
    }
    for(const n of nodes){
      if(n.groundM===null)finding('unknown-ground-level',n,'No local ground level is supplied; the scene terrain/floor plane is not substituted.');
      if(n.finishedFloorM===null)finding('unknown-finished-floor-level',n,'No local finished-floor level is supplied; owner-floor elevation is not substituted.');
      if(n.levelSource!==null||n.levelReference!==null)
        finding('unverified-level-provenance',n,'Level source/reference is an input claim, not survey or engineer verification.');
      if(n.invertBelowGroundM!==null){
        finding('cover-depth-not-assessed',n,'Invert-below-ground difference is not cover: nominal diameter does not establish outside pipe height, wall thickness or invert/axis relationship.');
        if(n.invertBelowGroundM<-FALL_TOLERANCE_M)finding('invert-above-ground',n,'Supplied invert exceeds supplied local ground. Review independent level inputs.');
      }
      if(n.finishedFloorAboveGroundM!==null&&n.finishedFloorAboveGroundM<-FALL_TOLERANCE_M)
        finding('finished-floor-below-ground',n,'Supplied finished floor is below supplied local ground; this comparison is not flood analysis.');
      if(n.accessRadiusM===null)finding('unknown-access-radius',n,'No access review radius is supplied; no regulatory clearance is assumed.');
      bounds(n,[n.anchor]);
    }
    for(const r of routes){
      const a=nodeMap.get(refKey(r.from)),b=nodeMap.get(refKey(r.to));
      const ends=[a?.system===r.system?a:null,b?.system===r.system?b:null];
      const mixed=ends.some(n=>n?.issues.includes('mixed-circuit-component'));
      const vent=r.circuit==='vent';
      const applicable=!vent&&!mixed&&!r.issues.includes('circuit-mismatch')&&
        (r.system==='rain'?r.circuit==='storm':['soil','waste'].includes(r.circuit));
      r.gravityStatus=vent?'not-applicable':applicable?'applicable':'unknown';
      if(!applicable)finding(vent?'vent-gravity-not-applicable':'gravity-circuit-unresolved',r,
        vent?'Vent intent is retained in the network but excluded from gravity fall calculations.':
          'Unknown or contradictory circuit/component intent prevents gravity interpretation; no circuit is inferred.');
      if(r.slopeSource!==null||r.slopeReference!==null)
        finding('unverified-slope-provenance',r,'Slope source/reference is an unverified input claim, not a validated drainage design.');
      if(r.clearanceM===null)finding('unknown-clearance',r,'No radial clearance review distance is supplied; envelope coordination is unknown, not zero or safe.');
      else if(r.clearanceM===0)finding('zero-clearance-intent',r,'Explicit zero is retained but supplies no positive clearance-review envelope.');
      r.profile=profile(r,ends,entries.get(entityKey(r)).anchorStatus,applicable,finding);
      bounds(r,r.points);
    }
    coordinate(drawing,base.routes,routeMap,nodes,entries,finding,check);
    return freeze({version:1,projectId:base.projectId,revision:base.revision,inputFingerprint:base.inputFingerprint,
      nodes,routes,findings,engineeringStatus:'not-assessed'});
  }
  function profile(route,ends,anchorStatus,applicable,finding){
    const points=route.points,invertsM=[known(ends[0]?.invertM),...route.viaInvertsM,known(ends[1]?.invertM)];
    const stationsM=[points[0]?0:null],segments=[];
    let planComplete=anchorStatus==='resolved'&&points.every(Boolean);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],run=a&&b?Math.hypot(b.x-a.x,b.y-a.y):null;
      let station=run!==null&&stationsM[i-1]!==null?stationsM[i-1]+run:null;
      if(station!==null&&(!finite(station)||(run>0&&station===stationsM[i-1]))){
        station=null;planComplete=false;
        finding('profile-precision-limit',route,'Horizontal station accumulation is below numeric precision; total run remains unknown.');
      }
      stationsM.push(station);
      const fall=applicable&&finite(invertsM[i-1])&&finite(invertsM[i])?invertsM[i-1]-invertsM[i]:null;
      const gradient=fall!==null&&run!==null&&run>EPS?fall/run:null;
      const verticalDrop=run!==null&&run<=EPS&&fall!==null&&fall>FALL_TOLERANCE_M;
      const expected=applicable&&planComplete&&run!==null&&run>0&&finite(route.slope)?run*route.slope:null;
      segments.push({fromIndex:i-1,toIndex:i,horizontalRunM:run,
        axisLengthM:a&&b?Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z):null,
        measuredFallM:fall,measuredGradient:gradient,verticalDrop,expectedFallM:expected,
        slopeDifferenceM:fall!==null&&expected!==null?fall-expected:null});
      if(fall!==null&&fall<-FALL_TOLERANCE_M)finding('reverse-fall',route,`Segment ${i} rises in the authored from-to direction.`);
      else if(fall!==null&&Math.abs(fall)<=FALL_TOLERANCE_M)
        finding('zero-fall',route,`Segment ${i} has no measurable invert fall within numerical tolerance; this is not slope compliance.`);
      if(verticalDrop)finding('vertical-drop',route,`Segment ${i} has supplied invert drop and zero/sub-tolerance plan run; gradient is undefined, not infinite.`);
      if(expected!==null&&fall!==null&&Math.abs(fall-expected)>FALL_TOLERANCE_M)
        finding('slope-intent-mismatch',route,`Segment ${i} measured fall differs from supplied slope intention by more than 1e-6 m; inputs are not changed.`);
    }
    const horizontalLengthM=planComplete&&stationsM.at(-1)!==null?stationsM.at(-1):null;
    const invertFallAvailable=applicable&&finite(invertsM[0])&&finite(invertsM.at(-1));
    const invertProfileComplete=applicable&&invertsM.every(finite);
    const measuredFallM=invertFallAvailable?invertsM[0]-invertsM.at(-1):null;
    const expectedFallM=applicable&&horizontalLengthM!==null&&horizontalLengthM>0&&finite(route.slope)?
      horizontalLengthM*route.slope:null;
    const slopeDifferenceM=measuredFallM!==null&&expectedFallM!==null?measuredFallM-expectedFallM:null;
    if(applicable&&!invertProfileComplete)
      finding('incomplete-invert-profile',route,'At least one invert station is unknown. Endpoint fall may be known, but internal intervals are never interpolated.');
    if(!planComplete||horizontalLengthM===null)finding('incomplete-horizontal-profile',route,'Full horizontal route stations/total cannot be established.');
    if(applicable&&route.slope===0)finding('zero-slope-intent',route,'Supplied slope intention is zero; no compliant minimum is inferred.');
    if(measuredFallM!==null&&measuredFallM<-FALL_TOLERANCE_M)
      finding('reverse-fall',route,'Known endpoint inverts rise overall in the authored direction, independently of intermediate profile completeness.');
    else if(measuredFallM!==null&&Math.abs(measuredFallM)<=FALL_TOLERANCE_M)
      finding('zero-fall',route,'Known endpoint inverts have no net fall within numerical tolerance; intermediate intervals may remain unknown.');
    if(slopeDifferenceM!==null&&Math.abs(slopeDifferenceM)>FALL_TOLERANCE_M)
      finding('slope-intent-mismatch',route,'Endpoint fall differs from total horizontal run times supplied slope by more than 1e-6 m. Agreement would not validate unknown intermediate stations.');
    return {invertsM,stationsM,segments,horizontalLengthM,axisLengthM:route.lengthM,
      planComplete:planComplete&&horizontalLengthM!==null,invertFallAvailable,invertProfileComplete,
      profileComplete:planComplete&&horizontalLengthM!==null&&invertProfileComplete,
      measuredFallM,measuredGradient:measuredFallM!==null&&horizontalLengthM!==null&&horizontalLengthM>EPS?
        measuredFallM/horizontalLengthM:null,expectedFallM,slopeDifferenceM};
  }
  function coordinate(drawing,allRoutes,selected,nodes,entries,finding,check){
    const segments=r=>{
      const result=[];
      for(let i=1;i<r.points.length;i++)if(r.points[i-1]&&r.points[i])result.push([r.points[i-1],r.points[i]]);
      return result;
    };
    const groups=allRoutes.map(r=>({route:r,segments:segments(r),
      clearanceM:entries.get(entityKey(r)).record.clearanceM??null}));
    const pairWork=list=>{
      let sum=0,squares=0;
      for(const group of list){sum+=group.segments.length;squares+=group.segments.length**2;}
      return (list.length*(list.length-1)+sum*sum-squares)/2;
    };
    check(pairWork(groups)-pairWork(groups.filter(g=>!selected.has(entityKey(g.route)))));
    const unknownPairs=new Set();
    for(let i=0;i<groups.length;i++){
      const a=groups[i];if(!selected.has(entityKey(a.route)))continue;
      for(let j=0;j<groups.length;j++){
        const b=groups[j];if(i===j||(j<i&&selected.has(entityKey(b.route))))continue;
        const owner=selected.get(entityKey(a.route)),other=b.route;
        const sized=positive(a.route.diameterMm)&&positive(b.route.diameterMm)&&positive(a.clearanceM)&&positive(b.clearanceM);
        let conflict=false,shared=false;
        for(const [p,q] of a.segments)for(const [r,s] of b.segments){
          if(sized&&!conflict&&segmentDistance(p,q,r,s)<=
            (a.route.diameterMm+b.route.diameterMm)/2000+a.clearanceM+b.clearanceM+EPS){
            conflict=true;finding('potential-route-envelope-conflict',owner,
              'Actual 3D segment distance intersects supplied nominal diameter plus radial review-clearance envelopes. Candidate only: axis/invert relationship, OD, fittings and connection intent are unverified.',[other]);
          }
          if(!shared&&Math.hypot(q.x-p.x,q.y-p.y)<=EPS&&Math.hypot(s.x-r.x,s.y-r.y)<=EPS&&
            Math.abs(q.z-p.z)>EPS&&Math.abs(s.z-r.z)>EPS&&Math.hypot(p.x-r.x,p.y-r.y)<=EPS&&
            Math.min(Math.max(p.z,q.z),Math.max(r.z,s.z))-Math.max(Math.min(p.z,q.z),Math.min(r.z,s.z))>EPS){
            shared=true;finding('shared-riser-zone-needs-review',owner,
              'Vertical authored segments share plan position and overlapping z ranges. Review shared riser space; no shaft geometry or safe penetration is invented.',[other]);
          }
        }
        if(!sized&&!unknownPairs.has(entityKey(owner))){
          unknownPairs.add(entityKey(owner));finding('route-pair-clearance-unknown',owner,
            'At least one pair envelope review is incomplete: both routes need known positive nominal diameter and positive supplied clearance. First unresolved pair is referenced; no missing input becomes zero.',[other]);
        }
      }
    }
    const footprints=[];
    const add=(id,floorId,origin,ux,uy,length,width)=>{
      if(origin&&[origin.x,origin.y,ux,uy].every(finite)&&positive(length)&&positive(width))
        footprints.push({id,floorId,origin,ux,uy,length,width});
    };
    for(const scene of drawing.scenes)for(const w of scene.walls){
      if(w.removed)continue;
      const length=Math.hypot(w.end.x-w.start.x,w.end.y-w.start.y),ux=(w.end.x-w.start.x)/length,uy=(w.end.y-w.start.y)/length;
      for(const s of w.solidSections||[])add(w.id,scene.floorId,
        {x:w.start.x+ux*s.startM,y:w.start.y+uy*s.startM},ux,uy,s.endM-s.startM,w.thicknessM);
    }
    for(const e of drawing.authored)if(e.collection==='structural'&&e.record.kind!=='grid'){
      const r=e.record,a=e.anchorStatus==='resolved'&&e.anchors[0]?.status==='resolved'?e.anchors[0].point:null;
      if(r.kind==='beam'){
        const b=e.anchors[1]?.status==='resolved'?e.anchors[1].point:null,length=a&&b?Math.hypot(b.x-a.x,b.y-a.y):0;
        if(a&&b&&length>EPS)add(r.id,e.floorId,a,(b.x-a.x)/length,(b.y-a.y)/length,length,r.widthM);
      }else if(a)add(r.id,e.floorId,{x:a.x-r.widthM/2,y:a.y},1,0,r.widthM,r.depthM);
    }
    check(nodes.filter(n=>n.accessRadiusM!==null&&n.anchor).length*footprints.length);
    for(const n of nodes)if(n.accessRadiusM!==null){
      finding('access-review-plan-only',n,'Supplied access radius is a plan review distance, not a code requirement. Access height and vertical working volume are unknown; all-floor footprint candidates are not physical clashes.');
      if(!n.anchor)continue;
      const hits=new Set();
      for(const box of footprints){
        const dx=n.anchor.x-box.origin.x,dy=n.anchor.y-box.origin.y;
        const x=dx*box.ux+dy*box.uy,y=-dx*box.uy+dy*box.ux;
        const distance=Math.hypot(Math.max(0,-x,x-box.length),Math.max(0,-box.width/2-y,y-box.width/2));
        if(distance<=n.accessRadiusM+EPS&&!hits.has(entityKey(box))){
          hits.add(entityKey(box));finding('access-plan-candidate',n,
            'Supplied access circle touches/overlaps a represented wall/member footprint in plan. Vertical access extent is unknown; review levels before treating this as a physical conflict.',[box]);
        }
      }
    }
  }
  const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
  const along=(p,v,t)=>({x:p.x+v.x*t,y:p.y+v.y*t,z:p.z+v.z*t});
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  function pointSegment(p,a,b){
    const v=subtract(b,a),length=dot(v,v);
    return distance(p,along(a,v,length>0?Math.max(0,Math.min(1,dot(subtract(p,a),v)/length)):0));
  }
  function segmentDistance(a,b,c,d){
    const u=subtract(b,a),v=subtract(d,c),w=subtract(a,c),normal=cross(u,v),denominator=dot(normal,normal);
    let result=Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
    if(denominator>0){
      const s=dot(cross(v,w),normal)/denominator,t=dot(cross(u,w),normal)/denominator;
      if(s>=0&&s<=1&&t>=0&&t<=1)result=Math.min(result,distance(along(a,u,s),along(c,v,t)));
    }
    return result;
  }
  return Object.freeze({build});
});
