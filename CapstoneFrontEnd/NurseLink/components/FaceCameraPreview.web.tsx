// I change this by rai
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import type { CameraStatus, FaceCameraPreviewHandle, FacePoseSample } from '../types/facePose';

const MEDIAPIPE_VERSION = '0.10.14';
const VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SAMPLE_INTERVAL_MS = 120;

type Props = {
  active: boolean;
  onSample: (sample: FacePoseSample) => void;
  onStatusChange: (status: CameraStatus, message?: string) => void;
};

declare global {
  interface Window {
    __mediapipeVision?: { FaceLandmarker: any; FilesetResolver: any };
  }
}

/**
 * @mediapipe/tasks-vision ships internal code (a runtime-computed
 * `import()`) that Metro's bundler can't statically resolve, so importing
 * it as a normal npm module 500s. Loading it as a real `<script
 * type="module">` sidesteps Metro entirely — the browser executes it
 * natively, and Metro never sees the package's source at all.
 */
function loadMediapipeVision(): Promise<{ FaceLandmarker: any; FilesetResolver: any }> {
  if (window.__mediapipeVision) return Promise.resolve(window.__mediapipeVision);

  return new Promise((resolve, reject) => {
    const onReady = () => {
      window.removeEventListener('mediapipe-vision-ready', onReady);
      if (window.__mediapipeVision) resolve(window.__mediapipeVision);
      else reject(new Error('Face-detection library failed to initialize.'));
    };
    window.addEventListener('mediapipe-vision-ready', onReady);

    const existing = document.getElementById('mediapipe-vision-loader');
    if (existing) return;

    const script = document.createElement('script');
    script.id = 'mediapipe-vision-loader';
    script.type = 'module';
    script.text = `
      import { FaceLandmarker, FilesetResolver } from '${VISION_BUNDLE_URL}';
      window.__mediapipeVision = { FaceLandmarker, FilesetResolver };
      window.dispatchEvent(new Event('mediapipe-vision-ready'));
    `;
    script.onerror = () => reject(new Error('Could not load the face-detection library.'));
    document.head.appendChild(script);
  });
}

/** Rotation-matrix -> yaw (deg). Assumes MediaPipe's row-major 4x4 facial
 * transformation matrix, rotation in the top-left 3x3. */
function yawFromMatrix(m: Float32Array | number[]): number {
  const r20 = m[8];
  const r00 = m[0];
  const r10 = m[4];
  const yawRad = Math.atan2(-r20, Math.sqrt(r00 * r00 + r10 * r10));
  return (yawRad * 180) / Math.PI;
}

export const FaceCameraPreview = forwardRef<FaceCameraPreviewHandle, Props>(function FaceCameraPreview(
  { active, onSample, onStatusChange },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSampleTsRef = useRef(0);
  const [videoReady, setVideoReady] = useState(false);

  useImperativeHandle(ref, () => ({
    takePhoto: async () => {
      const video = videoRef.current;
      if (!video) throw new Error('Camera is not ready.');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 640;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not capture frame.');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    },
  }));

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function setup() {
      onStatusChange('requesting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = stream;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.transform = 'scaleX(-1)'; // mirror, like a selfie camera
        await video.play();
        videoRef.current = video;
        containerRef.current?.appendChild(video);
        setVideoReady(true);

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        canvasRef.current = canvas;

        onStatusChange('granted');

        const { FaceLandmarker, FilesetResolver } = await loadMediapipeVision();
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        if (cancelled) return;

        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFacialTransformationMatrixes: true,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        const tick = (ts: number) => {
          if (cancelled) return;
          rafRef.current = requestAnimationFrame(tick);
          if (ts - lastSampleTsRef.current < SAMPLE_INTERVAL_MS) return;
          lastSampleTsRef.current = ts;

          const v = videoRef.current;
          const lm = landmarkerRef.current;
          if (!v || !lm || v.readyState < 2) return;

          const detection = lm.detectForVideo(v, ts);
          const faces = detection.faceLandmarks || [];

          if (faces.length === 0) {
            onSample({ faceDetected: false, yawDeg: null, faceBoundsRatio: null, brightness: null, multipleFaces: false });
            return;
          }

          const points = faces[0];
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          const faceBoundsRatio = (maxX - minX) * (maxY - minY);

          let yawDeg: number | null = null;
          const matrices = detection.facialTransformationMatrixes;
          if (matrices && matrices[0]) {
            yawDeg = yawFromMatrix(matrices[0].data);
          }

          let brightness: 'ok' | 'low' | null = null;
          const ctx = canvasRef.current?.getContext('2d', { willReadFrequently: true });
          if (ctx && canvasRef.current) {
            ctx.drawImage(v, 0, 0, canvasRef.current.width, canvasRef.current.height);
            const frame = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height).data;
            let total = 0;
            const pixelCount = frame.length / 4;
            for (let i = 0; i < frame.length; i += 4) {
              total += 0.299 * frame[i] + 0.587 * frame[i + 1] + 0.114 * frame[i + 2];
            }
            brightness = total / pixelCount < 55 ? 'low' : 'ok';
          }

          onSample({ faceDetected: true, yawDeg, faceBoundsRatio, brightness, multipleFaces: faces.length > 1 });
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        const err = e as DOMException;
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          onStatusChange('denied', 'Camera access was denied.');
        } else if (err?.name === 'NotFoundError') {
          onStatusChange('no-device', 'No camera was found on this device.');
        } else {
          onStatusChange('error', err instanceof Error ? err.message : 'Camera failed to start.');
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close?.();
      landmarkerRef.current = null;
      if (videoRef.current?.parentElement) {
        videoRef.current.parentElement.removeChild(videoRef.current);
      }
      videoRef.current = null;
      setVideoReady(false);
    };
  }, [active, onSample, onStatusChange]);

  return <View ref={containerRef as any} style={StyleSheet.absoluteFill} />;
});
