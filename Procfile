release: python manage.py migrate --noinput && python manage.py createcachetable || true
web: gunicorn config.wsgi:application --workers 1 --threads 2 --preload --timeout 120
