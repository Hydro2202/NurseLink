"""
Profile photo handling.

Nurses set a profile photo from their phone's camera roll or their laptop's
file picker, which means the bytes arriving here are whatever the device
produced: an 8 MB HEIC-turned-JPEG, a PNG screenshot, a portrait rotated only
by an EXIF tag, often carrying GPS coordinates from where it was taken.

Rather than trust any of that, every upload is decoded, stripped of metadata,
squared off and re-encoded to a small JPEG. The result is stored inline as a
data: URI on NurseProfile.avatar, which keeps the whole feature free of media
storage: no MEDIA_ROOT, no static file serving that silently 404s once DEBUG is
off, no orphaned files when someone changes their photo, and no publicly
guessable image URLs sitting outside the token-authenticated API.

The cost is that the photo travels inside the user payload, so it is kept
deliberately small — a 256px square is more than the UI ever displays.
"""

import base64
import binascii
import io
import re

from PIL import Image, ImageOps, UnidentifiedImageError

# What the stored photo is normalised to. The largest the UI renders an avatar
# is 96px, so 256 leaves room for high-density screens without paying for it.
AVATAR_SIZE = 256
AVATAR_JPEG_QUALITY = 82

# Ceiling on the *encoded* upload we are willing to decode, before it becomes a
# way to make the server chew through memory. Phone photos land well under this.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

# A decoded image can be far larger than its file size (the classic zip-bomb
# shape for images), so bound the pixel count too.
MAX_PIXELS = 50_000_000

_DATA_URI = re.compile(r'^data:image/([a-zA-Z0-9.+-]+);base64,(.*)$', re.DOTALL)
_HTTP_URL = re.compile(r'^https?://', re.IGNORECASE)


class AvatarError(ValueError):
    """Raised with a message intended to be shown to the person uploading."""


def is_data_uri(value: str) -> bool:
    return bool(_DATA_URI.match(value.strip()))


def is_http_url(value: str) -> bool:
    return bool(_HTTP_URL.match(value.strip()))


def normalize_avatar(value: str) -> str:
    """
    Turn whatever the client sent into something safe to store.

    Passes through '' (clearing the photo) and plain http(s) URLs unchanged —
    the field predates uploads and some accounts still hold a remote URL. A
    data: URI is decoded and re-encoded; anything else is rejected.
    """
    value = (value or '').strip()
    if not value:
        return ''
    if is_http_url(value):
        return value

    match = _DATA_URI.match(value)
    if not match:
        raise AvatarError(
            'Profile photo must be an uploaded image or an https:// image address.'
        )

    payload = match.group(2).strip()
    # Tolerate the whitespace and newlines some encoders insert.
    payload = re.sub(r'\s+', '', payload)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise AvatarError('That image is too large. Please choose one under 6 MB.')

    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise AvatarError('That image could not be read. Please choose another photo.')

    if not raw:
        raise AvatarError('That image could not be read. Please choose another photo.')

    return _to_square_jpeg_data_uri(raw)


def _to_square_jpeg_data_uri(raw: bytes) -> str:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise AvatarError('That image is too large. Please choose a smaller photo.')

            # Honour the EXIF orientation tag, then drop the metadata with it —
            # phone photos routinely carry GPS coordinates we have no reason to
            # keep, and a profile picture is the most widely shared field there is.
            image = ImageOps.exif_transpose(image)

            # Flatten transparency onto white so PNGs do not become black squares
            # once JPEG drops the alpha channel.
            if image.mode in ('RGBA', 'LA', 'P'):
                image = image.convert('RGBA')
                canvas = Image.new('RGB', image.size, (255, 255, 255))
                canvas.paste(image, mask=image.split()[-1])
                image = canvas
            else:
                image = image.convert('RGB')

            # Centre-crop to a square so the circular frame in the UI never
            # squashes a portrait, then scale to the stored size.
            square = ImageOps.fit(
                image, (AVATAR_SIZE, AVATAR_SIZE), method=Image.LANCZOS, centering=(0.5, 0.4)
            )

            buffer = io.BytesIO()
            square.save(buffer, format='JPEG', quality=AVATAR_JPEG_QUALITY, optimize=True)
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, ValueError):
        raise AvatarError(
            'That file does not look like an image. Please choose a JPG or PNG photo.'
        )

    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    return f'data:image/jpeg;base64,{encoded}'
