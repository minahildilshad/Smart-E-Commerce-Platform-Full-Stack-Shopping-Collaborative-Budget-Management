"""Integration tests exercise the real WSGI API and SQLite transactions."""
import concurrent.futures, io, json, os, secrets, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import server

class Client:
    def __init__(self): self.cookie='';self.csrf=''
    def request(self,path,method='GET',body=None,csrf=True,origin=None):
        raw=json.dumps(body).encode() if body is not None else b''
        env={'PATH_INFO':'/api/'+path,'REQUEST_METHOD':method,'wsgi.input':io.BytesIO(raw),'CONTENT_LENGTH':str(len(raw)),'CONTENT_TYPE':'application/json','REMOTE_ADDR':'127.0.0.1','HTTP_COOKIE':self.cookie}
        if csrf: env['HTTP_X_CSRF_TOKEN']=self.csrf
        if origin:env['HTTP_ORIGIN']=origin
        status=[];headers=[]
        def start(s,h):status.append(int(s.split()[0]));headers.extend(h)
        data=json.loads(b''.join(server.application(env,start)))
        for k,v in headers:
            if k=='Set-Cookie':self.cookie=v.split(';')[0]
        if 'csrf' in data:self.csrf=data['csrf']
        return status[0],data
    def session(self):return self.request('session')
    def register(self,email='one@example.test'):
        self.session();return self.request('register','POST',{'name':'Test Customer','email':email,'password':'a-strong-test-password'})

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=server.DATA;server.DATA=Path(self.temp.name);server.init_db()
        # Isolated synthetic products keep business-rule tests independent of the display catalog.
        with server.db() as c:
            for product in [dict(id='shirt',name='Blue & Black Check Shirt',cat='Fashion',base=4500,off=20,sizes=['S','M','L'],colors=['Original'],frames=1,path='',model='/assets/models/MaterialsVariantsShoe.glb',image='/assets/models/MaterialsVariantsShoe.jpg'),dict(id='cup',name='Cup',cat='Travel',base=2500,off=10,sizes=['350 ml','500 ml'],colors=['Original'],frames=1,path='',model='/assets/models/WaterBottle.glb',image='/assets/models/WaterBottle.jpg')]:
                c.execute('INSERT INTO products(id,data) VALUES(?,?)',(product['id'],json.dumps(product)))
                for size in product['sizes']:c.execute('INSERT INTO stock VALUES(?,?,?,20)',(product['id'],'Original',size))
        self.c=Client();self.assertEqual(self.c.register()[0],200)
        self.items=[{'id':'shirt','color':'Original','size':'M','qty':2}]
    def tearDown(self):server.DATA=self.old;self.temp.cleanup()
    def order(self,client=None,**changes):
        body={'items':self.items,'coupon':'ORBIT10','payment':'cod','name':'Test Person','phone':'03001234567','street':'Test Street 12','city':'Lahore','note':'Test order','requestKey':secrets.token_hex(16)};body.update(changes)
        return (client or self.c).request('orders','POST',body)
    def admin(self):
        with server.db() as c:c.execute("UPDATE users SET role='admin'")
    def test_accounts_hash_sessions_and_logout(self):
        with server.db() as c:
            u=c.execute('SELECT * FROM users').fetchone();self.assertNotIn('a-strong-test-password',u['password']);self.assertEqual(u['role'],'customer')
            s=c.execute('SELECT * FROM sessions WHERE user_id IS NOT NULL').fetchone();self.assertNotEqual(s['token'],self.c.cookie.split('=')[1])
        other=Client();other.session();self.assertEqual(other.request('login','POST',{'email':'one@example.test','password':'wrong-long-password'})[0],401)
        self.assertEqual(other.request('login','POST',{'email':'one@example.test','password':'a-strong-test-password'})[0],200)
        self.assertEqual(other.request('logout','POST',{})[0],200);self.assertIsNone(other.session()[1]['user'])
    def test_csrf_origin_and_admin_protection(self):
        self.assertEqual(self.c.request('cart','PUT',{'items':[]},csrf=False)[0],403)
        self.assertEqual(self.c.request('cart','PUT',{'items':[]},origin='https://evil.test')[0],403)
        self.assertEqual(self.c.request('admin/orders')[0],403)
        anon=Client();anon.session();self.assertEqual(anon.request('orders')[0],401)
    def test_server_totals_ignore_tampering(self):
        status,r=self.order(total=1,unit=1);self.assertEqual(status,200)
        q=r['order'];self.assertEqual(q['sub'],7200);self.assertEqual(q['discount'],720);self.assertEqual(q['shipping'],250);self.assertEqual(q['total'],6730)
        self.assertEqual(q['paymentStatus'],'unpaid')
    def test_idempotency_and_stock(self):
        key=secrets.token_hex(16);a=self.order(requestKey=key);b=self.order(requestKey=key)
        self.assertEqual(a[1]['order']['id'],b[1]['order']['id'])
        with server.db() as c:
            self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND color='Original' AND size='M'").fetchone()[0],18)
            self.assertEqual(c.execute('SELECT count(*) FROM orders').fetchone()[0],1)
    def test_cart_sync_and_checkout_clear(self):
        self.assertEqual(self.c.request('cart','PUT',{'items':self.items})[0],200)
        self.assertEqual(self.c.request('cart')[1]['items'],self.items)
        self.order();self.assertEqual(self.c.request('cart')[1]['items'],[])
    def test_order_privacy(self):
        self.order();other=Client();other.register('two@example.test')
        self.assertEqual(other.request('orders')[1]['orders'],[])
        self.assertEqual(len(self.c.request('orders')[1]['orders']),1)
    def test_invalid_stock_variants_and_gateway(self):
        for items in [[{'id':'shirt','color':'Invented','size':'M','qty':1}],[{'id':'shirt','color':'Original','size':'M','qty':-1}],[{'id':'missing','color':'Original','size':'M','qty':1}]]:
            self.assertIn(self.order(items=items)[0],(400,409))
        self.assertEqual(self.order(payment='card')[0],400)
        self.assertEqual(self.order(coupon='FREE')[0],400)
        with server.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM orders').fetchone()[0],0)
    def test_atomic_stock_competing_purchases(self):
        with server.db() as c:c.execute("UPDATE stock SET qty=1 WHERE product_id='shirt' AND color='Original' AND size='M'")
        other=Client();other.register('two@example.test');item=[{**self.items[0],'qty':1}]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures=[pool.submit(self.order,cl,items=item) for cl in [self.c,other]]
            statuses=sorted(f.result()[0] for f in futures)
        self.assertEqual(statuses,[200,409])
        with server.db() as c:self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND color='Original' AND size='M'").fetchone()[0],0)
    def test_atomic_failure_no_partial_stock_change(self):
        with server.db() as c:c.execute("UPDATE stock SET qty=0 WHERE product_id='cup'")
        self.assertEqual(self.order(items=self.items+[{'id':'cup','color':'Original','size':'350 ml','qty':1}])[0],409)
        with server.db() as c:self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND color='Original' AND size='M'").fetchone()[0],20)
    def test_admin_cancellation_restock_once_and_status_rules(self):
        oid=self.order()[1]['order']['id'];self.admin()
        for _ in range(2):self.assertEqual(self.c.request('admin/orders/'+oid,'PATCH',{'status':'cancelled','tracking':''})[0],200)
        with server.db() as c:self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND color='Original' AND size='M'").fetchone()[0],20)
        self.assertEqual(self.c.request('admin/orders/'+oid,'PATCH',{'status':'shipped'})[0],409)
    def test_admin_fulfillment_and_tracking(self):
        oid=self.order()[1]['order']['id'];self.admin()
        for status in ['confirmed','packed','shipped','delivered']:
            self.assertEqual(self.c.request('admin/orders/'+oid,'PATCH',{'status':status,'tracking':'Courier REF123'})[0],200)
        order=self.c.request('orders')[1]['orders'][0];self.assertEqual(order['paymentStatus'],'collected');self.assertEqual(order['tracking'],'Courier REF123')
    def test_admin_product_edit_and_snapshot(self):
        oid=self.order()[1]['order']['id'];self.admin()
        ps=self.c.request('admin/products')[1]['products'];p=next(p for p in ps if p['id']=='shirt');p['name']='Updated Shirt';p['base']=9000;p['inventory'][0]['qty']=4
        self.assertEqual(self.c.request('admin/products/shirt','PUT',{'product':p})[0],200)
        o=self.c.request('orders')[1]['orders'][0];self.assertEqual(o['items'][0]['name'],'Blue & Black Check Shirt');self.assertEqual(o['items'][0]['unit'],3600)
        p['active']=False;self.c.request('admin/products/shirt','PUT',{'product':p});self.assertEqual(self.order()[0],409)
    def test_admin_upload_and_create_product(self):
        import base64
        self.admin();png=base64.b64encode((server.PUBLIC/'assets/hero.jpg').read_bytes()).decode()
        status,r=self.c.request('admin/upload','POST',{'data':png});self.assertEqual(status,200);self.assertTrue((server.DATA/r['url'].lstrip('/')).is_file())
        p=dict(name='New bag',cat='Travel',base=5000,off=10,colors=['Original'],sizes=['Standard'],image=r['url'],model='/assets/models/MaterialsVariantsShoe.glb',inventory=[dict(color='Original',size='Standard',qty=5)],active=True)
        self.assertEqual(self.c.request('admin/products/new-bag','PUT',{'product':p})[0],200)
        self.assertEqual(self.order(items=[dict(id='new-bag',color='Original',size='Standard',qty=1)])[1]['order']['total'],4300)
        self.assertEqual(self.c.request('admin/upload','POST',{'data':base64.b64encode(b'<svg onload=evil()>').decode()})[0],400)
    def test_password_reset_one_time_expiry_session_invalidation(self):
        token=secrets.token_urlsafe(32)
        with server.db() as c:
            uid=c.execute('SELECT id FROM users').fetchone()[0];c.execute('INSERT INTO resets VALUES(?,?,?)',(server.digest(token),uid,server.now()+60))
        anon=Client();anon.session();b={'token':token,'password':'a-new-strong-password'}
        self.assertEqual(anon.request('reset-password','POST',b)[0],200)
        self.assertIsNone(self.c.session()[1]['user']);self.assertEqual(anon.request('reset-password','POST',b)[0],400)
        self.assertEqual(anon.request('login','POST',{'email':'one@example.test','password':b['password']})[0],200)
    def test_smtp_reset_and_generic_response(self):
        with patch.dict(os.environ,{'ORBIT_SMTP_HOST':'smtp.test','ORBIT_SMTP_FROM':'shop@example.test','ORBIT_SMTP_USER':'user','ORBIT_SMTP_PASSWORD':'secret'}),patch('server.smtplib.SMTP') as smtp:
            status,r=self.c.request('forgot-password','POST',{'email':'one@example.test'});self.assertEqual(status,200);self.assertIn('If the account exists',r['message']);smtp.return_value.__enter__.return_value.send_message.assert_called_once()
        with server.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM resets').fetchone()[0],1)
    def test_rate_limit_and_secure_cookie(self):
        for _ in range(19):
            with server.db() as c:server.rate(c,'auth:127.0.0.1',20)
        self.assertEqual(self.c.request('login','POST',{'email':'one@example.test','password':'a-strong-test-password'})[0],429)
        with patch('server.SECURE',True):self.assertIn('; Secure',server.Store.cookie('test'))
    def test_static_and_private_path_rejection(self):
        for path,expected in [('/',200),('/backend.js',200),('/data/orbit.sqlite3',404),('/../server.py',404),('/uploads/../orbit.sqlite3',200)]:
            # Upload route must be constrained to uploads, not the whole data dir.
            if path=='/uploads/../orbit.sqlite3':expected=404
            status=[]
            content=b''.join(server.application({'PATH_INFO':path,'REQUEST_METHOD':'GET'},lambda s,h:status.append(int(s.split()[0]))))
            self.assertEqual(status[0],expected,path)
    def test_all_catalog_models_and_authored_finishes(self):
        catalog=json.loads((server.ROOT/'catalog.json').read_text(encoding='utf-8'))
        self.assertEqual(len(catalog),12)
        self.assertEqual(len({p['model'] for p in catalog}),12)
        for p in catalog:
            self.assertEqual(server.model_info(p['model'])['colors'],p['colors'])
            self.assertTrue((server.PUBLIC/p['image'].lstrip('/')).is_file())
    def test_catalog_upgrade_preserves_accounts_orders_and_inventory(self):
        oid=self.order()[1]['order']['id'];self.c.request('cart','PUT',{'items':self.items})
        with server.db() as c:
            c.execute("DELETE FROM settings WHERE key='catalog_version'")
            c.execute("UPDATE stock SET qty=7 WHERE product_id='bottle'")
        server.init_db()
        with server.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],1)
            self.assertEqual(c.execute('SELECT id FROM orders').fetchone()[0],oid)
            self.assertEqual(c.execute("SELECT active FROM products WHERE id='shirt'").fetchone()[0],0)
            self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='bottle'").fetchone()[0],7)
            self.assertEqual(len(server.products(c)),12)
            c.execute("UPDATE products SET active=0 WHERE id='studio-shoe'")
        self.assertEqual(self.c.request('cart')[1]['items'],[])
        self.assertEqual(len(list((server.DATA/'backups').glob('*.sqlite3'))),1)
        server.init_db()
        with server.db() as c:self.assertEqual(c.execute("SELECT active FROM products WHERE id='studio-shoe'").fetchone()[0],0)
        self.assertEqual(len(list((server.DATA/'backups').glob('*.sqlite3'))),1)
    def test_glb_upload_and_reject_external_dependencies(self):
        import base64,struct
        self.admin();raw=(server.PUBLIC/'assets/models/SunglassesKhronos.glb').read_bytes()
        status,r=self.c.request('admin/upload-model','POST',{'data':base64.b64encode(raw).decode()})
        self.assertEqual(status,200);self.assertEqual(r['colors'],['Original']);self.assertTrue((server.DATA/r['url'].lstrip('/')).is_file())
        bad=json.dumps({'meshes':[{}],'buffers':[{'uri':'https://evil.test/data.bin'}]}).encode();bad+=b' '*((-len(bad))%4)
        raw=struct.pack('<III',0x46546C67,2,20+len(bad))+struct.pack('<II',len(bad),0x4E4F534A)+bad
        self.assertEqual(self.c.request('admin/upload-model','POST',{'data':base64.b64encode(raw).decode()})[0],400)
        self.assertEqual(self.c.request('admin/upload-model','POST',{'data':base64.b64encode(b'not-a-model').decode()})[0],400)
    def test_inventory_edit_is_admin_only_and_checks_previous_quantity(self):
        body={'color':'Original','size':'M','qty':3,'expectedQty':20}
        self.assertEqual(self.c.request('admin/inventory/shirt','PATCH',body)[0],403)
        self.admin()
        self.assertEqual(self.c.request('admin/inventory/shirt','PATCH',body)[0],200)
        self.assertEqual(self.c.request('admin/inventory/shirt','PATCH',{**body,'qty':10})[0],409)
        with server.db() as c:
            self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND size='M'").fetchone()[0],3)
            self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND size='S'").fetchone()[0],20)
        self.assertEqual(self.c.request('admin/inventory/shirt','PATCH',{**body,'qty':-1,'expectedQty':3})[0],400)
    def test_inventory_edit_cannot_overwrite_an_intervening_purchase(self):
        self.admin();self.assertEqual(self.order()[0],200)
        body={'color':'Original','size':'M','qty':10,'expectedQty':20}
        self.assertEqual(self.c.request('admin/inventory/shirt','PATCH',body)[0],409)
        with server.db() as c:self.assertEqual(c.execute("SELECT qty FROM stock WHERE product_id='shirt' AND size='M'").fetchone()[0],18)

if __name__=='__main__':unittest.main()
