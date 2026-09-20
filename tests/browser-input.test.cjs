const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const LIST='https://www.korail.com/ticket/search/list';
function setup(options={}) {
  const listeners=[],commands=[],attachments=[],detaches=[];
  let detached;
  const sender={id:'ext',frameId:0,documentId:'doc',url:LIST,tab:{id:7}};
  const chrome={
    runtime:{id:'ext',onMessage:{addListener:f=>listeners.push(f)}},
    notifications:{onClicked:{addListener:()=>{}},create:()=>{}},
    tabs:{onRemoved:{addListener:()=>{}},sendMessage:async(tabId,m,opts)=>{
      assert.equal(tabId,7); assert.equal(opts.documentId,'doc');
      if(m.type==='verify-search-document') return {ok:options.verified!==false,url:options.pageURL||LIST};
      assert.equal(m.type,'verify-page-input');return {ok:options.verified!==false};
    }},
    debugger:{
      onDetach:{addListener:f=>{detached=f;}},
      attach:async(target,version)=>{assert.equal(version,'1.3');attachments.push(target);if(options.attachError)throw new Error('Other debugger');},
      detach:async target=>{detaches.push(target);},
      sendCommand:async(target,method,params)=>{
        assert.deepEqual(target,{tabId:7});commands.push({method,params});
        if(method==='Page.getFrameTree')return {frameTree:{frame:{url:options.pageURL||LIST}}};
        if(method==='Page.getLayoutMetrics')return {cssVisualViewport:{clientWidth:1000,clientHeight:800}};
        if(options.releaseError && params?.type==='mouseReleased')throw new Error('Disconnected');
      }
    }
  };
  new Function('chrome',source)(chrome);
  const send=(message,over={})=>new Promise(resolve=>{
    let handled=false;
    for(const f of listeners) {const result=f(message,{...sender,...over},resolve);if(result===true)handled=true;}
    if(!handled && !['prepare-browser-input','click-page-element','release-browser-input'].includes(message.type))resolve();
  });
  return {send,commands,attachments,detaches,detached};
}
const click={type:'click-page-element',step:'reserve',id:'one',x:80,y:40};
test('fixed mouse press/release only, same document and correct tab',async()=>{
  const h=setup();assert.deepEqual(await h.send({type:'prepare-browser-input'}),{ok:true});
  assert.deepEqual(await h.send(click),{ok:true});
  assert.deepEqual(h.commands.map(c=>c.method),['Page.getFrameTree','Page.getFrameTree','Page.getLayoutMetrics','Input.dispatchMouseEvent','Input.dispatchMouseEvent']);
  assert.deepEqual(h.commands.slice(-2).map(c=>c.params.type),['mousePressed','mouseReleased']);
  await h.send({type:'release-browser-input'});assert.equal(h.detaches.length,1);
});
test('foreign extension, subframe, offsite, wrong path and missing document are refused',async()=>{
  for(const over of [{id:'other'},{frameId:1},{url:'https://evil.example/ticket/search/list'},{url:'https://www.korail.com/other'},{documentId:undefined}]) {
    const h=setup();assert.equal((await h.send({type:'prepare-browser-input'},over)).ok,false);assert.equal(h.attachments.length,0);
  }
});
test('navigation between preparation and input prevents click',async()=>{
  const h=setup({pageURL:'https://www.korail.com/ticket/login'});
  assert.equal((await h.send({type:'prepare-browser-input'})).ok,false);
  assert.equal(h.attachments.length,0);assert.equal(h.commands.some(c=>c.method.startsWith('Input.')),false);
});
test('moved, obscured or cancelled target never receives mouse input',async()=>{
  const h=setup({verified:false});await h.send({type:'prepare-browser-input'});
  assert.equal((await h.send(click)).ok,false);assert.equal(h.commands.some(c=>c.method.startsWith('Input.')),false);
});
test('invalid coordinates and arbitrary commands are rejected',async()=>{
  for(const patch of [{x:NaN},{y:-1},{x:1000},{step:'Runtime.evaluate'},{id:''}]) {
    const h=setup();await h.send({type:'prepare-browser-input'});
    assert.equal((await h.send({...click,...patch})).ok,false);assert.equal(h.commands.some(c=>c.method.startsWith('Input.')),false);
  }
});
test('attach conflicts do not detach another debugger or send clicks',async()=>{
  const h=setup({attachError:true});assert.equal((await h.send({type:'prepare-browser-input'})).ok,false);
  assert.equal(h.detaches.length,0);assert.equal(h.commands.length,0);
});
test('uncertain release fails closed without another mouse press',async()=>{
  const h=setup({releaseError:true});await h.send({type:'prepare-browser-input'});
  assert.equal((await h.send(click)).ok,false);
  assert.equal(h.commands.filter(c=>c.params?.type==='mousePressed').length,1);assert.equal(h.detaches.length,1);
});
test('detach invalidates pending input',async()=>{
  const h=setup();await h.send({type:'prepare-browser-input'});h.detached({tabId:7});
  assert.equal((await h.send(click)).ok,false);assert.equal(h.commands.some(c=>c.method.startsWith('Input.')),false);
});

test('SPA initial general document can click only while currently on search list',async()=>{
 const h=setup();const over={url:'https://www.korail.com/ticket/search/general'};
 assert.equal((await h.send({type:'prepare-browser-input'},over)).ok,true);
 assert.equal((await h.send(click,over)).ok,true);
});
