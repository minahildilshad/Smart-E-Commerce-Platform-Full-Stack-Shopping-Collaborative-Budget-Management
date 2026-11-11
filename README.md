# Orbit Studio: Refined UI & Categorized Management

Your existing Orbit design and Python/SQLite backend, now with 12 matching local 3D product models.

**Upgrading your existing store? Read `UPGRADE_FROM_PREVIOUS_VERSION.txt` first. Copy your old data folder into this new project before starting to keep your account and orders. The catalog migration creates a backup and clears old carts.**

## New interface

The storefront has refined typography, spacing, product cards, category navigation, and responsive styling while retaining the existing midnight palette and 3D behavior.

Manage Store is organized into four sections:
- **Overview:** active product count, open orders, collected COD, low-stock variants, department summaries and recent orders.
- **Products:** department filters, search, active/hidden visibility, prices, discounts, stock, and product editing.
- **Inventory:** department filters, finish/size SKU rows, search, low/out-of-stock filters, and per-variant stock editing.
- **Orders:** status filters and expandable order details with fulfillment controls.

Stock row saves use a guarded update. If checkout or another administrator changes that SKU's quantity after you opened the page, the server rejects the stale edit. Click Refresh, review the latest quantity and retry.

If you already use the All 3D version, this UI update does not rerun the catalog migration or reset products, stock, accounts or orders. Keep your existing data folder. The one-time catalog migration below only applies when upgrading from the older photo-only version.

## Start on Windows

1. Extract the ZIP into a normal folder, such as `C:\Users\usama\Desktop\Orbit`.
2. Install Python 3.10 or newer if it is not already installed. Python 3.14 works.
3. Double-click **START_STORE.bat**. Keep the terminal window open.
4. Open **http://127.0.0.1:8000** in Chrome or Edge.
5. Create a customer account using **Your account**. Use a password of at least 12 characters.

Do not open `public/index.html` directly. This version needs its server running.
No pip install, Node.js, or paid account is needed for local use.

If you prefer the terminal, open a terminal inside the extracted folder and run:

```bat
py -3 server.py
```

The BAT files automatically select their own folder, avoiding the earlier `server.py not found` error.

## Manage your store

Run **CREATE_ADMIN.bat**, enter your email, and choose a strong password. Password entry is hidden while typing. If this email already exists, this local command promotes that account and changes its password. Then log in through the website and open **Store management** in the footer or **Manage store** on your account page.

You can add products, upload matching product previews and GLB models, set prices and discounts, enter colors and sizes, set stock for every variant, hide products, and update order status and courier tracking references. Choose a supplied model, or upload a self-contained GLB under 20 MB with a matching preview. Model finishes are read from the GLB. After a custom model uploads, review the variant rows and click Save again. Models with external textures or decoder dependencies are rejected for offline compatibility. When editing sizes, click **Update variant rows**, enter quantities, then save. Stock changes are absolute values, so avoid editing a stale inventory screen while customers are purchasing.

Order flow: placed → confirmed → packed → shipped → delivered. Unshipped orders can be cancelled, which restores stock. Cancellation is terminal. Mark delivered only after your courier confirms both delivery and COD collection. Tracking is manually entered text, not an automatic courier connection. Returns and refunds need an owner-managed process.

## What works

- Registered customer accounts and login with salted PBKDF2 password hashes.
- Server-side, expiring sessions, HttpOnly cookies, CSRF checks, login attempt limits, and administrator authorization.
- Persistent database for accounts, carts, products, orders, SKU stock, and administrative audit entries.
- Cart synchronization after login and across signed-in sessions. Guest bags, favorites, comparisons, and bundle files remain browser-local. Cart merging keeps the larger quantity for matching variants rather than doubling it.
- Checkout calculates prices, discounts and shipping on the server, ignoring client-supplied totals. Stock is reserved atomically when an order is placed.
- Request keys protect against duplicate orders on a retry. Each order retains its original item names, selected variants, prices, and delivery address.
- Cash-on-delivery orders, customer order history, and admin fulfillment controls.
- Twelve matching GLB models and source previews across Fashion, Home, Electronics and Travel, plus animation, category filters, comparisons, and the budget bundle helper. Hover loads the selected model and rotates it; opening a product enables drag and zoom. Only model-authored finishes are selectable. Material changes preserve the original geometry.
- Email password recovery when SMTP is configured, or local owner-assisted password reset.

Delivery: Rs 250, free from Rs 10,000 after discounts. `ORBIT10` applies an extra 10% off the sale subtotal. Currency values use whole PKR. These rules currently live in `server.py`; update the corresponding frontend display rules in `public/app.js` when changing them.

## What needs your accounts before going live

**Online payments are not integrated.** The website offers COD only. Wallet or card payments require selecting your merchant provider, its approved account credentials, sandbox integration, a verified payment webhook, and transaction reconciliation. Never mark an online order paid just because the browser reports success. This package does not collect card numbers, wallet PINs, or banking credentials.

**Hosting and your domain are not configured.** This package runs locally. `server.py` uses a development server. For public hosting, use a production WSGI host with `wsgi:application`, persistent writable storage, a TLS reverse proxy, and the environment settings below. SQLite and uploaded files must live on durable storage. Run a single application instance on one persistent host, not multiple independently stored replicas. Have the deployment reviewed and tested before accepting real customer orders. No public store has been deployed by this delivery.

The included product catalog is sample content. Replace it with your own authorized product listings and photographs, verify all stock and prices, and publish your business contact information, service area, shipping/return terms, and privacy notice before launch. Sample fulfillment data does not arrange a courier pickup. Tax rules, automated courier bookings, transactional order emails, live shared shopping rooms, and stock changes per warehouse are not implemented.

## Password recovery

Email recovery requires these environment variables to be set by your host:

```text
ORBIT_SMTP_HOST=your-smtp-server
ORBIT_SMTP_PORT=587
ORBIT_SMTP_USER=your-smtp-user
ORBIT_SMTP_PASSWORD=your-smtp-password
ORBIT_SMTP_FROM=your-store-email
```

The implementation requires SMTP STARTTLS. Reset links expire after 30 minutes and can be used once. Password resets invalidate existing sessions. Without SMTP, the recovery screen shows a neutral message and no email is sent. An owner with access to the server can reset an account using:

```bat
py -3 server.py --reset-password
```

Do not put SMTP credentials into JavaScript, Git, or this ZIP.

## Hosting configuration and backups

```text
ORBIT_ORIGIN=https://your-domain.example
ORBIT_SECURE_COOKIES=1
ORBIT_DATA_DIR=/absolute/path/to/durable/orbit-data
```

The default origin is `http://127.0.0.1:8000`. Use exactly this local address. If you use another host or port, set `ORBIT_ORIGIN` to match. Do not enable secure cookies for local plain HTTP. Bind the production server behind HTTPS, restrict access to administration, and limit uploads at your reverse proxy too.

The `data` folder is created on first start and is not included in this ZIP. It contains private customer information. Stop the server before copying the entire data directory for a simple consistent backup. For online backups, use SQLite's backup API, and also back up `uploads`. Protect backups and test restoration. Reset tokens and session tokens are stored as hashes; passwords are never stored in plaintext. Administrative actions and data retention still require your operating procedures.

## Verification

From the project folder:

```bat
py -3 -m unittest -v test_server.py
```

Tests use a temporary database, not your store data. See `VERIFICATION.md` for the validation performed on this delivery. Browser appearance and production hosting need further validation in your deployment environment.

## 3D catalog and performance

The catalog contains 12 different models: a shoe, sunglasses, watch, two sofas, chair, copper wall lamp, covered glass dish, portable audio player, vintage camera, water bottle, and an architectural street lantern. These replace the prior photo-only catalog. Every supplied product is backed by its own GLB; new models are not invented from single images.

The ZIP is larger because all geometry, textures, and previews are bundled. Grid cards initially show matching source previews. Mouse hover loads and rotates that product's model. Keyboard focus also loads it. On a phone, open the product and drag or pinch. Automatic rotation respects reduced-motion settings. The first interaction may take a moment, depending on the device. No product model is downloaded from an external website at runtime.

Only up to two card viewers are retained at a time, plus an open detail viewer. The viewer's unused-model cache is limited to two. WebGL support is required; matching preview images are displayed if 3D loading fails. Source previews can use different lighting and default finishes from the live viewer. The model remains the same product.

## Assets

Models and source previews: KhronosGroup/glTF-Sample-Assets. Copyright and license attributions are included under `public/credits`, with links from About in the store. Geometry and source textures are unchanged. The supplied assets use CC BY 4.0 or CC0 licenses with applicable trademark notices. Orbit names, prices, stock, size choices and discounts are added demonstration data and do not imply manufacturer affiliation. The editorial room image is sourced from Unsplash, photo-1600607687939-ce8a6c25118c. Model-viewer 4.0.0 is bundled locally with its license notices.
