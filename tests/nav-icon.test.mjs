import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installPredictionNavIcon} from '../nav-icon.js';
import {SPARKLES_PARTS} from '../prediction-view.js';
class Element {
 constructor(tag,text=''){this.localName=tag;this.textContent=text;this.children=[];this.attributes=new Map();this.parentElement=null;this.connected=true;}
 get isConnected(){return this.connected && (!this.parentElement || this.parentElement.isConnected);}
 get childElementCount(){return this.children.length;}
 appendChild(node){this.children.push(node);node.parentElement=this;return node;}
 setAttribute(k,v){this.attributes.set(k,v);}getAttribute(k){return this.attributes.get(k)??null;}removeAttribute(k){this.attributes.delete(k);}
 replaceWith(node){const p=this.parentElement;if(!p)return;p.children[p.children.indexOf(this)]=node;node.parentElement=p;this.parentElement=null;}
}
function fixture(){
 const target=new Element('button'), other=new Element('button');
 const original=target.appendChild(new Element('svg'));original.setAttribute('class','host-nav-icon');target.appendChild(new Element('span','输入预测'));
 const unrelated=other.appendChild(new Element('svg'));other.appendChild(new Element('span','订阅'));
 const nav={querySelectorAll:()=>[target,other]},body=new Element('body');let observer,localeChange,disconnected=0,unsubscribed=0,nextId=0;
 const timers=new Map();const doc={body,querySelectorAll:s=>{assert.equal(s,'[data-shortcut-modal="settings"][role="dialog"] > nav');return [nav];},createElementNS:(_ns,tag)=>new Element(tag)};
 const stop=installPredictionNavIcon({document:doc,Observer:class{constructor(fn){observer=fn;}observe(){}disconnect(){disconnected++;}},label:()=>target.children[1].textContent,
 subscribe(fn){localeChange=fn;return()=>unsubscribed++;},schedule(fn){timers.set(++nextId,fn);return nextId;},cancel:id=>timers.delete(id)});
 const flush=()=>{for(const [id,fn]of [...timers]){timers.delete(id);fn();}};
 return {target,other,original,unrelated,stop,flush,timers,notify:()=>observer(),locale:()=>localeChange(),get disconnected(){return disconnected;},get unsubscribed(){return unsubscribed;}};
}
test('only target nav gear changes; shared Sparkles, layout, locale, idempotence and cleanup',()=>{
 const f=fixture(),icon=f.target.children[0];assert.notEqual(icon,f.original);assert.equal(f.other.children[0],f.unrelated);
 assert.equal(icon.getAttribute('class'),'host-nav-icon');assert.equal(icon.getAttribute('width'),'16');assert.equal(icon.getAttribute('viewBox'),'0 0 24 24');assert.equal(icon.getAttribute('stroke'),'currentColor');assert.equal(icon.getAttribute('stroke-width'),'2');
 assert.deepEqual(icon.children.map(e=>[e.localName,Object.fromEntries(e.attributes)]),SPARKLES_PARTS.map(([tag,attrs])=>[tag,Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k,String(v)]))]));
 for(let i=0;i<10;i++)f.notify();assert.equal(f.timers.size,1);f.flush();assert.equal(f.target.children[0],icon);assert.equal(icon.children.length,3);
 f.target.children[1].textContent='Input prediction';f.locale();f.flush();assert.equal(f.target.children[0],icon);
 f.notify();f.stop();f.stop();assert.equal(f.timers.size,0);assert.equal(f.disconnected,1);assert.equal(f.unsubscribed,1);assert.equal(f.target.children[0],f.original);assert.equal(f.target.getAttribute('data-dsh-prediction-nav-icon'),null);
});
test('host rerender is patched again, closed dialog releases ownership, no browser is safe',()=>{
 const f=fixture(),old=f.target.children[0],fresh=new Element('svg');old.replaceWith(fresh);f.notify();f.flush();assert.notEqual(f.target.children[0],fresh);
 f.target.connected=false;f.notify();f.flush();assert.equal(f.target.children[0],fresh);f.stop();
 assert.doesNotThrow(()=>installPredictionNavIcon()());
});
