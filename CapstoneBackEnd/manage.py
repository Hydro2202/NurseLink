#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def _schedule_docs_browser():
    """Open Scalar API docs once the reloader child process starts runserver."""
    if os.environ.get('RUN_MAIN') != 'true':
        return
    if len(sys.argv) < 2 or sys.argv[1] != 'runserver':
        return
    if os.environ.get('OPEN_API_DOCS_ON_START', '1') in ('0', 'false', 'False'):
        return

    import threading
    import time
    import webbrowser

    port = '8000'
    for arg in sys.argv[2:]:
        if arg.startswith('-'):
            continue
        if ':' in arg:
            port = arg.split(':')[-1]
            break
        if arg.isdigit():
            port = arg
            break

    url = f'http://127.0.0.1:{port}/api/docs/'

    def open_docs():
        time.sleep(1.25)
        webbrowser.open(url)

    threading.Thread(target=open_docs, daemon=True).start()


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

    _schedule_docs_browser()
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
