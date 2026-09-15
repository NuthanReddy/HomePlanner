const test=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../prohibited-properties.js');

test('API selection preserves district, mandal, village and SRO codes as strings',()=>{
  const query=UI.selectionQuery({
    district_code:'16_1',mandal_code:'00',village_code:'1600001',sro_code:'1607'
  },'NONAGRI','court');
  assert.equal(query.get('mand_code'),'00');
  assert.equal(query.get('sro_code'),'1607');
  assert.equal(query.get('category'),'court');
  assert.equal(query.get('prohib_type'),'NONAGRI');
});

test('table search retains zeroes, punctuation and case-insensitive values',()=>{
  const rows=[['001/2','PENDYAL','0'],['003','Hyderabad','25']];
  assert.deepEqual(UI.filterRows(rows,'001/2'),[rows[0]]);
  assert.deepEqual(UI.filterRows(rows,'  hyDERabad '),[rows[1]]);
  assert.deepEqual(UI.filterRows(rows,''),rows);
  assert.deepEqual(UI.filterRows(rows,'absent'),[]);
});

test('pagination covers every row and clamps changed search results',()=>{
  const rows=Array.from({length:61},(_,index)=>[String(index)]);
  assert.deepEqual(UI.pageRows(rows,0).rows,rows.slice(0,25));
  assert.deepEqual(UI.pageRows(rows,1).rows,rows.slice(25,50));
  assert.deepEqual(UI.pageRows(rows,2).rows,rows.slice(50));
  assert.equal(UI.pageRows(rows,200).page,2);
  assert.deepEqual(UI.pageRows([],3),{rows:[],page:0,pageCount:1,total:0});
});

test('cache status never disguises a refresh failure or unpublished report',()=>{
  assert.equal(UI.cacheLabel({cached:true,status:'ready'}),'Saved - Parsed');
  assert.equal(UI.cacheLabel({cached:true,status:'ready',refresh_error:'timeout'}),'Saved copy; refresh failed');
  assert.equal(UI.cacheLabel({cached:false,status:'not_published'}),'Fetched - Not published');
  assert.equal(UI.cacheLabel({cached:false,status:'error'}),'Could not load');
});
