(function(root){
  'use strict';
  class LocationError extends Error{
    constructor(message,code){super(message);this.name='LocationError';this.code=code;}
  }
  function detect(options={}){
    const secure=options.secureContext??root.isSecureContext??true;
    const geolocation=options.geolocation??root.navigator?.geolocation;
    if(!secure)return Promise.reject(new LocationError(
      'Location access requires HTTPS or localhost. Enter the site coordinates manually.','insecure'));
    if(!geolocation||typeof geolocation.getCurrentPosition!=='function')
      return Promise.reject(new LocationError('This browser cannot detect location. Enter the coordinates manually.','unsupported'));
    return new Promise((resolve,reject)=>{
      geolocation.getCurrentPosition(position=>{
        const {latitude,longitude,accuracy}=position.coords||{};
        if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||
           Math.abs(longitude)>180||!Number.isFinite(accuracy)||accuracy<0){
          reject(new LocationError('The device returned an invalid location. Enter coordinates manually or try again.','invalid'));
          return;
        }
        resolve({latitude,longitude,accuracyM:accuracy,timestamp:position.timestamp});
      },error=>{
        const messages={
          1:'Location permission was denied. Allow location in browser settings or enter coordinates manually.',
          2:'The device location is unavailable. Check location services or enter coordinates manually.',
          3:'Location detection timed out. Try again outdoors or enter coordinates manually.'
        };
        reject(new LocationError(messages[error.code]||
          'The browser could not determine your location. Enter coordinates manually.','geolocation-'+error.code));
      },{enableHighAccuracy:true,timeout:10000,maximumAge:0});
    });
  }
  const api=Object.freeze({detect,LocationError});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HomePlannerLocation=api;
})(globalThis);
