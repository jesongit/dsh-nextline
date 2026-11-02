import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predictionSurface} from '../prediction-view.js';
const h=(type,props,...children)=>({type,props,children});
const badge={type:'svg',width:14},actions={type:'controls'};
test('all status variants share glyph, text and action columns',()=>{
 for(const text of ['Loading','Generating','No suggestion','Timeout']){
  const v=predictionSurface(h,{badge,text,actions,error:text==='Timeout'});
  assert.equal(v.props.role,'status');assert.equal(v.children[0],badge);assert.equal(v.children[1].props.className,'dsh-predict-copy');assert.equal(v.children[2].props.className,'dsh-predict-actions');
 }
});
test('manual and ready variants preserve columns with a native text button and no nested buttons',()=>{
 const onClick=()=>{};
 for(const text of ['Predict next message','A multiline\nsuggestion']){
  const v=predictionSurface(h,{badge,text,actions,onClick,label:'Use suggestion'});
  assert.equal(v.props.role,'region');assert.equal(v.children[0],badge);assert.equal(v.children[1].type,'button');assert.equal(v.children[1].props.onClick,onClick);assert.deepEqual(v.children[1].children,[text]);assert.equal(v.children[1].props.title,text);assert.equal(v.children[1].props['aria-label'],'Use suggestion: '+text);assert.equal(v.children[2].type,'div');
 }
});
