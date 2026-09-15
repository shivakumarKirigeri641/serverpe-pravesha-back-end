/*
 * Nandi Hills as a per-person destination (056), for the demonstration.
 *
 *   node scripts/seed-nandi-hills.js
 *
 * What the user set on 2026-09-15:
 *   * ₹10 entry per person (the department's), plus a flat ₹5 platform fee per pass
 *   * one pool for the whole day, 1,000 people
 *   * one to ten people on a pass
 *
 * The opening hours were not given, so the day runs 6 AM to 6 PM (last entry an
 * hour before, as everywhere else) until the department confirms them.
 *
 * Re-runnable: it updates what it finds rather than adding a second copy.
 */
require('dotenv').config({ quiet: true });
const { query, one, tx } = require('../src/gatepass/db');

const PLACE = {
  code: 'NANDI_HILLS', name: 'Nandi Hills', name_kn: 'ನಂದಿ ಬೆಟ್ಟ',
  district: 'Chikkaballapur', district_kn: 'ಚಿಕ್ಕಬಳ್ಳಾಪುರ',
  max_persons_per_pass: 10,
};
const SLOT = { code: 'ALLDAY', label: 'Whole day (6 AM – 6 PM)', label_kn: 'ದಿನವಿಡೀ (ಬೆಳಿಗ್ಗೆ 6 – ಸಂಜೆ 6)', starts_at: '06:00', ends_at: '18:00' };
const CAPACITY = 1000;
const ENTRY_PAISE = 1000;     // ₹10 per person
const PLATFORM_PAISE = 500;   // ₹5 per pass
const CHECKPOST = { name: 'Nandi Hills Main Gate', name_kn: 'ನಂದಿ ಬೆಟ್ಟ ಮುಖ್ಯ ದ್ವಾರ' };

(async () => {
  const cat = await one(`SELECT id FROM vehicle_categories WHERE per_person ORDER BY id LIMIT 1`);
  if (!cat) throw new Error('no per-person category — run migration 056 first');

  const out = await tx(async (c) => {
    const existing = (await c.query(`SELECT id FROM places WHERE code = $1`, [PLACE.code])).rows[0];
    const place = existing
      ? (await c.query(
        `UPDATE places SET name = $2, name_kn = $3, district = $4, district_kn = $5,
                booking_mode = 'person', max_persons_per_pass = $6, is_active = true, modified_at = now()
          WHERE id = $1 RETURNING *`,
        [existing.id, PLACE.name, PLACE.name_kn, PLACE.district, PLACE.district_kn, PLACE.max_persons_per_pass])).rows[0]
      : (await c.query(
        `INSERT INTO places (code, name, name_kn, district, district_kn, booking_mode, max_persons_per_pass, is_active)
         VALUES ($1,$2,$3,$4,$5,'person',$6,true) RETURNING *`,
        [PLACE.code, PLACE.name, PLACE.name_kn, PLACE.district, PLACE.district_kn, PLACE.max_persons_per_pass])).rows[0];

    let slot = (await c.query(`SELECT * FROM place_slots WHERE place_id = $1 AND code = $2`, [place.id, SLOT.code])).rows[0];
    slot = slot
      ? (await c.query(
        `UPDATE place_slots SET label = $2, label_kn = $3, starts_at = $4, ends_at = $5, is_active = true, modified_at = now()
          WHERE id = $1 RETURNING *`, [slot.id, SLOT.label, SLOT.label_kn, SLOT.starts_at, SLOT.ends_at])).rows[0]
      : (await c.query(
        `INSERT INTO place_slots (place_id, code, label, label_kn, starts_at, ends_at, sort_order, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,1,true) RETURNING *`,
        [place.id, SLOT.code, SLOT.label, SLOT.label_kn, SLOT.starts_at, SLOT.ends_at])).rows[0];

    await c.query(
      `INSERT INTO slot_capacity (place_id, slot_id, category_id, capacity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (place_id, slot_id, category_id) DO UPDATE SET capacity = EXCLUDED.capacity`,
      [place.id, slot.id, cat.id, CAPACITY]);
    /* Days already opened keep their counts; only their capacity follows. */
    await c.query(
      `UPDATE slot_inventory SET capacity = GREATEST($4, booked + held), modified_at = now()
        WHERE place_id = $1 AND slot_id = $2 AND category_id = $3`, [place.id, slot.id, cat.id, CAPACITY]);

    const price = (await c.query(
      `SELECT entry_paise, platform_paise FROM place_pricing WHERE place_id = $1 AND category_id = $2 AND is_active`,
      [place.id, cat.id])).rows[0];
    if (!price || Number(price.entry_paise) !== ENTRY_PAISE || Number(price.platform_paise) !== PLATFORM_PAISE) {
      await c.query(`UPDATE place_pricing SET is_active = false WHERE place_id = $1 AND category_id = $2 AND is_active`, [place.id, cat.id]);
      await c.query(
        `INSERT INTO place_pricing (place_id, category_id, entry_paise, platform_paise, effective_from, is_active)
         VALUES ($1,$2,$3,$4, now(), true)`, [place.id, cat.id, ENTRY_PAISE, PLATFORM_PAISE]);
    }

    let gate = (await c.query(`SELECT * FROM checkposts WHERE place_id = $1 ORDER BY id LIMIT 1`, [place.id])).rows[0];
    if (!gate) {
      gate = (await c.query(
        `INSERT INTO checkposts (place_id, name, name_kn, is_active) VALUES ($1,$2,$3,true) RETURNING *`,
        [place.id, CHECKPOST.name, CHECKPOST.name_kn])).rows[0];
    }
    return { place, slot, gate };
  });

  console.log(`Nandi Hills ready: place ${out.place.id} (${out.place.booking_mode}, max ${out.place.max_persons_per_pass}),`
    + ` slot ${out.slot.code} ${out.slot.starts_at}-${out.slot.ends_at}, ${CAPACITY} people/day,`
    + ` ₹${ENTRY_PAISE / 100}/person + ₹${PLATFORM_PAISE / 100}/pass, gate "${out.gate.name}" (${out.gate.id})`);
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
