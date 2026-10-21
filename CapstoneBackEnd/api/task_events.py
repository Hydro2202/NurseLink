"""
Writes TaskEvent rows: the append-only history behind the Tasks page's
History view. Every path that creates, assigns, completes or edits a task
calls record() so the history reflects what actually happened and who did it.
"""

from .models import TaskEvent
from .names import full_name

SYSTEM_ACTOR = 'System'


def record(task, event, actor=None, actor_name=None, from_status='', to_status='', remarks='',
           previous_remarks='', **details):
    if actor_name is None:
        actor_name = full_name(actor) if actor is not None and actor.is_authenticated else SYSTEM_ACTOR
    return TaskEvent.objects.create(
        task=task,
        event=event,
        actor=actor if actor is not None and actor.is_authenticated else None,
        actor_name=actor_name,
        from_status=from_status or '',
        to_status=to_status or '',
        remarks=remarks or '',
        previous_remarks=previous_remarks or '',
        details=details,
    )
