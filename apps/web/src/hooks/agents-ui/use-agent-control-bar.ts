import {
  type TrackReference,
  useLocalParticipantPermissions,
  usePersistentUserChoices,
  useSessionContext,
  useTrackToggle,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useCallback } from "react";

const trackSourceToProtocol = (source: Track.Source) => {
  // NOTE: this mapping avoids importing the protocol package as that leads to a significant bundle size increase
  switch (source) {
    case Track.Source.Camera:
      return 1;
    case Track.Source.Microphone:
      return 2;
    case Track.Source.ScreenShare:
      return 3;
    default:
      return 0;
  }
};

export interface PublishPermissions {
  camera: boolean;
  data: boolean;
  microphone: boolean;
  screenShare: boolean;
}

export function usePublishPermissions(): PublishPermissions {
  const localPermissions = useLocalParticipantPermissions();

  const canPublishSource = (source: Track.Source) => {
    return (
      !!localPermissions?.canPublish &&
      (localPermissions.canPublishSources.length === 0 ||
        localPermissions.canPublishSources.includes(trackSourceToProtocol(source)))
    );
  };

  return {
    camera: canPublishSource(Track.Source.Camera),
    data: localPermissions?.canPublishData ?? false,
    microphone: canPublishSource(Track.Source.Microphone),
    screenShare: canPublishSource(Track.Source.ScreenShare),
  };
}

export interface UseInputControlsProps {
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
  onDisconnect?: () => void;
  saveUserChoices?: boolean;
}

export interface UseInputControlsReturn {
  cameraToggle: ReturnType<typeof useTrackToggle<Track.Source.Camera>>;
  handleAudioDeviceChange: (deviceId: string) => void;
  handleCameraDeviceSelectError: (error: Error) => void;
  handleMicrophoneDeviceSelectError: (error: Error) => void;
  handleVideoDeviceChange: (deviceId: string) => void;
  microphoneToggle: ReturnType<typeof useTrackToggle<Track.Source.Microphone>>;
  microphoneTrack?: TrackReference;
  screenShareToggle: ReturnType<typeof useTrackToggle<Track.Source.ScreenShare>>;
}

export function useInputControls({
  saveUserChoices = true,
  onDeviceError,
}: UseInputControlsProps = {}): UseInputControlsReturn {
  const {
    local: { microphoneTrack },
  } = useSessionContext();

  const microphoneToggle = useTrackToggle({
    onDeviceError: (error) => onDeviceError?.({ error, source: Track.Source.Microphone }),
    source: Track.Source.Microphone,
  });

  const cameraToggle = useTrackToggle({
    onDeviceError: (error) => onDeviceError?.({ error, source: Track.Source.Camera }),
    source: Track.Source.Camera,
  });

  const screenShareToggle = useTrackToggle({
    onDeviceError: (error) => onDeviceError?.({ error, source: Track.Source.ScreenShare }),
    source: Track.Source.ScreenShare,
  });

  const {
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
  } = usePersistentUserChoices({ preventSave: !saveUserChoices });

  const handleAudioDeviceChange = useCallback(
    (deviceId: string) => {
      saveAudioInputDeviceId(deviceId ?? "default");
    },
    [saveAudioInputDeviceId]
  );

  const handleVideoDeviceChange = useCallback(
    (deviceId: string) => {
      saveVideoInputDeviceId(deviceId ?? "default");
    },
    [saveVideoInputDeviceId]
  );

  const handleToggleCamera = useCallback(
    async (enabled?: boolean) => {
      if (screenShareToggle.enabled) {
        screenShareToggle.toggle(false);
      }
      await cameraToggle.toggle(enabled);
      // persist video input enabled preference
      saveVideoInputEnabled(!cameraToggle.enabled);
    },
    [cameraToggle, screenShareToggle, saveVideoInputEnabled]
  );

  const handleToggleMicrophone = useCallback(
    async (enabled?: boolean) => {
      await microphoneToggle.toggle(enabled);
      // persist audio input enabled preference
      saveAudioInputEnabled(!microphoneToggle.enabled);
    },
    [microphoneToggle, saveAudioInputEnabled]
  );

  const handleToggleScreenShare = useCallback(
    async (enabled?: boolean) => {
      if (cameraToggle.enabled) {
        cameraToggle.toggle(false);
      }
      await screenShareToggle.toggle(enabled);
    },
    [cameraToggle, screenShareToggle]
  );
  const handleMicrophoneDeviceSelectError = useCallback(
    (error: Error) => onDeviceError?.({ error, source: Track.Source.Microphone }),
    [onDeviceError]
  );

  const handleCameraDeviceSelectError = useCallback(
    (error: Error) => onDeviceError?.({ error, source: Track.Source.Camera }),
    [onDeviceError]
  );

  return {
    cameraToggle: {
      ...cameraToggle,
      toggle: handleToggleCamera,
    },
    handleAudioDeviceChange,
    handleCameraDeviceSelectError,
    handleMicrophoneDeviceSelectError,
    handleVideoDeviceChange,
    microphoneToggle: {
      ...microphoneToggle,
      toggle: handleToggleMicrophone,
    },
    microphoneTrack,
    screenShareToggle: {
      ...screenShareToggle,
      toggle: handleToggleScreenShare,
    },
  };
}
