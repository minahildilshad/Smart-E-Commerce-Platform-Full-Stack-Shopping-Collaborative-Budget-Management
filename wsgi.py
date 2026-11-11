"""Entry point for a production WSGI host. Configure HTTPS and environment first."""
from server import init_db, application
init_db()
