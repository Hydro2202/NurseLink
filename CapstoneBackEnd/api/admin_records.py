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
    GET    /api/admin/audit-log/             recent admin edits/deletes

Changes land in the same tables every nurse and head nurse reads from, so they
show up for every account; touching the related patient bumps the live-refresh
revision so open screens reload.
"""

import json

from django.db import transaction
from django.db.models import ProtectedError
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


def _log(request, action, record_type, record_id, label, changes):
    AdminAuditLog.objects.create(
        actor=request.user,
        actor_name=full_name(request.user),
        action=action,
        record_type=record_type,
        record_id=str(record_id),
        record_label=label,
        changes=changes,
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
        return Response(serializer_class(instance, context={'request': request}).data)

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


class AdminAuditLogView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdmin]

    def get(self, request):
        try:
            limit = max(1, min(int(request.query_params.get('limit', 50)), 200))
        except ValueError:
            limit = 50
        rows = AdminAuditLog.objects.all()[:limit]
        return Response([
            {
                'id': row.pk,
                'actorName': row.actor_name,
                'action': row.action,
                'recordType': row.record_type,
                'recordId': row.record_id,
                'recordLabel': row.record_label,
                'changes': row.changes,
                'createdAt': row.created_at.isoformat(),
            }
            for row in rows
        ])
