// DOM simulation verifies store wiring and computations. It is not a browser test.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const elements=new Map(),handlers={},memory=new Map(),requests=[];
class El{
 constructor(){this.innerHTML='';this.textContent='';this.value='';this.open=false;this.dataset={};this.style={};this.classList={add(){},remove(){},toggle(){}};}
 addEventListener(){} animate(){return {}} showModal(){this.open=true} close(){this.open=false}
 insertAdjacentHTML(where,html){this.innerHTML+=html} querySelector(s){return get(s)} querySelectorAll(){return []} scrollIntoView(){}
}
const get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)};
const document={querySelector:get,querySelectorAll:()=>[],addEventListener:(t,f)=>(handlers[t]??=[]).push(f),body:{classList:{add(){},remove(){}},appendChild(){}}};
const catalog=JSON.parse(fs.readFileSync(new URL('catalog.json',import.meta.url),'utf8')).map(p=>({...p,inventory:p.colors.flatMap(color=>p.sizes.map(size=>({color,size,qty:20})))}));
const fetch=async(path,options)=>{
 requests.push({path,...options});let result;
 if(path==='/api/session')result={csrf:'test-csrf',user:null};
 else if(path==='/api/products')result={products:catalog};
 else if(path==='/api/orders'||path==='/api/admin/orders')result={orders:[]};
 else if(path==='/api/admin/products')result={products:catalog.map(p=>({...p,active:true}))};
 else if(path==='/api/quote')result={sub:3600,saving:900,discount:0,shipping:250,total:3850};
 else throw Error('Unexpected endpoint '+path);
 return {ok:true,json:async()=>result};
};
const context=vm.createContext({document,console,fetch,crypto:{randomUUID:()=> 'test-key-123456789'},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},matchMedia:()=>({matches:true}),location:{hash:''},window:{addEventListener(){},scrollTo(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},Image:class{},URL,Blob,Date,FormData:class{constructor(form){this.fields=form.fields||[]} [Symbol.iterator](){return this.fields[Symbol.iterator]()}},FileReader:class{}});
const run=code=>vm.runInContext(code,context),value=code=>JSON.parse(run('JSON.stringify('+code+')'));
run(fs.readFileSync(new URL('public/app.js',import.meta.url),'utf8'));
run(fs.readFileSync(new URL('public/backend.js',import.meta.url),'utf8'));
run(fs.readFileSync(new URL('public/catalog3d.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''));
run(fs.readFileSync(new URL('public/admin-ui.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''));
await run('boot()');
assert.equal(requests[0].path,'/api/session');assert.equal(requests[1].path,'/api/products');
assert.equal(value('P.length'),12);assert.equal((get('#cards').innerHTML.match(/data-product=/g)||[]).length,12);
assert.equal(value("photoURL(by('studio-shoe'))"),'/assets/models/MaterialsVariantsShoe.jpg');
for(const p of catalog){
 const media=run(`model(by(${JSON.stringify(p.id)}),true)`);assert(media.includes(`src="${p.model}"`));assert(media.includes(`poster="${p.image}"`));assert(media.includes('camera-controls'));
 const markup=run(`card(by(${JSON.stringify(p.id)}))`);assert(!markup.includes('<model-viewer'));assert(markup.includes(p.image));
}
run("openProduct('chrono-watch')");assert(get('#detail-media').innerHTML.includes('/assets/models/ChronographWatch.glb'));assert(!get('#product-body').innerHTML.includes('three-dimensional shoe'));

assert.equal(value("price({id:'chrono-watch',size:'Standard'}).sale"),42680);
assert.deepEqual(value("computeTotals([{id:'studio-shoe',size:'42',qty:2}],'ORBIT10')"),{sub:50830,saving:8970,discount:5083,shipping:0,total:45747});
for(const cat of ['Gift','Fashion','Home','Electronics','Travel'])for(const amount of [500,1000,5000,10000,25000,100000,1000000]){
 const result=value(`chooseBundle(${amount},${JSON.stringify(cat)})`);
 assert(result.ids.length<=6);assert.equal(new Set(result.ids).size,result.ids.length);
 const items=result.ids.map(id=>({id,size:catalog.find(p=>p.id===id).sizes[0],qty:1}));assert(value(`computeTotals(${JSON.stringify(items)}).total`)<=amount);
}
const target=map=>({closest:sel=>map[sel]||null});
handlers.click[0]({target:target({'[data-product]':{dataset:{product:'studio-shoe'}}})});assert(get('#product-dialog').open);
handlers.click[0]({target:target({'[data-size]':{dataset:{size:'42'}}})});
handlers.click[0]({target:target({'[data-color]':{dataset:{color:'beach'}}})});
get('#detail-qty').value='2';handlers.click[0]({target:target({'button':{id:'detail-add'}})});
assert.deepEqual(value('S.cart'),[{id:'studio-shoe',color:'beach',size:'42',qty:2}]);
assert.equal(value("addItem({id:'studio-shoe',color:'beach',size:'42',qty:19},true)"),false);
run("by('studio-shoe').inventory.find(v=>v.color==='Original'&&v.size==='41').qty=0");
assert.equal(value("addItem({id:'studio-shoe',color:'Original',size:'41',qty:1},true)"),false);
await run('checkout()');assert(get('#app').innerHTML.includes('Please log in'));
await run("authUser={id:'test',name:'Test Person',email:'test@example.test',role:'customer'};S.profile=authUser;checkout()");assert(get('#app').innerHTML.includes('Cash on delivery'));assert(!get('#app').innerHTML.includes('name="payment"'));assert.equal(get('#place-real-order').disabled,false);
await run('account()');assert(get('#app').innerHTML.includes('Your orders'));assert(get('#real-orders').innerHTML.includes('No orders yet'));
await run('adminPage()');assert(get('#app').innerHTML.includes('administrator'));
run("authUser=null;S.profile=null;save()");const stored=JSON.parse(memory.get('orbit-midnight-motion-v7'));assert.equal(stored.profile,null);assert.deepEqual(stored.orders,[]);
for(const route of ['home','shop','builder','compare','together','account','wishlist','faq','about','admin','reset/test-token']){context.location.hash='#'+route;run('render()');assert(get('#app').innerHTML.length>70,route)}
assert.equal(value("esc('<img onerror=bad>')"),'&lt;img onerror=bad&gt;');

context.location.hash='#admin';await run("authUser={id:'owner',name:'Owner',role:'admin'};adminPage()");assert(get('#app').innerHTML.includes('ORBIT'));assert(get('#manager-view').innerHTML.includes('Your departments.'));
// Workspace groups products by department, keeps hidden products editable,
// and filters SKU quantities and order statuses without changing source data.
run("authUser={id:'owner',name:'Store Owner',role:'admin'};adminProducts=P.map(p=>({...p,active:true,inventory:p.inventory.map(v=>({...v}))}));adminProducts.find(p=>p.id==='chrono-watch').active=false;manager.tab='products';manager.category='Fashion';manager.search='';manager.visibility='all';paintManager()");
assert.equal(value('selectedProducts().length'),3);assert(get('#manager-results').innerHTML.includes('Chronograph Edition'));
run("manager.visibility='hidden';paintManagerResults()");assert.equal(value('selectedProducts().length'),1);assert(get('#manager-results').innerHTML.includes('Hidden'));
run("manager.visibility='all';manager.search='sunglasses';paintManagerResults()");assert.equal(value('selectedProducts().length'),1);assert(!get('#manager-results').innerHTML.includes('Studio Sneaker'));
run("manager.search='';manager.tab='inventory';manager.stockFilter='out';adminProducts.find(p=>p.id==='studio-shoe').inventory[0].qty=0;paintManagerView()");assert(get('#manager-results').innerHTML.includes('Out of stock'));assert(get('#manager-results').innerHTML.includes('data-stock-previous="0"'));
run("manager.tab='overview';paintManagerView()");assert(get('#manager-view').innerHTML.includes('Your departments.'));assert(get('#manager-view').innerHTML.includes('data-department-open="Fashion"'));
run("manager.tab='orders';paintManagerView()");assert(get('#manager-view').innerHTML.includes('All orders'));assert(get('#manager-view').innerHTML.includes('New orders will appear'));
console.log('PASS: sequential session boot, 12 matching model assets, 35 budget scenarios, server checkout wiring, variant selection, SKU stock, account/admin routes, local privacy, categorized workspace, hidden products, and inventory/order filters. DOM simulation only.');
