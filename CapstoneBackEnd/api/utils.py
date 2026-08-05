from django.db.models import Max


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
