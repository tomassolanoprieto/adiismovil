-- Create function to update employee PIN
CREATE OR REPLACE FUNCTION update_employee_pin(
  p_employee_id UUID,
  p_new_pin TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Validate PIN format
  IF p_new_pin !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'El PIN debe ser de 6 dígitos numéricos';
  END IF;

  -- Update employee profile
  UPDATE employee_profiles
  SET 
    pin = p_new_pin,
    updated_at = NOW()
  WHERE id = p_employee_id
  AND is_active = true;

  -- If no rows were updated, employee doesn't exist or is inactive
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empleado no encontrado o inactivo';
  END IF;

  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al actualizar el PIN: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create policy for PIN updates
CREATE POLICY "allow_employee_pin_update"
  ON employee_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());