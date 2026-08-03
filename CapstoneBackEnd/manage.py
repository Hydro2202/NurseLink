#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys
import threading
import time
import webbrowser


def _open_scalar_docs():
    """Open the Scalar docs page automatically after the dev server starts."""
    try:
        time.sleep(2)
        webbrowser.open('http://127.0.0.1:8000/api/docs/', new=0, autoraise=True)
    except Exception:
        pass


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'CapstoneBackEnd.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc

    if len(sys.argv) > 1 and sys.argv[1] == 'runserver':
        threading.Thread(target=_open_scalar_docs, daemon=True).start()

    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
