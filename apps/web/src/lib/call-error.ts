export function callSetupErrorDescription(error: unknown) {
  if (error instanceof Error) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Microphone access was denied. Allow the microphone for this site in your browser and in your system privacy settings, then try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No microphone was found. Connect a microphone or select an available input device, then try again.";
      case "NotReadableError":
      case "TrackStartError":
        return "Your microphone could not be opened. Check your input device and close other apps using it, then try again.";
      default:
        return error.message || "Unable to connect. Check that LiveKit is running, then try again.";
    }
  }
  return "Unable to connect. Check that LiveKit is running, then try again.";
}
