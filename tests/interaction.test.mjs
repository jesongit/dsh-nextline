import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tabPredictionAction} from '../interaction.js';
const base={eligible:true,sourceSeq:10,resultSeq:10,dismissed:false,accepted:false,pending:false};
test('Tab requests a prediction before any suggestion exists',()=>assert.equal(tabPredictionAction(base),'request'));
test('Tab accepts the matching visible suggestion',()=>assert.equal(tabPredictionAction({...base,status:'ready'}),'accept'));
test('loading and pending calls never generate a second request',()=>{
 assert.equal(tabPredictionAction({...base,status:'loading'}),'wait');
 assert.equal(tabPredictionAction({...base,pending:true}),'wait');
});
test('Tab is untouched when composer is ineligible',()=>assert.equal(tabPredictionAction({...base,eligible:false}),'pass'));
test('stale, dismissed, accepted and failed suggestions permit explicit retrigger',()=>{
 for(const patch of [{resultSeq:9,status:'ready'},{dismissed:true,status:'ready'},{accepted:true,status:'ready'},{status:'error'},{status:'empty'}]) assert.equal(tabPredictionAction({...base,...patch}),'request');
});
