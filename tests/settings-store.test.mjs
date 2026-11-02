import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsStore} from '../settings-store.js';
const tick = async () => {for(let i=0;i<12;i++) await Promise.resolve();};
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const value = (revision=0, automatic=true, instanceId='host-a') => ({instanceId,revision,settings:{enabled:true,automatic,provider:'p',model:'m'},providers:[]});
function scheduler(){let next=0;const timers=new Map();return {setTimer:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id),run(ms){const found=[...timers].find(([,v])=>v.ms===ms);assert.ok(found,`timer ${ms} exists`);timers.delete(found[0]);found[1].fn();},timers};}
function channel(){const queue=[],waiters=[];let disposed=0;return {push(v){const frame={value:v,done:false};waiters.length?waiters.shift().resolve(frame):queue.push(frame);},end(){const frame={done:true};waiters.length?waiters.shift().resolve(frame):queue.push(frame);},fail(e){waiters.shift()?.reject(e);},dispose(){disposed++;},get disposed(){return disposed;},[Symbol.asyncIterator](){return this;},next(){if(queue.length)return Promise.resolve(queue.shift());const d=deferred();waiters.push(d);return d.promise;}};}
function fixture(readSettings=async()=>value()) {const clock=scheduler(),channels=[];let reads=0;const store=createSettingsStore({...clock,readSettings:()=>{reads++;return readSettings();},watchSettings:()=>{const c=channel();channels.push(c);return c;}});return {store,clock,channels,get reads(){return reads;}};}
test('startup reads config independently of a stalled stream; equal frames preserve identities',async()=>{
 const f=fixture();f.store.start();await tick();assert.equal(f.store.getSnapshot().settings.model,'m');const before=f.store.getSnapshot();
 f.channels[0].push(value());await tick();assert.equal(f.store.getSnapshot(),before);f.store.stop();await tick();assert.equal(f.clock.timers.size,0);
});
test('new stream revision defeats stale read and stale frame',async()=>{
 const d=deferred(),f=fixture(()=>d.promise);f.store.start();await tick();f.channels[0].push(value(2,false));await tick();d.resolve(value(0));await tick();assert.equal(f.store.getSnapshot().revision,2);
 const before=f.store.getSnapshot();f.channels[0].push(value(1));await tick();assert.equal(f.store.getSnapshot(),before);f.store.stop();
});
test('save invalidates prior reads and old save response cannot overwrite new push',async()=>{
 const d=deferred(),f=fixture(()=>d.promise);f.store.start();await tick();const ticket=f.store.beginSave();f.channels[0].push(value(3,false));await tick();
 assert.equal(f.store.acceptSave(value(2),ticket),false);d.resolve(value(0));await tick();assert.equal(f.store.getSnapshot().revision,3);f.store.stop();
});
test('normal stream completion retries and obtains a new baseline',async()=>{
 const f=fixture();f.store.start();await tick();f.channels[0].push(value());await tick();f.channels[0].end();await tick();assert.ok(f.store.getSnapshot().error);
 f.clock.run(500);await tick();assert.equal(f.channels.length,2);assert.equal(f.reads,2);f.channels[1].push(value(1,false));await tick();assert.equal(f.store.getSnapshot().error,null);assert.equal(f.store.getSnapshot().settings.automatic,false);f.store.stop();
});
test('failed and stalled first frames retry without leaking timers',async()=>{
 const f=fixture();f.store.start();await tick();f.channels[0].fail(new Error('offline'));await tick();f.clock.run(500);await tick();assert.equal(f.channels.length,2);
 f.clock.run(5000);await tick();assert.equal(f.channels[1].disposed,1);f.clock.run(1000);await tick();assert.equal(f.channels.length,3);f.store.stop();await tick();assert.equal(f.clock.timers.size,0);
});
test('connection restart rejects old generation frames/read/save; permits new host revision zero',async()=>{
 const d=deferred();let reads=0;const f=fixture(()=>++reads===1?d.promise:Promise.resolve(value(0,false,'host-b')));f.store.start();await tick();const old=f.channels[0],ticket=f.store.beginSave();f.store.restart();await tick();
 old.push(value(99));d.resolve(value(99));await tick();assert.equal(f.store.getSnapshot().instanceId,'host-b');assert.equal(f.store.acceptSave(value(100),ticket),false);f.store.stop();
});
test('late save from retired host instance cannot overwrite new instance in the same connection',async()=>{
 const f=fixture();f.store.start();await tick();const ticket=f.store.beginSave();f.channels[0].push(value(0,false,'host-b'));await tick();
 assert.equal(f.store.acceptSave(value(99,true,'host-a'),ticket),false);assert.equal(f.store.getSnapshot().instanceId,'host-b');f.store.stop();
});
test('hung read times out, stream retry recovers even when transport never settles',async()=>{
 const f=fixture(()=>new Promise(()=>{}));f.store.start();await tick();f.clock.run(5000);await tick();assert.ok(f.store.getSnapshot().error);
 f.channels[0].push(value(1));await tick();assert.equal(f.store.getSnapshot().error,null);assert.equal(f.store.getSnapshot().syncing,false);f.store.stop();await tick();assert.equal(f.clock.timers.size,0);
});
