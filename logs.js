'use strict';
const status=document.getElementById('status');
function formatSize(bytes) {
  const units=['B','KB','MB','GB','TB','PB'];
  let size=bytes,unit=0;
  while(size>=1000 && unit<units.length-1){size/=1000;unit++;}
  return size.toLocaleString('ko-KR',{maximumFractionDigits:unit===0?0:2})+' '+units[unit];
}
async function refresh() {
  try {
    const result=await chrome.runtime.sendMessage({type:'list-file-logs'});
    if(!result?.ok) throw new Error(result?.error||'로그 목록을 읽지 못했습니다.');
    document.getElementById('files').replaceChildren();
    for(const item of result.files) {
      const li=document.createElement('li'),button=document.createElement('button');
      button.textContent=item.name+' ('+formatSize(item.size)+') · 내려받기';
      button.title=item.size.toLocaleString('ko-KR')+' B';
      button.onclick=async()=>{
        try {
          const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('korail-logs');
          const blob=await (await dir.getFileHandle(item.name)).getFile();
          const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=item.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
        }catch{status.textContent='파일이 압축되었거나 변경되었습니다. 목록을 새로고침해주세요.';}
      };
      const remove=document.createElement('button');
      remove.textContent='삭제';remove.title='이 로그 파일 완전삭제';remove.setAttribute('aria-label',item.name+' 완전삭제');
      remove.onclick=async()=>{
        if(!window.confirm(item.name+'\n이 로그 파일을 완전히 삭제할까요? 휴지통으로 이동하지 않으며 복원할 수 없습니다.'))return;
        remove.disabled=true;
        try {
          const result=await chrome.runtime.sendMessage({type:'delete-file-log',name:item.name});
          if(!result?.ok)throw new Error(result?.error||'로그 삭제 실패');
          await refresh();status.textContent=item.name+' 파일을 삭제했습니다.';
        }catch(error){status.textContent=error.message;remove.disabled=false;}
      };
      li.append(button,document.createTextNode(' '),remove);document.getElementById('files').append(li);
    }
    const totalSize=result.files.reduce((sum,f)=>sum+f.size,0);
    status.textContent=result.files.length+'개 파일 · '+formatSize(totalSize);
    status.title=totalSize.toLocaleString('ko-KR')+' B';
  }catch(error){status.textContent=error.message;}
}
document.getElementById('refresh').onclick=refresh;refresh();
