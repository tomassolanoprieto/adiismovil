/*
  # Fix holidays type column

  1. Changes
    - Make type column nullable or add default value
    - Add default value for type column

  2. Notes
    - This fixes the NOT NULL constraint error when inserting holidays
*/

ALTER TABLE holidays ALTER COLUMN type DROP NOT NULL;
ALTER TABLE holidays ALTER COLUMN type SET DEFAULT 'national';
