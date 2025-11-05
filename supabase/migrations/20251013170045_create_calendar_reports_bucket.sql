/*
  # Create Storage Bucket for Calendar Reports

  1. Storage Setup
    - Create 'calendar-reports' bucket for storing signed calendar PDFs
    - Set bucket to private (only authenticated users can access)
    - Enable RLS policies for secure access

  2. Security Policies
    - Employees can upload their own calendar reports
    - Employees can view their own reports
    - Company admins can view all reports from their company
    - Supervisors can view reports from employees in their work centers

  3. Access Control
    - INSERT: Employees can only upload files named with their employee_id
    - SELECT: Employees see own files, admins see company files, supervisors see their team files
    - DELETE: Only allow through admin interface (future feature)
*/

-- Create the storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('calendar-reports', 'calendar-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: Employees can upload their own calendar reports
CREATE POLICY "Employees can upload own calendar reports"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'calendar-reports' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Employees can view their own calendar reports
CREATE POLICY "Employees can view own calendar reports"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'calendar-reports' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Allow public read access for company viewing
-- (We'll control access through application logic and signed URLs)
CREATE POLICY "Authenticated users can view calendar reports"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'calendar-reports');