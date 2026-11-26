import test from 'node:test';
import assert from 'node:assert/strict';
import {retainStudioHistory,studioHistoryMarkup} from '../src/studio-history.js';

const row=(id,role,text=id)=>({id,role,text,source:'local'});

test('Canvas records are grouped and collapsed without hiding the first design requirement',()=>{
  const rows=[row('opening','notice'),row('request','user','首条 <要求>'),row('edit-a','notice'),row('edit-b','notice'),row('answer','assistant')];
  const markup=studioHistoryMarkup(rows,new Set(['request']));
  assert.match(markup,/data-canvas-history="intro">/);
  assert.match(markup,/data-first-requirement[^>]*>/);
  assert.match(markup,/首条 &lt;要求&gt;/);
  assert.match(markup,/data-canvas-history="request" open>[\s\S]*2 条[\s\S]*edit-a[\s\S]*edit-b/);
  assert.equal((markup.match(/<details/g)||[]).length,2);
});

test('Frequent canvas edits retain the first prompt and later conversation within the stored history limit',()=>{
  const first=row('first','user'),answer=row('answer','assistant'),last=row('last','user');
  const edits=Array.from({length:140},(_,index)=>row('edit-'+index,'notice'));
  const history=retainStudioHistory([first,answer,...edits,last]);
  assert.equal(history.length,80);
  assert.deepEqual(history.filter(entry=>entry.role!=='notice'),[first,answer,last]);
  assert.equal(history.at(-2),edits.at(-1));
  assert.deepEqual(retainStudioHistory([first,answer,last],1),[first]);
});
