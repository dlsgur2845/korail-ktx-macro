'use strict';
// Short leases survive worker suspension/reloads but expire if a tab stops responding.
const POWER_KEY='ktxPowerLeases',POWER_ALARM='ktx-power-maintenance',POWER_TTL=90000;
let powerQueue=Promise.resolve();
function powerTask(fn){const task=powerQueue.then(fn);powerQueue=task.catch(()=>{});return task;}
function powerURL(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='korail.com'||u.hostname.endsWith('.korail.com'));}catch{return false;}}
async function changePower(update){
  const saved=await chrome.storage.session.get(POWER_KEY);
  const leases=saved[POWER_KEY]||{};
  for(const [key,lease] of Object.entries(leases))if(!lease || lease.until<=Date.now())delete leases[key];
  update?.(leases);
  if(Object.keys(leases).length){
    if(!chrome.power)throw new Error('절전 방지 권한이 없습니다. 확장 프로그램을 다시 로드해주세요.');
    chrome.power.requestKeepAwake('display');
    await chrome.alarms.create(POWER_ALARM,{periodInMinutes:0.5});
  }else{chrome.power?.releaseKeepAwake();await chrome.alarms.clear(POWER_ALARM);}
  await chrome.storage.session.set({[POWER_KEY]:leases});
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type!=='keep-awake')return;
  if(s.id!==chrome.runtime.id || s.frameId!==0 || !Number.isInteger(s.tab?.id) || s.tab.id<0 || typeof s.documentId!=='string' || !powerURL(s.url) || !['normal','holiday'].includes(m.source) || typeof m.active!=='boolean'){
    reply({ok:false,error:'허용되지 않은 절전 방지 요청입니다.'});return;
  }
  powerTask(()=>changePower(leases=>{
    const key=s.tab.id+':'+m.source;
    if(m.active)leases[key]={tab:s.tab.id,document:s.documentId,until:Date.now()+POWER_TTL};
    else if(leases[key]?.document===s.documentId)delete leases[key];
  })).then(()=>reply({ok:true}),()=>reply({ok:false,error:'절전 방지를 적용하지 못했습니다. 확장 프로그램의 power 권한을 확인해주세요.'}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===POWER_ALARM)void powerTask(()=>changePower()).catch(()=>{});});
chrome.tabs.onRemoved.addListener(id=>{void powerTask(()=>changePower(leases=>{for(const key of Object.keys(leases))if(leases[key].tab===id)delete leases[key];})).catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.url&&!powerURL(change.url))void powerTask(()=>changePower(leases=>{for(const key of Object.keys(leases))if(leases[key].tab===id)delete leases[key];}));});
void powerTask(()=>changePower()).catch(()=>{});
