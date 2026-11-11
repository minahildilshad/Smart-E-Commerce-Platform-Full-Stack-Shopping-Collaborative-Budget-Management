"""Orbit full-stack store. Python 3.10+, no third-party packages for local use."""
from __future__ import annotations
import argparse, base64, hashlib, hmac, json, math, mimetypes, os, re, secrets
import smtplib, sqlite3, ssl, struct, sys, time
from datetime import datetime, timezone
from contextlib import contextmanager
from email.message import EmailMessage
from http.cookies import SimpleCookie
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIServer, make_server

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('ORBIT_DATA_DIR', str(ROOT / 'data')))
PUBLIC = ROOT / 'public'
SECURE = os.environ.get('ORBIT_SECURE_COOKIES', '0') == '1'
ORIGIN = os.environ.get('ORBIT_ORIGIN', 'http://127.0.0.1:8000').rstrip('/')
MAX_BODY = 30_000_000
CATALOG_VERSION = 'all-3d-1'
STATUSES = ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled']

class APIError(Exception):
    def __init__(self, status, message): self.status, self.message = status, message

@contextmanager
def db():
    c = sqlite3.connect(DATA / 'orbit.sqlite3', timeout=30)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()

def now(): return int(time.time())
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def password_hash(value):
    salt = secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', value.encode(), bytes.fromhex(salt), 600000).hex()
def password_ok(value, encoded):
    salt, expected = encoded.split(':')
    actual = hashlib.pbkdf2_hmac('sha256', value.encode(), bytes.fromhex(salt), 600000).hex()
    return hmac.compare_digest(actual, expected)
def text(value, label, minimum=1, maximum=160):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        raise APIError(400, f'{label} must be {minimum} to {maximum} characters.')
    return value.strip()
def email(value):
    value = text(value, 'Email', 3, 254).lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value): raise APIError(400, 'Enter a valid email address.')
    return value
def integer(value, label, low, high):
    if type(value) is not int or not low <= value <= high: raise APIError(400, f'Invalid {label}.')
    return value

def glb_info(content):
    if len(content)<28 or content[:4]!=b'glTF': raise APIError(400,'Use a valid self-contained GLB 2.0 model.')
    version,length=struct.unpack_from('<II',content,4)
    if version!=2 or length!=len(content): raise APIError(400,'Invalid GLB header.')
    length,kind=struct.unpack_from('<II',content,12)
    if kind!=0x4E4F534A or 20+length>len(content): raise APIError(400,'Invalid GLB document.')
    try: g=json.loads(content[20:20+length])
    except (ValueError,UnicodeDecodeError): raise APIError(400,'Invalid GLB JSON.')
    if not isinstance(g,dict) or not g.get('meshes'): raise APIError(400,'The GLB must contain a mesh.')
    if any(i.get('uri') for i in g.get('images',[])+g.get('buffers',[])): raise APIError(400,'Embed all model textures and buffers into the GLB.')
    if set(g.get('extensionsRequired',[])) & {'KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'}: raise APIError(400,'Upload an uncompressed GLB with PNG, JPEG or WebP textures for offline use.')
    variants=[text(v.get('name'),'Model finish',1,80) for v in g.get('extensions',{}).get('KHR_materials_variants',{}).get('variants',[])]
    return {'colors':['Original',*variants]}

def model_info(url):
    if not isinstance(url,str) or not re.fullmatch(r'/(?:assets/models|uploads)/[a-zA-Z0-9_-]+\.glb',url): raise APIError(400,'Choose a supplied model or upload a GLB.')
    base=DATA if url.startswith('/uploads/') else PUBLIC
    path=base/url.lstrip('/')
    if not path.is_file(): raise APIError(400,'The selected model is missing.')
    return glb_info(path.read_bytes())

def init_db():
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'uploads').mkdir(exist_ok=True)
    with db() as c:
        c.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,csrf TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS stock(product_id TEXT,color TEXT,size TEXT,qty INTEGER NOT NULL CHECK(qty>=0),PRIMARY KEY(product_id,color,size),FOREIGN KEY(product_id) REFERENCES products(id));
        CREATE TABLE IF NOT EXISTS carts(user_id TEXT PRIMARY KEY,data TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,tracking TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,request_key TEXT NOT NULL,UNIQUE(user_id,request_key),FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT NOT NULL,created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        ''')
        version=c.execute("SELECT value FROM settings WHERE key='catalog_version'").fetchone()
        if not version or version['value']!=CATALOG_VERSION:
            existing=c.execute('SELECT 1 FROM products LIMIT 1').fetchone()
            if existing:
                # Back up the original store before replacing the active sample catalog.
                c.commit();(DATA/'backups').mkdir(exist_ok=True)
                with sqlite3.connect(DATA/'backups'/('before-all-3d-'+str(time.time_ns())+'.sqlite3')) as backup:c.backup(backup)
                c.execute('BEGIN IMMEDIATE')
                c.execute('UPDATE products SET active=0')
                for row in c.execute('SELECT id,data FROM products').fetchall():
                    archived=json.loads(row['data']);archived['legacyArchived']=True
                    c.execute('UPDATE products SET data=? WHERE id=?',(json.dumps(archived),row['id']))
                c.execute('DELETE FROM carts')
            for p in json.loads((ROOT / 'catalog.json').read_text(encoding='utf-8')):
                info=model_info(p['model'])
                if p['colors']!=info['colors']: raise RuntimeError('Catalog finishes do not match the model: '+p['id'])
                c.execute('INSERT INTO products(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1', (p['id'], json.dumps(p)))
                for color in p['colors']:
                    for size in p['sizes']: c.execute('INSERT OR IGNORE INTO stock VALUES(?,?,?,?)', (p['id'], color, size, 20))
            c.execute("INSERT INTO settings VALUES('catalog_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(CATALOG_VERSION,))

def public_user(row): return {k: row[k] for k in ('id','name','email','role')}
def products(c, admin=False):
    result = []
    for row in c.execute('SELECT * FROM products' + ('' if admin else ' WHERE active=1')):
        p = json.loads(row['data']); p['active'] = bool(row['active'])
        if p.get('legacyArchived'): continue
        p['inventory'] = [dict(r) for r in c.execute('SELECT color,size,qty FROM stock WHERE product_id=?', (row['id'],))]
        p['stock'] = sum(r['qty'] for r in p['inventory']); result.append(p)
    return result

def rate(c, key, limit=15):
    c.execute('DELETE FROM limits WHERE until<?', (now(),))
    row = c.execute('SELECT * FROM limits WHERE key=?', (key,)).fetchone()
    if row and row['count'] >= limit: raise APIError(429, 'Too many attempts. Try again in 15 minutes.')
    c.execute('INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now()+900))
    c.commit()

def validated_cart(c, items, check_stock=True):
    if not isinstance(items, list) or len(items)>100: raise APIError(400, 'Invalid cart.')
    merged = {}
    for item in items:
        if not isinstance(item, dict): raise APIError(400, 'Invalid cart item.')
        key = (text(item.get('id'), 'Product', 1, 64), text(item.get('color'), 'Color', 1, 80), text(item.get('size'), 'Size', 1, 80))
        merged[key] = merged.get(key, 0) + integer(item.get('qty'), 'quantity', 1, 20)
        if merged[key]>20: raise APIError(400, 'Maximum 20 of one variant per order.')
    result = []
    for (pid, color, size), qty in merged.items():
        row = c.execute('SELECT data FROM products WHERE id=? AND active=1', (pid,)).fetchone()
        if not row: raise APIError(409, 'A product is no longer available. Please update your bag.')
        p = json.loads(row['data'])
        if color not in p['colors'] or size not in p['sizes']: raise APIError(400, 'Invalid product variant.')
        stock = c.execute('SELECT qty FROM stock WHERE product_id=? AND color=? AND size=?', (pid,color,size)).fetchone()
        if check_stock and (not stock or stock['qty']<qty): raise APIError(409, f"Insufficient stock: {p['name']} / {color} / {size}.")
        index = p['sizes'].index(size)
        rate = .15 if pid in ['phone','sofa'] else .12 if re.search(r'\d+(?:\.\d+)?\s*(?:ml|L|pack)|^(?:Wide|Large|Medium)$', size) else 0
        base = p['base'] + (math.floor(p['base']*rate*index+.5) if index>0 else 0)
        unit = math.floor(base*(100-p['off'])/100+.5)
        result.append(dict(id=pid, name=p['name'], color=color, size=size, qty=qty, unit=unit, base=base))
    return result

def quote(c, body):
    items = validated_cart(c, body.get('items'))
    code = text(body.get('coupon',''), 'Coupon', 0, 30).upper()
    if code not in ('','ORBIT10'): raise APIError(400, 'Unknown coupon.')
    sub = sum(i['unit']*i['qty'] for i in items)
    saving = sum((i['base']-i['unit'])*i['qty'] for i in items)
    discount = sub//10 if code=='ORBIT10' else 0
    shipping = 0 if not sub or sub-discount>=10000 else 250
    return dict(items=items, sub=sub, saving=saving, discount=discount, shipping=shipping, total=sub-discount+shipping, coupon=code)

class Store:
    def __call__(self, env, start_response):
        headers = [('X-Content-Type-Options','nosniff'),('Referrer-Policy','same-origin'),('X-Frame-Options','DENY')]
        try:
            path = env.get('PATH_INFO','/'); method = env['REQUEST_METHOD']
            if not path.startswith('/api/'):
                if method not in ('GET','HEAD'): raise APIError(405, 'Method not allowed.')
                upload = path.startswith('/uploads/')
                base = DATA / 'uploads' if upload else PUBLIC
                relative = path[len('/uploads/'):] if upload else path.lstrip('/')
                target = (base / relative).resolve() if path!='/' else PUBLIC / 'index.html'
                if not target.is_relative_to(base.resolve()) or not target.is_file(): raise APIError(404, 'File not found.')
                content = target.read_bytes()
                mime = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                headers += [('Content-Type',mime),('Content-Length',str(len(content))),('Cache-Control','no-cache')]
                start_response('200 OK', headers); return [b'' if method=='HEAD' else content]
            headers += [('Content-Type','application/json; charset=utf-8'),('Cache-Control','no-store')]
            with db() as c:
                cookies = SimpleCookie()
                try: cookies.load(env.get('HTTP_COOKIE',''))
                except Exception: pass
                token = cookies.get('orbit_session')
                session = c.execute('SELECT * FROM sessions WHERE token=? AND expires>?', (digest(token.value) if token else '',now())).fetchone()
                if not session:
                    raw = secrets.token_urlsafe(32); csrf = secrets.token_urlsafe(32)
                    c.execute('INSERT INTO sessions VALUES(?,NULL,?,?)', (digest(raw),csrf,now()+86400))
                    session = c.execute('SELECT * FROM sessions WHERE token=?', (digest(raw),)).fetchone()
                    headers.append(('Set-Cookie',self.cookie(raw)))
                user = c.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone() if session['user_id'] else None
                body = {}
                if method not in ('GET','HEAD'):
                    if env.get('HTTP_ORIGIN') and env['HTTP_ORIGIN'] != ORIGIN: raise APIError(403, 'Origin rejected.')
                    if not hmac.compare_digest(env.get('HTTP_X_CSRF_TOKEN',''),session['csrf']): raise APIError(403, 'Session expired. Refresh and try again.')
                    if not env.get('CONTENT_TYPE','').startswith('application/json'): raise APIError(415, 'JSON required.')
                    length = int(env.get('CONTENT_LENGTH') or 0)
                    cap=MAX_BODY if path=='/api/admin/upload-model' else 4_500_000
                    if not 0<length<=cap: raise APIError(413, 'Request too large or empty.')
                    try: body = json.loads(env['wsgi.input'].read(length))
                    except (ValueError, UnicodeDecodeError): raise APIError(400, 'Invalid JSON.')
                    if not isinstance(body,dict): raise APIError(400, 'JSON object required.')
                result = self.route(c,method,path,body,user,session,headers,env)
                c.execute('DELETE FROM sessions WHERE expires<?', (now(),))
                content = json.dumps(result,ensure_ascii=False).encode()
            start_response('200 OK',headers); return [content]
        except APIError as e:
            content = json.dumps({'error':e.message}).encode()
            headers = [(k,v) for k,v in headers if k not in ('Content-Type','Content-Length')]+[('Content-Type','application/json')]
            start_response(f'{e.status} Error',headers); return [content]
        except Exception:
            import traceback; traceback.print_exc()
            start_response('500 Error',[('Content-Type','application/json')]); return [b'{"error":"Server error. Please try again."}']

    @staticmethod
    def cookie(value, age=86400):
        return f'orbit_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}' + ('; Secure' if SECURE else '')

    def route(self,c,method,path,b,user,s,headers,env):
        if method=='GET' and path=='/api/session':
            return {'user':public_user(user) if user else None,'csrf':s['csrf'],'onlinePayments':False}
        if method=='GET' and path=='/api/products': return {'products':products(c)}
        if method=='POST' and path in ('/api/register','/api/login'):
            rate(c,'auth:'+env.get('REMOTE_ADDR',''),20)
            addr = email(b.get('email')); pw = text(b.get('password'),'Password',12,128)
            if path.endswith('register'):
                name=text(b.get('name'),'Name',2,80)
                if c.execute('SELECT 1 FROM users WHERE email=?',(addr,)).fetchone(): raise APIError(409,'This email is already registered.')
                uid=secrets.token_hex(16)
                c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(uid,name,addr,password_hash(pw),'customer',now()))
                user=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
            else:
                user=c.execute('SELECT * FROM users WHERE email=?',(addr,)).fetchone()
                if not user or not password_ok(pw,user['password']): raise APIError(401,'Incorrect email or password.')
            c.execute('DELETE FROM sessions WHERE token=?',(s['token'],))
            raw=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32)
            c.execute('INSERT INTO sessions VALUES(?,?,?,?)',(digest(raw),user['id'],csrf,now()+86400))
            headers.append(('Set-Cookie',self.cookie(raw)))
            cart=c.execute('SELECT data FROM carts WHERE user_id=?',(user['id'],)).fetchone()
            return {'user':public_user(user),'csrf':csrf,'cart':json.loads(cart['data']) if cart else []}
        if method=='POST' and path=='/api/logout':
            c.execute('DELETE FROM sessions WHERE token=?',(s['token'],)); headers.append(('Set-Cookie',self.cookie('',0))); return {'ok':True}
        if method=='POST' and path=='/api/forgot-password':
            rate(c,'reset:'+env.get('REMOTE_ADDR',''),5)
            addr=email(b.get('email')); row=c.execute('SELECT id FROM users WHERE email=?',(addr,)).fetchone()
            if row and os.environ.get('ORBIT_SMTP_HOST'):
                token=secrets.token_urlsafe(32)
                c.execute('DELETE FROM resets WHERE user_id=?',(row['id'],))
                c.execute('INSERT INTO resets VALUES(?,?,?)',(digest(token),row['id'],now()+1800))
                msg=EmailMessage();msg['Subject']='Reset your Orbit password';msg['From']=os.environ['ORBIT_SMTP_FROM'];msg['To']=addr
                msg.set_content('Reset your password within 30 minutes:\n'+ORIGIN+'/#reset/'+token)
                with smtplib.SMTP(os.environ['ORBIT_SMTP_HOST'],int(os.environ.get('ORBIT_SMTP_PORT','587')),timeout=15) as smtp:
                    smtp.starttls(context=ssl.create_default_context());smtp.login(os.environ['ORBIT_SMTP_USER'],os.environ['ORBIT_SMTP_PASSWORD']);smtp.send_message(msg)
            return {'message':'If the account exists and email delivery is configured, a reset link has been sent.'}
        if method=='POST' and path=='/api/reset-password':
            rate(c,'reset-use:'+env.get('REMOTE_ADDR',''),10)
            token=text(b.get('token'),'Reset token',20,200); pw=text(b.get('password'),'Password',12,128)
            row=c.execute('SELECT * FROM resets WHERE token=? AND expires>?',(digest(token),now())).fetchone()
            if not row: raise APIError(400,'Reset link is invalid or expired.')
            c.execute('UPDATE users SET password=? WHERE id=?',(password_hash(pw),row['user_id']))
            c.execute('DELETE FROM sessions WHERE user_id=?',(row['user_id'],)); c.execute('DELETE FROM resets WHERE user_id=?',(row['user_id'],))
            return {'ok':True}
        if method=='POST' and path=='/api/quote': return quote(c,b)
        if not user: raise APIError(401,'Please log in to continue.')
        if path=='/api/cart':
            if method=='GET':
                r=c.execute('SELECT data FROM carts WHERE user_id=?',(user['id'],)).fetchone();return {'items':json.loads(r['data']) if r else []}
            if method=='PUT':
                items=validated_cart(c,b.get('items'),False)
                items=[{k:i[k] for k in ('id','color','size','qty')} for i in items]
                c.execute('INSERT INTO carts VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data',(user['id'],json.dumps(items)));return {'items':items}
        if path=='/api/orders' and method=='GET':
            return {'orders':[self.order(r) for r in c.execute('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC',(user['id'],))]}
        if path=='/api/orders' and method=='POST':
            key=text(b.get('requestKey'),'Request key',16,100)
            c.commit(); c.execute('BEGIN IMMEDIATE')
            old=c.execute('SELECT * FROM orders WHERE user_id=? AND request_key=?',(user['id'],key)).fetchone()
            if old: return {'order':self.order(old)}
            if b.get('payment')!='cod': raise APIError(400,'Online payments are not connected. Choose cash on delivery.')
            q=quote(c,b)
            if not q['items']: raise APIError(400,'Your bag is empty.')
            delivery={k:text(b.get(k),label,2,160) for k,label in [('name','Name'),('phone','Phone'),('street','Street'),('city','City')]}
            if not re.fullmatch(r'[+()\d\s-]{7,25}',delivery['phone']): raise APIError(400,'Enter a valid phone number.')
            q.update(delivery);q.update(payment='cod',paymentStatus='unpaid',note=text(b.get('note',''),'Note',0,300),date=datetime.now(timezone.utc).isoformat())
            for i in q['items']:
                changed=c.execute('UPDATE stock SET qty=qty-? WHERE product_id=? AND color=? AND size=? AND qty>=?',(i['qty'],i['id'],i['color'],i['size'],i['qty'])).rowcount
                if not changed: raise APIError(409,'Stock changed. Please try again.')
            oid='ORB-'+secrets.token_hex(6).upper()
            c.execute('INSERT INTO orders(id,user_id,data,status,created,request_key) VALUES(?,?,?,?,?,?)',(oid,user['id'],json.dumps(q),'placed',now(),key))
            c.execute('DELETE FROM carts WHERE user_id=?',(user['id'],))
            return {'order':self.order(c.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())}
        if not path.startswith('/api/admin/'): raise APIError(404,'Endpoint not found.')
        if user['role']!='admin': raise APIError(403,'Administrator access required.')
        if method=='GET' and path=='/api/admin/products': return {'products':products(c,True)}
        if method=='GET' and path=='/api/admin/models':
            return {'models':[{'name':p['name'],'model':p['model'],'image':p['image'],'colors':p['colors']} for p in json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))]}
        if method=='GET' and path=='/api/admin/orders':
            return {'orders':[self.order(r) for r in c.execute('SELECT * FROM orders ORDER BY created DESC')]}
        if method=='PATCH' and path.startswith('/api/admin/inventory/'):
            pid=path.rsplit('/',1)[1]
            color=text(b.get('color'),'Finish',1,80);size=text(b.get('size'),'Size',1,80)
            qty=integer(b.get('qty'),'stock',0,1000000);expected=integer(b.get('expectedQty'),'previous stock',0,1000000)
            changed=c.execute('UPDATE stock SET qty=? WHERE product_id=? AND color=? AND size=? AND qty=?',(qty,pid,color,size,expected)).rowcount
            if not changed: raise APIError(409,'This stock changed since you opened the page. Refresh the workspace and review the quantity before saving.')
            c.execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',(user['id'],'stock '+pid+' '+color+' '+size+' '+str(expected)+' -> '+str(qty),now()))
            return {'ok':True,'qty':qty}
        if method=='POST' and path=='/api/admin/upload':
            try: content=base64.b64decode(b.get('data',''),validate=True)
            except (ValueError,TypeError): raise APIError(400,'Invalid image data.')
            ext='png' if content.startswith(b'\x89PNG\r\n\x1a\n') else 'jpg' if content.startswith(b'\xff\xd8\xff') else 'webp' if content[:4]==b'RIFF' and content[8:12]==b'WEBP' else None
            if not ext or not 0<len(content)<=3_000_000: raise APIError(400,'Use a PNG, JPEG or WebP image under 3 MB.')
            name=secrets.token_hex(16)+'.'+ext;(DATA/'uploads'/name).write_bytes(content)
            return {'url':'/uploads/'+name}
        if method=='POST' and path=='/api/admin/upload-model':
            try: content=base64.b64decode(b.get('data',''),validate=True)
            except (ValueError,TypeError): raise APIError(400,'Invalid GLB upload.')
            if not 0<len(content)<=20_000_000: raise APIError(400,'Use a GLB under 20 MB.')
            info=glb_info(content);name=secrets.token_hex(16)+'.glb';(DATA/'uploads'/name).write_bytes(content)
            return {'url':'/uploads/'+name,**info}
        if method=='PUT' and path.startswith('/api/admin/products/'):
            pid=path.rsplit('/',1)[1]
            if not re.fullmatch(r'[a-z0-9-]{1,64}',pid): raise APIError(400,'Use lowercase letters, numbers and hyphens for the product ID.')
            p=b.get('product')
            if not isinstance(p,dict): raise APIError(400,'Product required.')
            old=c.execute('SELECT data FROM products WHERE id=?',(pid,)).fetchone()
            stored=json.loads(old['data']) if old else {}
            stored.update(id=pid,name=text(p.get('name'),'Name',2,140),cat=text(p.get('cat'),'Department',2,40),base=integer(p.get('base'),'price',1,100000000),off=integer(p.get('off'),'discount',0,90))
            if stored['cat'] not in ['Fashion','Home','Beauty','Electronics','Sports','Travel']: raise APIError(400,'Invalid department.')
            for k in ('colors','sizes'):
                v=p.get(k)
                if not isinstance(v,list) or not 1<=len(v)<=30: raise APIError(400,'Enter 1 to 30 '+k+'.')
                stored[k]=list(dict.fromkeys(text(x,k,1,80) for x in v))
            image=p.get('image',stored.get('image',''))
            if image and not re.fullmatch(r'/(?:uploads|assets|assets/models)/[a-zA-Z0-9_.-]+',image): raise APIError(400,'Use an uploaded product image.')
            stored['image']=image;stored.setdefault('frames',1);stored.setdefault('path','');stored.setdefault('width',0)
            model=p.get('model',stored.get('model',''))
            if model:
                info=model_info(model);stored['model']=model
                if any(color not in info['colors'] for color in stored['colors']): raise APIError(400,'Use only the finishes supplied by the selected model.')
            elif p.get('active',True): raise APIError(400,'Active products require a matching GLB model in this catalog.')
            if not old and not image: raise APIError(400,'Upload a product image first.')
            inventory=p.get('inventory')
            if not isinstance(inventory,list): raise APIError(400,'Inventory required.')
            stock={}
            for i in inventory:
                if not isinstance(i,dict) or i.get('color') not in stored['colors'] or i.get('size') not in stored['sizes']: raise APIError(400,'Invalid inventory variant.')
                key=(i['color'],i['size'])
                if key in stock: raise APIError(400,'Duplicate inventory variant.')
                stock[key]=integer(i.get('qty'),'stock',0,1000000)
            if len(stock)!=len(stored['colors'])*len(stored['sizes']): raise APIError(400,'Supply inventory for every variant.')
            c.execute('INSERT INTO products VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=excluded.active',(pid,json.dumps(stored),int(bool(p.get('active',True)))))
            c.execute('DELETE FROM stock WHERE product_id=?',(pid,))
            for (color,size),qty in stock.items():c.execute('INSERT INTO stock VALUES(?,?,?,?)',(pid,color,size,qty))
            c.execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',(user['id'],'product '+pid,now()))
            return {'ok':True}
        if method=='PATCH' and path.startswith('/api/admin/orders/'):
            oid=path.rsplit('/',1)[1]; status=b.get('status'); tracking=text(b.get('tracking',''),'Tracking',0,160)
            if status not in STATUSES: raise APIError(400,'Invalid order status.')
            c.commit();c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone()
            if not row: raise APIError(404,'Order not found.')
            transitions={'placed':['confirmed','cancelled'],'confirmed':['packed','cancelled'],'packed':['shipped','cancelled'],'shipped':['delivered'],'delivered':[],'cancelled':[]}
            if status!=row['status'] and status not in transitions[row['status']]: raise APIError(409,'Invalid status transition.')
            if status=='cancelled' and row['status']!='cancelled':
                for i in json.loads(row['data'])['items']:
                    c.execute('INSERT INTO stock VALUES(?,?,?,?) ON CONFLICT(product_id,color,size) DO UPDATE SET qty=qty+excluded.qty',(i['id'],i['color'],i['size'],i['qty']))
            payload=json.loads(row['data'])
            if status=='delivered': payload['paymentStatus']='collected'
            c.execute('UPDATE orders SET status=?,tracking=?,data=? WHERE id=?',(status,tracking,json.dumps(payload),oid))
            c.execute('INSERT INTO audit(actor,action,created) VALUES(?,?,?)',(user['id'],'order '+oid+' '+status,now()))
            return {'ok':True}
        raise APIError(404,'Endpoint not found.')

    @staticmethod
    def order(row): return {**json.loads(row['data']),'id':row['id'],'status':row['status'],'tracking':row['tracking']}

application=Store()

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--host',default='127.0.0.1');parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--create-admin',action='store_true');parser.add_argument('--reset-password',action='store_true');args=parser.parse_args()
    init_db()
    if args.create_admin or args.reset_password:
        import getpass
        addr=email(input('Account email: '));pw=text(getpass.getpass('Password (12+ characters): '),'Password',12,128)
        with db() as c:
            row=c.execute('SELECT * FROM users WHERE email=?',(addr,)).fetchone()
            if args.reset_password:
                if not row:sys.exit('Account not found.')
                c.execute('UPDATE users SET password=? WHERE id=?',(password_hash(pw),row['id']));c.execute('DELETE FROM sessions WHERE user_id=?',(row['id'],))
            elif row:c.execute("UPDATE users SET role='admin',password=? WHERE id=?",(password_hash(pw),row['id']))
            else:c.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(secrets.token_hex(16),'Store owner',addr,password_hash(pw),'admin',now()))
        print('Account updated.');return
    class ThreadedServer(ThreadingMixIn,WSGIServer):daemon_threads=True
    print(f'Open http://{args.host}:{args.port} in your browser. Keep this window open.\nLocal development server. Press Ctrl+C to stop.',flush=True)
    with make_server(args.host,args.port,application,server_class=ThreadedServer) as server:
        try:server.serve_forever()
        except KeyboardInterrupt:print('\nStopped.')

if __name__=='__main__':main()
