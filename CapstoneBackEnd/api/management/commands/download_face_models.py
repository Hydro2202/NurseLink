from django.core.management.base import BaseCommand

from api.face_match import SFACE_PATH, SFACE_URL, YUNET_PATH, YUNET_URL, _ensure_model


class Command(BaseCommand):
    help = 'Download the YuNet (detection) and SFace (recognition) ONNX models used by Face Verification.'

    def handle(self, *args, **options):
        for path, url in ((YUNET_PATH, YUNET_URL), (SFACE_PATH, SFACE_URL)):
            if path.exists() and path.stat().st_size > 0:
                self.stdout.write(self.style.SUCCESS(f'Already present: {path.name}'))
                continue
            self.stdout.write(f'Downloading {path.name} ...')
            _ensure_model(path, url)
            self.stdout.write(self.style.SUCCESS(f'Downloaded: {path.name}'))
