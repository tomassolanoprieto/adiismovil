/*
  # Fix nacional holiday type

  1. Changes
    - Update check constraint to include 'nacional' type
    - Allows 'nacional' holidays to be created

  2. Notes
    - Removes old constraint and creates new one with 'nacional' included
*/

ALTER TABLE holidays DROP CONSTRAINT IF EXISTS holidays_holiday_type_check;

ALTER TABLE holidays ADD CONSTRAINT holidays_holiday_type_check
CHECK (holiday_type IN ('nacional', 'work_center', 'comunidad', 'municipio'));
