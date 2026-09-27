"use client";
import { MapPin } from "lucide-react";

export type AttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  recordedAt?: string;
  locationName?: string;
  distanceMeters?: number;
  radiusMeters?: number;
};

export function AttendanceLocationCard({
  label,
  location,
  time,
}: {
  label: string;
  location: AttendanceLocation | null;
  time: string;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] p-4 space-y-2">
      <h3 className="font-semibold flex items-center gap-2">
        <MapPin size={18} />
        {label}
      </h3>
      <p className="text-sm muted">{time}</p>
      {location ? (
        <>
          {location.locationName && (
            <p className="font-medium">{location.locationName}</p>
          )}
          <p className="text-sm">
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
          </p>
          <p className="text-sm muted">
            Reported GPS accuracy: ±{Math.round(location.accuracy)} meters
          </p>
          {location.distanceMeters !== undefined && (
            <p className="text-sm muted">
              {location.distanceMeters} meters from attendance area center
              (radius {location.radiusMeters} meters)
            </p>
          )}
          <a
            className="text-blue-700 underline inline-block text-sm"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open location in Google Maps
          </a>
        </>
      ) : (
        <p className="text-sm muted">
          No GPS location recorded for this event.
        </p>
      )}
    </section>
  );
}
