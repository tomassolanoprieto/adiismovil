/*
  # Add location and device info to time_requests

  1. Changes
    - Add location_latitude for GPS latitude
    - Add location_longitude for GPS longitude
    - Add location_accuracy for GPS accuracy
    - Add device_info for device/browser information

  2. Notes
    - Tracks GPS location when request is created
    - Stores device information for audit trail
*/

ALTER TABLE time_requests ADD COLUMN IF NOT EXISTS location_latitude double precision;
ALTER TABLE time_requests ADD COLUMN IF NOT EXISTS location_longitude double precision;
ALTER TABLE time_requests ADD COLUMN IF NOT EXISTS location_accuracy double precision;
ALTER TABLE time_requests ADD COLUMN IF NOT EXISTS device_info jsonb;

CREATE INDEX IF NOT EXISTS idx_time_requests_location ON time_requests(location_latitude, location_longitude);
