import re
from datetime import date, datetime

from django.db.models import Max
from rest_framework import serializers

ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def parse_user_date(value, name: str) -> date:
    """
    A user-supplied YYYY-MM-DD date (query parameter or request body). Anything
    else - a wrong shape, or a date that does not exist such as 2026-02-30 or
    2026-13-01 - is a 400 naming the field, never a 500.
    """
    text = (value or '').strip() if isinstance(value, str) else ''
    if not ISO_DATE_RE.match(text):
        raise serializers.ValidationError({name: 'Invalid date format; expected YYYY-MM-DD.'})
    try:
        return datetime.strptime(text, '%Y-%m-%d').date()
    except ValueError:
        raise serializers.ValidationError({name: 'Invalid date; that day does not exist.'})


def next_code(model, field_name: str, prefix: str, width: int = 3) -> str:
    """Generate next sequential code like T001, H002."""
    existing = model.objects.filter(**{f'{field_name}__startswith': prefix}).aggregate(
        Max(field_name)
    )[f'{field_name}__max']
    if not existing:
        return f'{prefix}{1:0{width}d}'
    try:
        num = int(existing[len(prefix):])
    except (TypeError, ValueError):
        num = model.objects.filter(**{f'{field_name}__startswith': prefix}).count()
    return f'{prefix}{num + 1:0{width}d}'
