'use strict';
let authUser=null,csrf='',cartTimer,cartRevision=0,serverQuote=null,orderKey=null,adminProducts=[];
function save(){persistState();syncCart()}
function stockFor(p,color,size){return p.inventory?.find(v=>v.color===color&&v.size===size)?.qty||0}
const originalRefreshVariant=refreshVariant;
refreshVariant=function(){
 originalRefreshVariant();const p=by(detail.id),stock=stockFor(p,detail.color,detail.size);
 $('#variant-summary').textContent=p.name+' · '+detail.color+' · '+detail.size+' · '+stock+' available';
 $('#detail-add').disabled=stock<1;$('#detail-add').textContent=stock<1?'Out of stock':'Add selected variant to bag ↗';
}
function addItem(i,quiet=false){
 const p=by(i.id);if(!p||!p.colors.includes(i.color)||!p.sizes.includes(i.size)||!Number.isInteger(i.qty)||i.qty<1||i.qty>20){toast('Choose a valid variant and quantity.');return false}
 const same=S.cart.find(x=>x.id===i.id&&x.color===i.color&&x.size===i.size),next=(same?.qty||0)+i.qty;
 if(next>Math.min(20,stockFor(p,i.color,i.size))){toast('Not enough stock for this variant.');return false}
 if(same)same.qty=next;else S.cart.push({id:i.id,color:i.color,size:i.size,qty:i.qty});save();if(!quiet)toast(p.name+' added to your bag.');return true;
}
function changeQty(n,delta){const i=S.cart[n];if(!i)return;const next=i.qty+delta;if(next<=0)S.cart.splice(n,1);else if(next<=Math.min(20,stockFor(by(i.id),i.color,i.size)))i.qty=next;else toast('Not enough stock for this variant.');save();paintBag()}
async function api(path,method='GET',body){
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed.');return result;
}
async function boot(){
  try{
    const session=await api('session');csrf=session.csrf;
    const catalog=await api('products');
    authUser=session.user;S.profile=authUser;S.orders=[];
    P.splice(0,P.length,...catalog.products);S.cart=cleanCart(S.cart);S.wishes=S.wishes.filter(by);S.compare=S.compare.filter(by);bundle=bundle.filter(by);
    if(authUser){const saved=await api('cart');S.cart=cleanCart(saved.items)}
    render();
  }catch(error){app.innerHTML=`<section class="wrap empty"><h1>We couldn’t open the store.</h1><p>${esc(error.message)}</p><p>Start the store using START_STORE.bat, then open http://127.0.0.1:8000.</p><button class="btn" id="retry-boot">Try again</button></section>`}
}
function cleanCart(items){return (Array.isArray(items)?items:[]).filter(i=>by(i.id)&&by(i.id).colors.includes(i.color)&&by(i.id).sizes.includes(i.size)&&Number.isInteger(i.qty)&&i.qty>0&&i.qty<=20)}
function syncCart(){
  clearTimeout(cartTimer);if(!authUser)return;
  const revision=++cartRevision;
  cartTimer=setTimeout(async()=>{try{await api('cart','PUT',{items:S.cart})}catch(e){if(revision===cartRevision)toast('Bag could not sync: '+e.message)}},450);
}
function orderCard(o,admin=false){
 return `<article class="panel order-card"><div class="order-head"><b>${esc(o.id)}</b><span class="pill">${esc(o.status)}</span><b>${money(o.total)}</b></div><p>${new Date(o.date).toLocaleDateString()} · ${esc(o.city)} · Cash on delivery · ${esc(o.paymentStatus)}</p>${o.items.map(i=>`<div class="line"><div class="line-copy"><h3>${esc(i.name)} × ${i.qty}</h3><p>${esc(i.color)} / ${esc(i.size)}</p></div><b>${money(i.unit*i.qty)}</b></div>`).join('')}${o.tracking?`<p><b>Courier / tracking:</b> ${esc(o.tracking)}</p>`:''}${o.note?`<p>Note: ${esc(o.note)}</p>`:''}${admin?`<p><b>Deliver to:</b> ${esc(o.name)} · ${esc(o.phone)}<br>${esc(o.street)}, ${esc(o.city)}</p><form data-order-update="${esc(o.id)}"><label class="field">Status<select name="status">${['placed','confirmed','packed','shipped','delivered','cancelled'].map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></label><label class="field">Courier and tracking number<input name="tracking" maxlength="160" value="${esc(o.tracking)}"></label><button class="btn small">Update order</button></form>`:''}</article>`;
}
async function account(){
 app.innerHTML=`<section class="wrap"><div class="eyebrow">YOUR ORBIT</div><h1 class="page-title">${authUser?'Welcome, '+esc(authUser.name.split(' ')[0])+'.':'Make yourself at home.'}</h1>${!authUser?`<div class="two-col"><form id="login-form" class="panel"><h2>Welcome back.</h2><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="current-password" required></label><button class="btn full">Log in</button><button type="button" class="text-link" data-account-mode="forgot">Forgot password?</button></form><form id="register-form" class="panel"><h2>Your next chapter.</h2><label class="field">Full name<input name="name" minlength="2" maxlength="80" autocomplete="name" required></label><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">Password, at least 12 characters<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="btn full">Create account</button></form></div>`:`<div class="info"><p>${esc(authUser.email)}</p><button class="btn small light" id="logout-real">Log out</button>${authUser.role==='admin'?'<a class="btn small" href="#admin">Manage store</a>':''}</div><h2>Your orders</h2><div id="real-orders" aria-live="polite">Loading your orders…</div>`}</section>`;
 if(authUser){try{const data=await api('orders');const el=$('#real-orders');if(el)el.innerHTML=data.orders.length?data.orders.map(o=>orderCard(o)).join(''):'<p>No orders yet. Your next favorite is waiting.</p>'}catch(e){toast(e.message)}}
}
function passwordPage(reset=false){
 app.innerHTML=`<section class="wrap"><h1 class="page-title">${reset?'Choose a new password.':'Forgot your password?'}</h1><form id="${reset?'reset-real-form':'forgot-real-form'}" class="panel narrow">${reset?'<label class="field">New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>':'<label class="field">Account email<input name="email" type="email" required></label>'}<button class="btn full">${reset?'Save password':'Send reset link'}</button><p id="password-message" role="status"></p></form><a href="#account">Back to account</a></section>`;
}
async function checkout(){
 serverQuote=null;
 if(!authUser){app.innerHTML='<section class="wrap empty"><h1>Please log in to checkout.</h1><p>Your bag will stay here while you log in.</p><a class="btn" href="#account">Log in or create account</a></section>';return}
 if(!S.cart.length){app.innerHTML='<section class="wrap empty"><h1>Your bag is empty.</h1><a href="#shop" class="btn">Explore the collection</a></section>';return}
 app.innerHTML=`<section class="wrap"><div class="eyebrow">THE FINAL DETAILS</div><h1 class="page-title">Your choices. All together.</h1><div class="two-col"><form id="checkout-real-form" class="panel"><h2>Delivery details</h2>${[['name','Full name','text',authUser.name],['phone','Phone number','tel',''],['street','Street address','text',''],['city','City','text','']].map(([key,label,type,value])=>`<label class="field">${label}<input name="${key}" type="${type}" minlength="2" maxlength="160" value="${esc(value)}" required></label>`).join('')}<h3>Payment</h3><div class="info"><b>Cash on delivery</b><p>Pay the courier when your order arrives.</p></div><p class="fine">Online payment methods will appear once the store owner connects a merchant account.</p><label class="field">Order note, optional<textarea name="note" maxlength="300"></textarea></label><button id="place-real-order" class="btn full" disabled>Checking prices and availability…</button><p role="status" id="checkout-error"></p></form><div class="panel"><h2>Your bag</h2>${S.cart.map(i=>`<div class="line"><div class="thumb">${medium(by(i.id))}</div><div class="line-copy"><h3>${esc(by(i.id).name)} × ${i.qty}</h3><p>${esc(i.color)} / ${esc(i.size)}</p></div></div>`).join('')}<div id="server-totals"></div></div></div></section>`;
 try{const q=await api('quote','POST',{items:S.cart,coupon});if(!$('#server-totals'))return;serverQuote=q;$('#server-totals').innerHTML=summary(q);$('#place-real-order').disabled=false;$('#place-real-order').textContent='Place order · '+money(q.total)}catch(e){if($('#checkout-error'))$('#checkout-error').textContent=e.message}
}
async function placeRealOrder(form){
 if(!serverQuote)return;
 const button=form.querySelector('button');button.disabled=true;clearTimeout(cartTimer);
 try{
  const current=await api('quote','POST',{items:S.cart,coupon});
  if(JSON.stringify(current)!==JSON.stringify(serverQuote)){serverQuote=current;$('#server-totals').innerHTML=summary(current);throw Error('Prices or availability changed. Review the updated total, then place your order again.')}
  orderKey=orderKey||crypto.randomUUID();
  const result=await api('orders','POST',{...Object.fromEntries(new FormData(form)),items:S.cart,coupon,payment:'cod',requestKey:orderKey});
  orderKey=null;S.cart=[];serverQuote=null;save();
  app.innerHTML=`<section class="wrap"><div class="eyebrow">THANK YOU</div><h1 class="page-title">Your order is placed.</h1><p>Pay ${money(result.order.total)} on delivery. Your order is awaiting confirmation by the store.</p>${orderCard(result.order)}<a class="btn" href="#account">Track your orders</a></section>`;
  try{const catalog=await api('products');P.splice(0,P.length,...catalog.products)}catch{ /* Order confirmation remains visible if catalog refresh fails. */ }
 }catch(e){if($('#checkout-error'))$('#checkout-error').textContent=e.message;toast(e.message)}finally{if(button.isConnected){button.disabled=false;button.textContent='Place order · '+money(serverQuote?.total||0)}}
}
async function adminPage(){
 if(authUser?.role!=='admin'){app.innerHTML='<section class="wrap empty"><h1>Store management</h1><p>Log in with your administrator account to continue. Create the owner account using CREATE_ADMIN.bat.</p><a class="btn" href="#account">Log in</a></section>';return}
 app.innerHTML='<section class="wrap"><h1 class="page-title">Your store, at a glance.</h1><div id="admin-content">Loading management tools…</div></section>';
 try{
  const [ps,os]=await Promise.all([api('admin/products'),api('admin/orders')]);adminProducts=ps.products;
  const el=$('#admin-content');if(!el)return;
  el.innerHTML=`<div class="admin-metrics"><div class="panel"><small>PRODUCTS</small><h2>${ps.products.length}</h2></div><div class="panel"><small>ORDERS</small><h2>${os.orders.length}</h2></div><div class="panel"><small>COLLECTED COD</small><h2>${money(os.orders.filter(o=>o.paymentStatus==='collected').reduce((n,o)=>n+o.total,0))}</h2></div></div><div class="section-head"><h2>Catalog & inventory</h2><button class="btn small" id="new-product">Add product</button></div><div class="admin-products">${ps.products.map(p=>`<button class="admin-product" data-edit-product="${esc(p.id)}"><img src="${esc(photoURL(p))}" alt=""><span><b>${esc(p.name)}</b><small>${money(p.base)} · ${p.off}% off · ${p.stock} units · ${p.active?'Active':'Hidden'}</small></span><span>Edit ↗</span></button>`).join('')}</div><div id="product-editor"></div><h2>Order fulfillment</h2><p class="fine">Confirm, pack, ship, and deliver in order. Cancelling an unshipped order returns its stock. Enter the courier and tracking number after dispatch.</p>${os.orders.length?os.orders.map(o=>orderCard(o,true)).join(''):'<div class="info">No orders yet.</div>'}`;
 }catch(e){toast(e.message)}
}
function editProduct(id){
 const p=adminProducts.find(p=>p.id===id)||{id:'',name:'',cat:'Fashion',base:1000,off:0,colors:['Black'],sizes:['Standard'],active:true,inventory:[]};
 $('#product-editor').innerHTML=`<form id="admin-product-form" class="panel"><h2>${p.id?'Edit product':'Add a product'}</h2><div class="two-col">${[['id','Product ID',p.id],['name','Product name',p.name]].map(([key,label,v])=>`<label class="field">${label}<input name="${key}" value="${esc(v)}" ${key==='id'&&p.id?'readonly':''} required></label>`).join('')}<label class="field">Department<select name="cat">${departments.map(([c])=>`<option ${p.cat===c?'selected':''}>${c}</option>`).join('')}</select></label><label class="field">Base price (PKR)<input type="number" name="base" min="1" step="1" value="${p.base}" required></label><label class="field">Discount %<input type="number" name="off" min="0" max="90" step="1" value="${p.off}" required></label><label class="field">Visibility<select name="active"><option value="1" ${p.active?'selected':''}>Active</option><option value="0" ${!p.active?'selected':''}>Hidden</option></select></label><label class="field">Colors, separated by commas<input name="colors" value="${esc(p.colors.join(', '))}" required></label><label class="field">Sizes, separated by commas<input name="sizes" value="${esc(p.sizes.join(', '))}" required></label></div><p class="fine">Size price increments follow the existing store rules. Verify each variant in the catalog after saving.</p><label class="field">Product photograph (JPEG, PNG, WebP, maximum 3 MB)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label><input name="image" type="hidden" value="${esc(p.image||'')}"><button type="button" class="btn small light" id="rebuild-stock">Update variant rows</button><div id="stock-editor"></div><button class="btn">Save product & stock</button><p role="status" id="admin-product-message"></p></form>`;
 rebuildStock(p.inventory);$('#product-editor').scrollIntoView({behavior:'smooth',block:'start'});
}
function rebuildStock(existing){
 const form=$('#admin-product-form');if(!form)return;
 const rows=existing||[...form.querySelectorAll('[data-stock-color]')].map(el=>({color:el.dataset.stockColor,size:el.dataset.stockSize,qty:Number(el.value)}));
 const split=name=>[...new Set(form.elements[name].value.split(',').map(s=>s.trim()).filter(Boolean))];
 const colors=split('colors'),sizes=split('sizes');if(colors.length>30||sizes.length>30){toast('Maximum 30 colors and 30 sizes.');return}
 $('#stock-editor').innerHTML='<h3>Stock per variant</h3><div class="stock-grid">'+colors.flatMap(color=>sizes.map(size=>`<label class="field">${esc(color)} / ${esc(size)}<input type="number" min="0" max="1000000" step="1" required data-stock-color="${esc(color)}" data-stock-size="${esc(size)}" value="${rows.find(r=>r.color===color&&r.size===size)?.qty||0}"></label>`)).join('')+'</div>';
}
async function saveProduct(form){
 const button=form.querySelector('button:last-of-type');button.disabled=true;
 try{
  const d=Object.fromEntries(new FormData(form));let image=d.image;
  if(d.photo?.size){if(d.photo.size>3000000)throw Error('Use an image under 3 MB.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(d.photo)});image=(await api('admin/upload','POST',{data})).url}
  const split=v=>[...new Set(v.split(',').map(s=>s.trim()).filter(Boolean))];
  const product={...d,base:Number(d.base),off:Number(d.off),active:d.active==='1',colors:split(d.colors),sizes:split(d.sizes),image,inventory:[...form.querySelectorAll('[data-stock-color]')].map(el=>({color:el.dataset.stockColor,size:el.dataset.stockSize,qty:Number(el.value)}))};delete product.photo;
  await api('admin/products/'+encodeURIComponent(d.id),'PUT',{product});
  const catalog=await api('products');P.splice(0,P.length,...catalog.products);S.cart=cleanCart(S.cart);S.wishes=S.wishes.filter(by);S.compare=S.compare.filter(by);bundle=bundle.filter(by);save();toast('Product and inventory saved.');adminPage();
 }catch(e){$('#admin-product-message').textContent=e.message}finally{button.disabled=false}
}
function faq(){app.innerHTML=`<section class="wrap faq"><h1 class="page-title">A little clarity.</h1>${[['How do I pay?','Cash on delivery is available. Online payments need a connected merchant account and are currently unavailable.'],['Where is my order?','Log in to your account for order status and the courier reference entered by the store. Courier updates are managed manually.'],['How much is delivery?','Delivery is Rs 250, or free from Rs 10,000 after discounts.'],['Which products rotate?','The Sneaker Studio sample has an actual textured 3D model. Other products show their available original photographs.'],['How do I reset my password?','Use Forgot password on the account page. Email delivery requires SMTP configuration. The store owner can also reset an account from the server command line.'],['Are these real products?','The supplied catalog uses sample products, prices and photography. The owner must replace them with products they actually sell before accepting customer orders.'],['What is the return policy?','Contact the store owner before returning a purchase. The owner must publish their contact details and return terms before launching.']].map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</section>`}
const originalAbout=about;
about=function(){originalAbout();const policy=app.querySelector('.policy');policy.querySelectorAll('button').forEach(el=>el.remove());policy.innerHTML=policy.innerHTML.replace(/<h2>Payments and privacy<\/h2>[\s\S]*/,`<h2>Accounts and orders</h2><p>Accounts, orders and variant inventory are stored on the store server. Cash on delivery is available. The supplied catalog is demonstration inventory that the owner must replace before launch.</p><p>Online payments and courier integrations are not connected. Product photographs and the 3D sample are included locally.</p>`)};
document.addEventListener('click',async e=>{
 const t=e.target.closest('button');if(!t)return;
 if(t.id==='retry-boot')boot();
 if(t.dataset.accountMode==='forgot')passwordPage();
 if(t.id==='new-product')editProduct('');
 if(t.dataset.editProduct)editProduct(t.dataset.editProduct);
 if(t.id==='rebuild-stock')rebuildStock();
 if(t.id==='logout-real'){try{clearTimeout(cartTimer);await api('logout','POST',{});const session=await api('session');csrf=session.csrf;authUser=null;S.profile=null;S.cart=[];save();account()}catch(err){toast(err.message)}}
});
document.addEventListener('submit',async e=>{
 const form=e.target,d=Object.fromEntries(new FormData(form));
 if(form.id==='checkout-real-form')return placeRealOrder(form);
 if(form.id==='admin-product-form')return saveProduct(form);
 if(form.dataset.orderUpdate){try{await api('admin/orders/'+form.dataset.orderUpdate,'PATCH',d);toast('Order updated.');adminPage()}catch(err){toast(err.message)}return}
 if(!['login-form','register-form','forgot-real-form','reset-real-form'].includes(form.id))return;
 const button=form.querySelector('button');button.disabled=true;
 try{
  if(form.id==='forgot-real-form'){const result=await api('forgot-password','POST',d);$('#password-message').textContent=result.message;return}
  if(form.id==='reset-real-form'){await api('reset-password','POST',{password:d.password,token:location.hash.slice(7)});const session=await api('session');csrf=session.csrf;authUser=session.user;S.profile=authUser;toast('Password updated. Please log in.');go('account');return}
  const result=await api(form.id==='login-form'?'login':'register','POST',d);csrf=result.csrf;authUser=result.user;S.profile=authUser;
  const combined=new Map();for(const i of [...cleanCart(result.cart),...S.cart]){const key=[i.id,i.color,i.size].join('\u0000');if(!combined.has(key))combined.set(key,{...i});else combined.get(key).qty=Math.min(20,Math.max(combined.get(key).qty,i.qty))}
  S.cart=[...combined.values()];await api('cart','PUT',{items:S.cart});save();toast('You’re logged in.');account();
 }catch(err){toast(err.message)}finally{button.disabled=false}
});

