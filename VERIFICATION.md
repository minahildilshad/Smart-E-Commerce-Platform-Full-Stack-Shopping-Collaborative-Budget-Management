# Delivery verification

The following checks passed in the build environment:

- 22 Python integration tests against the real API and temporary SQLite databases: account hashing/login/logout, CSRF and origin checks, admin authorization, server pricing despite client price tampering, duplicate request protection, cart synchronization, customer order privacy, invalid variants and unsupported payments, concurrent checkout without overselling, transaction rollback, cancellation/restocking, fulfillment/tracking, product editing and order snapshots, image uploads and product creation, one-use password recovery/session invalidation, mocked SMTP dispatch, rate limits, secure-cookie configuration, static/private file isolation, matching catalog model variants, preservation of accounts and orders during the one-time catalog upgrade, GLB uploads with external-dependency rejection, administrator-only SKU stock edits, and rejection of edits that would overwrite stock changed by a purchase.
- A real HTTP server startup using `server.py`, with cookie-backed account registration and successful serving of the storefront, scripts, styles, product image, 3D model, and viewer library.
- JavaScript syntax checks for both application files.
- DOM-simulated frontend checks for session boot sequencing, 12 matching model records, local asset paths, 35 bundle-budget scenarios, variant selection, SKU stock limits, login-required checkout, account/admin routes, categorized management navigation, department/search/visibility filters, hidden product rows, inventory stock filters, order sections, and avoiding local storage of customer profiles or order addresses.
- Archive integrity and absence of runtime databases, test accounts, credentials, and uploaded test content in the distributable.

All 12 GLB containers and buffer bounds, 69 embedded image textures, and all 12 matching preview files passed structural/image checks. Models have no external texture or buffer references. Each model URL and matching preview is wired into its product’s detail view; catalog cards defer model loading until interaction.

These are implementation checks, not certification for production use. No real browser rendering or WebGL test was available for this version. The original visual styles were retained and product media replaced with matching source models and previews; perform browser, mobile, and accessibility checks on your machine. Frontend simulation does not establish pixel accuracy or real browser compatibility.

SMTP was mocked. No live email, online payment, courier, or public deployment was tested or configured. Production hosting, business configuration, operational backups, and merchant onboarding remain outside this local delivery.

Run Python tests with `py -3 -m unittest -v test_server.py`. Optional frontend simulation requires Node.js and runs with `node test_frontend.mjs`; Node.js is not needed to run the store.

The new workspace and storefront CSS have not been visually rendered in a real browser in this environment. Validate their appearance on desktop and mobile when you open this version.
