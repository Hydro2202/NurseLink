"""
Admin edit/delete for every hospital record shown in the Admin panel.

The regular endpoints keep their clinical rules (assigned nurse only, head
nurse only, sender/recipient only) and stay read-only for admins. Instead of
loosening each of those, admins get this one endpoint:

    PATCH  /api/admin/records/<type>/<id>/   edit (partial) through the record's
                                             normal serializer, so every side
                                             effect (names, risk recompute, duty
                                             -> profile sync, ...) still runs
    DELETE /api/admin/records/<type>/<id>/   delete with the normal cascades
    GET    /api/admin/records/<type>/<id>/   one record (logged as a VIEW)
    GET    /api/admin/audit-log/             administrator activity, filtered + paged
    GET    /api/admin/audit-log/<id>/        one activity entry
    POST   /api/admin/audit-log/print/       record a print request

Changes land in the same tables every nurse and head nurse reads from, so they
show up for every account; touching the related patient bumps the live-refresh
revision so open screens reload.
"""

import json

from django.db import transaction
from django.db.models import ProtectedError, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    AdminAuditLog,
    ChartingNote,
    Department,
    Doctor,
    DutyAssignment,
    HandoverNote,
    KardexRecord,
    Patient,
    Task,
    TaskHandover,
    VitalSigns,
)
from . import admin_audit
from .names import full_name
from .permissions import IsAdmin
from .serializers import (
    ChartingNoteSerializer,
    DepartmentSerializer,
    DoctorSerializer,
    DutyAssignmentSerializer,
    HandoverSerializer,
    KardexRecordSerializer,
    PatientSerializer,
    TaskHandoverSerializer,
    TaskSerializer,
    VitalSignsSerializer,
)

# type -> (model, serializer, lookup field, label for messages)
RECORD_TYPES = {
    'patients': (Patient, PatientSerializer, 'patient_code', 'patient'),
    'tasks': (Task, TaskSerializer, 'task_code', 'task'),
    'handovers': (HandoverNote, HandoverSerializer, 'handover_code', 'referral'),
    'task-handovers': (TaskHandover, TaskHandoverSerializer, 'handover_code', 'task handover'),
    'charting': (ChartingNote, ChartingNoteSerializer, 'note_code', 'charting note'),
    'duty': (DutyAssignment, DutyAssignmentSerializer, 'pk', 'duty assignment'),
    'kardex': (KardexRecord, KardexRecordSerializer, 'pk', 'kardex record'),
    'vitals': (VitalSigns, VitalSignsSerializer, 'pk', 'vital signs reading'),
    'departments': (Department, DepartmentSerializer, 'pk', 'department'),
    'doctors': (Doctor, DoctorSerializer, 'pk', 'doctor'),
}

# Record types whose serializer only fits the original author's create flow
# (e.g. a task handover checks the *sending nurse's* own duty). Admin edits
# of these set plain model fields directly: {api field: (model field, choices)}.
DIRECT_EDIT_FIELDS = {
    'task-handovers': {
        'taskDescription': ('task_description', None),
        'notes': ('notes', None),
        'status': ('status', dict(TaskHandover.STATUS_CHOICES)),
        'shift': ('shift', dict(DutyAssignment.SHIFT_CHOICES)),
        'rejectionReason': ('rejection_reason', None),
    },
}

# What a PROTECT foreign key means in words, for a delete that can't happen.
PROTECTED_HINTS = {
    'departments': 'This department is still used by doctors or duty assignments. '
                   'Move or delete those first.',
}


def _jsonable(value):
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        return str(value)


def _diff(before, after):
    changes = {}
    for key in set(before) | set(after):
        if before.get(key) != after.get(key):
            changes[key] = [before.get(key), after.get(key)]
    return _jsonable(changes)


def _label(instance):
    for attr in ('name', 'title', 'patient_name', 'full_name'):
        value = getattr(instance, attr, '')
        if value:
            return str(value)[:255]
    return str(instance)[:255]


def _touch_patient(instance):
    """Bump the patient's updated_at so every open screen's live refresh reloads."""
    patient_id = getattr(instance, 'patient_id', None)
    if patient_id:
        Patient.objects.filter(pk=patient_id).update(updated_at=timezone.now())


SUMMARIES = {'update': 'Updated {noun}', 'delete': 'Deleted {noun}', 'view': 'Viewed {noun} details'}


def _noun(record_type):
    if record_type in RECORD_TYPES:
        return RECORD_TYPES[record_type][3]
    return {'accounts': 'account', 'registrations': 'registration'}.get(record_type, record_type)


def _log(request, action, record_type, record_id, label, changes, summary=''):
    admin_audit.record(
        request, action, record_type, record_id, label, changes=changes,
        summary=summary or SUMMARIES.get(action, action).format(noun=_noun(record_type)),
    )


class AdminRecordView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def _get(self, record_type, record_id):
        if record_type not in RECORD_TYPES:
            return None, None
        model, serializer_class, lookup, _ = RECORD_TYPES[record_type]
        instance = get_object_or_404(model, **{lookup: record_id})
        return instance, serializer_class

    def get(self, request, record_type, record_id):
        instance, serializer_class = self._get(record_type, record_id)
        if instance is None:
            return Response({'detail': 'Unknown record type.'}, status=status.HTTP_404_NOT_FOUND)
        data = serializer_class(instance, context={'request': request}).data
        # Logged only once the record was found and served; the details
        # themselves are not copied into the log.
        _log(request, 'view', record_type, record_id, _label(instance), {})
        return Response(data)

    def patch(self, request, record_type, record_id):
        instance, serializer_class = self._get(record_type, record_id)
        if instance is None:
            return Response({'detail': 'Unknown record type.'}, status=status.HTTP_404_NOT_FOUND)
        context = {'request': request}
        before = _jsonable(serializer_class(instance, context=context).data)
        direct = DIRECT_EDIT_FIELDS.get(record_type)
        if direct is None:
            serializer = serializer_class(instance, data=request.data, partial=True, context=context)
            serializer.is_valid(raise_exception=True)
        else:
            errors = {}
            for key, (attr, choices) in direct.items():
                if key not in request.data:
                    continue
                value = str(request.data.get(key) or '').strip()
                if choices is not None and value and value not in choices:
                    errors[key] = f'Must be one of: {", ".join(choices)}.'
                setattr(instance, attr, value)
            if errors:
                return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            if direct is None:
                saved = serializer.save()
            else:
                instance.save()
                saved = instance
            if record_type == 'duty':
                # Same department/shift sync a head nurse's roster edit does.
                from .views import DutyAssignmentViewSet

                DutyAssignmentViewSet()._sync_nurse_profile(saved)
            saved.refresh_from_db()
            after = _jsonable(serializer_class(saved, context=context).data)
            _touch_patient(saved)
            _log(request, 'update', record_type, record_id, _label(saved), _diff(before, after))
        return Response(after)

    def delete(self, request, record_type, record_id):
        instance, serializer_class = self._get(record_type, record_id)
        if instance is None:
            return Response({'detail': 'Unknown record type.'}, status=status.HTTP_404_NOT_FOUND)
        snapshot = _jsonable(serializer_class(instance, context={'request': request}).data)
        label = _label(instance)
        try:
            with transaction.atomic():
                _touch_patient(instance)
                instance.delete()
                _log(request, 'delete', record_type, record_id, label, snapshot)
        except ProtectedError:
            noun = RECORD_TYPES[record_type][3]
            return Response(
                {'detail': PROTECTED_HINTS.get(
                    record_type, f'This {noun} is still referenced by other records and cannot be deleted.'
                )},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


def _audit_row(row, with_changes=True):
    data = {
        'id': row.pk,
        'actorId': row.actor_id,
        'actorName': row.actor_name,
        'actorRole': row.actor_role,
        'action': row.action,
        'actionLabel': row.get_action_display(),
        'category': next(
            (cat for cat, actions in AdminAuditLog.CATEGORY_ACTIONS.items() if row.action in actions), 'change'
        ),
        'recordType': row.record_type,
        'recordId': row.record_id,
        'recordLabel': row.record_label,
        'summary': row.summary,
        'status': row.status,
        'requestId': row.request_id,
        'createdAt': row.created_at.isoformat(),
    }
    if with_changes:
        data['changes'] = row.changes
    return data


class AdminAuditLogView(APIView):
    """
    Administrator activity, newest first. Filters: actor (name contains),
    action, category (view | change | decision | print), recordType,
    recordId, dateFrom/dateTo (YYYY-MM-DD, hospital time), order
    (newest | oldest). Paged with page/pageSize (max 200); all=true returns
    every match (up to 5000) for printing a full report. Admin-only, read-only.
    """

    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def get(self, request):
        from datetime import datetime, time as dtime, timedelta
        from zoneinfo import ZoneInfo

        from django.conf import settings
        from django.utils.dateparse import parse_date

        params = request.query_params
        rows = AdminAuditLog.objects.all()
        actor = (params.get('actor') or '').strip()
        if actor:
            rows = rows.filter(actor_name__icontains=actor)
        action = params.get('action')
        if action:
            rows = rows.filter(action=action)
        category = params.get('category')
        if category in AdminAuditLog.CATEGORY_ACTIONS:
            rows = rows.filter(action__in=AdminAuditLog.CATEGORY_ACTIONS[category])
        record_type = params.get('recordType')
        if record_type:
            rows = rows.filter(record_type=record_type)
        record_id = (params.get('recordId') or '').strip()
        if record_id:
            rows = rows.filter(Q(record_id__iexact=record_id) | Q(record_label__icontains=record_id))
        tz = ZoneInfo(settings.DUTY_LOCAL_TIMEZONE)
        for key, lookup, shift in (('dateFrom', 'created_at__gte', 0), ('dateTo', 'created_at__lt', 1)):
            try:
                day = parse_date(params.get(key) or '')
            except ValueError:
                day = None
            if params.get(key) and day is None:
                return Response({key: 'Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
            if day:
                rows = rows.filter(**{lookup: datetime.combine(day + timedelta(days=shift), dtime.min, tzinfo=tz)})
        rows = rows.order_by('created_at', 'id') if params.get('order') == 'oldest' else rows.order_by('-created_at', '-id')

        # Without page/pageSize/all this is the original endpoint: a plain list
        # of the newest entries (?limit=, default 50), as the dashboard reads it.
        if not ({'page', 'pageSize', 'all'} & set(params.keys())):
            try:
                limit = max(1, min(int(params.get('limit', 50)), 200))
            except ValueError:
                limit = 50
            return Response([_audit_row(r) for r in rows[:limit]])

        total = rows.count()
        if params.get('all') in ('1', 'true', 'True'):
            return Response({'count': total, 'page': 1, 'pageSize': total, 'results': [_audit_row(r) for r in rows[:5000]]})
        try:
            page_size = max(1, min(int(params.get('pageSize', 25)), 200))
            page = max(1, int(params.get('page', 1)))
        except ValueError:
            return Response({'detail': 'page and pageSize must be numbers.'}, status=status.HTTP_400_BAD_REQUEST)
        start = (page - 1) * page_size
        return Response({
            'count': total,
            'page': page,
            'pageSize': page_size,
            'results': [_audit_row(r, with_changes=False) for r in rows[start:start + page_size]],
        })


class AdminAuditLogDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def get(self, request, entry_id):
        return Response(_audit_row(get_object_or_404(AdminAuditLog, pk=entry_id)))


class AdminPrintLogView(APIView):
    """
    Records that an admin asked to print (or export) a report: what, how
    many records, and the filters in force. The browser can't confirm that
    paper actually came out, so the entry is stored as status "requested".
    """

    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def post(self, request):
        record_type = str(request.data.get('recordType') or '').strip()[:40]
        if not record_type:
            return Response({'recordType': 'Required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            count = max(0, int(request.data.get('count') or 0))
        except (TypeError, ValueError):
            count = 0
        scope = str(request.data.get('scope') or 'list')[:20]
        filters = request.data.get('filters') if isinstance(request.data.get('filters'), dict) else {}
        title = str(request.data.get('title') or record_type)[:120]
        entry = admin_audit.record(
            request, 'print', record_type, str(request.data.get('recordId') or '')[:60],
            str(request.data.get('label') or title)[:255],
            changes={'scope': scope, 'count': count, 'filters': filters, 'title': title},
            summary=f'Print requested: {title} ({count} record{"" if count == 1 else "s"})',
            status='requested',
        )
        return Response({'id': entry.pk if entry else None}, status=status.HTTP_201_CREATED)
