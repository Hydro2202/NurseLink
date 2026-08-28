import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';

/**
 * Live camera capture for an ID card, with an alignment guide.
 *
 * The previous "Camera Scan" was a hidden file input with capture="environment".
 * On a phone that opens the OS camera app; in a desktop browser it opens nothing
 * but a file picker, so a web user could never actually scan a card. It also
 * offered no framing guidance, and a card shot at an angle or half out of frame
 * is the main reason OCR comes back with missing fields.
 *
 * This owns its own MediaStream, separate from the selfie camera, so the two can
 * never hold the device at the same time.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives the captured frame as a JPEG data URL. */
  onCapture: (dataUrl: string) => void;
  title?: string;
  instruction?: string;
}

type CameraState = 'idle' | 'requesting' | 'active' | 'denied' | 'not-supported' | 'error';

export default function IdCameraCaptureModal({
  open,
  onClose,
  onCapture,
  title = 'Scan your PRC ID',
  instruction = 'Place the card flat inside the frame. Make sure all four corners are visible and the text is sharp.',
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startingRef = useRef(false);

  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [captured, setCaptured] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState('idle');
  }, []);

  const startCamera = useCallback(async () => {
    // Guards against a second stream from a double click, or from a re-render
    // landing while getUserMedia is still resolving.
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setErrorMessage('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('not-supported');
      setErrorMessage('This browser cannot open a camera. Use "Upload File" instead.');
      startingRef.current = false;
      return;
    }

    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera where there is one; harmless on a laptop webcam.
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraState('active');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraState('denied');
        setErrorMessage('Camera access was denied. Allow camera permission in your browser, then try again.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setCameraState('error');
        setErrorMessage('No camera was found on this device. Use "Upload File" instead.');
      } else {
        setCameraState('error');
        setErrorMessage('The camera could not be started. Close any other app using it and try again.');
      }
    } finally {
      startingRef.current = false;
    }
  }, []);

  // Attach the stream once the video element has mounted — it only renders
  // after cameraState flips to 'active', one render after the stream exists.
  useEffect(() => {
    if (cameraState === 'active' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState]);

  // Open on mount, and always release the device on close or unmount.
  useEffect(() => {
    if (open) {
      setCaptured(null);
      void startCamera();
    } else {
      stopStream();
      setCaptured(null);
    }
    return () => stopStream();
  }, [open, startCamera, stopStream]);

  if (!open) return null;

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCaptured(canvas.toDataURL('image/jpeg', 0.92));
    // Hold the frame for review and release the camera meanwhile.
    stopStream();
  };

  const retake = () => {
    setCaptured(null);
    void startCamera();
  };

  const confirm = () => {
    if (!captured) return;
    onCapture(captured);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{instruction}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black">
          {captured ? (
            <img src={captured} alt="Captured ID" className="h-72 w-full bg-black object-contain" />
          ) : (
            <>
              <video ref={videoRef} className="h-72 w-full object-cover" playsInline muted autoPlay />
              {/* ID cards are roughly 1.6:1, so framing to this rectangle keeps
                  the whole card in shot. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-40 w-64 rounded-xl border-4 border-white/70" />
              </div>
              {cameraState === 'requesting' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Starting camera...
                </div>
              )}
            </>
          )}
        </div>

        {errorMessage && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {errorMessage}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {captured ? (
            <>
              <button
                type="button"
                onClick={retake}
                className="flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4" /> Retake
              </button>
              <button
                type="button"
                onClick={confirm}
                className="flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                <CheckCircle2 className="h-4 w-4" /> Use This Photo
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={capture}
                disabled={cameraState !== 'active'}
                className="flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                <Camera className="h-4 w-4" /> Capture Photo
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-12 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" /> Cancel
              </button>
            </>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}
