"""
Server-side client for the NurseLink n8n workflows.

Every JSON-body n8n call goes through :func:`call_workflow`, built on
``urllib`` from the standard library — no ``requests`` dependency needed for
that shape. File uploads (currently just the PRC ID scan) go through
:func:`call_workflow_multipart` instead, which needs ``requests`` because
urllib's multipart support is painful enough not to hand-roll. Both share the
same URL resolution, shared secret, timeout and failure taxonomy — only the
wire format differs.

Failure taxonomy (all subclass :class:`N8nError`, all carry an
``http_status`` the views map straight onto a DRF response):

    N8nNotConfigured   no URL configured for that workflow key    -> 503
    N8nWorkflowOffline n8n answered 404 "webhook not registered"  -> 503
    N8nTimeout         workflow did not answer in time            -> 504
    N8nUnavailable     DNS/TLS/connection failure                 -> 502
    N8nHTTPError       workflow answered with a non-2xx status     -> 502
    N8nInvalidResponse 2xx body was not usable JSON               -> 502

Nothing here retries. These workflows are not guaranteed idempotent — a
retried face check would burn a second verification attempt — so a caller
that wants a retry has to ask for one explicitly.
"""

import http.client
import json
import logging
import urllib.error
import urllib.request
from typing import Any

import requests
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder

logger = logging.getLogger(__name__)

# n8n returns this shape when a workflow exists but nothing is listening:
# test URLs need "Execute workflow" pressed, production URLs need the
# workflow toggled Active. Worth its own exception — it is by far the most
# common failure in development and the fix is not "retry later".
_NOT_REGISTERED_HINT = 'not registered'


class N8nError(Exception):
    """Base class for every n8n failure. ``http_status`` is what the API returns."""

    http_status = 502
    default_detail = 'The n8n workflow could not be reached.'

    def __init__(self, message: str = '', *, workflow: str = '', payload: Any = None):
        self.workflow = workflow
        self.payload = payload
        super().__init__(message or self.default_detail)


class N8nNotConfigured(N8nError):
    http_status = 503
    default_detail = 'No n8n webhook URL is configured for this feature.'


class N8nWorkflowOffline(N8nError):
    http_status = 503
    default_detail = (
        'The n8n workflow is not listening. In test mode press "Execute workflow" on the '
        'n8n canvas (it accepts one call), or activate the workflow and set '
        'N8N_WEBHOOK_PREFIX=webhook.'
    )


class N8nTimeout(N8nError):
    http_status = 504
    default_detail = 'The n8n workflow did not respond in time.'


class N8nUnavailable(N8nError):
    http_status = 502
    default_detail = 'Could not connect to n8n.'


class N8nHTTPError(N8nError):
    http_status = 502
    default_detail = 'The n8n workflow returned an error.'

    def __init__(self, message='', *, workflow='', status=None, body=None):
        self.status = status
        self.body = body
        super().__init__(message, workflow=workflow, payload=body)


class N8nInvalidResponse(N8nError):
    http_status = 502
    default_detail = 'The n8n workflow returned a response that was not valid JSON.'


class N8nNoFaceVerdict(N8nInvalidResponse):
    """
    The face-verify workflow answered 2xx but without a usable {matched,
    confidence} verdict — most often a Webhook node left on "Respond:
    Immediately" instead of "Using Respond to Webhook Node". Its own class
    (rather than a raise-time message) so this configuration hint is a fixed
    string on the class, not something callers reconstruct from exc.
    """

    default_detail = (
        'The face-verify workflow returned no match result. Set its Webhook node to '
        'respond "Using Respond to Webhook Node" and return {"matched": true|false, '
        '"confidence": 0-1}.'
    )


def webhook_url(workflow: str) -> str:
    """
    Full URL for a workflow key, or '' when it is not configured.

    Assembled from three settings so the same code hits the test URL in
    development and the production URL in deployment:
    ``{N8N_BASE_URL}/{N8N_WEBHOOK_PREFIX}/{path}``
    """
    if workflow in ('verify_id', 'face_verify') and settings.N8N_IDENTITY_VERIFY_WEBHOOK:
        return settings.N8N_IDENTITY_VERIFY_WEBHOOK
    if workflow == 'structure_chart' and getattr(settings, 'N8N_AUTO_CHARTING_WEBHOOK_URL', ''):
        return settings.N8N_AUTO_CHARTING_WEBHOOK_URL
    if workflow == 'discharge_plan' and getattr(settings, 'N8N_DISCHARGE_PLAN_WEBHOOK_URL', ''):
        return settings.N8N_DISCHARGE_PLAN_WEBHOOK_URL
    path = (settings.N8N_WEBHOOKS or {}).get(workflow, '')
    if not path:
        return ''
    # An absolute override in N8N_WEBHOOKS wins over the assembled form.
    if path.startswith(('http://', 'https://')):
        return path
    base = settings.N8N_BASE_URL.rstrip('/')
    prefix = settings.N8N_WEBHOOK_PREFIX.strip('/')
    return f'{base}/{prefix}/{path.strip("/")}'


def configured_workflows() -> dict:
    """Every workflow key mapped to its resolved URL — used by docs and the check command."""
    return {key: webhook_url(key) for key in (settings.N8N_WEBHOOKS or {})}


def call_workflow(workflow: str, payload: dict, *, timeout: float | None = None) -> Any:
    """
    POST ``payload`` as JSON to the named n8n workflow and return its parsed body.

    ``workflow`` is a key of ``settings.N8N_WEBHOOKS`` ('structure_chart',
    'verify_id', 'face_verify'). Raises an :class:`N8nError` subclass on any
    failure — callers are expected to translate that into a response rather
    than let it escape as a 500.
    """
    url = webhook_url(workflow)
    if not url:
        raise N8nNotConfigured(
            f'No webhook path configured for "{workflow}". Set it in settings.N8N_WEBHOOKS.',
            workflow=workflow,
        )

    # DjangoJSONEncoder: payloads carry model values such as Decimal
    # (Patient.height_cm/weight_kg), dates and UUIDs that plain json.dumps
    # rejects -- that TypeError used to escape as an HTTP 500.
    body = json.dumps(payload, cls=DjangoJSONEncoder).encode('utf-8')
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'NurseLink-Backend/1.0',
    }
    if settings.N8N_WEBHOOK_TOKEN:
        headers['X-NurseLink-Token'] = settings.N8N_WEBHOOK_TOKEN

    request = urllib.request.Request(url, data=body, headers=headers, method='POST')
    seconds = timeout if timeout is not None else settings.N8N_TIMEOUT_SECONDS

    # Log the size, never the payload — these carry base64 ID photos and selfies.
    logger.info('n8n call workflow=%s url=%s bytes=%d', workflow, url, len(body))

    try:
        with urllib.request.urlopen(request, timeout=seconds) as response:
            raw = response.read()
            status = response.status
        logger.info('n8n response status: %s workflow=%s', status, workflow)
    except urllib.error.HTTPError as exc:
        raw = b''
        try:
            raw = exc.read()
        except Exception:  # noqa: BLE001 - body is best-effort context only
            pass
        text = raw.decode('utf-8', errors='replace')[:500]
        logger.warning('n8n HTTP %s workflow=%s body=%s', exc.code, workflow, text)
        if exc.code == 404 and _NOT_REGISTERED_HINT in text.lower():
            raise N8nWorkflowOffline(workflow=workflow, payload=text) from exc
        raise N8nHTTPError(
            f'n8n returned HTTP {exc.code} for "{workflow}".',
            workflow=workflow,
            status=exc.code,
            body=text,
        ) from exc
    except TimeoutError as exc:
        logger.warning('n8n timeout workflow=%s after %ss', workflow, seconds)
        raise N8nTimeout(
            f'"{workflow}" did not respond within {seconds:g}s.', workflow=workflow
        ) from exc
    except urllib.error.URLError as exc:
        # URLError wraps socket.timeout on some Python builds.
        if isinstance(exc.reason, TimeoutError):
            raise N8nTimeout(
                f'"{workflow}" did not respond within {seconds:g}s.', workflow=workflow
            ) from exc
        logger.warning('n8n unreachable workflow=%s reason=%s', workflow, exc.reason)
        # The raw socket/DNS error goes to the log only — never into the
        # client-facing message, which could otherwise echo internal
        # networking details back to whoever triggered the request.
        raise N8nUnavailable(workflow=workflow) from exc
    except (http.client.HTTPException, OSError) as exc:
        # Dropped/reset connections (RemoteDisconnected, ConnectionResetError,
        # IncompleteRead) aren't URLErrors and used to escape as a 500.
        logger.warning('n8n connection error workflow=%s: %s', workflow, type(exc).__name__)
        raise N8nUnavailable(workflow=workflow) from exc

    if not raw.strip():
        # A workflow ending in a node with no "Respond to Webhook" returns 200
        # and an empty body. Treat as success-with-nothing rather than an error.
        logger.info('n8n empty body workflow=%s status=%s', workflow, status)
        return {}

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        snippet = raw.decode('utf-8', errors='replace')[:500]
        logger.warning('n8n non-JSON workflow=%s body=%s', workflow, snippet)
        raise N8nInvalidResponse(
            f'"{workflow}" returned a non-JSON body.', workflow=workflow, payload=snippet
        ) from exc

    # n8n commonly answers with a single-item list (one item per workflow item).
    # Unwrap it so views can treat every workflow as returning an object.
    if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], dict):
        parsed = parsed[0]
    # "Respond to Webhook" set to "First Incoming Item" nests the real payload.
    if isinstance(parsed, dict) and set(parsed) == {'json'} and isinstance(parsed['json'], dict):
        parsed = parsed['json']

    return parsed


def call_workflow_multipart(
    workflow: str, files: dict, data: dict | None = None, *, timeout: float | None = None
) -> Any:
    """
    POST ``files`` (and optional ``data`` form fields) as multipart/form-data
    to the named n8n workflow and return its parsed JSON body.

    Same URL resolution, shared-secret header, timeout and failure taxonomy
    as :func:`call_workflow` — only the wire format differs, for a workflow
    that expects a real file upload (e.g. one feeding an OCR service that
    wants raw bytes) rather than a base64 string in a JSON body.

    ``files`` is the ``requests``-style mapping, e.g.
    ``{'prc_id': (filename, file_obj, content_type)}``.
    """
    url = webhook_url(workflow)
    if not url:
        raise N8nNotConfigured(
            f'No webhook path configured for "{workflow}". Set it in settings.N8N_WEBHOOKS.',
            workflow=workflow,
        )

    headers = {}
    if settings.N8N_WEBHOOK_TOKEN:
        headers['X-NurseLink-Token'] = settings.N8N_WEBHOOK_TOKEN

    seconds = timeout if timeout is not None else settings.N8N_TIMEOUT_SECONDS

    # Log which field/filename was sent, never the file's bytes.
    file_desc = ','.join(f'{k}={v[0]}' for k, v in files.items()) if files else ''
    logger.info('n8n multipart call workflow=%s url=%s files=%s', workflow, url, file_desc)

    try:
        response = requests.post(url, files=files, data=data or {}, headers=headers, timeout=seconds)
    except requests.exceptions.Timeout as exc:
        logger.warning('n8n timeout workflow=%s after %ss', workflow, seconds)
        raise N8nTimeout(f'"{workflow}" did not respond within {seconds:g}s.', workflow=workflow) from exc
    except requests.exceptions.ConnectionError as exc:
        logger.warning('n8n unreachable workflow=%s reason=%s', workflow, exc)
        # Same rule as call_workflow: the raw exception is logged, never
        # echoed back to the client.
        raise N8nUnavailable(workflow=workflow) from exc
    except requests.exceptions.RequestException as exc:
        logger.warning('n8n request failed workflow=%s reason=%s', workflow, exc)
        raise N8nUnavailable(workflow=workflow) from exc

    logger.info('n8n response status: %s workflow=%s', response.status_code, workflow)

    text = response.text or ''
    if response.status_code == 404 and _NOT_REGISTERED_HINT in text.lower():
        raise N8nWorkflowOffline(workflow=workflow, payload=text[:500])
    if not response.ok:
        logger.warning('n8n HTTP %s workflow=%s body=%s', response.status_code, workflow, text[:500])
        raise N8nHTTPError(
            f'n8n returned HTTP {response.status_code} for "{workflow}".',
            workflow=workflow,
            status=response.status_code,
            body=text[:500],
        )

    if not text.strip():
        logger.info('n8n empty body workflow=%s status=%s', workflow, response.status_code)
        return {}

    try:
        parsed = response.json()
    except ValueError as exc:
        logger.warning('n8n non-JSON workflow=%s body=%s', workflow, text[:500])
        raise N8nInvalidResponse(
            f'"{workflow}" returned a non-JSON body.', workflow=workflow, payload=text[:500]
        ) from exc

    if isinstance(parsed, list) and len(parsed) == 1 and isinstance(parsed[0], dict):
        parsed = parsed[0]
    if isinstance(parsed, dict) and set(parsed) == {'json'} and isinstance(parsed['json'], dict):
        parsed = parsed['json']

    return parsed


def as_data_uri(value: str, mime: str = 'image/jpeg') -> str:
    """
    Return a ``data:<mime>;base64,...`` URI, adding the prefix if absent.

    The counterpart to :func:`strip_data_uri`. The two n8n actions want
    different shapes and neither tolerates the other: the OCR service behind
    ``extract_id`` rejects bare base64 with *"E501: Not an image or PDF —
    Invalid base64 Data URI"*, while Rekognition behind ``verify_face``
    rejects a prefixed string because the prefix is not valid image bytes.
    """
    if not isinstance(value, str):
        return ''
    payload = value.strip()
    if not payload:
        return ''
    if payload.startswith('data:'):
        return payload
    return f'data:{mime};base64,{payload}'


def strip_data_uri(value: str) -> str:
    """
    Return bare base64, dropping any ``data:image/jpeg;base64,`` prefix.

    The mobile client sends data-URIs because that is what the camera and
    ``<img>` tags want. Cloud vision APIs do not: AWS Rekognition's
    ``Image.Bytes`` and Google Vision's ``content`` both reject the prefix,
    and an n8n workflow that forwards the field verbatim fails on it. Sending
    bare base64 keeps that stripping out of the workflow, where it is easy to
    forget and hard to debug.
    """
    if not isinstance(value, str):
        return ''
    payload = value.strip()
    if payload.startswith('data:'):
        _, _, payload = payload.partition(',')
    return payload


def error_response_body(exc: N8nError) -> dict:
    """
    Uniform JSON body for a failed n8n call, shared by all three integrations.

    ``detail`` is deliberately the exception *class's* fixed ``default_detail``
    rather than ``str(exc)``. Some subclasses build their instance message
    with details like the raw HTTP status or a truncated n8n response body
    (see call_workflow) — useful in logs, not something to hand back to a
    client. default_detail is a plain string literal on the class itself, so
    this never carries anything computed from a request or from n8n's reply.
    """
    return {
        'success': False,
        'detail': exc.default_detail,
        'source': 'n8n',
        'workflow': exc.workflow,
        'workflowUrl': webhook_url(exc.workflow) if exc.workflow else '',
    }
