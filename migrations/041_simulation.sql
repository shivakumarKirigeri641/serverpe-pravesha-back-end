-- 041_simulation.sql — demonstration mode.
--
-- A switch that makes the panel look alive: bookings arriving, vehicles
-- entering, the occasional refusal at the gate. It exists for showing the
-- product before it has real traffic, and it must be impossible to leave on by
-- accident — so it carries an expiry, it is off by default, and the server
-- refuses to run it in production unless ALLOW_SIMULATION says otherwise.

INSERT INTO app_settings (key, value, note) VALUES
  ('simulation_enabled', 'false', 'Demonstration mode: generate test bookings and gate activity as if visitors were arriving'),
  ('simulation_rate',    'steady', 'How busy the simulation is: quiet, steady or busy'),
  ('simulation_until',   '',       'Demonstration mode stops by itself at this moment (ISO 8601)'),
  ('simulation_started_at', '',    'When demonstration mode was last switched on')
ON CONFLICT (key) DO NOTHING;
