const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function load(confirmValue){
 const nodes=new Map(),calls=[];let confirmText='';
 const element=()=>({children:[],disabled:false,append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(){}});
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,createTextNode:text=>text};
 vm.runInNewContext(fs.readFileSync(require.resolve('../logs.js'),'utf8'),{document,window:{confirm:text=>{confirmText=text;return confirmValue;}},chrome:{runtime:{sendMessage:async m=>{calls.push(m);return m.type==='list-file-logs'?{ok:true,files:[{name:'ktx-test.jsonl',size:42}]}:{ok:true};}}}});
 return {nodes,calls,confirmation:()=>confirmText};
}
test('delete cancel sends no deletion; confirm targets exactly the selected file',async()=>{
 for(const allow of [false,true]){
  const h=load(allow);await new Promise(r=>setImmediate(r));
  const row=h.nodes.get('files').children[0];const button=row.children.find(c=>c.textContent==='삭제');
  await button.onclick();assert.match(h.confirmation(),/ktx-test.jsonl/);assert.match(h.confirmation(),/복원할 수 없습니다/);
  const deletes=h.calls.filter(m=>m.type==='delete-file-log');assert.equal(deletes.length,allow?1:0);
  if(allow)assert.equal(deletes[0].name,'ktx-test.jsonl');
 }
});
