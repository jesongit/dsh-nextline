import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clientPlugin} from '../client-source.js';
const settle = async () => {for(let i=0;i<16;i++) await Promise.resolve();};
function fixture({legacyLeak=false}={}) {
 const dictionaries=new Map(), slots=new Map();let streams=0, mounts=0, resets=new Set(),activeEffects=[];
 if(legacyLeak)dictionaries.set('composer-predictions',new Map([['en',{}],['zh',{}]]));
 const React={createElement:(type,props,...children)=>({type,props,children})};
 const settings={instanceId:'test',revision:0,settings:{enabled:true,automatic:false,provider:'p',model:'m'},providers:[]};
 const api={readSettings:async()=>({ok:true,value:settings}),watchSettings(signal){
  return (async function*(){streams++;try{yield settings;await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});}finally{streams--;}})();
 }};
 const locale={register(ns,dicts){let existing=dictionaries.get(ns);if(!existing){existing=new Map();dictionaries.set(ns,existing);}for(const k of Object.keys(dicts))if(existing.has(k))throw new Error('duplicate locale '+ns+'/'+k);for(const [k,v]of Object.entries(dicts))existing.set(k,v);return()=>{for(const [k,v]of Object.entries(dicts))if(existing.get(k)===v)existing.delete(k);};},bind:()=>key=>key};
 const effect=fn=>{const dispose=fn();if(dispose)activeEffects.push(dispose);return dispose;};
 const ctx={locale,effect,remote:{$mount:async()=>{mounts++;effect(()=>()=>mounts--);}},get:key=>key==='remote.composerPredictions'?api:undefined,
  slots:{inject(_slot,fn){return effect(fn);},register(options,component){const key=options.name+'/'+options.id;if(slots.has(key))throw new Error('duplicate slot');slots.set(key,{options,component});return()=>slots.delete(key);}},
  on(name,fn){assert.equal(name,'connection/reset');resets.add(fn);effect(()=>()=>resets.delete(fn));},conversation:{},sessions:{}};
 return {ctx,React,dictionaries,slots,get streams(){return streams;},get mounts(){return mounts;},get resetCount(){return resets.size;},
  async dispose(){for(const fn of activeEffects.splice(0).reverse())await fn();await settle();}};
}
test('real client apply unload/reapply keeps dictionaries, slots, stream and reset ownership balanced',async()=>{
 const f=fixture();
 for(let i=0;i<4;i++){
  await clientPlugin(f.React).apply(f.ctx);await settle();
  assert.equal(f.slots.size,2);assert.equal(f.dictionaries.get('composer-predictions-ui').size,2);assert.equal(f.streams,1);assert.equal(f.mounts,1);assert.equal(f.resetCount,1);
  await f.dispose();assert.equal(f.slots.size,0);assert.equal(f.dictionaries.get('composer-predictions-ui').size,0);assert.equal(f.streams,0);assert.equal(f.mounts,0);assert.equal(f.resetCount,0);
 }
});
test('new owned namespace recovers an open page with old unowned dictionaries',async()=>{
 const f=fixture({legacyLeak:true});await clientPlugin(f.React).apply(f.ctx);await settle();assert.equal(f.slots.size,2);assert.equal(f.dictionaries.get('composer-predictions').size,2);await f.dispose();
 assert.equal(f.dictionaries.get('composer-predictions-ui').size,0);assert.equal(f.dictionaries.get('composer-predictions').size,2);
});
