// I change this by rai
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraStatus, FaceCameraPreviewHandle, FacePoseSample } from '../types/facePose';

type Props = {
  active: boolean;
  onSample: (sample: FacePoseSample) => void;
  onStatusChange: (status: CameraStatus, message?: string) => void;
};

// expo-camera (not react-native-vision-camera) so this works in plain Expo
// Go — no custom dev-client build required. The tradeoff: there is no
// on-device face/pose detector here, so FaceCheckStep drives this platform
// through manual tap-to-confirm capture instead of automatic hold-detection.
export const FaceCameraPreview = forwardRef<FaceCameraPreviewHandle, Props>(function FaceCameraPreview(
  { active, onStatusChange },
  ref
) {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  useImperativeHandle(ref, () => ({
    takePhoto: async () => {
      if (!cameraRef.current) throw new Error('Camera is not ready.');
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: true });
      if (!photo?.uri) throw new Error('Could not capture a photo.');
      return photo.uri;
    },
  }));

  useEffect(() => {
    if (!active || !permission) return;
    if (permission.granted) {
      onStatusChange('granted');
      return;
    }
    if (permission.canAskAgain) {
      requestPermission().then((result) => {
        onStatusChange(result.granted ? 'granted' : 'denied', result.granted ? undefined : 'Camera access was denied.');
      });
    } else {
      onStatusChange('denied', 'Camera access was denied.');
    }
  }, [active, permission, requestPermission, onStatusChange]);

  if (!active || !permission?.granted) {
    return null;
  }

  return <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="front" />;
});
