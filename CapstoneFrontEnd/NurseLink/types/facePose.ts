// I change this by rai
export type FacePoseSample = {
  faceDetected: boolean;
  yawDeg: number | null;
  faceBoundsRatio: number | null;
  brightness: 'ok' | 'low' | null;
  multipleFaces: boolean;
};

export type FacePoseDetectorResult = FacePoseSample & {
  isDetectorReady: boolean;
  error: string | null;
};

export type CameraStatus = 'requesting' | 'granted' | 'denied' | 'no-device' | 'error';

export type FaceCameraPreviewHandle = {
  /** Captures a still frame and returns a local URI/data-URL suitable for the
   * existing multipart upload path (services/api.ts). */
  takePhoto: () => Promise<string>;
};
