(() => {
  'use strict';
  if (window.__eduToolsDrivePdfRunning) return;
  window.__eduToolsDrivePdfRunning = true;
  const images=[...document.images].filter(img=>(img.src||'').startsWith('blob:https://drive.google.com/')&&img.naturalWidth>0);
  if(!images.length){alert('Nenhuma página carregada foi encontrada. Role o documento até o final e tente novamente.');window.__eduToolsDrivePdfRunning=false;return;}
  const win=window.open('','_blank');
  if(!win){alert('Permita pop-ups para preparar o PDF.');window.__eduToolsDrivePdfRunning=false;return;}
  const title=(document.title||'Documento').replace(/[<>]/g,'');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4;margin:0}body{margin:0;background:#ddd}.page{display:flex;width:210mm;height:297mm;align-items:center;justify-content:center;page-break-after:always;background:#fff}.page:last-child{page-break-after:auto}img{max-width:100%;max-height:100%;object-fit:contain}@media print{body{background:#fff}}</style></head><body></body></html>`);
  images.forEach(source=>{const page=win.document.createElement('div');page.className='page';const img=win.document.createElement('img');img.src=source.src;page.appendChild(img);win.document.body.appendChild(page);});
  win.document.close();
  setTimeout(()=>{win.focus();win.print();window.__eduToolsDrivePdfRunning=false;},700);
})();
