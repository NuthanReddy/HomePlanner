// Reuse the incumbent plot test harness as an independent migration oracle.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = fs.readFileSync(path.join(__dirname, 'plot-planner.test.cjs'), 'utf8');
const context = vm.createContext({
  __dirname,
  require: name => name === 'node:test' ? () => {} : require(name),
});
vm.runInContext(fixture.slice(0, fixture.indexOf("test('all allowable floor counts")), context);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const results = cases.map(entry => {
  const site=entry.site??entry;
  const { inputs, state, context: legacy } = vm.runInContext('load()', context);
  const values = {pEW:site.width,pNS:site.depth,dunit:site.units==='ft'?.3048:1,
    ht:site.height_m,ffh:site.floor_height_m,floorCount:site.floors??'max',
    face:site.facing,cat:site.category,use:site.use};
  for(const [key,value] of Object.entries(values)) inputs[key].value=value;
  inputs.stilt.checked=site.stilt;
  inputs.tdr.checked=site.tdr??false;
  inputs.dev.checked=site.compounding??false;
  inputs.customSetbacks.checked=site.custom_setbacks??false;
  for(const role of ['Front','Rear','Left','Right'])inputs['setback'+role].value=site['setback_'+role.toLowerCase()+'_m']??'';
  state.roads=site.roads;
  const r=legacy.compute();
  const result={gross_area_m2:r.grossA,net_area_m2:r.netA,widening_m:r.widenStrip,
    setbacks_m:r.E,usable_m2:r.usable,coverage_percent:r.cov,max_floors:r.maxFloors,
    floors:r.floors,built_up_m2:r.builtUp};
  if(entry.costs){
    vm.runInContext(html.slice(html.indexOf('const LRS_BASIC'),html.indexOf('const RS =')),legacy);
    const c=entry.costs;
    const fields={plotRate:c.land_inr_m2*.83612736,plotRateUnit:'sqyd',
      govRate:c.land_sro_inr_m2*.83612736,govRateUnit:'sqyd',
      flatRate:(c.flat_sro_inr_m2??0)*.09290304,buildRate:c.construction_inr_m2*.09290304,
      stiltRate:c.stilt_rate_mode==='legacy-55-percent'?'':(c.stilt_inr_m2??0)*.09290304,
      stampPct:c.registration_percent,gstPct:c.gst_percent,lrsMode:c.lrs_mode??'na',
      brsMode:c.brs_mode??'na',brsArea:(c.brs_violated_m2??0)/.09290304};
    for(const [key,value] of Object.entries(fields))inputs[key]={value:String(value)};
    inputs.lrsRebate={checked:c.lrs_rebate===true};
    const cost=legacy.costModel(r);
    result.cost={subtotal_inr:cost.total,costed_footprint_m2:cost.costFootprintSqm,costed_built_up_m2:cost.builtSqm,
      onward_sale_sro_inr:cost.flatSroValue,onward_sale_duty_inr:cost.flatDutyCost,
      inr_per_built_ft2:cost.perSqftBuilt,lines_inr:{
        'Land purchase':cost.plotCost,'Registration at supplied rate':cost.stampCost,
        'Construction':cost.buildCost,'Stilt':cost.stiltCost,'GST at supplied rate':cost.gstCost,
        'LRS regularisation':cost.lrsCost,'BRS regularisation':cost.brsCost,
        'Betterment (included in BRS when due)':cost.effBetterment,
        'Infrastructure impact (included in BRS when due)':cost.effImpact,
        'Labour cess':cost.cessCost,'Rule 26(d) compounding':cost.devFine}};
    if(entry.samples){
      const ctx={effRoad:r.effRoad,roadCapHt:r.roadCapHt,roadFloorCap:r.roadFloorCap,rbi:r.rbi,
        ffh:r.ffh,tdr:r.tdr,dev:r.devOn,use:r.use,stilt:r.stilt,cost,
        floorCount:site.floors??null,setbacks:site.custom_setbacks?
          {front:site.setback_front_m,rear:site.setback_rear_m,left:site.setback_left_m,right:site.setback_right_m}:null};
      result.samples=entry.samples.map(p=>legacy.evalPlot(p.area,p.aspect,ctx));
    }
  }
  if(site.split_edge){
    const edge=site.split_edge, ns='NS'.includes(edge);
    const f=(ns?site.width:site.depth)*(site.units==='ft'?.3048:1);
    const d=(ns?site.depth:site.width)*(site.units==='ft'?.3048:1);
    const best=legacy.bestSplit(f,d,site.roads[edge],site.category,site.floor_height_m);
    const selected=legacy.splitPair(f,d,site.split_fraction,site.roads[edge],site.category,site.floor_height_m);
    result.split={best_fraction:best.frac,best_usable:best.usable,best_built:best.built,selected_usable:selected.usable,selected_built:selected.built};
  }
  return result;
});
process.stdout.write(JSON.stringify(results));
