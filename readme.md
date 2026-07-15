# SIKKA — Architecture Snapshot

## Tech stack
- Django 6.0 + Django REST Framework
- PostgreSQL (sqlite bhi chal sakta hai locally — set DB_ENGINE=sqlite in .env)
- Django templates + Bootstrap + vanilla JS
- Auth: DRF Token authentication
- Config: python-decouple (.env file)

## Apps
| App | Kya karta hai |
|---|---|
| core | Middleware, throttles, audit log |
| accounts | Login, register, user profile |
| wallet | Wallet balance |
| transactions | Send/receive SKA |
| blockchain | Blocks, chain stats |
| mining | Mining start/claim/status |
| dashboard | Dashboard + explorer HTML shells |
| landing | Public landing page |

## Local setup
```bash
cp .env.example .env    # apni values bharo
pip install -r requirements/dev.txt
python manage.py migrate
python manage.py test
python manage.py runserver
```