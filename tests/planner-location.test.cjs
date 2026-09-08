const test=require('node:test');
const assert=require('node:assert/strict');
const {detect,LocationError}=require('../planner-location.js');

test('location detection only runs on invocation and returns the device accuracy',async()=>{
  let calls=0;
  const geolocation={getCurrentPosition(success,error,options){
    calls++;
    assert.equal(options.maximumAge,0);
    assert.equal(options.timeout,10000);
    success({coords:{latitude:17.4,longitude:78.5,accuracy:12},timestamp:123});
  }};
  assert.equal(calls,0);
  assert.deepEqual(await detect({geolocation,secureContext:true}),
    {latitude:17.4,longitude:78.5,accuracyM:12,timestamp:123});
  assert.equal(calls,1);
});

test('permission, unavailable and timeout failures preserve explicit error codes',async()=>{
  for(const code of [1,2,3]){
    const geolocation={getCurrentPosition(success,failure){failure({code});}};
    await assert.rejects(detect({geolocation}),error=>
      error instanceof LocationError&&error.code==='geolocation-'+code);
  }
});

test('insecure origins and invalid device coordinates cannot look successful',async()=>{
  let called=false;
  const geolocation={getCurrentPosition(success){called=true;success({coords:{latitude:NaN,longitude:0,accuracy:1}});}};
  await assert.rejects(detect({geolocation,secureContext:false}),error=>error.code==='insecure');
  assert.equal(called,false);
  await assert.rejects(detect({geolocation,secureContext:true}),error=>error.code==='invalid');
});
