const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BubbleDrag } = require('../src/bubble-drag.cjs');
function fixture() {
  let point={x:110,y:110}, bounds={x:100,y:100,width:76,height:76}, enabled=true, time=0;
  const moves=[], finishes=[];
  const drag=new BubbleDrag({cursor:()=>point,bounds:()=>({...bounds}),enabled:()=>enabled,now:()=>time,
    workArea:p=>p.x<0?{x:-1280,y:0,width:1280,height:720}:{x:0,y:0,width:1920,height:1040},
    move:(x,y)=>{moves.push({x,y});bounds={...bounds,x,y};},finish:moved=>finishes.push(moved)});
  return {drag,moves,finishes,get bounds(){return bounds;},cursor:p=>{point=p;},disable:()=>{enabled=false;},time:t=>{time=t;}};
}
test('native cursor movement follows the original drag anchor without dropping fast movement',()=>{
  const f=fixture(); f.drag.begin(1);f.cursor({x:810,y:410});f.drag.update(1);
  assert.deepEqual(f.moves.at(-1),{x:800,y:400});f.cursor({x:820,y:420});f.drag.update(1);
  assert.deepEqual(f.moves.at(-1),{x:810,y:410});assert.deepEqual(f.drag.end(1),{moved:true,cancelled:false});assert.deepEqual(f.finishes,[true]);
});
test('tiny movement remains a click while slow cumulative movement becomes a drag',()=>{
  const f=fixture();f.drag.begin(1);f.cursor({x:112,y:111});f.drag.update(1);assert.equal(f.moves.length,0);
  assert.equal(f.drag.end(1).moved,false);f.drag.begin(2);f.cursor({x:116,y:115});f.drag.update(2);
  assert.equal(f.drag.end(2).moved,true);
});
test('crossing to another monitor uses native desktop coordinates and stays visible',()=>{
  const f=fixture();f.drag.begin(1);f.cursor({x:-500,y:200});f.drag.update(1);assert.deepEqual(f.moves.at(-1),{x:-510,y:190});
  f.cursor({x:-2000,y:2000});f.drag.update(1);assert.deepEqual(f.moves.at(-1),{x:-1280,y:644});
});
test('stale gesture events cannot move or finish the current drag',()=>{
  const f=fixture();f.drag.begin(2);f.cursor({x:300,y:300});f.drag.update(1);assert.equal(f.moves.length,0);
  assert.equal(f.drag.end(1),null);assert.equal(f.drag.active,true);f.drag.end(2,true);assert.equal(f.drag.active,false);
});
test('cancel, lost session and stale pointer state stop movement safely',()=>{
  const f=fixture();f.drag.begin(1);assert.equal(f.drag.end(1,true).cancelled,true);f.drag.begin(2);f.disable();f.drag.update(2);
  assert.equal(f.drag.active,false);assert.equal(f.drag.end(2),null);assert.equal(f.drag.begin(3),false);
});
test('lost pointer release expires rather than leaving the bubble attached to the mouse',()=>{
  const f=fixture();f.drag.begin(1);f.time(10001);f.drag.expire();assert.equal(f.drag.active,false);assert.equal(f.drag.end(1),null);
});
