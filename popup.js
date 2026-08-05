'use strict';
const DEFAULTS={coursePendingChecks:true,categoryPendingChecks:true,pendingBadges:true,pendingDownloads:true};
const inputs=[...document.querySelectorAll('[data-setting]')];
const status=document.getElementById('status');
const save=document.getElementById('save-settings');
const setStatus=(message,error=false)=>{status.textContent=message;status.classList.toggle('is-error',error)};
chrome.storage.local.get(DEFAULTS,values=>inputs.forEach(input=>input.checked=values[input.dataset.setting]!==false));
save.addEventListener('click',()=>{save.disabled=true;const values=Object.fromEntries(inputs.map(input=>[input.dataset.setting,input.checked]));chrome.storage.local.set(values,()=>{setStatus('Configurações salvas.');save.disabled=false;});});
async function activeTab(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return tab;}
async function runDrivePdf(){const tab=await activeTab();if(!tab?.id||!String(tab.url||'').startsWith('https://drive.google.com/')){setStatus('Abra um documento no Google Drive antes de usar Baixar PDF.',true);return;}await chrome.scripting.executeScript({target:{tabId:tab.id},files:['modules/drive-pdf/content.js']});window.close();}
async function openKahoot(){const tab=await activeTab();if(!String(tab?.url||'').startsWith('https://create.kahoot.it/')){setStatus('Abra o editor do Kahoot antes de usar o KahootOmático.',true);return;}location.href=chrome.runtime.getURL('modules/kahoot/popup.html');}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{const action=button.dataset.action;if(action==='drive-pdf')runDrivePdf().catch(error=>setStatus(error.message,true));else if(action==='kahoot')openKahoot().catch(error=>setStatus(error.message,true));else setStatus('As ferramentas Moodle são exibidas diretamente nas páginas compatíveis.');}));
