/*
  # Update Calendar Reports Storage Policies for Public Access

  1. Changes
    - Drop existing restrictive policies
    - Create new policies that allow public INSERT and SELECT
    - Allow anyone to upload calendar reports
    - Allow anyone to view calendar reports

  2. Security Note
    - This is intentional to allow employees without authentication to upload reports
    - Access control is managed through application logic using employeeId
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Employees can upload own calendar reports" ON storage.objects;
DROP POLICY IF EXISTS "Employees can view own calendar reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view calendar reports" ON storage.objects;

-- Allow public uploads to calendar-reports bucket
CREATE POLICY "Public can upload calendar reports"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'calendar-reports');

-- Allow public read access to calendar-reports bucket
CREATE POLICY "Public can view calendar reports"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'calendar-reports');

-- Update bucket to be publicly accessible
UPDATE storage.buckets
SET public = true
WHERE id = 'calendar-reports';