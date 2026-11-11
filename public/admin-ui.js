'use strict';
let manager={tab:'overview',category:'All',search:'',visibility:'all',orderStatus:'all',stockFilter:'all'},managerOrders=[],managerRequest=0;
const adminTabs=[['overview','Overview','◈'],['products','Products','▦'],['inventory','Inventory','▤'],['orders','Orders','↗']];
const categoryNames=()=>['All',...new Set(adminProducts.map(p=>p.cat))];
function selectedProducts(){return adminProducts.filter(p=>(manager.category==='All'||p.cat===manager.category)&&(manager.visibility==='all'||p.active===(manager.visibility==='active'))&&(`${p.name} ${p.id} ${p.cat}`).toLowerCase().includes(manager.search.toLowerCase().trim()))}
function lowStockVariants(){return adminProducts.flatMap(p=>(p.inventory||[]).filter(v=>v.qty<5).map(v=>({p,...v})))}
async function adminPage(){
 if(authUser?.role!=='admin'){app.innerHTML='<section class="wrap empty"><div class="eyebrow">ORBIT STUDIO</div><h1>Store management.</h1><p>Log in with your administrator account to continue.</p><a class="btn" href="#account">Log in</a></section>';return}
 const request=++managerRequest;
 app.innerHTML='<section class="wrap manager-loading"><div class="eyebrow">ORBIT STUDIO</div><h1 class="page-title">Opening your workspace.</h1><p role="status">Loading products, inventory and orders…</p></section>';
 try{
  const [ps,os]=await Promise.all([api('admin/products'),api('admin/orders')]);
  if(request!==managerRequest||location.hash!=='#admin')return;
  adminProducts=ps.products;managerOrders=os.orders;paintManager();
 }catch(e){if(request===managerRequest){app.innerHTML=`<section class="wrap empty"><h1>Couldn’t open your workspace.</h1><p>${esc(e.message)}</p><button class="btn" data-manager-refresh>Try again</button></section>`}}
}
function paintManager(){
 app.innerHTML=`<section class="manager-shell"><aside class="manager-sidebar"><a href="#admin" class="studio-wordmark">ORBIT<span>STUDIO</span></a><p class="sidebar-label">YOUR WORKSPACE</p><nav aria-label="Store management">${adminTabs.map(([id,label,icon])=>`<button data-manager-tab="${id}" class="${manager.tab===id?'selected':''}" ${manager.tab===id?'aria-current="page"':''}><i>${icon}</i>${label}${id==='orders'?`<span>${managerOrders.length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><span class="owner-avatar">${esc(authUser.name[0].toUpperCase())}</span><div><b>${esc(authUser.name)}</b><small>Store administrator</small></div></div><a class="back-store" href="#shop">↗ Visit storefront</a></aside><div class="manager-main"><div class="manager-topbar"><span>Workspace <i>/</i> <b>${adminTabs.find(t=>t[0]===manager.tab)[1]}</b></span><button class="workspace-refresh" data-manager-refresh>↻ Refresh</button></div><div class="manager-heading"><div><span class="eyebrow">YOUR STORE, CONSIDERED</span><h1>${({overview:'A little perspective.',products:'Your collection.',inventory:'Every piece accounted for.',orders:'From your store, to their door.'})[manager.tab]}</h1><p>${({overview:'The numbers, the details, and what needs your attention.',products:'A clear view of every product, organized by department.',inventory:'Track availability by product, finish, and size.',orders:'Manage your orders from confirmation to delivery.'})[manager.tab]}</p></div><button class="btn" id="new-product">＋ Add product</button></div><div id="manager-view"></div><div id="product-editor"></div></div></section>`;
 paintManagerView();
}
function categoryControls(){return `<div class="manager-categories" aria-label="Product departments">${categoryNames().map(c=>`<button data-manager-category="${esc(c)}" class="${manager.category===c?'selected':''}" aria-pressed="${manager.category===c}">${esc(c==='All'?'All products':c)}<span>${adminProducts.filter(p=>c==='All'||p.cat===c).length}</span></button>`).join('')}</div>`}
function managerToolbar(stock=false){return `<div class="manager-toolbar"><label class="manager-search"><span>⌕</span><input id="manager-search" type="search" placeholder="Search ${stock?'products or SKU details':'products'}…" aria-label="Search management products" value="${esc(manager.search)}"></label>${stock?`<select id="manager-stock-filter" aria-label="Inventory stock filter"><option value="all" ${manager.stockFilter==='all'?'selected':''}>All stock levels</option><option value="low" ${manager.stockFilter==='low'?'selected':''}>Low stock · under 5</option><option value="out" ${manager.stockFilter==='out'?'selected':''}>Out of stock</option></select>`:''}<select id="manager-visibility" aria-label="Product visibility"><option value="all" ${manager.visibility==='all'?'selected':''}>All visibility</option><option value="active" ${manager.visibility==='active'?'selected':''}>Active products</option><option value="hidden" ${manager.visibility==='hidden'?'selected':''}>Hidden products</option></select></div>`}
function paintManagerView(){
 const el=$('#manager-view');if(!el)return;
 if(manager.tab==='overview'){
  const pending=managerOrders.filter(o=>!['delivered','cancelled'].includes(o.status)),collected=managerOrders.filter(o=>o.paymentStatus==='collected').reduce((n,o)=>n+o.total,0),low=lowStockVariants();
  el.innerHTML=`<div class="studio-metrics">${[['Active products',adminProducts.filter(p=>p.active).length,'Across '+(categoryNames().length-1)+' departments','products'],['Open orders',pending.length,'Awaiting delivery','orders'],['Collected COD',money(collected),'Delivered and collected','orders'],['Low-stock variants',low.length,'Fewer than 5 units available','inventory']].map(([label,value,help,tab])=>`<button class="metric-card" data-manager-tab="${tab}" ${label==='Low-stock variants'?'data-low-stock="1"':''}><span>${label}<i>↗</i></span><b>${value}</b><small>${help}</small></button>`).join('')}</div><div class="manager-section-title"><div><span class="eyebrow">THE BIG PICTURE</span><h2>Your departments.</h2></div><button class="studio-text-button" data-manager-tab="products">View all products ↗</button></div><div class="department-overview">${categoryNames().filter(c=>c!=='All').map((c,i)=>{const ps=adminProducts.filter(p=>p.cat===c);return `<button class="department-stat" data-department-open="${esc(c)}"><span class="department-stat-number">0${i+1} /</span><div><h3>${esc(c)}</h3><p>${ps.length} products · ${ps.reduce((n,p)=>n+p.stock,0)} units in stock</p></div><span>↗</span></button>`}).join('')}</div><div class="manager-section-title"><div><span class="eyebrow">YOUR LATEST ACTIVITY</span><h2>Recent orders.</h2></div><button class="studio-text-button" data-manager-tab="orders">All orders ↗</button></div>${orderList(managerOrders.slice(0,5))}<div class="studio-note"><span>◉</span><div><b>A collection worth exploring.</b><p>Every included product has a matching 3D model. Add matching models and preview images as you grow your catalog.</p></div><a href="#shop">Visit storefront ↗</a></div>`;
 }else if(manager.tab==='products'){
  el.innerHTML=`${categoryControls()}${managerToolbar()}<div id="manager-results"></div>`;paintManagerResults();
 }else if(manager.tab==='inventory'){
  el.innerHTML=`${categoryControls()}${managerToolbar(true)}<p class="inventory-help">Quantities are per finish and size. Save a row to set its available stock.</p><div id="manager-results"></div>`;paintManagerResults();
 }else{
  el.innerHTML=`<div class="order-status-tabs">${['all','placed','confirmed','packed','shipped','delivered','cancelled'].map(s=>`<button data-manager-status="${s}" class="${manager.orderStatus===s?'selected':''}">${s==='all'?'All orders':s[0].toUpperCase()+s.slice(1)}<span>${managerOrders.filter(o=>s==='all'||o.status===s).length}</span></button>`).join('')}</div>${orderList(managerOrders.filter(o=>manager.orderStatus==='all'||o.status===manager.orderStatus))}<p class="inventory-help">Move orders through confirmation, packing, shipping, and delivery. Cancelling an unshipped order restores its stock.</p>`;
 }
}
function paintManagerResults(){
 const el=$('#manager-results');if(!el)return;
 const ps=selectedProducts();
 if(manager.tab==='products'){
  el.innerHTML=ps.length?`<div class="studio-table-scroll"><table class="studio-table"><thead><tr><th>Product</th><th>Department</th><th>Price</th><th>Stock</th><th>Visibility</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${ps.map(p=>`<tr><td><div class="table-product"><img src="${esc(photoURL(p))}" alt=""><div><b>${esc(p.name)}</b><small>${esc(p.id)} <span>· 3D model</span></small></div></div></td><td>${esc(p.cat)}</td><td><b>${money(Math.round(p.base*(100-p.off)/100))}</b>${p.off?`<small class="table-discount">${p.off}% off · base ${money(p.base)}</small>`:''}</td><td><span class="stock-dot ${p.stock===0?'out':p.inventory.some(v=>v.qty<5)?'low':''}"></span>${p.stock}<small class="table-discount">${p.inventory.length} variants</small></td><td><span class="visibility-pill ${p.active?'active':'hidden'}">${p.active?'Active':'Hidden'}</span></td><td><button class="table-edit" data-edit-product="${esc(p.id)}" aria-label="Edit ${esc(p.name)}">Edit ↗</button></td></tr>`).join('')}</tbody></table></div><p class="results-count">Showing ${ps.length} of ${adminProducts.length} products</p>`:emptyManager('No products match.','Try another department, search, or visibility filter.');
 }else{
  // SKU searches include finish and size, while department/visibility stay independent.
  const query=manager.search.toLowerCase().trim();
  const rows=adminProducts.filter(p=>(manager.category==='All'||p.cat===manager.category)&&(manager.visibility==='all'||p.active===(manager.visibility==='active'))).flatMap(p=>p.inventory.map(v=>({p,...v}))).filter(r=>(`${r.p.name} ${r.p.id} ${r.color} ${r.size}`).toLowerCase().includes(query)&&(manager.stockFilter==='all'||manager.stockFilter==='out'&&r.qty===0||manager.stockFilter==='low'&&r.qty<5));
  el.innerHTML=rows.length?`<div class="studio-table-scroll"><table class="studio-table inventory-table"><thead><tr><th>Product / department</th><th>Finish</th><th>Size</th><th>Stock level</th><th>Available quantity</th></tr></thead><tbody>${rows.map((r,n)=>`<tr><td><b>${esc(r.p.name)}</b><small class="table-discount">${esc(r.p.cat)}</small></td><td>${esc(r.color)}</td><td>${esc(r.size)}</td><td><span class="visibility-pill ${r.qty===0?'empty-stock':r.qty<5?'low-stock':'active'}">${r.qty===0?'Out of stock':r.qty<5?'Low stock':'In stock'}</span></td><td><form class="stock-row-form" data-stock-product="${esc(r.p.id)}" data-stock-finish="${esc(r.color)}" data-stock-size="${esc(r.size)}" data-stock-previous="${r.qty}"><input name="qty" type="number" min="0" max="1000000" step="1" value="${r.qty}" aria-label="Stock for ${esc(r.p.name)} / ${esc(r.color)} / ${esc(r.size)}" required><button class="table-edit">Save</button></form></td></tr>`).join('')}</tbody></table></div><p class="results-count">${rows.length} matching variants</p>`:emptyManager('Everything is clear.','No inventory variants match these filters.');
 }
}
function emptyManager(title,copy){return `<div class="manager-empty"><span>◈</span><h3>${esc(title)}</h3><p>${esc(copy)}</p></div>`}
function orderList(orders){return orders.length?`<div class="studio-orders">${orders.map(o=>`<details class="studio-order"><summary><div><b>${esc(o.id)}</b><small>${esc(o.name)} · ${esc(o.city)}</small></div><span class="order-date">${new Date(o.date).toLocaleDateString()}</span><span class="visibility-pill order-${esc(o.status)}">${esc(o.status)}</span><b>${money(o.total)}</b><span class="order-open">⌄</span></summary><div class="studio-order-detail">${orderCard(o,true)}</div></details>`).join('')}</div>`:emptyManager('Your next order starts here.','New orders will appear here when a customer checks out.')}
document.addEventListener('click',e=>{
 const t=e.target.closest('button');if(!t)return;
 if(t.hasAttribute('data-manager-refresh')){adminPage();return}
 if(t.dataset.managerTab){manager.tab=t.dataset.managerTab;if(t.dataset.lowStock)manager.stockFilter='low';paintManager();return}
 if(t.dataset.managerCategory){manager.category=t.dataset.managerCategory;paintManagerView();return}
 if(t.dataset.departmentOpen){manager.category=t.dataset.departmentOpen;manager.tab='products';manager.search='';paintManager();return}
 if(t.dataset.managerStatus){manager.orderStatus=t.dataset.managerStatus;paintManagerView()}
});
document.addEventListener('input',e=>{if(e.target.id==='manager-search'){manager.search=e.target.value;paintManagerResults()}});
document.addEventListener('change',e=>{if(e.target.id==='manager-visibility'){manager.visibility=e.target.value;paintManagerResults()}if(e.target.id==='manager-stock-filter'){manager.stockFilter=e.target.value;paintManagerResults()}});
document.addEventListener('submit',async e=>{
 const form=e.target;if(!form.dataset.stockProduct)return;e.preventDefault();const button=form.querySelector('button');button.disabled=true;
 try{
  await api('admin/inventory/'+encodeURIComponent(form.dataset.stockProduct),'PATCH',{color:form.dataset.stockFinish,size:form.dataset.stockSize,qty:Number(form.elements.qty.value),expectedQty:Number(form.dataset.stockPrevious)});
  adminProducts=(await api('admin/products')).products;const catalog=await api('products');P.splice(0,P.length,...catalog.products);toast('Stock updated.');paintManagerResults();
 }catch(err){toast(err.message)}finally{button.disabled=false}
});
const homeBeforeRefinement=home;
home=function(shop=false){
 homeBeforeRefinement(shop);
 if(!shop){const hero=app.querySelector('.premium-hero');if(hero)hero.insertAdjacentHTML('afterend',`<div class="store-assurance"><span><i>◉</i> ${P.length} considered pieces</span><span><i>↻</i> Every product in real 3D</span><span><i>⌂</i> Cash on delivery</span><span><i>↗</i> Free delivery from Rs 10,000</span></div>`)}
};
boot();
