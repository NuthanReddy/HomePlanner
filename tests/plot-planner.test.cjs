const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

function field(value='',checked=false){
  let text='',current=String(value),options=[];
  return {checked,dataset:{},
    get value(){return current;},
    set value(value){current=String(value);if(options.length&&!options.some(option=>option.value===current))current='';},
    get valueAsNumber(){return current===''?NaN:Number(current);},
    get innerHTML(){return text;},
    set innerHTML(value){
      text=value;options=[...value.matchAll(/<option value="([^"]+)"([^>]*)>/g)]
        .map(match=>({value:match[1],disabled:match[2].includes('disabled')}));
      if(options.length)current=options[0].value;
    },
    get options(){return options;}
  };
}

function load(){
  const inputs=Object.fromEntries(Object.entries({
    cat:'B',use:'res',face:'N',dunit:'1',pEW:'20',pNS:'17.5',ht:'12',ffh:'3',
    floorCount:'max',splitPos:'50',setbackFront:'3',setbackRear:'2',setbackLeft:'2',setbackRight:'2'
  }).map(([key,value])=>[key,field(value)]));
  Object.assign(inputs,{tdr:field('',false),dev:field('',false),stilt:field('',true),customSetbacks:field('',false)});
  const state={roads:{N:12},axis:null};
  const maps={N:{N:'N',E:'E',S:'S',W:'W'},E:{N:'E',E:'S',S:'W',W:'N'},
    S:{N:'S',E:'W',S:'N',W:'E'},W:{N:'W',E:'N',S:'E',W:'S'}};
  const context=vm.createContext({ROOM_EPS:1e-7,$:id=>inputs[id],
    readRoads:()=>state.roads,splitAxisEdge:()=>state.axis,
    roomLocalEdgeGlobal:(edge,front)=>maps[front][edge],render(){}});
  vm.runInContext(html.slice(html.indexOf('const ROAD_BANDS'),html.indexOf('/* ================= Compass')),context);
  vm.runInContext(html.slice(html.indexOf('const DIRNAME'),html.indexOf('const $ =')),context);
  for(const pattern of [/const M2SY[^\n]+/,/const FRONT_PRIORITY[^\n]+/,/const floorLabel[^\n]+/,
    /function roadBandIdx[^\n]+/,/function plotBand[^\n]+/])
    vm.runInContext(html.match(pattern)[0],context);
  vm.runInContext(html.slice(html.indexOf('class PlotInputError'),html.indexOf('function scenarioSettings')),context);
  for(const name of ['scenarioSettings','compute','fillFloorCounts','fillHeights','envelopeFor','splitPair','bestSplit','useRuleSetbacks','evalPlot']){
    const source=html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(source,`Missing ${name}`);vm.runInContext(source[0],context);
  }
  return {inputs,state,context};
}

test('all allowable floor counts include G+2 without changing height-band limits',()=>{
  const {context,inputs}=load();
  context.fillHeights();
  assert.deepEqual(inputs.floorCount.options.map(option=>option.value),['max','1','2','3','4']);
  inputs.floorCount.value='3';
  const selected=context.compute();
  assert.equal(selected.floors,3);
  assert.equal(selected.maxFloors,4);
  assert.equal(selected.selH,12);
  assert.equal(selected.builtUp,selected.usable*3);
  inputs.ht.value='7';context.fillHeights();
  assert.equal(inputs.floorCount.value,'2');
  assert.match(inputs.floorCount.dataset.adjustment,/G\+2.*G\+1/);
  assert.equal(context.compute().maxFloors,2);
});

test('custom setbacks change geometry but retain rule minima and explicit non-compliance',()=>{
  const {context,inputs}=load();
  const before=context.compute();
  inputs.customSetbacks.checked=true;inputs.dev.checked=true;
  inputs.setbackFront.value='1';inputs.setbackRear.value='0.5';
  inputs.setbackLeft.value='0.25';inputs.setbackRight.value='0.75';
  const after=context.compute();
  assert.deepEqual(plain(after.requiredE),plain(before.E));
  assert.deepEqual(plain(after.E),{N:1,E:0.75,S:0.5,W:0.25});
  assert.equal(after.F.bw,19);
  assert.equal(after.F.bd,16);
  assert.ok(after.usable>before.usable);
  assert.equal(after.nonCompliant,true);
  assert.equal(after.devOn,false);
  assert.equal(after.maxFloors,before.maxFloors);
  inputs.customSetbacks.checked=false;
  assert.deepEqual(plain(context.compute().E),plain(before.E));
});

test('custom side roles rotate with the chosen front and do not waive road widening',()=>{
  const {context,inputs,state}=load();
  inputs.face.value='E';state.roads={E:6};
  inputs.customSetbacks.checked=true;
  inputs.setbackFront.value='1';inputs.setbackRear.value='2';
  inputs.setbackLeft.value='3';inputs.setbackRight.value='4';
  const result=context.compute();
  assert.deepEqual(plain(result.E),{E:1,S:4,W:2,N:3});
  assert.equal(result.widenStrip,1.5);
  assert.equal(result.extEW,18.5);
  assert.equal(result.netA,18.5*17.5);
});

test('invalid custom setbacks fail explicitly and rule reset remains available',()=>{
  const {context,inputs}=load();
  inputs.customSetbacks.checked=true;
  for(const value of ['', '-1','NaN']){
    inputs.setbackLeft.value=value;
    assert.throws(()=>context.compute(),error=>error.name==='PlotInputError'&&error.field==='setbackLeft');
  }
  context.useRuleSetbacks();
  const restored=context.compute();
  assert.equal(restored.nonCompliant,false);
  assert.deepEqual(plain(restored.E),plain(restored.requiredE));
});

test('split plots apply all four custom setbacks and cap chosen floors independently',()=>{
  const {context,inputs,state}=load();
  state.axis='N';inputs.customSetbacks.checked=true;inputs.floorCount.value='3';
  inputs.setbackFront.value='1';inputs.setbackRear.value='2';
  inputs.setbackLeft.value='0.5';inputs.setbackRight.value='1.5';
  const result=context.compute();
  for(const half of [result.split.A,result.split.B]){
    assert.equal(half.bw,half.frontage-2);
    assert.equal(half.bd,half.depth-3);
    assert.equal(half.left,0.5);assert.equal(half.right,1.5);
    assert.ok(half.floors<=3&&half.floors<=half.maxFloors);
    assert.equal(half.built,half.usable*half.floors);
  }
});

test('a lower planned count does not automatically consume all available TDR floors',()=>{
  const {context,inputs,state}=load();
  inputs.pEW.value='60';inputs.pNS.value='40';inputs.ht.value='35';
  inputs.tdr.checked=true;inputs.floorCount.value='3';state.roads={N:24};
  const result=context.compute();
  assert.equal(result.tdrFloors,5);
  assert.equal(result.floors,3);
  assert.equal(result.usedTdrFloors,0);
  assert.equal(result.plannedBaseFloors,3);
  assert.ok(result.maxFloors>result.floors);
});

test('sensitivity curves apply custom setbacks and the selected floor-count cap',()=>{
  const {context}=load();
  const options={effRoad:12,roadCapHt:24,roadFloorCap:6,rbi:0,ffh:3,tdr:false,dev:false,
    floorCount:3,setbacks:{front:1,rear:2,left:0.5,right:1.5}};
  const result=context.evalPlot(350,17.5/20,options);
  assert.equal(result.floors,3);
  assert.ok(Math.abs(result.built-18*14.5*3)<1e-8);
  assert.ok(result.built>context.evalPlot(350,17.5/20,{...options,setbacks:null}).built);
});

test('product heading is shared but regulatory introduction belongs only to Plot Planner',()=>{
  const header=html.match(/<header>([^]*?)<\/header>/)[1];
  assert.match(header,/<h1>HomePlanner<\/h1>/);
  assert.doesNotMatch(header,/G\.O\.Ms|GHMC|TG-bPASS/);
  assert.match(html,/<button data-page="optimizer"[^>]*>Plot Planner<\/button>/);
  assert.match(html,/<div class="app-page on" id="page-optimizer">\s*<div class="plot-introduction">/);
  assert.match(html,/750–2,000 sq m plots: 18–21 m band; extra floors: above 2,000 sq m/);
});

test('intermediate room rebuilds cannot combine new geometry with old plot boundaries',()=>{
  const bridge=fs.readFileSync(path.join(__dirname,'..','planner-bridge.js'),'utf8');
  const source=bridge.match(/function renderContext\([^]*?\n  \}/)[0];
  const oldGeometry={W:10,D:8,frontEdge:'N'};
  const current={g:oldGeometry,plate:{id:'whole',sitePlot:{x:-2,y:-3,w:14,h:13}}};
  const context=vm.createContext({root:{__roomPlanner:current}});
  vm.runInContext(source,context);
  const newer=context.renderContext({W:20,D:18,frontEdge:'E'},{},{});
  assert.equal(newer.plate.sitePlot,undefined);
  assert.equal(newer.plate.frontEdge,'E');
  assert.deepEqual(plain(context.renderContext(oldGeometry,{},{}).plate.sitePlot),current.plate.sitePlot);
});
