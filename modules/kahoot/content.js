(() => {
  'use strict';
  if (window.__eduToolsKahootLoaded) return;
  window.__eduToolsKahootLoaded = true;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const selectors={title:'[data-functional-selector="question-title__input"]',answer:'[data-functional-selector="question-answer__input"]',toggle:'[data-functional-selector="question-answer__toggle-button"]',add:'[data-functional-selector="add-question-button"]'};
  async function waitFor(selector,timeout=10000){const start=Date.now();while(Date.now()-start<timeout){const nodes=[...document.querySelectorAll(selector)];if(nodes.length)return nodes;await sleep(120);}throw new Error(`Elemento do Kahoot não encontrado: ${selector}`);}
  function setValue(element,value){element.focus();if('value' in element){const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value')?.set;setter?setter.call(element,value):element.value=value;}else{element.textContent=value;}element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));element.dispatchEvent(new Event('change',{bubbles:true}));}
  async function fill(question){const [title]=await waitFor(selectors.title);setValue(title,question.question);const answers=await waitFor(selectors.answer);if(answers.length<4)throw new Error('O editor não exibiu quatro respostas.');question.options.forEach((option,index)=>setValue(answers[index],option));const toggles=await waitFor(selectors.toggle);if(toggles[question.correctIndex])toggles[question.correctIndex].click();await sleep(250);}
  async function addQuestion(){const [button]=await waitFor(selectors.add);button.click();await sleep(350);const quiz=[...document.querySelectorAll('button,[role="menuitem"]')].find(node=>/quiz/i.test(node.textContent||''));if(quiz){quiz.click();await sleep(500);}}
  chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
    if(message?.type==='CHECK_PAGE'){sendResponse({ok:true,ready:Boolean(document.querySelector(selectors.title)),questionCount:document.querySelectorAll(selectors.title).length});return;}
    if(message?.type!=='IMPORT_QUESTIONS')return;
    (async()=>{try{const list=Array.isArray(message.questions)?message.questions:[];for(let index=0;index<list.length;index+=1){if(index>0||!message.overwriteCurrent)await addQuestion();await fill(list[index]);}sendResponse({ok:true,imported:list.length});}catch(error){sendResponse({ok:false,error:error.message});}})();
    return true;
  });
})();
