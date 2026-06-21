import * as Location from 'expo-location';

// Location helpers for the worker setup form. The GPS icon is only a convenience
// — the text field stays manually editable at all times — so every function here
// returns a typed result the caller can fall back from instead of throwing.
//
// PRIVACY: location coordinates are personal data. We never log them (no
// console.log of lat/lng anywhere), and we only ever return a readable string to
// the form, not raw coordinates kept around longer than needed.

// Result of trying to capture + describe the device's current location.
//   granted: false        -> the user denied permission (show manual-entry hint)
//   granted: true, address-> a readable place string to drop into the field
export type LocationResult =
  | { granted: false }
  | { granted: true; address: string };

// Format raw coordinates as a short, readable fallback string, e.g.
// "10.3157, 123.8854". Used when reverse geocoding finds no address.
function formatCoords(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

// Turn a geocoded address into a short "district/city" style label. We prefer the
// most human parts (neighbourhood + city) and quietly skip anything missing.
function describeAddress(place: Location.LocationGeocodedAddress): string {
  // Order chosen so the result reads like "Lahug, Cebu City": a local area first,
  // then the city/region. Duplicates and empties are filtered out below.
  const parts = [place.district ?? place.street, place.city ?? place.subregion, place.region];
  const seen = new Set<string>();
  const cleaned = parts
    .map((part) => part?.trim())
    .filter((part): part is string => !!part && !seen.has(part) && !!seen.add(part));
  return cleaned.slice(0, 2).join(', ');
}

// Capture the device's current location and reverse-geocode it to a readable
// address. Guard clauses keep every failure mode non-blocking:
//   * permission denied -> { granted: false } (caller shows a manual-entry hint)
//   * geocoding finds nothing / throws -> fall back to raw coordinates string
export async function getReadableLocation(): Promise<LocationResult> {
  // Guard: never assume permission — request it and check the result first.
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { granted: false };

  // Balanced accuracy is plenty for a city/area label and avoids the slow,
  // power-hungry high-accuracy GPS fix we don't need here.
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  const { latitude, longitude } = position.coords;

  // Guard: reverse geocoding can fail or return nothing (no network, remote
  // area). Either way we fall back to raw coordinates rather than blocking.
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const address = results[0] ? describeAddress(results[0]) : '';
    if (!address) return { granted: true, address: formatCoords(latitude, longitude) };
    return { granted: true, address };
  } catch {
    return { granted: true, address: formatCoords(latitude, longitude) };
  }
}
