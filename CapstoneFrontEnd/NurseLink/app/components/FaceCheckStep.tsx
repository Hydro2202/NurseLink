// I change this by rai — rewritten from a manual 5-photo capture flow into a
// guided liveness scan (progress ring, retry counter, email-OTP fallback)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Platform } from 'react-native';
import { CheckCircle2, ChevronLeft, RotateCcw, Settings } from 'lucide-react-native';
import { Colors, Radius, Shadows } from '../../constants/colors';
import { FaceCameraPreview } from '../../components/FaceCameraPreview';
import { FaceScanRing } from './FaceScanRing';
import { OtpVerification } from './OtpVerification';
import {
  createLivenessState,
  reduceLivenessState,
  completePoseManually,
  hintToMessage,
  DEFAULT_POSES,
  SCAN_TIMEOUT_MS,
  type LivenessState,
} from '../../lib/faceLivenessProgress';
import type { CameraStatus, FaceCameraPreviewHandle, FacePoseSample } from '../../types/facePose';

export type FaceCheckResult = {
  faceVerificationId: number;
  matchScore: number;
  confidence: string;
  status: 'verified' | 'retry' | 'failed';
  message: string;
  capturedImages: string[];
};

type ScanPhase = 'positioning' | 'scanning' | 'processing' | 'success' | 'failed';

const MAX_FAILED_ATTEMPTS = 3;

// Automatic hold-based pose detection only exists on web (MediaPipe).
// Native uses expo-camera so it keeps working in plain Expo Go — no
// on-device detector there, so it's driven by manual tap-to-confirm instead.
const AUTO_DETECT = Platform.OS === 'web';

type Props = {
  idDocumentId: number | null;
  isLoading: boolean;
  error?: string;
  failedAttempts: number;
  onFailedAttemptsChange: (count: number) => void;
  onCaptureComplete: (capturedUris: string[]) => void;
  onRetry: () => void;
  onCancel: () => void;
  onOtpFallbackVerified: (otpVerificationId: number, email: string) => void;
};

export function FaceCheckStep({
  idDocumentId,
  isLoading,
  error,
  failedAttempts,
  onFailedAttemptsChange,
  onCaptureComplete,
  onRetry,
  onCancel,
  onOtpFallbackVerified,
}: Props) {
  const [phase, setPhase] = useState<ScanPhase>('positioning');
  const [liveness, setLiveness] = useState<LivenessState>(() => createLivenessState());
  const [cameraStatus, setCameraStatus] = useState<CameraStatus | null>(null);
  const [cameraStatusMessage, setCameraStatusMessage] = useState<string | undefined>(undefined);
  const [otpVerified, setOtpVerified] = useState(false);

  const cameraHandleRef = useRef<FaceCameraPreviewHandle | null>(null);
  const phaseRef = useRef<ScanPhase>('positioning');
  const failedAttemptsRef = useRef(failedAttempts);
  const centerUriRef = useRef<string | null>(null);
  const capturingCenterRef = useRef(false);
  const wasLoadingRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    failedAttemptsRef.current = failedAttempts;
  }, [failedAttempts]);

  const useOtpFallback = failedAttempts >= MAX_FAILED_ATTEMPTS && !otpVerified;

  const resetForNewAttempt = useCallback(() => {
    centerUriRef.current = null;
    capturingCenterRef.current = false;
    setLiveness(createLivenessState());
    setPhase('positioning');
  }, []);

  const handleAttemptFailed = useCallback(() => {
    setPhase('failed');
    onFailedAttemptsChange(failedAttemptsRef.current + 1);
  }, [onFailedAttemptsChange]);

  const finishScan = useCallback(async () => {
    setPhase('processing');
    try {
      const uri = centerUriRef.current ?? (await cameraHandleRef.current?.takePhoto());
      if (!uri) throw new Error('No photo captured.');
      onCaptureComplete([uri]);
    } catch (e) {
      handleAttemptFailed();
    }
  }, [onCaptureComplete, handleAttemptFailed]);

  const onSample = useCallback(
    (sample: FacePoseSample) => {
      const now = Date.now();

      if (phaseRef.current === 'positioning') {
        if (sample.faceDetected) {
          setLiveness(createLivenessState());
          setPhase('scanning');
        }
        return;
      }

      if (phaseRef.current !== 'scanning') return;

      setLiveness((prev) => {
        const next = reduceLivenessState(prev, sample, now);
        if (!prev.completedPoses[0] && next.completedPoses[0] && !capturingCenterRef.current) {
          capturingCenterRef.current = true;
          cameraHandleRef.current
            ?.takePhoto()
            .then((uri) => {
              centerUriRef.current = uri;
            })
            .catch(() => {
              // Falls back to a capture attempt in finishScan() once all poses complete.
            })
            .finally(() => {
              capturingCenterRef.current = false;
            });
        }
        return next;
      });
    },
    []
  );

  const onCameraStatusChange = useCallback((status: CameraStatus, message?: string) => {
    setCameraStatus(status);
    setCameraStatusMessage(message);
  }, []);

  // No live detector on native — as soon as the camera is granted, move
  // straight to "scanning" so the manual capture button is usable.
  useEffect(() => {
    if (!AUTO_DETECT && cameraStatus === 'granted' && phaseRef.current === 'positioning') {
      setPhase('scanning');
    }
  }, [cameraStatus]);

  const handleManualCapture = useCallback(async () => {
    if (liveness.currentPoseIndex === 0 && !centerUriRef.current) {
      try {
        centerUriRef.current = (await cameraHandleRef.current?.takePhoto()) ?? null;
      } catch {
        // finishScan() retries the capture once all poses are confirmed.
      }
    }
    setLiveness((prev) => completePoseManually(prev));
  }, [liveness.currentPoseIndex]);

  // Scan complete -> capture + hand off to the parent's real backend verification.
  useEffect(() => {
    if (phase === 'scanning' && liveness.done) {
      void finishScan();
    }
  }, [phase, liveness.done, finishScan]);

  // Per-attempt timeout.
  useEffect(() => {
    if (phase !== 'scanning') return;
    const timer = setTimeout(() => {
      if (phaseRef.current === 'scanning') handleAttemptFailed();
    }, SCAN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, handleAttemptFailed]);

  // React to the parent's real backend verification result (isLoading flips
  // false once /auth/verify-face/ responds). Only a verified status counts
  // as success — hitting 100% locally just triggers submission.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      if (error) {
        handleAttemptFailed();
      } else {
        setPhase('success');
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, error, handleAttemptFailed]);

  const cameraActive =
    !useOtpFallback && !!idDocumentId && (phase === 'positioning' || phase === 'scanning');

  const currentPose = DEFAULT_POSES[liveness.currentPoseIndex];
  const hintMessage = !AUTO_DETECT
    ? 'Get into position, then tap Capture below.'
    : phase === 'positioning'
    ? 'Position your face in the frame.'
    : hintToMessage(liveness.hint) ?? 'Hold still...';

  const ringStatus = phase === 'failed' ? 'failed' : phase === 'success' ? 'success' : 'scanning';
  const ringPercent = phase === 'success' ? 100 : liveness.percent;

  const handleRetry = () => {
    resetForNewAttempt();
    onRetry();
  };

  const handleOtpVerified = (otpVerificationId: number, email: string) => {
    setOtpVerified(true);
    onOtpFallbackVerified(otpVerificationId, email);
  };

  return (
    <View style={styles.root}>
      {!idDocumentId && (
        <View style={styles.warningBox}>
          <Text style={styles.warningBold}>Upload your ID first</Text>
          <Text style={styles.warningText}>Face verification requires the previously uploaded ID document.</Text>
        </View>
      )}

      {useOtpFallback ? (
        <OtpVerification onVerified={handleOtpVerified} />
      ) : (
        <>
          <View style={styles.attemptsRow}>
            <Text style={styles.attemptsText}>Attempt {Math.min(failedAttempts + 1, MAX_FAILED_ATTEMPTS)} of {MAX_FAILED_ATTEMPTS}</Text>
          </View>

          <View style={styles.cameraCard}>
            {cameraStatus === 'denied' ? (
              <PermissionDenied message={cameraStatusMessage} />
            ) : cameraStatus === 'no-device' ? (
              <CenteredMessage title="No camera found" message={cameraStatusMessage ?? 'This device has no usable camera.'} />
            ) : cameraStatus === 'error' ? (
              <CenteredMessage title="Camera error" message={cameraStatusMessage ?? 'Something went wrong starting the camera.'} />
            ) : !idDocumentId ? (
              <CenteredMessage title="Waiting for ID upload" message="Complete the previous step to unlock face verification." />
            ) : (
              <View style={styles.cameraPreview}>
                {(phase === 'positioning' || phase === 'scanning') && (
                  <FaceCameraPreview active={cameraActive} onSample={onSample} onStatusChange={onCameraStatusChange} ref={cameraHandleRef} />
                )}

                {phase === 'processing' && (
                  <View style={styles.centeredOverlay}>
                    <ActivityIndicator color={Colors.white} size="large" />
                    <Text style={styles.overlayTitle}>Verifying your identity...</Text>
                  </View>
                )}

                {phase === 'success' && (
                  <View style={styles.centeredOverlay}>
                    <View style={styles.successCircle}>
                      <CheckCircle2 size={40} color={Colors.white} />
                    </View>
                    <Text style={styles.overlayTitle}>Face scan complete</Text>
                  </View>
                )}

                {phase === 'failed' && (
                  <View style={styles.centeredOverlay}>
                    <Text style={styles.overlayTitle}>Scan failed — try again</Text>
                    <Text style={styles.overlaySubtitle}>{error || "We couldn't verify your face in time."}</Text>
                    <Pressable style={styles.retryButton} onPress={handleRetry}>
                      <RotateCcw size={16} color={Colors.white} />
                      <Text style={styles.retryButtonText}>Retry</Text>
                    </Pressable>
                  </View>
                )}

                {(phase === 'positioning' || phase === 'scanning') && (
                  <>
                    <FaceScanRing percent={ringPercent} status={ringStatus} />
                    <View style={styles.overlayCircle} pointerEvents="none" />
                    <View style={styles.cameraHintBox}>
                      <Text style={styles.cameraHintLabel}>Live Face Verification</Text>
                      <Text style={styles.cameraHintText}>
                        {phase === 'scanning' ? currentPose.label : 'Look at the camera'}
                      </Text>
                      <Text style={styles.cameraHintSubtext}>{hintMessage}</Text>
                      {!AUTO_DETECT && phase === 'scanning' && (
                        <Pressable style={styles.manualCaptureButton} onPress={handleManualCapture}>
                          <Text style={styles.manualCaptureButtonText}>Capture</Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </>
      )}

      <View style={styles.controlRow}>
        <Pressable style={styles.smallButton} onPress={onCancel}>
          <ChevronLeft size={16} color={Colors.gray700} />
          <Text style={styles.smallButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PermissionDenied({ message }: { message?: string }) {
  return (
    <CenteredMessage title="Camera permission required" message={message ?? 'Please allow camera access to continue with face verification.'}>
      {Platform.OS !== 'web' ? (
        <Pressable style={styles.settingsButton} onPress={() => Linking.openSettings()}>
          <Settings size={16} color={Colors.white} />
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      ) : (
        <Text style={styles.overlaySubtitle}>
          Click the camera icon in your browser&apos;s address bar to allow access, then reload this page.
        </Text>
      )}
    </CenteredMessage>
  );
}

function CenteredMessage({ title, message, children }: { title: string; message: string; children?: React.ReactNode }) {
  return (
    <View style={[styles.cameraPreview, styles.centeredPreview]}>
      <Text style={styles.cameraPermissionTitle}>{title}</Text>
      <Text style={styles.cameraPermissionText}>{message}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  warningBox: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.yellow200,
    backgroundColor: Colors.yellow50,
    padding: 14,
  },
  warningBold: { fontSize: 14, fontWeight: '700', color: Colors.orange700, marginBottom: 4 },
  warningText: { fontSize: 13, color: Colors.gray900, lineHeight: 18 },
  attemptsRow: { alignItems: 'center' },
  attemptsText: { fontSize: 12, fontWeight: '600', color: Colors.gray500 },
  cameraCard: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.gray900,
    minHeight: 340,
    ...Shadows.sm,
  },
  cameraPreview: { width: '100%', minHeight: 340, position: 'relative' },
  centeredPreview: { alignItems: 'center', justifyContent: 'center', padding: 20, gap: 8 },
  cameraPermissionTitle: { fontSize: 16, fontWeight: '700', color: Colors.white, marginBottom: 6 },
  cameraPermissionText: { fontSize: 13, color: Colors.gray200, textAlign: 'center', lineHeight: 18 },
  overlayCircle: {
    position: 'absolute',
    top: '18%',
    left: '50%',
    width: 190,
    height: 190,
    marginLeft: -95,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  centeredOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(15,23,42,0.92)',
    padding: 24,
  },
  overlayTitle: { fontSize: 16, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  overlaySubtitle: { fontSize: 13, color: Colors.gray200, textAlign: 'center', lineHeight: 18 },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.green600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  retryButtonText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  settingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  settingsButtonText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  cameraHintBox: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(15,23,42,0.84)',
    borderRadius: Radius.lg,
    padding: 14,
  },
  cameraHintLabel: { fontSize: 12, color: Colors.blue300, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.5 },
  cameraHintText: { fontSize: 16, fontWeight: '700', color: Colors.white, marginBottom: 4 },
  cameraHintSubtext: { fontSize: 13, color: Colors.gray200, lineHeight: 18 },
  manualCaptureButton: {
    marginTop: 12,
    alignSelf: 'center',
    backgroundColor: Colors.blue600,
    borderRadius: Radius.full,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  manualCaptureButtonText: { color: Colors.white, fontWeight: '700', fontSize: 15 },
  controlRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.gray200,
    backgroundColor: Colors.white,
  },
  smallButtonText: { color: Colors.gray700, fontSize: 13, fontWeight: '600' },
});
