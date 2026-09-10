/**
 * businessCase.js — what a ticket actually earns, and what the platform costs.
 *
 * Every figure the presentation and the proposal quote about money comes from
 * here, computed rather than typed. A slide that says "about seven rupees" and
 * a spreadsheet that says five is the kind of contradiction that ends a meeting
 * badly.
 *
 * THE MARGIN LADDER, AND WHY IT HAS FOUR RUNGS.
 *
 * It is easy — and wrong — to say "we charge Rs.10 and the gateway takes
 * Rs.2.40, so we make Rs.7.60". That figure is CASH RETAINED, not profit,
 * because the GST inside our own fee is not ours: it is collected and remitted.
 * Presenting cash retained as profit to a Deputy Commissioner would be an
 * overstatement of about 20%, and the person who catches it will be the one
 * deciding whether to sign.
 *
 * So the ladder is stated in full:
 *
 *   1. Collected from the visitor        entry + booking fee
 *   2. Passed to the department          the entry fee, untouched
 *   3. Our gross fee                     what is left
 *   4. Less the gateway's charge         taken on the WHOLE amount, including
 *                                        the department's share
 *   5. Less GST on our fee               net of input credit on the gateway's GST
 *   = what the business actually keeps
 *
 * The gateway charging its percentage on the department's money as well as on
 * ours is the single most surprising line here, and it is why the margin is
 * thinner than a first glance suggests.
 */

const { query } = require('./db');
const settings = require('./settings');

/**
 * The full ladder for one ticket.
 *
 * @param entryPaise     the department's fee
 * @param platformPaise  our fee, GST-inclusive
 * @param route          true for the split-settlement model, which costs an
 *                       extra transfer fee on the department's share
 *
 * THE RATES ARE QUOTED EXCLUSIVE OF GST, because that is how Razorpay quotes
 * them. 2.2% plus GST is 2.596%, not 2.2% — a distinction worth about a third
 * of a rupee a ticket, which at this margin is not small.
 */
async function perTicket(entryPaise, platformPaise, { route = false } = {}) {
  const cfg = await settings.all();
  const gstPct = Number(cfg.gst_percent_on_platform || 18);
  const gatewayPct = Number(cfg.gateway_fee_percent || 2.2);
  const transferPct = Number(cfg.route_transfer_percent || 0.25);
  const g = 1 + gstPct / 100;

  const collected = entryPaise + platformPaise;

  /* Our fee, split into the part that is revenue and the part that is tax. */
  const ourBase = Math.round(platformPaise * 100 / (100 + gstPct));
  const gstOnOurFee = platformPaise - ourBase;

  /* The gateway takes its cut of everything that moved, not of our share —
     including the department's entry fee, which is not our money. */
  const gatewayBase = collected * gatewayPct / 100;
  const gatewayGst = gatewayBase * (gstPct / 100);
  const gatewayTotal = Math.round(gatewayBase + gatewayGst);

  /* Route charges again for the split. WHAT IT IS CHARGED ON IS NOT YET
     CONFIRMED — it could be the whole transaction, the department's share, or
     only the amount routed to our own account. Those give very different
     numbers:

         on the whole transaction   Rs.113 x 0.25%  =  28.25 paise
         on the department's share  Rs.100 x 0.25%  =  25.00 paise
         on our own share           Rs. 13 x 0.25%  =   3.25 paise

     So the DEAREST of the three is used. A margin that can only improve once
     the gateway confirms its terms is a margin that can be shown to a
     department without a caveat attached to the number itself; the caveat
     belongs in the footnote, not in the arithmetic.

     WE ABSORB IT either way. The department must receive its entry fee to the
     rupee, and a settlement arriving 33 paise short is a reconciliation problem
     worth far more than the 33 paise. */
  const transferBase = route ? collected * transferPct / 100 : 0;
  const transferGst = transferBase * (gstPct / 100);
  const transferTotal = Math.round(transferBase + transferGst);

  /* We are GST-registered, so the tax the gateway charged us is an input
     credit against the tax we owe on our own fee. */
  const inputCredit = Math.round(gatewayGst + transferGst);
  const gstPayable = Math.max(0, gstOnOurFee - inputCredit);

  const charges = gatewayTotal + transferTotal;
  const cashRetained = platformPaise - charges;
  const netProfit = cashRetained - gstPayable;

  return {
    route,
    collected,
    entry_paise: entryPaise,
    platform_paise: platformPaise,

    our_base_paise: ourBase,
    gst_on_our_fee_paise: gstOnOurFee,

    gateway_paise: gatewayTotal,
    gateway_gst_paise: Math.round(gatewayGst),
    transfer_paise: transferTotal,
    transfer_gst_paise: Math.round(transferGst),
    charges_paise: charges,

    input_credit_paise: inputCredit,
    gst_payable_paise: gstPayable,

    cash_retained_paise: cashRetained,
    net_profit_paise: netProfit,

    gst_percent: gstPct,
    gateway_percent: gatewayPct,
    transfer_percent: transferPct,
    // What the charges actually come to once GST is added on.
    gateway_effective: Number((gatewayPct * g).toFixed(3)),
    transfer_effective: Number((transferPct * g).toFixed(3)),
  };
}

/** Both settlement models side by side — the comparison the department needs. */
async function compareSettlement(entryPaise, platformPaise) {
  const direct = await perTicket(entryPaise, platformPaise, { route: false });
  const split = await perTicket(entryPaise, platformPaise, { route: true });
  return {
    direct, split,
    cost_of_split_paise: direct.net_profit_paise - split.net_profit_paise,
  };
}

/**
 * The same ladder at a year's volume.
 *
 * Deliberately quoted at a range of occupancy rather than at capacity: no hill
 * runs full every day, and a projection that assumes it does invites exactly
 * the question you do not want.
 */
async function annual({ entryPaise, platformPaise, vehiclesPerDay, days = 300, route = false }) {
  const t = await perTicket(entryPaise, platformPaise, { route });
  const at = (occupancy) => {
    const tickets = Math.round(vehiclesPerDay * occupancy * days);
    return {
      occupancy: Math.round(occupancy * 100),
      tickets,
      department_paise: tickets * t.entry_paise,
      collected_paise: tickets * t.collected,
      net_profit_paise: tickets * t.net_profit_paise,
    };
  };
  return { per_ticket: t, scenarios: [at(0.25), at(0.5), at(0.75), at(1)] };
}

/**
 * Tatkal — a reserved slice of each slot, sold at a higher entry fee on peak
 * days only.
 *
 * WHO GETS THE UPLIFT. The entry fee belongs to the department and only the
 * department may set it. So raising it from Rs. 100 to Rs. 150 on a reserved
 * allocation is EXTRA REVENUE FOR THE DEPARTMENT, not for ServerPe — every
 * rupee of the Rs. 50 uplift is remitted like any other entry fee. ServerPe
 * earns only its usual percentage, which rises because the base did.
 *
 * That is also why this is worth proposing: it is the one item on the roadmap
 * that pays the department rather than costing it, and it answers a real
 * problem — the visitor who has driven three hours and finds the day full.
 *
 * The reserve must stay small and be published. A large unpublished reserve is
 * indistinguishable from selling around the capacity limit the system exists
 * to enforce, and would deserve the objection it would get.
 *
 * @param capacityPerSlot vehicles of this category per slot
 * @param slots           slots per day
 * @param entryPaise      the ordinary entry fee
 * @param tatkalPaise     the tatkal entry fee
 * @param reservePct      share of each slot held back
 * @param peakDays        days a year it applies (weekends and holidays only)
 */
async function tatkal({ capacityPerSlot, slots, entryPaise, tatkalPaise,
  reservePct = 10, peakDays = 110, feePercent = null } = {}) {
  const pct = feePercent !== null ? Number(feePercent)
    : Number(await settings.get('platform_fee_percent') || 13);

  const perSlot = Math.floor(capacityPerSlot * (reservePct / 100));
  const perDay = perSlot * slots;
  const upliftPaise = tatkalPaise - entryPaise;

  // ServerPe's fee follows the base it is charged on, so it rises with the
  // entry fee rather than being a second charge on top of the uplift.
  const feeOrdinary = Math.round(entryPaise * pct / 100);
  const feeTatkal = Math.round(tatkalPaise * pct / 100);

  return {
    reserve_percent: reservePct,
    per_slot: perSlot,
    per_day: perDay,
    peak_days: peakDays,
    tickets_per_year: perDay * peakDays,

    entry_paise: entryPaise,
    tatkal_entry_paise: tatkalPaise,
    uplift_paise: upliftPaise,

    // The department's side — the reason to propose it at all.
    department_extra_per_day_paise: perDay * upliftPaise,
    department_extra_per_year_paise: perDay * peakDays * upliftPaise,

    // Ours, stated so nobody has to ask.
    fee_ordinary_paise: feeOrdinary,
    fee_tatkal_paise: feeTatkal,
    platform_extra_per_ticket_paise: feeTatkal - feeOrdinary,
    platform_extra_per_year_paise: perDay * peakDays * (feeTatkal - feeOrdinary),

    fee_percent: pct,
  };
}

/** What has been put into the platform, grouped by how it recurs. */
async function investment() {
  const rows = (await query(
    'SELECT * FROM investment_items ORDER BY sort_order')).rows;

  const sum = (kind, field) => rows.filter((r) => r.kind === kind)
    .reduce((n, r) => n + r[field], 0);

  return {
    rows,
    one_time: { min: sum('one_time', 'expense_min'), max: sum('one_time', 'expense_max') },
    annual: { min: sum('annual', 'expense_min'), max: sum('annual', 'expense_max') },
    // What has actually been committed, as against what these things cost.
    invested_one_time: { min: sum('one_time', 'invested_min'), max: sum('one_time', 'invested_max') },
    invested_annual: { min: sum('annual', 'invested_min'), max: sum('annual', 'invested_max') },
    needed: rows.filter((r) => r.status === 'needed' || r.status === 'planned'),
  };
}

const revenueModels = async () =>
  (await query('SELECT * FROM revenue_models ORDER BY sort_order')).rows;

/**
 * The AMC range, and what it is set against.
 *
 * Quoted as a range because a single gate and a busy multi-gate site are not
 * the same commitment, and because a department that is told one number will
 * treat it as the only number.
 */
async function amc() {
  const cfg = await settings.all();
  const min = Number(cfg.amc_gate_min_paise || 9000000) / 100;
  const max = Number(cfg.amc_gate_max_paise || 15000000) / 100;
  const proposed = Number(cfg.amc_per_gate_annual_paise || 12000000) / 100;
  const inv = await investment();

  return {
    min, max, proposed,
    // The honest justification: the AMC covers the recurring cost of keeping the
    // platform running, plus the support commitment. It is not a margin.
    annual_cost_min: inv.annual.min,
    annual_cost_max: inv.annual.max,
    covers_cost_at: inv.annual.max <= proposed,
    tiers: [
      { label: 'Single gate, one site', amount: proposed,
        note: 'Support during gate hours, updates, hosting, training.' },
      { label: 'Each additional gate at the same site', amount: Math.round(proposed * 0.4),
        note: 'Shares the same server and the same support window.' },
      { label: 'Each additional site', amount: Math.round(proposed * 0.75),
        note: 'Its own configuration, staff and reports; shared infrastructure.' },
    ],
  };
}

const rs = (paise) => Number((paise / 100).toFixed(2));
const inr = (n) => Number(n).toLocaleString('en-IN');

module.exports = { perTicket, compareSettlement, annual, tatkal, investment, revenueModels, amc, rs, inr };
