import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialBoundary, foldBoundary, contextFromMessages, cleanPrediction, collectPrediction, validateSettings, SYSTEM, SYSTEM_DRAFT} from '../engine.js';
import {descriptors, normalizeDraft, MAX_DRAFT_CHARS} from '../protocol.js';
test('completed-turn boundary is invalidated on new input/start and skips failed turns', () => {
 let s=initialBoundary();
 assert.equal(foldBoundary(s,{type:'tool/result'}),s);
 s=foldBoundary(s,{type:'turn/start',data:{turn:1}}); assert.equal(s.running,true);
 s=foldBoundary(s,{type:'turn/end',seq:10,data:{turn:1,reason:{kind:'completed'}}}); assert.equal(s.sourceSeq,10);
 s=foldBoundary(s,{type:'user/message'}); assert.equal(s.sourceSeq,-1);
 s=foldBoundary(s,{type:'turn/end',seq:20,data:{turn:2,reason:{kind:'error'}}}); assert.equal(s.sourceSeq,-1);
});
test('prediction context excludes reasoning, tools, files and nonconversation roles',()=>{
 const msgs=[{role:'system',content:[{type:'text',text:'secret system'}]},{role:'user',content:[{type:'text',text:'fix it'},{type:'file',attachment:{name:'secret'}}]},{role:'tool',content:[{type:'text',text:'tool secret'}]},{role:'assistant',content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'fixed'}]}];
 assert.deepEqual(contextFromMessages(msgs,100),[{role:'user',text:'fix it'},{role:'assistant',text:'fixed'}]);
});
test('bounds context and retains latest answer',()=>{
 const result=contextFromMessages([{role:'user',content:[{type:'text',text:'a'.repeat(100)}]},{role:'assistant',content:[{type:'text',text:'new'}]}],30);
 assert.equal(result.at(-1).text,'new');assert.ok(result.length<=2);
});
test('empty and malformed suggestions are discarded',()=>{
 for(const x of ['NONE','null','无','', '```sh\nrm\n```','x'.repeat(501)]) assert.equal(cleanPrediction(x),null);
 assert.equal(cleanPrediction('“运行测试并修复失败项。”'),'运行测试并修复失败项。');
});
async function* stream(chunks){yield* chunks;}
test('only successful text stop is accepted; output cap/tool calls/failures rejected',async()=>{
 assert.equal(await collectPrediction(stream([{type:'text-delta',text:'Run tests.'},{type:'finish',reason:{kind:'stop'}}])),'Run tests.');
 for(const chunks of [[{type:'tool-call-delta'}],[{type:'finish',reason:{kind:'max-tokens'}}],[{type:'text-delta',text:'x'.repeat(4001)}],[]]) await assert.rejects(()=>collectPrediction(stream(chunks)));
});
test('aborted response cannot become a suggestion',async()=>{
 const ctrl=new AbortController();ctrl.abort();await assert.rejects(()=>collectPrediction(stream([{type:'finish',reason:{kind:'stop'}}]),ctrl.signal));
});
test('settings reject unknown or unbounded values and preserve independent route',()=>{
 assert.deepEqual(validateSettings({provider:'custom',model:'fast',enabled:false}),{provider:'custom',model:'fast',enabled:false});
 for(const x of [{arbitrary:true},{maxTokens:0},{contextChars:Infinity},{timeoutMs:1},{enabled:'yes'}]) assert.throws(()=>validateSettings(x));
});
test('remote inputs are strict and cancellable predict never accepts invalid turn',()=>{
 const d=descriptors().find(d=>d.method==='predict');assert.deepEqual(d.cancellation,{parameter:'signal'});
 assert.throws(()=>d.parameters[1].codec.create().parse(-1));assert.equal(d.parameters[1].codec.create().parse(4),4);
 assert.throws(()=>d.parameters[0].codec.create().parse(''));
});
test('draft continuation has a dedicated strict prompt and its own strict wire method',()=>{
 assert.ok(SYSTEM_DRAFT.includes('continuation')||SYSTEM_DRAFT.includes('draft'));
 assert.ok(!SYSTEM.includes('[The user is now typing'));
 const predict=descriptors().find(d=>d.method==='predict'),draft=descriptors().find(d=>d.method==='predictDraft');
 assert.equal(predict.parameters.length,2);assert.equal(draft.parameters.length,3);
 assert.equal(draft.parameters[2].name,'draft');
 assert.equal(normalizeDraft(undefined),'');assert.equal(normalizeDraft(null),'');assert.equal(normalizeDraft('  '),'  ');
 assert.throws(()=>normalizeDraft('x'.repeat(MAX_DRAFT_CHARS+1)));assert.throws(()=>normalizeDraft(7));
});
