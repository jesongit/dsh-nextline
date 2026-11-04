import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tabPredictionAction, draftAnchorKey, anchorMatches} from '../interaction.js';
const base={eligible:true,sourceSeq:10,resultSeq:10,dismissed:false,accepted:false,pending:false,anchor:'fix the',resultAnchor:'fix the'};
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
test('any draft content change invalidates the suggestion and re-predicts on Tab',()=>{
 assert.equal(tabPredictionAction({...base,status:'ready',anchor:'fix the bug'}),'request');
 assert.equal(tabPredictionAction({...base,status:'ready',resultAnchor:'fix the bug'}),'request');
});
test('whitespace-only drafts anchor like the empty composer, never like text',()=>{
 assert.equal(anchorMatches('   ', '   '),true);
 assert.equal(anchorMatches('',''),true);
 assert.equal(anchorMatches(undefined,''),true);
 assert.equal(anchorMatches('fix the','   '),false);
 assert.equal(anchorMatches('fix the',''),false);
 assert.equal(anchorMatches('','fix the'),false);
 assert.equal(tabPredictionAction({...base,anchor:'  ',status:'ready'}),'request');
});
test('draftAnchorKey keeps exact text and caps at 8000 characters',()=>{
 assert.equal(draftAnchorKey('  hint: '),'  hint: ');
 assert.equal(draftAnchorKey('x'.repeat(8001)),'x'.repeat(8000));
 assert.equal(draftAnchorKey('   '),'');
 assert.equal(draftAnchorKey(null),'');
 assert.equal(draftAnchorKey(42),'');
});
