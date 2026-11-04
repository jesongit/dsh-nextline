import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createComposerPredictionsClass} from '../host-service.js';
import {DEFAULTS, contextFromSession, contextFromMessages} from '../engine.js';
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
async function flush() {for (let i=0;i<12;i++) await Promise.resolve();}
function clock() {
 let time=0, next=0; const timers=new Map();
 return {now:()=>time,setTimer(fn,ms){const id=++next;timers.set(id,{at:time+ms,fn});return id;},clearTimer:id=>timers.delete(id),advance(ms){time+=ms;for(const [id,t] of [...timers]) if(t.at<=time){timers.delete(id);t.fn();}},timers};
}
const message=(role,text)=>({role,content:[{type:'text',text}]});
function fixture({prepare, settings={}}={}) {
 const runtime=clock(); let prepareCalls=0, edits=0;
 const dispose=[], events=new Map(), refs={};
 for(const [key,value] of Object.entries({...DEFAULTS,provider:'p',model:'m',...settings})) {
  let val=value;const listeners=new Set();refs[key]={get:()=>val,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},set(v){val=v;for(const fn of listeners)fn();},notify(){for(const fn of listeners)fn();}};
 }
 const session={id:'s',header:{},deriveMessages:()=>[message('user','fix'),message('assistant','fixed')]};
 const boundary={sourceSeq:10,running:false};
 const ctx={fiber:{entry:'plugin'},effect(fn){const cleanup=fn();if(typeof cleanup==='function')dispose.push(cleanup);},on(name,fn){events.set(name,fn);},
  sessions:{get:id=>id==='s'?session:null},
  sessionProjections:{register(){},onChanged(fn){events.set('projection',fn);},stateOf:()=>boundary},
  llm:{listProviders:()=>[{id:'p'}],resolveModelInfo:async()=>{},listModels:async()=>[],prepareCall(...args){prepareCalls++;return prepare?prepare(...args):Promise.resolve({config:{},stream:async function*(){yield{type:'text-delta',text:'Run tests.'};yield{type:'finish',reason:{kind:'stop'}};}});}},
  configEditor:{async edit(_id,change){edits++;const values=Object.fromEntries(Object.entries(refs).map(([k,r])=>[k,r.get()]));const updated=change(values);for(const [k,v] of Object.entries(updated))if(refs[k].get()!==v)refs[k].set(v);}}
 };
 class Base {constructor(ctx){this.ctx=ctx;}}
 const scalar=()=>({});const z={object:scalar,number:scalar,boolean:scalar};
 const C=createComposerPredictionsClass({TypertRemoteService:Base,RemoteError:Error,z,createUserMessage:x=>x},{...runtime,randomUUID:()=> 'instance-1'});
 const service=new C(ctx,refs);
 return {service,ctx,refs,boundary,session,events,runtime,dispose:()=>dispose.forEach(fn=>fn()),get calls(){return prepareCalls;},get edits(){return edits;}};
}
function prepared(text='Run tests.') {return {config:{},stream:async function*(){yield{type:'text-delta',text};yield{type:'finish',reason:{kind:'stop'}};}};}

test('same live work is shared; one caller cancellation does not abort remaining subscriber',async()=>{
 const wait=deferred();let providerSignal;
 const f=fixture({prepare:(_c,s)=>{providerSignal=s;return wait.promise;}}),a=new AbortController(),b=new AbortController();
 const p=f.service.predict('s',10,a.signal),q=f.service.predict('s',10,b.signal);await flush();
 assert.equal(f.calls,1);a.abort();assert.equal((await p).reason,'cancelled');assert.equal(providerSignal.aborted,false);
 wait.resolve(prepared());const value=await q;assert.equal(value.status,'ready');assert.equal(value.meta.cached,false);
 assert.equal((await f.service.predict('s',10)).meta.cached,true);assert.equal(f.calls,1);assert.equal(f.runtime.timers.size,0);
});
test('last cancellation immediately detaches noncooperative work; old finalizer cannot evict or cache replacement',async()=>{
 const old=deferred(),replacement=deferred();let calls=0;
 const f=fixture({prepare:()=>++calls===1?old.promise:replacement.promise}),a=new AbortController();
 const p=f.service.predict('s',10,a.signal);await flush();a.abort();assert.equal((await p).reason,'cancelled');assert.equal(f.service.active.size,0);
 const q=f.service.predict('s',10);await flush();assert.equal(f.calls,2);const entry=f.service.active.get('s');
 old.resolve(prepared('Old text.'));await flush();assert.equal(f.service.cache.size,0);assert.equal(f.service.active.get('s'),entry);
 replacement.resolve(prepared('New text.'));assert.equal((await q).text,'New text.');assert.equal(f.service.cache.get('s').value.text,'New text.');
});
test('hard deadline settles hung prepare and consumes late rejection without cache writes',async()=>{
 const wait=deferred();let signal;const f=fixture({prepare:(_c,s)=>{signal=s;return wait.promise;}});
 const p=f.service.predict('s',10);await flush();f.runtime.advance(20000);const result=await p;
 assert.equal(result.status,'error');assert.equal(result.code,'timeout');assert.match(result.message,/20000/);assert.equal(signal.aborted,true);
 assert.equal(result.meta.timings.totalMs,20000);assert.equal(f.service.active.size,0);assert.equal(f.runtime.timers.size,0);
 wait.reject(new Error('late provider failure'));await flush();assert.equal(f.service.cache.size,0);
});
test('hard deadline settles hung stream; late text never writes cache',async()=>{
 const next=deferred();const f=fixture({prepare:async()=>({config:{},stream:()=>({async *[Symbol.asyncIterator](){yield await next.promise;yield {type:'finish',reason:{kind:'stop'}};}})})});
 const p=f.service.predict('s',10);await flush();f.runtime.advance(20000);assert.equal((await p).code,'timeout');
 next.resolve({type:'text-delta',text:'Late'});await flush();assert.equal(f.service.cache.size,0);
});
test('pre-aborted caller never starts work or timer',async()=>{
 const f=fixture(),c=new AbortController();c.abort();assert.equal((await f.service.predict('s',10,c.signal)).reason,'cancelled');await flush();assert.equal(f.calls,0);assert.equal(f.runtime.timers.size,0);
});
test('settings revisions dedupe semantic notifications and no-op saves',async()=>{
 const f=fixture();const initial=f.service.readSettings();assert.equal(initial.instanceId,'instance-1');assert.equal(initial.revision,0);
 f.refs.model.notify();assert.equal(f.service.readSettings().revision,0);
 await f.service.saveSettings({model:'m'});assert.equal(f.edits,0);assert.equal(f.service.revision,0);
 await f.service.saveSettings({model:'m2'});assert.equal(f.edits,1);assert.equal(f.service.readSettings().revision,1);
 f.refs.model.notify();assert.equal(f.service.readSettings().revision,1);
});
test('settings watch initial + one semantic change; same-value notifications do not yield',async()=>{
 const f=fixture(),c=new AbortController(),it=f.service.watchSettings(c.signal);
 assert.equal((await it.next()).value.revision,0);let yielded=false;const next=it.next().then(x=>{yielded=true;return x;});
 f.refs.model.notify();await flush();assert.equal(yielded,false);
 f.refs.model.set('new');assert.equal((await next).value.revision,1);
 const end=it.next();c.abort();assert.equal((await end).done,true);assert.equal(f.service.settingsWatchers.size,0);
});
test('semantic config changes invalidate and detach old work, allowing replacement immediately',async()=>{
 const wait=deferred();const f=fixture({prepare:()=>wait.promise});const p=f.service.predict('s',10);await flush();
 f.refs.model.set('new');assert.equal((await p).reason,'cancelled');const q=f.service.predict('s',10);await flush();assert.equal(f.calls,2);
 f.dispose();assert.equal((await q).reason,'cancelled');wait.reject(new Error('cancelled'));await flush();assert.equal(f.service.cache.size,0);
});
test('projection advance/disposal cancels subscribers; failure does not poison future work',async()=>{
 const wait=deferred();const f=fixture({prepare:()=>wait.promise});const p=f.service.predict('s',10);await flush();f.boundary.sourceSeq=20;
 f.events.get('projection')(f.session,'composerPredictions',f.boundary);assert.equal((await p).reason,'cancelled');
 const q=f.service.predict('s',20);await flush();f.events.get('session/disposed')(f.session);assert.equal((await q).reason,'cancelled');wait.reject(new Error('late'));await flush();
 const g=fixture({prepare:()=>Promise.reject(new Error('provider exploded'))});assert.match((await g.service.predict('s',10)).message,/exploded/);assert.equal(g.service.active.size,0);
});
test('timings separate context/prepare/first text and preserve compute metadata on cache hits',async()=>{
 let f;f=fixture({prepare:async()=>{f.runtime.advance(5);return {config:{},stream:async function*(){f.runtime.advance(7);yield{type:'text-delta',text:'Run.'};f.runtime.advance(2);yield{type:'finish',reason:{kind:'stop'}};}};}});
 f.session.deriveMessages=()=>{f.runtime.advance(3);return [message('user','fix'),message('assistant','done')];};
 const value=await f.service.predict('s',10);assert.deepEqual(value.meta,{cached:false,timings:{contextMs:3,prepareMs:5,firstTextMs:15,totalMs:17}});
 f.runtime.advance(50);const hit=await f.service.predict('s',10);assert.deepEqual(hit.meta,{cached:true,timings:value.meta.timings});
});
test('bounded context uses active surface membership and projected messages, never shadowed raw payloads',()=>{
 const events=[{seq:0},{seq:1},{seq:2},{seq:3}];const projected=new Map([[0,message('user','old user')],[1,message('assistant','shadowed')],[2,message('user','replacement user')],[3,message('assistant','projected answer')]]);
 const session={surface:{nodes:[2,3]},eventAt:i=>events[i],deriveEventMessage:e=>projected.get(e.seq),deriveMessages:()=>{throw new Error('full history should not be needed');}};
 assert.deepEqual(contextFromSession(session,100),[message('user','replacement user'),message('assistant','projected answer')].map(m=>({role:m.role,text:m.content[0].text})));
});
test('bounded context matches full derivation and touches only a small tail of large surfaces',()=>{
 const nodes=Array.from({length:10000},(_,i)=>i),messages=nodes.map(i=>message(i%2?'assistant':'user','text '+i));let calls=0;
 const session={surface:{nodes},eventAt:seq=>({seq}),deriveEventMessage:e=>{calls++;return messages[e.seq];},deriveMessages:()=>messages};
 assert.deepEqual(contextFromSession(session,100),contextFromMessages(messages,100));assert.ok(calls<25);
 calls=0;contextFromSession(session,64000);assert.equal(calls,24);
});
test('safe context fallback uses canonical derivation; unavailable active nodes fail closed',()=>{
 const messages=[message('user','a'),message('assistant','b')];assert.deepEqual(contextFromSession({deriveMessages:()=>messages},100),contextFromMessages(messages,100));
 assert.throws(()=>contextFromSession({surface:{nodes:[1]},eventAt:()=>undefined,deriveEventMessage:()=>null},100),/unavailable/);
});
test('draft prediction carries draft-anchored result and echoes the exact draft',async()=>{
 let captured;
 const f=fixture({prepare:async()=>{
  return {config:{},stream:async function*(){yield{type:'text-delta',text:' bug'};yield{type:'finish',reason:{kind:'stop'}};}};}});
 const p=await f.service.predictDraft('s',10,'fix the',null);
 assert.equal(p.status,'ready');assert.equal(p.text,'bug');assert.equal(p.draft,'fix the');
 assert.equal(p.meta.cached,false);assert.equal(f.calls,1);
});
test('draft prediction caches per exact draft text and misses on any change',async()=>{
 const wait=deferred();const f=fixture({prepare:()=>wait.promise});
 const first=f.service.predictDraft('s',10,'fix the',null);wait.resolve(prepared());await first;
 assert.equal(f.calls,1);
 const hit=await f.service.predictDraft('s',10,'fix the',null);assert.equal(hit.meta.cached,true);assert.equal(f.calls,1);
 const miss=await f.service.predictDraft('s',10,'fix the bug',null);assert.equal(miss.meta.cached,false);assert.equal(f.calls,2);
});
test('draft and whole-message predictions never share a cache entry',async()=>{
 const wait=deferred();const f=fixture({prepare:()=>wait.promise});
 const whole=f.service.predict('s',10);wait.resolve(prepared());await whole;
 const draft=await f.service.predictDraft('s',10,'fix the',null);assert.equal(draft.meta.cached,false);assert.equal(f.calls,2);
 assert.equal(draft.draft,'fix the');assert.equal(whole.draft,undefined);
});
