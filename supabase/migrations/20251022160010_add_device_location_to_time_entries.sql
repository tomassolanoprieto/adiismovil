/*
  # Add device info and location to time_entries

  1. Changes
    - Add location_latitude for GPS latitude
    - Add location_longitude for GPS longitude
    - Add location_accuracy for GPS accuracy
    - Add device_info for device/browser information

  2. Notes
    - Tracks GPS location when entry is created
    - Stores device information for audit trail
    - Matches structure of time_requests table
*/

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location_latitude double precision;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location_longitude double precision;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS location_accuracy double precision;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS device_info jsonb;

CREATE INDEX IF NOT EXISTS idx_time_entries_location ON time_entries(location_latitude, location_longitude);
