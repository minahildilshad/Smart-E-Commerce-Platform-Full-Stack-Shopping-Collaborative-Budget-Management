'use strict';
// Match every card and detail view to the same local model. No substitute geometry.
const cardViewers=new Map();
if(typeof customElements!=='undefined')customElements.whenDefined('model-viewer').then(()=>{customElements.get('model-viewer').modelCacheSize=2});
function model(p,interactive=false,variant='Original'){
 return `<model-viewer data-real3d data-model-product="${esc(p.id)}" src="${esc(p.model)}" poster="${esc(photoURL(p))}" alt="Interactive 3D view of ${esc(p.name)}" loading="eager" reveal="auto" ${interactive?'camera-controls touch-action="pan-y"':'disable-zoom disable-tap'} interaction-prompt="none" shadow-intensity="1" exposure="1" auto-rotate-delay="0" rotation-per-second="45deg" camera-orbit="35deg 75deg 105%" ${variant!=='Original'?`variant-name="${esc(variant)}"`:''}></model-viewer><div class="media-status" role="status">Preparing the 3D view…</div>`;
}
function card(p,n=0){
 const v=price({id:p.id,size:p.sizes[0]});
 return `<article class="card" data-product="${esc(p.id)}" tabindex="0" role="button" style="--delay:${Math.min(n,5)*30}ms" aria-label="Open ${esc(p.name)} in 3D"><div class="art"><div class="photo-wrap">${photo(p,1,'data-card-photo loading="lazy"')}</div><div class="card-model-slot" aria-hidden="true"></div>${p.off?`<span class="sale">${p.off}% off</span>`:''}<button class="heart ${S.wishes.includes(p.id)?'saved':''}" data-wish="${esc(p.id)}" aria-label="Save ${esc(p.name)}">♡</button><div class="photo-hint"><span>${reduced()?'Open interactive 3D':'Hover for 360°'}</span><span>↗</span></div></div><div class="card-info"><div class="product-category">${esc(p.cat)} <span class="model-badge">3D</span></div><h3>${esc(p.name)}</h3><div class="prices"><b>${money(v.sale)}</b>${p.off?`<del>${money(v.base)}</del>`:''}</div><div class="card-bottom"><span class="finish-count">${p.colors.length>1?(p.colors.length-1)+' material finishes':'Original finish'}</span><label class="compare-label"><input data-compare="${esc(p.id)}" type="checkbox" ${S.compare.includes(p.id)?'checked':''}>Compare</label></div></div></article>`;
}
function spinViewer(mv,enabled){mv.autoRotate=enabled;mv.toggleAttribute('auto-rotate',enabled)}
function activateCard(card){
 const p=by(card.dataset.product);if(!p?.model)return;
 clearTimeout(card._disposeTimer);let mv=card.querySelector('model-viewer');
 if(mv){spinViewer(mv,!reduced());return}
 const slot=card.querySelector('.card-model-slot');slot.innerHTML=model(p);mv=slot.querySelector('model-viewer');cardViewers.set(card,mv);const hint=card.querySelector('.photo-hint span');if(hint)hint.textContent='Preparing 3D…';bindModels();
 if(!reduced())spinViewer(mv,true);
 // Retain at most two card viewers, in addition to an open detail viewer.
 for(const [other,viewer] of cardViewers){if(other!==card&&cardViewers.size>2){viewer.parentElement.innerHTML='';other.classList.remove('model-ready');cardViewers.delete(other)}}
}
function deactivateCard(card){
 const mv=cardViewers.get(card);if(mv)spinViewer(mv,false);
 clearTimeout(card._disposeTimer);card._disposeTimer=setTimeout(()=>{const slot=card.querySelector('.card-model-slot');if(slot)slot.innerHTML='';card.classList.remove('model-ready');const hint=card.querySelector('.photo-hint span');if(hint)hint.textContent=reduced()?'Open interactive 3D':'Hover for 360°';cardViewers.delete(card)},1200);
}
function bindCards(){
 document.querySelectorAll('[data-product]:not([data-hover])').forEach(card=>{
  card.dataset.hover='1';card.addEventListener('pointerenter',e=>{if(e.pointerType!=='touch')activateCard(card)});card.addEventListener('pointerleave',()=>deactivateCard(card));
  card.addEventListener('focusin',()=>activateCard(card));card.addEventListener('focusout',e=>{if(!card.contains(e.relatedTarget))deactivateCard(card)});
 });bindModels();
}
function bindModels(){
 document.querySelectorAll('[data-real3d]:not([data-bound])').forEach(mv=>{
  mv.dataset.bound='1';const parent=mv.parentElement,status=parent.querySelector('.media-status'),card=mv.closest('[data-product]');
  const done=()=>{if(status)status.style.display='none';if(card){card.classList.add('model-ready');const hint=card.querySelector('.photo-hint span');if(hint)hint.textContent='360° · same product'}};mv.addEventListener('load',done);if(mv.loaded)done();
  mv.addEventListener('error',()=>{mv.style.display='none';if(card)card.classList.remove('model-ready');if(status){status.style.display='block';status.textContent='3D could not load. The matching product preview is shown.'}if(!card){const p=by(mv.dataset.modelProduct);if(p){const img=document.createElement('img');img.src=photoURL(p);img.alt=p.name;img.className='model-fallback';parent.prepend(img)}}});
  if(!card){parent.addEventListener('pointerenter',()=>{if(!reduced())spinViewer(mv,true)});parent.addEventListener('pointerleave',()=>spinViewer(mv,false));mv.addEventListener('pointerdown',()=>spinViewer(mv,false))}
 });
}
function clearHovers(){for(const [card,mv] of cardViewers){clearTimeout(card._disposeTimer);mv.remove();card.classList.remove('model-ready')}cardViewers.clear();hoverTimers.forEach(clearInterval);hoverTimers.clear()}
const closeProductWithoutDisposal=closeProduct;
closeProduct=function(){document.querySelectorAll('#detail-media model-viewer').forEach(mv=>mv.remove());closeProductWithoutDisposal()};
function about(){
 app.innerHTML=`<section class="wrap policy"><div class="eyebrow">THE ORBIT SELECTION</div><h1 class="page-title">Every piece. Every angle.</h1><p>A curated concept catalog of 12 products, each paired with its own matching 3D asset and supplied preview. Hover to rotate, or open a product to drag, zoom, and explore its original finishes.</p><h2>Made for a closer inspection</h2><p>Geometry and materials come from the licensed source models. There are no cartoon replacements or generated back views. Only finishes that exist in a model are selectable. “Original” restores the model’s default materials.</p><h2>Model credits</h2><p>Models and supplied preview images are from the <a href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noopener">Khronos glTF Sample Assets repository</a>. Each retains its creator and license attribution. Orbit product names and sample PKR prices are presentation choices and do not imply manufacturer affiliation or actual stock for sale.</p><div class="credit-list">${P.map(p=>`<a href="/credits/${esc(p.asset||'')}.md" target="_blank" rel="noopener">${esc(p.name)} · Source & license ↗</a>`).join('')}</div><p>These are sample catalog assets. Copyright and trademark rights remain with their respective owners. <a href="/credits/ATTRIBUTION.md" target="_blank">Full attribution and license notes</a>.</p><p>The editorial room image is from Unsplash, photo-1600607687939-ce8a6c25118c, and illustrates the collection. Model-viewer is included locally with its license notices.</p><h2>Accounts and orders</h2><p>Accounts, orders and variant inventory are stored on the server. Cash on delivery is supported. Online payments and automated courier services are not connected.</p></section>`;
}
function faq(){
 const qa=[['Do all products have 3D?','Yes. All 12 products in this supplied catalog have matching local GLB models. Hover with a mouse to rotate. Click a product for a larger view. On a phone, tap a product, then drag to turn it and pinch to zoom.'],['Why does the first hover take a moment?','The actual model loads when you interact, keeping the catalog lighter. The supplied preview stays visible until the model is ready. Leave the pointer over a product while it prepares.'],['Can I change finishes?','Products with authored material variants offer those finishes. The same geometry stays on screen while materials change. Products with one finish keep their original materials.'],['Why do I see an image instead?','WebGL and a compatible browser are needed for 3D. If rendering fails, the matching product preview remains visible. Automatic rotation respects your device’s reduced-motion setting; manual drag still works.'],['How do I pay?','Cash on delivery is supported. Online payment methods need a connected merchant provider.'],['Where is my order?','Log in to your account to see its status and the courier reference entered by the store owner.'],['How much is delivery?','Delivery is Rs 250, or free from Rs 10,000 after discounts.'],['Are these products available to buy?','The included collection uses licensed sample models and sample prices. The owner must replace or confirm actual inventory, publish business policies, and arrange fulfillment before accepting real customer orders.']];
 app.innerHTML=`<section class="wrap faq"><h1 class="page-title">A little clarity.</h1>${qa.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</section>`;
}
let modelLibrary=[];
const editProductBeforeModels=editProduct;
editProduct=async function(id){
 try{
  if(!modelLibrary.length)modelLibrary=(await api('admin/models')).models;
  editProductBeforeModels(id);const form=$('#admin-product-form'),p=adminProducts.find(p=>p.id===id);
  const found=modelLibrary.find(m=>m.model===p?.model);
  form.querySelector('h2').insertAdjacentHTML('afterend',`<div class="info model-source"><b>Matching 3D model</b><label class="field">Choose a supplied product model<select id="choose-built-in-model"><option value="">Choose model…</option>${modelLibrary.map((m,i)=>`<option value="${i}" ${found===m?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><label class="field">Selected GLB<input name="model" readonly value="${esc(p?.model||'')}"></label><label class="field">Or upload your matching self-contained GLB (maximum 20 MB)<input name="modelFile" type="file" accept=".glb,model/gltf-binary"></label><p>For a custom GLB, upload a matching preview image below. Model finishes are read from the file. Existing geometry is never guessed from a photograph.</p></div>`);
  form.elements.colors.readOnly=true;
  if(!p)applySuppliedModel(modelLibrary[0]);
 }catch(e){toast(e.message)}
};
function applySuppliedModel(m){
 const form=$('#admin-product-form');if(!m||!form)return;
 $('#choose-built-in-model').value=String(modelLibrary.indexOf(m));form.elements.model.value=m.model;form.elements.image.value=m.image;form.elements.colors.value=m.colors.join(', ');form.elements.photo.value='';form.elements.modelFile.value='';rebuildStock();
}
const saveProductBeforeModels=saveProduct;
saveProduct=async function(form){
 try{
  const file=form.elements.modelFile.files[0];
  if(file){
   if(file.size>20000000)throw Error('Use a self-contained GLB under 20 MB.');
   if(!form.elements.photo.files[0])throw Error('Upload a matching product preview image with your custom GLB.');
   const button=form.querySelector('button:last-of-type');button.disabled=true;button.textContent='Uploading 3D model…';
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file)});
   const result=await api('admin/upload-model','POST',{data});form.elements.model.value=result.url;form.elements.colors.value=result.colors.join(', ');rebuildStock();form.elements.modelFile.value='';
   button.disabled=false;button.textContent='Save product & stock';toast('3D model uploaded. Review the variant stock, then save the product.');return;
  }
  if(form.elements.active.value==='1'&&!form.elements.model.value)throw Error('Choose a matching model before activating this product.');
  return saveProductBeforeModels(form);
 }catch(e){toast(e.message);const button=form.querySelector('button:last-of-type');button.disabled=false;button.textContent='Save product & stock'}
};
document.addEventListener('change',e=>{if(e.target.id==='choose-built-in-model'&&e.target.value!=='')applySuppliedModel(modelLibrary[Number(e.target.value)])});
$('#product-dialog').addEventListener('close',()=>document.querySelectorAll('#detail-media model-viewer').forEach(mv=>mv.remove()));

