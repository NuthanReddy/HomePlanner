(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerStructure=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const EPS=1e-7,MAX_ELEMENTS=1000,MAX_SCENES=1000,MAX_OPENINGS=10000,MAX_WALLS=20000,MAX_PAIRS=100000;
  const positive=value=>Number.isFinite(value)&&value>0;
  const point=value=>value&&['x','y','z'].every(key=>Number.isFinite(value[key]));
  const clonePoint=value=>({x:value.x,y:value.y,z:value.z});
  function freeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(freeze);Object.freeze(value);
    }
    return value;
  }
  function rectangle(x,y,w,d){
    return [{x,y},{x:x+w,y},{x:x+w,y:y+d},{x,y:y+d}];
  }
  function strip(start,end,width){
    const length=Math.hypot(end.x-start.x,end.y-start.y);
    const dx=-(end.y-start.y)/length*width/2,dy=(end.x-start.x)/length*width/2;
    return [{x:start.x+dx,y:start.y+dy},{x:end.x+dx,y:end.y+dy},
      {x:end.x-dx,y:end.y-dy},{x:start.x-dx,y:start.y-dy}];
  }
  function volume(polygon,z,h,extra={}){
    return {...extra,polygon,z,top:z+h,minX:Math.min(...polygon.map(p=>p.x)),
      maxX:Math.max(...polygon.map(p=>p.x)),minY:Math.min(...polygon.map(p=>p.y)),maxY:Math.max(...polygon.map(p=>p.y))};
  }
  function usableVolume(v){
    return [v.z,v.top,v.minX,v.maxX,v.minY,v.maxY].every(Number.isFinite)&&v.top>v.z&&
      v.polygon.every((p,i)=>Math.hypot(p.x-v.polygon[(i+1)%v.polygon.length].x,
        p.y-v.polygon[(i+1)%v.polygon.length].y)>0);
  }
  function boundsMeet(a,b){
    return a.minX<=b.maxX+EPS&&a.maxX>=b.minX-EPS&&a.minY<=b.maxY+EPS&&a.maxY>=b.minY-EPS;
  }
  // A balanced bounds tree avoids scanning every aperture/support for each member.
  function index(items){
    if(!items.length)return null;
    const box={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
    for(const item of items)for(const axis of ['X','Y']){
      box[`min${axis}`]=Math.min(box[`min${axis}`],item[`min${axis}`]);
      box[`max${axis}`]=Math.max(box[`max${axis}`],item[`max${axis}`]);
    }
    if(items.length<=8)return {...box,items};
    const axis=box.maxX-box.minX>=box.maxY-box.minY?'X':'Y';
    items.sort((a,b)=>(a[`min${axis}`]/2+a[`max${axis}`]/2)-(b[`min${axis}`]/2+b[`max${axis}`]/2));
    const middle=Math.floor(items.length/2);
    return {...box,left:index(items.slice(0,middle)),right:index(items.slice(middle))};
  }
  function query(tree,box,visit){
    if(!tree||!boundsMeet(tree,box))return;
    if(tree.items){for(const item of tree.items)if(boundsMeet(item,box))visit(item);}
    else{query(tree.left,box,visit);query(tree.right,box,visit);}
  }
  function contains(polygon,p){
    let sign=0;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b.x-a.x,b.y-a.y);
      const cross=((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/length;
      if(Math.abs(cross)<=EPS)continue;
      if(sign&&Math.sign(cross)!==sign)return false;
      sign=Math.sign(cross);
    }
    return true;
  }
  // Separating axes use actual oriented rectangles, not their enclosing bounds.
  function overlaps(a,b){
    if(Math.min(a.top,b.top)-Math.max(a.z,b.z)<=EPS)return false;
    for(const polygon of [a.polygon,b.polygon])for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length],length=Math.hypot(q.x-p.x,q.y-p.y);
      const nx=-(q.y-p.y)/length,ny=(q.x-p.x)/length;
      const aa=a.polygon.map(v=>v.x*nx+v.y*ny),bb=b.polygon.map(v=>v.x*nx+v.y*ny);
      if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=EPS)return false;
    }
    return true;
  }
  function build(drawing){
    if(!drawing||drawing.version!==1||drawing.kind!=='DrawingScene'||!Array.isArray(drawing.authored)||
      !Array.isArray(drawing.scenes))throw new TypeError('Expected a version 1 DrawingScene from HomePlannerProjection.build.');
    if(drawing.scenes.length>MAX_SCENES||drawing.authored.length>70000)
      throw new RangeError('Structural coordination input limit exceeded (1000 scenes / 70000 authored records).');
    const entries=drawing.authored.filter(entry=>entry.collection==='structural');
    if(entries.length>MAX_ELEMENTS)throw new RangeError('Structural coordination limit exceeded (1000 elements).');
    let openingCount=0,wallCount=0;
    for(const scene of drawing.scenes){
      if(scene.coordinateSpace!=='site-local'||!Array.isArray(scene.walls)||!Array.isArray(scene.openings))
        throw new TypeError('Structural coordination requires projected site-local scenes.');
      openingCount+=scene.openings.length;wallCount+=scene.walls.length;
    }
    if(openingCount>MAX_OPENINGS||wallCount>MAX_WALLS)
      throw new RangeError('Structural coordination input limit exceeded (10000 openings / 20000 walls).');
    let pairs=0;
    const consume=()=>{if(++pairs>MAX_PAIRS)throw new RangeError('Structural coordination candidate-pair limit exceeded (100000); partition the input explicitly.');};
    const elements=[],findings=[],solids=[],sceneByFloor=new Map(drawing.scenes.map(scene=>[scene.floorId,scene]));
    function finding(code,element,message,ids=element?[element.id]:[],floorId=element?.floorId??null){
      if(element&&!element.issues.includes(code))element.issues.push(code);
      findings.push({code,severity:'warning',elementIds:ids,floorId,message});
    }
    finding('engineering-not-assessed',null,
      'Conceptual geometry coordination only. Structural engineering is not assessed: dimensions, materials and reference claims are not verified. A qualified engineer must determine structural adequacy; no loads, soil, reinforcement or cost are inferred.');
    for(const entry of entries){
      const r=entry.record,anchors=entry.anchors.map(a=>a?.status==='resolved'&&point(a.point)?clonePoint(a.point):null);
      const e={id:r.id,floorId:entry.floorId,kind:r.kind,label:r.label||r.id,sizeSource:r.sizeSource??'unspecified',
        reference:r.reference??null,anchors,widthM:r.widthM,depthM:r.depthM,heightM:r.heightM??null,
        material:r.material,geometry:null,issues:[]};
      elements.push(e);
      const segment=['beam','grid'].includes(e.kind),knownKind=['column','slab','footing','beam','grid'].includes(e.kind);
      if(!knownKind)finding('unsupported-kind',e,'This structural intent kind has no coordination representation.');
      if(anchors.length!==(segment?2:1)||anchors.some(a=>!a))
        finding('unresolved-anchor',e,'One or more anchor positions are unresolved; no member geometry is generated.');
      if(e.kind!=='grid'){
        const missing=['widthM','depthM',...(!segment?['heightM']:[])].filter(key=>!positive(e[key]));
        if(missing.length)finding('unknown-dimensions',e,`Coordination dimensions are unknown or unusable: ${missing.join(', ')}. No extent is guessed.`);
        if(e.material===null||e.material===undefined)finding('unknown-material',e,'Material is unknown; the coordination shape does not establish a material specification.');
      }
      if(e.sizeSource==='unspecified')finding('unknown-provenance',e,'Size/reference provenance is unspecified; geometry is not verified.');
      if(e.sizeSource==='assumed')finding('assumed-dimensions',e,'Dimensions are labeled assumed and are used only for conceptual coordination.');
      if(e.sizeSource==='engineer-provided'||e.reference!==null)
        finding('unverified-reference',e,'The supplied reference/provenance is an author claim only; no engineer, document or dimensions have been verified.');
      if(e.sizeSource==='engineer-provided'&&e.reference===null)
        finding('missing-reference',e,'Engineer-provided provenance is claimed without a reference; coordination cannot establish its source.');
      if(!e.issues.includes('unresolved-anchor')&&knownKind){
        const a=anchors[0],b=anchors[1];
        if(segment){
          if(Math.hypot(b.x-a.x,b.y-a.y)<=EPS)finding('degenerate-endpoints',e,'Coincident plan endpoints cannot define a coordination segment.');
          if(Math.abs(b.z-a.z)>EPS)finding('sloping-endpoints',e,'Sloping endpoints are not supported by this horizontal coordination representation.');
          if(e.heightM!==null)finding('unsupported-height',e,'Beam thickness uses depthM; grids have no vertical extent. Separate heightM is unsupported.');
          if(e.kind==='grid'&&[e.widthM,e.depthM,e.material].some(value=>value!==null))
            finding('invalid-grid-input',e,'A grid is a reference segment without sizes or material.');
          if(!e.issues.some(code=>['degenerate-endpoints','sloping-endpoints','unsupported-height','invalid-grid-input','unknown-dimensions'].includes(code)))
            e.geometry=e.kind==='grid'?{kind:'grid',start:clonePoint(a),end:clonePoint(b)}:
              {kind:'beam',start:clonePoint(a),end:clonePoint(b),widthM:e.widthM,depthM:e.depthM};
        }else if(!e.issues.includes('unknown-dimensions')){
          e.geometry={kind:'box',x:a.x-e.widthM/2,y:a.y-e.depthM/2,z:a.z,w:e.widthM,d:e.depthM,h:e.heightM};
        }
      }
      let g=e.geometry;
      if(g&&g.kind!=='grid'){
        const v=g.kind==='box'?volume(rectangle(g.x,g.y,g.w,g.d),g.z,g.h,{element:e}):
          volume(strip(g.start,g.end,g.widthM),g.start.z,g.depthM,{element:e});
        if(usableVolume(v))solids.push(v);
        else{
          finding('geometry-precision-limit',e,'Supplied extents collapse at these coordinates in numeric precision; no usable coordination solid is generated.');
          e.geometry=null;g=null;
        }
      }
      const scene=sceneByFloor.get(e.floorId),plot=scene?.plot;
      const footprint=g?.kind==='box'?rectangle(g.x,g.y,g.w,g.d):g?.kind==='beam'?strip(g.start,g.end,g.widthM):
        !segment&&anchors[0]&&positive(e.widthM)&&positive(e.depthM)?
          rectangle(anchors[0].x-e.widthM/2,anchors[0].y-e.depthM/2,e.widthM,e.depthM):anchors.filter(Boolean);
      if(!plot)finding('missing-plot-information',e,'A registered plot is unavailable; plot-boundary coordination is unknown.');
      else if(footprint.some(p=>p.x<plot.x-EPS||p.x>plot.x+plot.w+EPS||p.y<plot.y-EPS||p.y>plot.y+plot.h+EPS))
        finding('out-of-plot',e,'Known member geometry or anchors extend outside the projected plot; check geometric placement only.');
    }
    const apertures=[];
    for(const scene of drawing.scenes){
      const walls=new Map(scene.walls.map(wall=>[wall.id,wall]));
      for(const opening of scene.openings){
        const wall=walls.get(opening.wallId),s=opening.segment;
        // A valid aperture can consume every wall solid; "removed" does not
        // remove the opening's physical clearance from coordination.
        if(!wall||!s||![s.x1,s.y1,s.x2,s.y2,wall.baseM,opening.sillM].every(Number.isFinite)||
          !positive(wall.thicknessM)||!positive(opening.heightM)||Math.hypot(s.x2-s.x1,s.y2-s.y1)<=EPS){
          finding('missing-opening-information',null,'An aperture has incomplete geometry; its volume coordination is unknown.',[opening.id],scene.floorId);
          continue;
        }
        const aperture=volume(strip({x:s.x1,y:s.y1},{x:s.x2,y:s.y2},wall.thicknessM),
          wall.baseM+opening.sillM,opening.heightM,{id:opening.id});
        if(usableVolume(aperture))apertures.push(aperture);
        else finding('missing-opening-information',null,
          'Aperture extents collapse in numeric precision; aperture volume coordination is unknown.',[opening.id],scene.floorId);
      }
      if(scene.unresolvedOpenings?.length)finding('unresolved-openings',null,
        'Rejected or unresolved opening proposals are not usable aperture volumes; their coordination remains unknown.',[],scene.floorId);
    }
    const apertureIndex=index(apertures);
    for(const solid of solids)query(apertureIndex,solid,aperture=>{
      consume();
      if(overlaps(solid,aperture))finding('opening-volume-conflict',solid.element,
        'The conceptual member and an opening aperture have overlapping volumes; review geometric coordination, not structural adequacy.',
        [solid.element.id,aperture.id]);
    });
    const supportIndex=index(solids.slice()),solidsByFloor=new Map(),incompleteByFloor=new Set();
    for(const solid of solids){
      const floor=solid.element.floorId;
      if(!solidsByFloor.has(floor))solidsByFloor.set(floor,[]);
      solidsByFloor.get(floor).push(solid);
    }
    for(const e of elements)if(e.kind!=='grid'&&!e.geometry)incompleteByFloor.add(e.floorId);
    for(const e of elements){
      if(e.kind==='grid')continue;
      if(!e.geometry){
        finding('missing-support-information',e,'Incomplete member geometry prevents even geometric support-contact coordination.');
        continue;
      }
      if(e.kind==='slab'||e.kind==='footing'){
        finding('missing-support-information',e,e.kind==='slab'?
          'Slab support layout is not evaluated by this rectangular-intent foundation; support information remains incomplete.':
          'Ground/foundation support is not represented or assessed; the footing is rectangular intent only.');
        continue;
      }
      const own=solidsByFloor.get(e.floorId).find(s=>s.element===e);
      if(e.kind==='beam'){
        e.anchors.forEach((p,i)=>{
          let contact=false;
          query(supportIndex,{minX:p.x,maxX:p.x,minY:p.y,maxY:p.y},candidate=>{
            consume();
            if(candidate!==own&&candidate.z<p.z-EPS&&Math.abs(candidate.top-p.z)<=EPS&&contains(candidate.polygon,p))contact=true;
          });
          if(!contact)finding('unsupported-endpoint',e,
            `Beam endpoint ${i+1} has no known bottom-to-top geometric support contact; this is missing coordination information, not a capacity conclusion.`);
        });
        if(e.issues.includes('unsupported-endpoint'))finding('missing-support-information',e,
          'One or more beam endpoint support contacts cannot be established from the supplied solid intents.');
        continue;
      }
      const floorScene=sceneByFloor.get(e.floorId);
      const lower=drawing.scenes.filter(s=>Number.isFinite(s.floorElevationM)&&s.floorElevationM<floorScene?.floorElevationM-EPS)
        .sort((a,b)=>b.floorElevationM-a.floorElevationM)[0];
      let contact=false,partial=false;
      query(supportIndex,own,candidate=>{
        consume();
        if(candidate===own||candidate.z>=own.z-EPS||Math.abs(candidate.top-own.z)>EPS)return;
        if(own.polygon.every(p=>contains(candidate.polygon,p)))contact=true;
        else partial=true;
      });
      const lowerKnown=lower?(solidsByFloor.get(lower.floorId)||[]):[];
      if(!contact&&(lowerKnown.length||partial))finding('column-support-mismatch',e,
        'The column bottom has no complete footprint contact with a known support top; check elevations and plan alignment. Partial or combined contacts are not resolved.');
      if(!contact||!lower||incompleteByFloor.has(lower.floorId))finding('missing-support-information',e,
        'Column support information is incomplete or contact is unknown. Absence of a mismatch is not structural verification.');
    }
    return freeze({version:1,projectId:drawing.projectId,revision:drawing.revision,inputFingerprint:drawing.inputFingerprint,
      elements,findings,engineeringStatus:'not-assessed'});
  }
  return Object.freeze({build});
});
