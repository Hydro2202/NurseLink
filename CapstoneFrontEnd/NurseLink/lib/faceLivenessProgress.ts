// I change this by rai
import type { FacePoseSample } from '../types/facePose';

export type PoseId = 'center' | 'left' | 'right';

export type PoseRequirement = {
  id: PoseId;
  label: string;
  yawRange: [number, number];
};

export const DEFAULT_POSES: PoseRequirement[] = [
  { id: 'center', label: 'Center your face', yawRange: [-12, 12] },
  { id: 'left', label: 'Turn your head left', yawRange: [-45, -18] },
  { id: 'right', label: 'Turn your head right', yawRange: [18, 45] },
];

export const HOLD_DURATION_MS = 1200;
export const FACE_LOST_RESET_MS = 2000;
export const SCAN_TIMEOUT_MS = 18000;
export const MIN_FACE_RATIO = 0.06;
export const MAX_FACE_RATIO = 0.45;
export const MAX_YAW_DEG_PER_SEC = 120;

export type LivenessHint =
  | 'no_face'
  | 'multiple_faces'
  | 'move_closer'
  | 'move_back'
  | 'low_light'
  | 'slow_down'
  | 'turn_left'
  | 'turn_right'
  | 'center_face'
  | 'hold_still'
  | null;

export type LivenessState = {
  currentPoseIndex: number;
  poseProgressMs: number;
  completedPoses: boolean[];
  percent: number;
  hint: LivenessHint;
  lastFaceSeenAt: number | null;
  lastYawDeg: number | null;
  lastSampleAt: number | null;
  done: boolean;
};

export function createLivenessState(poseCount: number = DEFAULT_POSES.length): LivenessState {
  return {
    currentPoseIndex: 0,
    poseProgressMs: 0,
    completedPoses: new Array(poseCount).fill(false),
    percent: 0,
    hint: null,
    lastFaceSeenAt: null,
    lastYawDeg: null,
    lastSampleAt: null,
    done: false,
  };
}

function computePercent(completedPoses: boolean[], currentPoseProgressMs: number): number {
  const completedCount = completedPoses.filter(Boolean).length;
  const currentFrac = Math.min(1, currentPoseProgressMs / HOLD_DURATION_MS);
  return Math.round(((completedCount + currentFrac) / completedPoses.length) * 100);
}

/** For platforms with no live pose detector available (e.g. Expo Go, which
 * can't run a native frame processor): a manual "tap to confirm this pose"
 * completes it outright instead of requiring a timed automatic hold. */
export function completePoseManually(
  state: LivenessState,
  poses: PoseRequirement[] = DEFAULT_POSES
): LivenessState {
  if (state.done) return state;

  const completedPoses = [...state.completedPoses];
  completedPoses[state.currentPoseIndex] = true;
  const nextIndex = state.currentPoseIndex + 1;
  const allDone = nextIndex >= poses.length;

  return {
    ...state,
    completedPoses,
    currentPoseIndex: Math.min(nextIndex, poses.length - 1),
    poseProgressMs: 0,
    hint: null,
    percent: allDone ? 100 : computePercent(completedPoses, 0),
    done: allDone,
  };
}

/** Pure reducer: given the current state and a new sample, returns the next state.
 * Knows nothing about the underlying detector (VisionCamera, MediaPipe, ...) — it
 * only consumes FacePoseSample, so the detector can be swapped without touching this. */
export function reduceLivenessState(
  state: LivenessState,
  sample: FacePoseSample,
  nowMs: number,
  poses: PoseRequirement[] = DEFAULT_POSES
): LivenessState {
  if (state.done) return state;

  const dtMs = state.lastSampleAt != null ? Math.max(0, nowMs - state.lastSampleAt) : 0;
  const pose = poses[state.currentPoseIndex];

  if (!sample.faceDetected) {
    const lostForMs = state.lastFaceSeenAt != null ? nowMs - state.lastFaceSeenAt : Infinity;
    const resetProgress = lostForMs >= FACE_LOST_RESET_MS;
    const poseProgressMs = resetProgress ? 0 : state.poseProgressMs;
    return {
      ...state,
      poseProgressMs,
      hint: 'no_face',
      lastSampleAt: nowMs,
      lastYawDeg: null,
      percent: computePercent(state.completedPoses, poseProgressMs),
    };
  }

  const lastFaceSeenAt = nowMs;

  if (sample.multipleFaces) {
    return { ...state, hint: 'multiple_faces', lastSampleAt: nowMs, lastFaceSeenAt };
  }

  if (sample.brightness === 'low') {
    return { ...state, hint: 'low_light', lastSampleAt: nowMs, lastFaceSeenAt };
  }

  if (sample.faceBoundsRatio != null) {
    if (sample.faceBoundsRatio < MIN_FACE_RATIO) {
      return { ...state, hint: 'move_closer', lastSampleAt: nowMs, lastFaceSeenAt };
    }
    if (sample.faceBoundsRatio > MAX_FACE_RATIO) {
      return { ...state, hint: 'move_back', lastSampleAt: nowMs, lastFaceSeenAt };
    }
  }

  if (sample.yawDeg != null && state.lastYawDeg != null && dtMs > 0) {
    const degPerSec = (Math.abs(sample.yawDeg - state.lastYawDeg) / dtMs) * 1000;
    if (degPerSec > MAX_YAW_DEG_PER_SEC) {
      return { ...state, hint: 'slow_down', lastSampleAt: nowMs, lastFaceSeenAt, lastYawDeg: sample.yawDeg };
    }
  }

  const inTolerance =
    sample.yawDeg != null && sample.yawDeg >= pose.yawRange[0] && sample.yawDeg <= pose.yawRange[1];

  if (!inTolerance) {
    const hint: LivenessHint = pose.id === 'left' ? 'turn_left' : pose.id === 'right' ? 'turn_right' : 'center_face';
    return { ...state, hint, lastSampleAt: nowMs, lastFaceSeenAt, lastYawDeg: sample.yawDeg };
  }

  const poseProgressMs = Math.min(HOLD_DURATION_MS, state.poseProgressMs + dtMs);
  const poseComplete = poseProgressMs >= HOLD_DURATION_MS;

  if (!poseComplete) {
    return {
      ...state,
      poseProgressMs,
      hint: 'hold_still',
      lastSampleAt: nowMs,
      lastFaceSeenAt,
      lastYawDeg: sample.yawDeg,
      percent: computePercent(state.completedPoses, poseProgressMs),
    };
  }

  const completedPoses = [...state.completedPoses];
  completedPoses[state.currentPoseIndex] = true;
  const nextIndex = state.currentPoseIndex + 1;
  const allDone = nextIndex >= poses.length;

  return {
    ...state,
    completedPoses,
    currentPoseIndex: Math.min(nextIndex, poses.length - 1),
    poseProgressMs: 0,
    hint: null,
    lastSampleAt: nowMs,
    lastFaceSeenAt,
    lastYawDeg: sample.yawDeg,
    percent: allDone ? 100 : computePercent(completedPoses, 0),
    done: allDone,
  };
}

export function hintToMessage(hint: LivenessHint): string | null {
  switch (hint) {
    case 'no_face':
      return 'Position your face in the frame.';
    case 'multiple_faces':
      return 'Only one person should be in frame.';
    case 'move_closer':
      return 'Move closer.';
    case 'move_back':
      return 'Move back a little.';
    case 'low_light':
      return 'Move to a well-lit area.';
    case 'slow_down':
      return 'Slow down.';
    case 'turn_left':
      return 'Turn your head left.';
    case 'turn_right':
      return 'Turn your head right.';
    case 'center_face':
      return 'Look straight ahead.';
    case 'hold_still':
      return 'Hold still...';
    default:
      return null;
  }
}
