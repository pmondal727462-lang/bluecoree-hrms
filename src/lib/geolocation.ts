export async function currentLocation() {
  if (!window.isSecureContext)
    throw new Error(
      "GPS requires HTTPS. Open the secure app URL, or use localhost on this computer.",
    );
  if (!navigator.geolocation)
    throw new Error("This browser does not support GPS location.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => {
        reject(
          new Error(
            error.code === 1
              ? "Location permission was denied. Allow location access for this site in your browser settings, then try again."
              : error.code === 3
                ? "GPS timed out. Move to a place with a better signal and try again."
                : "Location is unavailable. Turn on device location services and try again.",
          ),
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
  };
}
