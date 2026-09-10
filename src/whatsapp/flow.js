/**
 * whatsapp/flow.js — the whole conversation.
 *
 * A WhatsApp bot has no home button, so the MENU is the home button. Any time
 * someone types "hi" — or gets lost, or comes back a month later — they land
 * on the same five choices:
 *
 *     Book ticket · Download ticket · Postpone ticket · Support · Feedback
 *
 * Booking is the first row because it is why most people are here. Postpone is
 * a permanent row rather than something that only appears when the hill floods:
 * a customer whose plans changed needs it just as much as one caught by a
 * closure, and a feature that only exists during an emergency is a feature
 * nobody can find during one.
 *
 * The booking path is a tap at every step except the registration number, which
 * only the customer knows:
 *
 *     menu -> plate -> confirm plate -> date -> slot -> pay -> QR + PDF
 *
 * WHY CONSENT IS ITS OWN STEP: we look up a vehicle's registration record. That
 * is the customer's data being fetched, and the tap agreeing to it is recorded
 * with a timestamp in event_log. Nothing is looked up before it.
 *
 * WHY THE PLATE IS ECHOED IN CAPITALS: everything is keyed on it. A typo that
 * still looks like a plate produces a ticket for a vehicle that will never
 * arrive, and the customer discovers that at the barrier.
 */

const send = require('./send');
const store = require('./store');
const db = require('../gatepass/db');
const customers = require('../gatepass/customers');
const plate = require('../gatepass/plate');
const vehicles = require('../gatepass/vehicle');
const booking = require('../gatepass/booking');
const pricing = require('../gatepass/pricing');
const inventory = require('../gatepass/inventory');
const settings = require('../gatepass/settings');
const checkout = require('../gatepass/checkout');
const deliver = require('../gatepass/deliver');
const closure = require('../gatepass/closure');
const { kn } = require('../gatepass/kn');
const { t } = require('../gatepass/i18n');

/* Which language to answer this customer in. Defaults to Kannada, which is
   also the column default — a customer row that predates the language question
   is answered in the language the site is in, not the one we build in. */
const lang = (customer) => (customer?.language === 'en' ? 'en' : 'kn');
const policy = require('../gatepass/policy');
const flowEndpoint = require('../routes/flowEndpoint');

/*
 * The site this number sells for.
 *
 * One WhatsApp number serves one site today. It is a setting rather than a
 * constant because the next site will have its own number, and neither should
 * need a code change to exist.
 */
const PLACE_CODE = process.env.PLACE_CODE || 'MULLAYANAGIRI';

/**
 * The place this booking is for.
 *
 * Taken from what the visitor chose, not from a constant. PLACE_CODE remains
 * only as the fallback for a conversation that started before a place was
 * picked — a menu greeting, say — and for a single-site deployment where the
 * question is not worth asking.
 */
async function placeFor(ctx) {
  const id = ctx?.session?.context?.place_id;
  if (id) {
    const p = await db.one('SELECT * FROM places WHERE id = $1 AND is_active', [id]);
    if (p) return p;
  }
  return booking.placeByCode(PLACE_CODE);
}

/** Every site currently switched on, in menu order. */
const activePlaces = () =>
  db.query('SELECT * FROM places WHERE is_active ORDER BY id').then((r) => r.rows);

/* ─────────────────────────────────────────────────────────────── helpers */

const GREETING = /^(hi|hii|hello|hey|start|book|namaste|namaskara|hai|menu|ticket|help)\b/i;

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Wed, 10 Sep" — how a date is spoken, not how it is stored. */
function pretty(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY[dt.getUTCDay()].slice(0, 3)}, ${d} ${MON[m - 1]}`;
}

const today = () => new Date().toISOString().slice(0, 10);
const isToday = (d) => String(d) === today();
const isTomorrow = (d) => String(d) === new Date(Date.now() + 86400000).toISOString().slice(0, 10);

/** Re-space a stored plate for display: KA31N8147 -> KA 31 N 8147. */
const p2 = (reg) => (plate.parse(reg).pretty || reg);

const dayLabel = (d) => (isToday(d) ? `Today, ${pretty(d).split(', ')[1]}`
  : isTomorrow(d) ? `Tomorrow, ${pretty(d).split(', ')[1]}`
  : pretty(d));

/* ─────────────────────────────────────────────────────────── the entry point */

async function handle(msg) {
  const { mobile, text, buttonId, listId } = msg;
  const choice = buttonId || listId || null;

  const customer = await customers.upsert(mobile, { name: msg.profileName, waId: msg.waId });
  if (customer.is_blocked) return;

  const session = await store.touchInbound(mobile, {
    waId: msg.waId, profileName: msg.profileName, customerId: customer.id });

  const ctx = { mobile, customer, session, text, choice };

  // A tap means what it says, whatever state the conversation is in. Someone
  // can change their mind three screens back and the button must still work;
  // routing on state first would strand them.
  if (choice) return onChoice(ctx);

  const typed = String(text || '').trim();
  if (GREETING.test(typed)) return welcome(ctx);

  // States that are waiting for typed words, not taps.
  switch (session.state) {
    case 'awaiting_plate':   return onPlate(ctx);
    case 'support_message':  return onSupportMessage(ctx);
    case 'feedback_message': return onFeedbackMessage(ctx);
    default:                 return welcome(ctx);
  }
}

/* ───────────────────────────────────────────────────────────── the menu */

async function welcome(ctx) {
  const { mobile, customer } = ctx;

  /* Language first, before anything else is said.
     Asked once and remembered. Every message after this is in one language
     rather than both, which halves the length of every screen — a bot that
     carries two languages in every bubble reads as one that could not decide. */
  if (!customer.language_asked_at) return askLanguage(ctx);

  if (!await hasConsented(customer.id)) return askConsent(ctx);

  // A closure is the one thing important enough to interrupt the menu with.
  const stuck = await closure.awaitingChoice(customer.id);
  if (stuck.length) return offerClosureChoice(ctx, stuck[0]);

  return menu(ctx);
}

async function menu(ctx, header) {
  const { mobile, customer } = ctx;
  await store.setState(mobile, 'menu', {});

  const place = await placeFor(ctx);
  const name = customer.wa_profile_name ? customer.wa_profile_name.split(' ')[0] : null;
  const L = lang(customer);

  const body = header || `${t(L, 'greeting')}${name ? ` ${name}` : ''} 🙏\n\n`
    + t(L, 'what_would_you_like');

  /* WhatsApp truncates a list row title at 24 characters and a description at
     72. Two languages in one row never fitted; one does, which is the other
     reason these are single-language now rather than only a matter of taste. */
  return send.list(mobile, {
    body,
    button: t(L, 'menu_button'),
    sectionTitle: place?.name || t(L, 'f_title_details'),
    rows: [
      { id: 'menu_book',     title: t(L, 'menu_book'),     description: t(L, 'menu_book_desc') },
      { id: 'menu_download', title: t(L, 'menu_download'), description: t(L, 'menu_download_desc') },
      { id: 'menu_postpone', title: t(L, 'menu_postpone'), description: t(L, 'menu_postpone_desc') },
      { id: 'menu_support',  title: t(L, 'menu_support'),  description: t(L, 'menu_support_desc') },
      { id: 'menu_feedback', title: t(L, 'menu_feedback'), description: t(L, 'menu_feedback_desc') },
    ],
    footer: 'ServerPe App Solutions',
  });
}

/**
 * The one question asked in both languages, because it is the question that
 * decides which language the rest is in.
 *
 * Kannada is listed first and is the default: the site is in Karnataka and the
 * department is a Karnataka department.
 */
async function askLanguage(ctx) {
  const { mobile } = ctx;
  await store.setState(mobile, 'language', {});

  /* English only, because this is asked before we know which language they
     want. The button labels stay in their own scripts — a Kannada speaker
     looking for Kannada scans for ಕನ್ನಡ, not for the word "Kannada".

     THE AUTHORITY LINE IS A SETTING, and it is worded to say who sets the
     fees rather than who is sending the message. Until something is signed,
     a greeting that reads as though it comes FROM the department is a claim
     we cannot support — and one Meta treats seriously. Changing it is a
     settings row, not a deploy. */
  const cfg = await settings.all();
  const product = cfg.product_name || 'Pravesha';
  const tagline = cfg.product_tagline || 'Entry made simple.';
  const authority = cfg.authority_line
    || 'Vehicle entry tickets for tourist places in Karnataka.';

  return send.buttons(mobile,
    `🙏 Welcome to *${product}* — ${tagline}\n\n${authority}\n\nPlease choose your language.`,
    [
      { id: 'lang_kn', title: 'ಕನ್ನಡ' },
      { id: 'lang_en', title: 'English' },
    ],
    { footer: `${product} · Powered by ${cfg.merchant_name || 'ServerPe App Solutions'}` });
}

async function hasConsented(customerId) {
  return !!(await db.one(
    `SELECT 1 FROM event_log WHERE customer_id = $1 AND kind = 'consent_given' LIMIT 1`,
    [customerId]));
}

async function askConsent(ctx) {
  const { mobile, customer } = ctx;
  await store.setState(mobile, 'consent', {});
  const place = await placeFor(ctx);
  const name = customer.wa_profile_name ? `, ${customer.wa_profile_name.split(' ')[0]}` : '';

  /* One language, chosen by the visitor a moment ago. */
  const L = lang(customer);

  /* The policy link is shown here, before the button, rather than hidden behind
     a second tap. Somebody who wants to read it can; somebody who does not is
     not made to tap twice to get past it — and either way we can say the terms
     were in front of them when they agreed. */
  const base = process.env.PUBLIC_BASE_URL || '';
  const link = base ? `\n\n📄 ${t(L, 'terms_link_label')}:\n${base}/policy` : '';

  return send.buttons(mobile,
    `${t(L, 'greeting')}${name} 🙏\n\n`
    + `${t(L, 'consent_book_here')}\n\n`
    + `${t(L, 'consent_qr')}\n\n`
    + `${t(L, 'consent_ask')}`
    + link
    + `\n\n_${t(L, 'read_before_agree')}_`,
    [
      { id: 'consent_yes', title: t(L, 'agree_continue') },
    ],
    { footer: 'ServerPe App Solutions' });
}

/* ──────────────────────────────────────────────────────────── 1 · booking */

/**
 * Open the booking form.
 *
 * The whole booking — place, date, vehicle check, slot, review, agree — happens
 * on one native WhatsApp screen rather than as a dozen chat messages. What the
 * visitor picks comes back once, at the end, as a completed reply.
 *
 * FALLING BACK IS DELIBERATE. If the Flow is not configured, or Meta refuses
 * the message, the old step-by-step conversation still works and the visitor
 * gets a ticket. A booking system that cannot sell a ticket because a form
 * failed to open is worse than one with an old-fashioned form.
 */
async function startBooking(ctx) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  /* The web form, opened by a link button in the chat.
     The native WhatsApp Flow is built and validated but Meta refuses to
     publish it, so it is not attempted here. flowEndpoint is still used — for
     minting the signed token, which both paths share. */
  const base = process.env.PUBLIC_BASE_URL;
  if (base) {
    const token = flowEndpoint.newToken(customer.id, mobile, 'booking', 120);
    const r = await send.ctaUrl(mobile, {
      body: t(L, 'flow_body'),
      label: t(L, 'flow_cta'),
      url: `${base.replace(/\/+$/, '')}/book/${token}`,
      footer: 'ServerPe App Solutions',
    });
    if (r?.ok) {
      await store.setState(mobile, 'in_web_form', {});
      return r;
    }
    console.warn('[wa] link button did not send (%s) — falling back to chat steps',
      r?.error || 'unknown');
  }

  /* The chat fallback asks the same questions in the same order the form does,
     starting with which place. It was written when there was one site and
     assumed it; a platform serving the department's places cannot assume. */
  return askPlace(ctx);
}

/**
 * Which place is being visited.
 *
 * Skipped when only one site is switched on — asking somebody to choose from a
 * list of one is a tap that teaches them nothing.
 */
async function askPlace(ctx) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  const places = await activePlaces();

  if (!places.length) return send.text(mobile, t(L, 'no_places'));

  if (places.length === 1) {
    await store.setState(mobile, 'awaiting_plate', { place_id: places[0].id });
    return askPlate({ ...ctx,
      session: { ...ctx.session, context: { ...(ctx.session?.context || {}), place_id: places[0].id } } });
  }

  await store.setState(mobile, 'choose_place', {});
  return send.list(mobile, {
    body: t(L, 'which_place'),
    button: t(L, 'choose_place'),
    sectionTitle: t(L, 'f_place'),
    rows: places.slice(0, 10).map((p) => ({
      id: `place_${p.id}`,
      title: p.name.slice(0, 24),
      description: (p.district || '').slice(0, 72) || undefined,
    })),
    footer: 'ServerPe App Solutions',
  });
}

async function onPlaceChosen(ctx, placeId) {
  const { mobile } = ctx;
  const place = await db.one('SELECT * FROM places WHERE id = $1 AND is_active', [placeId]);
  if (!place) return askPlace(ctx);

  await store.setState(mobile, 'awaiting_plate', { place_id: place.id });
  return askPlate({ ...ctx,
    session: { ...ctx.session, context: { ...(ctx.session?.context || {}), place_id: place.id } } });
}

async function askPlate(ctx) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  await store.setState(mobile, 'awaiting_plate', {});
  return send.text(mobile,
    `${t(L, 'ask_plate')}\n\n`
    + `${t(L, 'ask_plate_example')}\n\n`
    + `${t(L, 'ask_plate_format')}`);
}

async function onPlate(ctx) {
  const { mobile, text, customer } = ctx;
  const L = lang(customer);
  const p = plate.parse(text);

  if (!p.ok) {
    const why = {
      empty:  t(L, 'plate_err_empty'),
      length: t(L, 'plate_err_length'),
      format: t(L, 'plate_err_format'),
      state:  t(L, 'plate_err_state', { code: String(p.reg_no).slice(0, 2) }),
    }[p.reason] || t(L, 'plate_err_format');

    return send.text(mobile, `${why}\n\n${t(L, 'plate_err_retry')}`);
  }

  await store.setState(mobile, 'confirm_plate', { reg_no: p.reg_no });
  const L2 = lang(customer);
  return send.buttons(mobile,
    `${t(L, 'vehicle_number')}:\n\n*${p.pretty}*\n\n${t(L, 'is_this_correct')}`,
    [
      { id: 'plate_yes', title: t(L, 'yes_correct') },
      { id: 'plate_no', title: t(L, 'change_number') },
    ]);
}

/**
 * Plate confirmed: look it up, decide its category, offer dates.
 *
 * A lookup failure does not stop the sale. The gateway being unreachable is our
 * problem, not the visitor's, so they pick their own vehicle type instead.
 */
async function onPlateConfirmed(ctx) {
  const { mobile, customer, session } = ctx;
  const regNo = session.context?.reg_no;
  if (!regNo) return askPlate(ctx);

  await send.text(mobile, t(lang(customer), 'checking_vehicle'));

  const r = await vehicles.resolve(regNo, { customerId: customer.id });
  const vehicle = r.vehicle;

  if (!r.ok) {
    await store.setState(mobile, 'choose_category', { reg_no: regNo, vehicle_id: vehicle.id });
    return send.buttons(mobile,
      'I could not reach the vehicle records service just now.\n\n' +
      'No problem — please tell me your vehicle type and we will continue.',
      [
        { id: 'cat_CAR', title: 'Car / Jeep / SUV' },
        { id: 'cat_BIKE', title: 'Two-wheeler' },
        { id: 'cat_TT', title: 'Tempo / Toofan' },
      ]);
  }

  const category = await pricing.categoryForVehicle(vehicle);
  const desc = vehicles.describe(vehicle);

  await store.setState(mobile, 'choose_date',
    { reg_no: regNo, vehicle_id: vehicle.id, category_id: category.id });

  if (desc) {
    const L = lang(customer);
    await send.text(mobile,
      `${t(L, 'vehicle_found')}\n\n*${p2(regNo)}*\n${desc}\n`
      + `${t(L, 'entry_type')}: *${category.label}*`);
  }
  return askDate(ctx);
}

/**
 * The dates on offer.
 *
 * Closed days are left out rather than shown and refused — a date a customer
 * cannot have is noise on a small screen.
 */
async function askDate(ctx) {
  const { mobile, session, customer } = ctx;
  const L = lang(customer);
  const categoryId = session.context?.category_id;
  const place = await placeFor(ctx);
  const all = await booking.bookableDates(place);

  const open = [];
  for (const d of all) {
    if (open.length >= 9) break;
    if (!await closure.isClosed(place.id, d)) open.push(d);
  }

  if (!open.length) {
    return send.text(mobile,
      'Booking is closed for all available dates at the moment.\n\nPlease try again later.');
  }

  const release = await booking.nextRelease(place);

  // Live availability for every date on the list, in one query.
  const avail = categoryId
    ? await inventory.availabilityForDates(place.id, open, categoryId) : {};

  await store.setState(mobile, 'choose_date', {});
  return send.list(mobile, {
    body: t(L, 'which_day'),
    button: t(L, 'choose_date'),
    sectionTitle: t(L, 'travel_date'),
    /* Each date carries what is actually left in each slot, for THIS customer's
       vehicle type. Showing every type would be four numbers a car owner has to
       read past to find theirs; showing theirs makes the choice for them. */
    rows: open.map((d) => {
      const a = avail[d] || {};
      const am = a['0612']; const pm = a['1206'];
      const part = (label, s) => {
        if (!s) return null;
        if (!s.is_open) return `${label} ${t(L, 'closed_short')}`;
        if (s.available <= 0) return `${label} ✖ FULL`;
        if (s.available <= 15) return `${label} ${s.available} ⚠`;
        return `${label} ${s.available}`;
      };
      const desc = [part('AM', am), part('PM', pm)].filter(Boolean).join('  ·  ');
      return { id: `date_${d}`, title: dayLabel(d), description: desc || undefined };
    }),
    // Say when the next date appears rather than letting someone looking a
    // fortnight out conclude the list simply stops there.
    footer: t(L, 'release_note', { hour: release.hour }),
  });
}

async function onDateChosen(ctx, travelDate) {
  const { mobile, session, customer } = ctx;
  const L = lang(customer);
  const c = session.context || {};
  if (!c.vehicle_id || !c.category_id) return askPlate(ctx);

  // Say it plainly rather than walking them through four more screens to a
  // refusal.
  const existing = await booking.existingForDate(c.vehicle_id, travelDate);
  if (existing && existing.status !== 'held') {
    await store.reset(mobile, 'menu');
    return send.text(mobile,
      `This vehicle already has a ticket for *${pretty(travelDate)}* (${existing.slot_label}).\n\n` +
      `Ticket number: *${existing.ticket_no}*\n\n` +
      'One vehicle can enter once per day. Type *hi* for the menu.');
  }

  const place = await placeFor(ctx);
  const category = await db.one('SELECT * FROM vehicle_categories WHERE id = $1', [c.category_id]);
  await inventory.sweepExpiredHolds();
  const slots = await inventory.availability(place.id, travelDate, c.category_id);

  await store.setState(mobile, 'choose_slot', { travel_date: travelDate });

  const open = slots.filter((s) => s.is_open && s.available > 0);

  /* Every slot is listed with what is left in it, including the ones that are
     full. A slot that silently disappears reads as a bug; a slot that says FULL
     reads as a system that is counting — and it is the moment the capacity
     limit becomes visible to the public, which is half of why it exists. */
  const line = (s) => {
    const name = s.code === '0612'
      ? `${t(L, 'morning')} 6-12` : `${t(L, 'afternoon')} 12-6`;
    if (!s.is_open) return `${name} — ${t(L, 'closed_short')}`;
    if (s.available <= 0) return `❌ ${name} — ${t(L, 'slot_full')}`;
    if (s.available <= 15) return `⚠️ ${name} — ${s.available} ${t(L, 'left')}`;
    return `✅ ${name} — ${s.available} ${t(L, 'left')}`;
  };

  const board = slots.map(line).join('\n');

  if (!open.length) {
    return send.text(mobile,
      `*${pretty(travelDate)}*\n\n${board}\n\n`
      + `${t(L, 'sold_out')}\n\n${t(L, 'type_hi_for_menu')}`);
  }

  return send.buttons(mobile,
    `*${pretty(travelDate)}*\n\n${board}\n\n${t(L, 'choose_time')}`,
    open.slice(0, 3).map((s) => ({
      id: `slot_${s.code}`,
      title: s.code === '0612'
        ? `${t(L, 'morning')} 6-12` : `${t(L, 'afternoon')} 12-6`,
    })),
    { footer: `${category?.label || 'Your vehicle type'} · live availability` });
}

/**
 * Slot chosen: take the hold, show the price, send the payment link.
 *
 * The hold is taken BEFORE the payment page. Otherwise the place could be sold
 * to someone else while this customer is typing a UPI PIN, and they would pay
 * for something that no longer exists.
 */
async function onSlotChosen(ctx, slotCode) {
  const { mobile, customer, session } = ctx;
  const c = session.context || {};
  if (!c.vehicle_id || !c.category_id || !c.travel_date) return askPlate(ctx);

  const place = await placeFor(ctx);
  const slot = await booking.slotByCode(place.id, slotCode);
  const vehicle = await db.one('SELECT * FROM vehicles WHERE id = $1', [c.vehicle_id]);
  const category = await db.one('SELECT * FROM vehicle_categories WHERE id = $1', [c.category_id]);

  const held = await booking.hold({
    customer, vehicle, place, slot, category, travelDate: c.travel_date });

  if (!held.ok) {
    await store.reset(mobile, 'menu');
    const line = {
      sold_out: `That slot filled up just now for *${pretty(c.travel_date)}*.`,
      already_booked: 'This vehicle already has a ticket for that day.',
      closed: 'That slot is closed for booking.',
    }[held.reason] || 'I could not hold that slot.';
    return send.text(mobile, `${line}\n\nType *hi* to try another day or time.`);
  }

  const tk = held.ticket;
  const b = held.breakdown;
  const link = await checkout.linkFor(tk);
  const minutes = await inventory.holdMinutes();

  await store.setState(mobile, 'awaiting_payment', { ticket_id: tk.id });
  await customers.logEvent(customer.id, 'booking_held',
    { ticket_no: tk.ticket_no, reg_no: tk.reg_no, travel_date: tk.travel_date, slot: slot.code });

  const L = lang(customer);
  return send.text(mobile,
    `*${t(L, 'booking_summary')}*\n\n`
    + `${t(L, 'vehicle_number')}: *${p2(tk.reg_no)}*  (${category.label})\n`
    + `${t(L, 'place')}: ${place.name}\n`
    + `${t(L, 'travel_date')}: ${pretty(tk.travel_date)}\n`
    + `${t(L, 'entry_time')}: ${slot.label}\n\n`
    + `${t(L, 'entry_fee')}: ₹${pricing.rs(b.entry_paise)}\n`
    + `${t(L, 'service_fee')}: ₹${pricing.rs(b.platform_paise)}\n`
    + `*${t(L, 'total_pay')}: ₹${pricing.rs(b.total_paise)}*\n\n`
    + `${t(L, 'pay_button')} 👇\n${link}\n\n`
    + `_${t(L, 'held_for_minutes', { n: minutes })}_`);
}

async function onCategoryChosen(ctx, code) {
  const { mobile } = ctx;
  const category = await pricing.categoryByCode(code);
  if (!category) return askPlate(ctx);
  await store.setState(mobile, 'choose_date', { category_id: category.id });
  return askDate(ctx);
}

/* ─────────────────────────────────────────────────────── 2 · download again */

/** Tickets worth showing: paid, not used, and not in the past. */
async function liveTickets(customerId) {
  const r = await db.query(
    `SELECT t.*, s.label AS slot_label, s.code AS slot_code, c.label AS category_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.customer_id = $1 AND t.status = 'paid'
        AND t.travel_date >= CURRENT_DATE
      ORDER BY t.travel_date, s.sort_order
      LIMIT 10`, [customerId]);
  return r.rows;
}

async function askWhichTicket(ctx, action) {
  const { mobile, customer } = ctx;
  const rows = await liveTickets(customer.id);

  if (!rows.length) {
    return menu(ctx, action === 'download'
      ? 'You have no active tickets to download.\n\nWhat would you like to do?'
      : 'You have no tickets that can be postponed.\n\nWhat would you like to do?');
  }

  if (rows.length === 1) {
    return action === 'download' ? sendAgain(ctx, rows[0]) : startPostpone(ctx, rows[0]);
  }

  await store.setState(mobile, action === 'download' ? 'pick_download' : 'pick_postpone', {});
  return send.list(mobile, {
    body: action === 'download'
      ? 'Which ticket would you like?'
      : 'Which ticket would you like to move?',
    button: 'Choose ticket',
    sectionTitle: 'Your tickets',
    rows: rows.map((t) => ({
      id: `${action === 'download' ? 'dl' : 'pp'}_${t.id}`,
      title: `${p2(t.reg_no)} · ${pretty(t.travel_date)}`,
      description: t.slot_label,
    })),
  });
}

async function sendAgain(ctx, ticket) {
  const { mobile } = ctx;

  // The state is committed BEFORE the slow work, not after. Uploading a PDF to
  // Meta takes seconds, and an impatient customer tapping the next thing in the
  // meantime would have their new state overwritten by this one finishing late.
  await store.setState(mobile, 'menu', {});

  await send.text(mobile, 'Sending your ticket…');
  // force: the double-send guard exists for the payment paths, and this is the
  // customer deliberately asking for it again.
  await deliver.sendTicket(ticket.id, { force: true });
}

/* ─────────────────────────────────────────────────────────── 3 · postpone */

/**
 * Moving a ticket to another day.
 *
 * Available to anyone with a live ticket, not only when the hill is closed. A
 * feature that appears only during an emergency is a feature nobody can find
 * during one.
 *
 * The validations, and why each exists:
 *   used            they already went through the gate
 *   past date       nothing to move
 *   move_count      a ticket walked around the calendar forever holds capacity
 *                   it never intends to use
 *   vehicle clash   one vehicle, one ticket per day — still true when moving
 *   sold out        the new day has to actually have room
 */
async function startPostpone(ctx, ticket) {
  const { mobile } = ctx;
  const maxMoves = await settings.num('max_moves_per_ticket', 1);

  if (ticket.status === 'used') {
    return menu(ctx, 'That ticket has already been used at the gate, so it cannot be moved.');
  }
  if (String(ticket.travel_date) < today()) {
    return menu(ctx, 'That ticket was for a date that has passed, so it cannot be moved.');
  }
  if (ticket.move_count >= maxMoves) {
    return menu(ctx,
      `Ticket *${ticket.ticket_no}* has already been moved ${ticket.move_count} time(s), ` +
      'which is the limit.\n\nPlease contact support if you need to change it again.');
  }

  const place = await placeFor(ctx);
  const all = await booking.bookableDates(place);

  // Not the day it is already on, and not a closed day.
  const open = [];
  for (const d of all) {
    if (open.length >= 9) break;
    if (String(d) === String(ticket.travel_date)) continue;
    if (await closure.isClosed(place.id, d)) continue;
    open.push(d);
  }

  if (!open.length) {
    return menu(ctx, 'There are no other dates open at the moment. Please try again later.');
  }

  await store.setState(mobile, 'pp_choose_date', { pp_ticket_id: ticket.id });

  return send.list(mobile, {
    body: `Moving ticket *${ticket.ticket_no}*\n${p2(ticket.reg_no)} · ` +
          `currently ${pretty(ticket.travel_date)}, ${ticket.slot_label}\n\n` +
          'Which day would you like instead?',
    button: 'Choose new date',
    sectionTitle: 'New travel date',
    rows: open.map((d) => ({ id: `ppdate_${d}`, title: dayLabel(d) })),
    footer: 'No extra charge. Your ticket keeps the same number.',
  });
}

async function onPostponeDate(ctx, travelDate) {
  const { mobile, session } = ctx;
  const ticketId = session.context?.pp_ticket_id;
  if (!ticketId) return menu(ctx);

  const t = await booking.byId(ticketId);
  if (!t) return menu(ctx);

  // The rule that outranks everything: one vehicle, one ticket per day.
  const clash = await db.one(
    `SELECT ticket_no FROM tickets
      WHERE vehicle_id = $1 AND travel_date = $2 AND id <> $3
        AND status IN ('held','paid','used')`, [t.vehicle_id, travelDate, t.id]);
  if (clash) {
    return menu(ctx,
      `*${p2(t.reg_no)}* already has ticket *${clash.ticket_no}* for ${pretty(travelDate)}.\n\n` +
      'One vehicle can enter once per day, so please choose another date.');
  }

  const place = await placeFor(ctx);
  await inventory.sweepExpiredHolds();
  const slots = await inventory.availability(place.id, travelDate, t.category_id);
  const open = slots.filter((s) => s.is_open && s.available > 0);

  if (!open.length) {
    return menu(ctx,
      `*${pretty(travelDate)}* is fully booked for your vehicle type.\n\n` +
      'Type *hi* and choose Postpone again to pick another date.');
  }

  await store.setState(mobile, 'pp_choose_slot', { pp_date: travelDate });

  return send.buttons(mobile,
    `*${pretty(travelDate)}*\n\n${kn("choose_time")}
Choose your entry time:`,
    open.slice(0, 3).map((s) => ({
      id: `ppslot_${s.code}`,
      title: s.code === '0612' ? 'Morning 6-12' : 'Afternoon 12-6',
    })),
    { footer: open.map((s) =>
        `${s.code === '0612' ? 'Morning' : 'Afternoon'}: ${s.available} left`).join('  ·  ') });
}

async function onPostponeSlot(ctx, slotCode) {
  const { mobile, session, customer } = ctx;
  const c = session.context || {};
  if (!c.pp_ticket_id || !c.pp_date) return menu(ctx);

  const before = await booking.byId(c.pp_ticket_id);
  const r = await closure.postpone(c.pp_ticket_id, { travelDate: c.pp_date, slotCode });

  if (!r.ok) {
    const line = {
      sold_out: 'That slot filled up while you were choosing.',
      already_booked: `This vehicle already has ticket ${r.ticket_no} for that day.`,
      too_many_moves: 'This ticket has been moved as many times as allowed.',
      already_used: 'That ticket has already been used at the gate.',
      same_day: 'That is the day the ticket is already booked for.',
    }[r.reason] || 'I could not move that ticket.';
    return menu(ctx, `${line}\n\nWhat would you like to do?`);
  }

  const t = await booking.byId(c.pp_ticket_id);
  await store.reset(mobile, 'menu');

  await send.text(mobile,
    '✅ *Ticket moved*\n\n' +
    `Ticket *${t.ticket_no}* · ${p2(t.reg_no)}\n\n` +
    `From: ${pretty(before.travel_date)}, ${before.slot_label}\n` +
    `To: *${pretty(t.travel_date)}, ${t.slot_label}*\n\n` +
    'Your old QR code no longer works. The new one is below — please use that one at the gate.');

  // A new date means a new signature, so the code itself has changed.
  await deliver.sendTicket(t.id, { force: true });
}

/* ────────────────────────────────────────────────── closure: the interruption */

async function offerClosureChoice(ctx, ticket) {
  const { mobile } = ctx;
  const allowRefund = await settings.bool('closure_allow_refund', true);
  const days = await settings.get('refund_working_days', '5-7');

  await store.setState(mobile, 'closure_choice', { pp_ticket_id: ticket.id });

  const buttons = [{ id: `ppstart_${ticket.id}`, title: 'Choose new date' }];
  if (allowRefund) buttons.push({ id: `refund_${ticket.id}`, title: 'Refund me' });

  return send.buttons(mobile,
    '⚠️ *Your travel day has been closed*\n\n' +
    `Ticket *${ticket.ticket_no}* · ${p2(ticket.reg_no)}\n` +
    `${pretty(ticket.travel_date)} · ${ticket.slot_label}\n\n` +
    `Reason: ${ticket.reason}\n\n` +
    'We are sorry for the trouble. You can move your ticket to another day at no extra cost' +
    (allowRefund ? `, or take a full refund (${days} working days).` : '.'),
    buttons);
}

async function doRefund(ctx, ticketId) {
  const { mobile, customer } = ctx;
  const days = await settings.get('refund_working_days', '5-7');
  const t = await booking.byId(ticketId);
  if (!t || t.customer_id !== customer.id) return menu(ctx);

  await send.text(mobile, 'Processing your refund…');
  const r = await closure.refund(ticketId, { reason: 'closure_customer_choice' });

  if (!r.ok) {
    return menu(ctx,
      'I could not process the refund automatically. Our team has been notified and will ' +
      'contact you shortly.\n\nWhat would you like to do?');
  }

  await store.reset(mobile, 'menu');
  return send.text(mobile,
    '✅ *Refund started*\n\n' +
    `Ticket *${t.ticket_no}* has been cancelled.\n` +
    `₹${pricing.rs(t.total_paise)} will reach your original payment method within ` +
    `${days} working days.\n\n` +
    'Type *hi* whenever you want to book again.');
}

/* ─────────────────────────────────────────────────── 4 · support, 5 · feedback */

/**
 * Support and feedback both open a page rather than asking for a paragraph.
 *
 * Typed free text arrived as an undifferentiated blob: no query type to route
 * on, no rating to count. A page gives both, and still takes the same one
 * message from the visitor.
 *
 * The chat fallback remains for the case where the link cannot be sent, so
 * somebody with a problem is never met with silence.
 */
async function webForm(ctx, path, bodyKey, ctaKey, fallback) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  const base = process.env.PUBLIC_BASE_URL;

  if (base) {
    /* Not single use — somebody may have two things to report — but it still expires. */
    const token = flowEndpoint.newToken(customer.id, mobile, path, 24 * 60);
    const r = await send.ctaUrl(mobile, {
      body: t(L, bodyKey),
      label: t(L, ctaKey),
      url: `${base.replace(/\/+$/, '')}/${path}/${token}`,
      footer: 'ServerPe App Solutions',
    });
    if (r?.ok) {
      await store.setState(mobile, 'menu', {});
      return r;
    }
    console.warn('[wa] %s link did not send (%s) — asking in chat instead',
      path, r?.error || 'unknown');
  }
  return fallback();
}

async function askSupport(ctx) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  return webForm(ctx, 'support', 'support_sub', 'menu_support', async () => {
    const cfg = await settings.all();
    await store.setState(mobile, 'support_message', {});
    return send.text(mobile,
      `*${t(L, 'menu_support')}*\n\n${t(L, 'support_placeholder')}\n\n`
      + (cfg.support_mobile ? `${cfg.support_mobile}` : ''));
  });
}

async function onSupportMessage(ctx) {
  const { mobile, customer, text } = ctx;
  await customers.logEvent(customer.id, 'support_request',
    { message: String(text).slice(0, 2000), mobile });
  await store.setState(mobile, 'menu', {});
  return send.text(mobile,
    'Thank you — we have your message and will get back to you on this number.\n\n' +
    'Type *hi* for the menu.');
}

async function askFeedback(ctx) {
  const { mobile, customer } = ctx;
  const L = lang(customer);
  return webForm(ctx, 'feedback', 'feedback_sub', 'menu_feedback', async () => {
    await store.setState(mobile, 'feedback_message', {});
    return send.text(mobile, `*${t(L, 'menu_feedback')}*\n\n${t(L, 'feedback_ask')}`);
  });
}

async function onFeedbackMessage(ctx) {
  const { mobile, customer, text } = ctx;
  await customers.logEvent(customer.id, 'feedback',
    { message: String(text).slice(0, 2000), mobile });
  const L = lang(customer);
  await store.setState(mobile, 'menu', {});
  return send.text(mobile,
    `${t(L, 'feedback_thanks')}\n\n${t(L, 'type_hi_for_menu')}`);
}

/* ───────────────────────────────────────────────────────────────── taps */

async function onChoice(ctx) {
  const { mobile, customer, choice } = ctx;

  /* language */
  if (choice === 'lang_kn' || choice === 'lang_en') {
    const lang = choice === 'lang_en' ? 'en' : 'kn';
    const updated = await customers.setLanguage(customer.id, lang);
    await customers.logEvent(customer.id, 'language_chosen', { language: lang });
    // Carry the updated row forward so the very next message is already in the
    // language just chosen, rather than one message behind.
    return welcome({ ...ctx, customer: updated || { ...customer, language: lang,
      language_asked_at: new Date() } });
  }

  /* consent */
  if (choice === 'consent_yes') {
    await customers.logEvent(customer.id, 'consent_given',
      { channel: 'whatsapp', at: new Date().toISOString() });
    return menu(ctx, t(lang(customer), 'consent_thanks'));
  }
  if (choice === 'consent_policy') {
    const base = process.env.PUBLIC_BASE_URL || '';
    const L = lang(customer);
    await send.text(mobile,
      `*${t(L, 'policy_heading')}*\n\n`
      + (L === 'en' ? policy.SHORT_EN : policy.SHORT_KN)
      + (base ? `\n\n${t(L, 'policy_full')}: ${base}/policy` : ''));
    return send.buttons(mobile, t(L, 'policy_continue'),
      [{ id: 'consent_yes', title: t(L, 'consent_agree') }]);
  }

  /* menu */
  if (choice === 'menu_book')     return startBooking(ctx);
  if (choice === 'menu_download') return askWhichTicket(ctx, 'download');
  if (choice === 'menu_postpone') return askWhichTicket(ctx, 'postpone');
  if (choice === 'menu_support')  return askSupport(ctx);
  if (choice === 'menu_feedback') return askFeedback(ctx);

  /* booking */
  if (choice === 'plate_yes') return onPlateConfirmed(ctx);
  if (choice === 'plate_no')  return askPlate(ctx);
  if (choice.startsWith('place_')) return onPlaceChosen(ctx, choice.slice(6));
  if (choice.startsWith('cat_'))  return onCategoryChosen(ctx, choice.slice(4));
  if (choice.startsWith('date_')) return onDateChosen(ctx, choice.slice(5));
  if (choice.startsWith('slot_')) return onSlotChosen(ctx, choice.slice(5));

  /* download */
  if (choice.startsWith('dl_')) {
    const t = await ownedTicket(customer.id, choice.slice(3));
    return t ? sendAgain(ctx, t) : menu(ctx);
  }

  /* postpone */
  if (choice.startsWith('ppstart_')) {
    const t = await ownedTicket(customer.id, choice.slice(8));
    return t ? startPostpone(ctx, t) : menu(ctx);
  }
  if (choice.startsWith('ppdate_')) return onPostponeDate(ctx, choice.slice(7));
  if (choice.startsWith('ppslot_')) return onPostponeSlot(ctx, choice.slice(7));
  if (choice.startsWith('pp_')) {
    const t = await ownedTicket(customer.id, choice.slice(3));
    return t ? startPostpone(ctx, t) : menu(ctx);
  }

  /* closure */
  if (choice.startsWith('refund_')) return doRefund(ctx, choice.slice(7));

  if (choice === 'book_again' || choice === 'menu') return menu(ctx);

  return menu(ctx);
}

/**
 * A ticket, but only if it belongs to the person asking.
 *
 * Ticket ids appear in button payloads, and a button payload is something a
 * determined person can forge. Ownership is therefore checked on the way out of
 * the database, not assumed from the tap.
 */
async function ownedTicket(customerId, id) {
  if (!/^\d+$/.test(String(id))) return null;
  return db.one(
    `SELECT t.*, s.label AS slot_label, s.code AS slot_code, c.label AS category_label
       FROM tickets t
       JOIN place_slots s ON s.id = t.slot_id
       JOIN vehicle_categories c ON c.id = t.category_id
      WHERE t.id = $1 AND t.customer_id = $2`, [id, customerId]);
}

/**
 * Payment confirmed — send the actual ticket.
 *
 * Called from all three payment paths, so it must be safe to call twice.
 */
async function deliverTicket(ticketId) {
  return deliver.sendTicket(ticketId);
}

module.exports = { handle, deliverTicket, menu, pretty };
