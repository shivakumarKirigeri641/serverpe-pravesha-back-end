/**
 * reportPdf.js — the printable report.
 *
 * Drawn from the same dataset as the screen and the workbook, on the same
 * letterhead as the pass, for a reader who has it on paper in a meeting:
 *
 *   1. Executive summary  — the handful of numbers somebody quotes
 *   2. Visitors           — who came, new and returning
 *   3. Vehicles           — by type, with a chart
 *   4. Slots              — capacity against use
 *   5. Staff              — checks and speed
 *   6. Negative activity  — no-shows, invalid and duplicate passes, overrides
 *   7. Financial summary  — collection and how it divides
 *   8. Graphs             — traffic over the period and by hour
 *   9. When they arrive   — weekday by hour, as a heat map
 *  10. Where they come from — state and registering district of every vehicle
 *  11. Staff day by day   — who admitted how many, each day
 *  12. Detailed tables    — day by day
 *
 * CHARTS ARE VECTOR, drawn with PDFKit's own primitives rather than pasted as
 * images of a web chart: they stay sharp when printed or zoomed, and add almost
 * nothing to the file size.
 *
 * Every page carries the Report ID and when it was generated, so a single page
 * photographed out of the pack still says what it belongs to.
 */

const { C, newDoc, toBuffer, header, footer, istDateTime, longDate } = require('./common');

const inr = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-IN');
const pc = (n) => `${Number(n || 0).toFixed(1)}%`;

const PALETTE = ['#00a884', '#075e54', '#e08700', '#667781', '#128c7e', '#b42318'];

function makeKit(doc) {
  const W = doc.page.width;
  const M = doc.page.margins.left;
  const CW = W - 2 * M;
  const bottomLimit = () => doc.page.height - 70;

  const kit = {
    W, M, CW, y: 0,

    newPage() {
      doc.addPage();
      kit.y = doc.page.margins.top;
    },

    ensure(space) {
      if (kit.y + space > bottomLimit()) kit.newPage();
    },

    /* `keep` is the space the first thing under the heading needs, so a heading
       is never left alone at the foot of a page with its content overleaf. */
    section(title, subtitle, { keep = 90 } = {}) {
      kit.ensure(keep);
      doc.save().rect(M, kit.y, 4, 16).fill(C.accent).restore();
      doc.font('B').fontSize(12.5).fillColor(C.ink).text(title, M + 10, kit.y + 1, { width: CW - 10, lineBreak: false });
      kit.y += 19;
      if (subtitle) {
        doc.font('R').fontSize(8).fillColor(C.muted).text(subtitle, M + 10, kit.y, { width: CW - 10 });
        kit.y = doc.y + 4;
      }
      kit.y += 4;
    },

    /** A row of figure tiles. */
    tiles(items, { cols = 4, h = 52 } = {}) {
      const gap = 8;
      const tw = (CW - gap * (cols - 1)) / cols;
      for (let i = 0; i < items.length; i += cols) {
        kit.ensure(h + gap);
        items.slice(i, i + cols).forEach((it, j) => {
          const x = M + j * (tw + gap);
          doc.save().roundedRect(x, kit.y, tw, h, 6).fill(C.shade).restore();
          doc.save().rect(x, kit.y, 3, h).fill(it.tone || C.accent).restore();
          doc.font('R').fontSize(7.5).fillColor(C.muted).text(it.label.toUpperCase(), x + 10, kit.y + 8, { width: tw - 16, lineBreak: false, characterSpacing: 0.4 });
          doc.font('B').fontSize(16).fillColor(C.ink).text(it.value, x + 10, kit.y + 20, { width: tw - 16, lineBreak: false });
          if (it.sub) doc.font('R').fontSize(7).fillColor(C.muted).text(it.sub, x + 10, kit.y + 39, { width: tw - 16, lineBreak: false });
        });
        kit.y += h + gap;
      }
      kit.y += 4;
    },

    /**
     * A table that breaks across pages, repeating its header, with right-aligned
     * numbers and an optional bold totals row.
     */
    table(columns, rows, { totals = null, fs = 8, rowH = 16 } = {}) {
      const widths = columns.map((c) => c.w * CW);
      const drawHead = () => {
        doc.save().rect(M, kit.y, CW, rowH + 2).fill(C.brand).restore();
        let x = M;
        columns.forEach((c, i) => {
          doc.font('B').fontSize(fs - 0.5).fillColor('#ffffff')
             .text(c.h, x + 5, kit.y + 5, { width: widths[i] - 10, align: c.right ? 'right' : 'left', lineBreak: false });
          x += widths[i];
        });
        kit.y += rowH + 2;
      };

      kit.ensure(rowH * 3);
      drawHead();
      rows.forEach((r, ri) => {
        if (kit.y + rowH > bottomLimit()) { kit.newPage(); drawHead(); }
        if (ri % 2 === 1) doc.save().rect(M, kit.y, CW, rowH).fill(C.shade).restore();
        let x = M;
        columns.forEach((c, i) => {
          const v = typeof c.v === 'function' ? c.v(r) : r[c.k];
          doc.font('R').fontSize(fs).fillColor(C.ink)
             .text(v === null || v === undefined ? '—' : String(v), x + 5, kit.y + 4.5, { width: widths[i] - 10, align: c.right ? 'right' : 'left', lineBreak: false });
          x += widths[i];
        });
        kit.y += rowH;
      });
      if (totals) {
        if (kit.y + rowH > bottomLimit()) { kit.newPage(); drawHead(); }
        doc.save().rect(M, kit.y, CW, rowH + 1).fill('#dcf5e8').restore();
        let x = M;
        columns.forEach((c, i) => {
          const v = typeof totals === 'function' ? totals(c, i) : totals[c.k];
          doc.font('B').fontSize(fs).fillColor(C.ink)
             .text(i === 0 ? 'Total' : (v === undefined || v === null ? '' : String(v)), x + 5, kit.y + 5, { width: widths[i] - 10, align: c.right ? 'right' : 'left', lineBreak: false });
          x += widths[i];
        });
        kit.y += rowH + 1;
      }
      doc.save().moveTo(M, kit.y).lineTo(M + CW, kit.y).lineWidth(0.6).stroke(C.line).restore();
      kit.y += 12;
    },

    /** Vertical bars with a light grid. `series` is [{ label, value }] or stacked. */
    bars({ title, data, keys, labels, colours = PALETTE, h = 150, format = num, stacked = false }) {
      kit.ensure(h + 50);
      doc.font('B').fontSize(9).fillColor(C.ink).text(title, M, kit.y, { width: CW, lineBreak: false });
      kit.y += 14;

      const left = M + 34;
      const width = CW - 34;
      const top = kit.y;
      const bottom = top + h;
      const totalsPer = data.map((d) => (stacked ? keys.reduce((s, k) => s + Number(d[k] || 0), 0) : Math.max(...keys.map((k) => Number(d[k] || 0)))));
      const max = Math.max(1, ...totalsPer);
      const nice = Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));

      for (let i = 0; i <= 4; i += 1) {
        const gy = bottom - (h * i) / 4;
        doc.save().moveTo(left, gy).lineTo(left + width, gy).lineWidth(0.4).stroke(C.line).restore();
        doc.font('R').fontSize(6.5).fillColor(C.muted).text(format((nice * i) / 4), M, gy - 3.5, { width: 30, align: 'right', lineBreak: false });
      }

      const slot = width / Math.max(1, data.length);
      const groupW = Math.min(slot * 0.72, 40);
      const every = Math.ceil(data.length / 16);

      data.forEach((d, i) => {
        const cx = left + slot * i + (slot - groupW) / 2;
        if (stacked) {
          let acc = 0;
          keys.forEach((k, ki) => {
            const v = Number(d[k] || 0);
            const bh = (v / nice) * h;
            doc.save().rect(cx, bottom - acc - bh, groupW, bh).fill(colours[ki % colours.length]).restore();
            acc += bh;
          });
        } else {
          const bw = groupW / keys.length;
          keys.forEach((k, ki) => {
            const v = Number(d[k] || 0);
            const bh = (v / nice) * h;
            doc.save().rect(cx + ki * bw, bottom - bh, bw - 1, bh).fill(colours[ki % colours.length]).restore();
          });
        }
        if (i % every === 0) {
          doc.font('R').fontSize(6.5).fillColor(C.muted)
             .text(d.label, left + slot * i - 6, bottom + 3, { width: slot + 12, align: 'center', lineBreak: false });
        }
      });
      kit.y = bottom + 14;

      if (labels) {
        let lx = left;
        labels.forEach((l, i) => {
          doc.save().rect(lx, kit.y + 2, 7, 7).fill(colours[i % colours.length]).restore();
          doc.font('R').fontSize(7.5).fillColor(C.ink).text(l, lx + 10, kit.y + 1, { lineBreak: false });
          lx += doc.widthOfString(l) + 26;
        });
        kit.y += 14;
      }
      kit.y += 8;
    },

    /** One horizontal bar split into shares, with a legend of amounts. */
    split({ title, parts, total }) {
      kit.ensure(90);
      doc.font('B').fontSize(9).fillColor(C.ink).text(title, M, kit.y, { width: CW, lineBreak: false });
      kit.y += 14;
      let x = M;
      const h = 18;
      parts.forEach((p, i) => {
        const w = total ? (p.value / total) * CW : 0;
        if (w > 0) doc.save().rect(x, kit.y, w, h).fill(p.colour || PALETTE[i % PALETTE.length]).restore();
        x += w;
      });
      kit.y += h + 8;
      const colW = CW / Math.min(parts.length, 3);
      parts.forEach((p, i) => {
        const cx = M + (i % 3) * colW;
        const cy = kit.y + Math.floor(i / 3) * 24;
        doc.save().rect(cx, cy + 2, 8, 8).fill(p.colour || PALETTE[i % PALETTE.length]).restore();
        doc.font('R').fontSize(7.5).fillColor(C.muted).text(p.label, cx + 12, cy, { width: colW - 16, lineBreak: false });
        doc.font('B').fontSize(9).fillColor(C.ink)
           .text(`${inr(p.value)}  ·  ${total ? pc((p.value / total) * 100) : '—'}`, cx + 12, cy + 10, { width: colW - 16, lineBreak: false });
      });
      kit.y += Math.ceil(parts.length / 3) * 24 + 10;
    },

    /**
     * A grid of shaded cells — weekday down, hour across.
     *
     * Printed rather than plotted, because the question it answers is "when do
     * we need people at the barrier?" and that is read off a grid at a glance.
     * Shading is one colour at varying strength rather than a rainbow: a report
     * is photocopied in black and white more often than anybody admits, and a
     * single hue still reads correctly in grey.
     */
    heat({ title, rows, hours, max, valueOf, format = num }) {
      const labelW = 62;
      const cellW = (CW - labelW) / hours.length;
      const cellH = 15;
      kit.ensure(34 + rows.length * cellH + 26);
      doc.font('B').fontSize(9).fillColor(C.ink).text(title, M, kit.y, { width: CW, lineBreak: false });
      kit.y += 14;

      /* The hours across the top. */
      hours.forEach((h, i) => {
        doc.font('R').fontSize(6).fillColor(C.muted)
           .text(h.short, M + labelW + i * cellW, kit.y, { width: cellW, align: 'center', lineBreak: false });
      });
      kit.y += 10;

      rows.forEach((r) => {
        doc.font('R').fontSize(7.5).fillColor(C.muted).text(r.label, M, kit.y + 4, { width: labelW - 4, lineBreak: false });
        hours.forEach((h, i) => {
          const v = valueOf(r, h);
          const strength = max > 0 ? v / max : 0;
          const x = M + labelW + i * cellW;
          if (strength > 0) {
            doc.save().opacity(0.12 + strength * 0.88).rect(x, kit.y, cellW - 1, cellH - 1).fill(C.accent).restore();
          } else {
            doc.save().rect(x, kit.y, cellW - 1, cellH - 1).fill('#f2f5f5').restore();
          }
          if (v > 0 && cellW > 17) {
            /* Dark on a pale cell, white once the cell is too dark to read through. */
            doc.font('R').fontSize(5.5).fillColor(strength > 0.55 ? '#ffffff' : C.ink)
               .text(format(v), x, kit.y + 5, { width: cellW - 1, align: 'center', lineBreak: false });
          }
        });
        kit.y += cellH;
      });
      kit.y += 6;
      doc.font('R').fontSize(7).fillColor(C.muted)
         .text('Darker means busier. Each cell is the average number of vehicles admitted in that hour on that weekday.', M, kit.y, { width: CW });
      kit.y = doc.y + 8;
    },

    note(text) {
      kit.ensure(24);
      doc.font('R').fontSize(7.5).fillColor(C.muted).text(text, M, kit.y, { width: CW });
      kit.y = doc.y + 8;
    },
  };
  return kit;
}

async function render(report, { reportNo, generatedAt, generatedBy, settings = {} }) {
  const p = report.period;
  const s = report.summary;
  const f = report.finance;
  const kindText = { daily: 'DAILY REPORT', weekly: 'WEEKLY REPORT', monthly: 'MONTHLY REPORT', custom: 'PERIOD REPORT' }[p.kind];
  const periodText = p.from === p.to ? longDate(p.from) : `${longDate(p.from)} – ${longDate(p.to)}`;

  const doc = newDoc({ title: `Pravesha ${kindText.toLowerCase()} ${reportNo}`, subject: periodText });
  const kit = makeKit(doc);

  kit.y = header(doc, {
    heading: `${settings.product_name || 'Pravesha'} — ${settings.product_tagline || 'Entry made simple.'}`,
    dept: 'Department of Tourism, Government of Karnataka',
    title: kindText,
    chip: reportNo,
  });

  /* Period band */
  doc.font('B').fontSize(11).fillColor(C.ink).text(periodText, kit.M, kit.y, { width: kit.CW * 0.7, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(C.muted)
     .text(`${p.days} day${p.days === 1 ? '' : 's'}${p.partial ? ' · to date' : ''} · operations by travel date, money by payment date`,
       kit.M, kit.y + 15, { width: kit.CW, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(C.muted)
     .text(`Generated ${istDateTime(generatedAt)}${generatedBy ? ` by ${generatedBy}` : ''}`, kit.M + kit.CW * 0.5, kit.y + 2, { width: kit.CW * 0.5, align: 'right', lineBreak: false });
  kit.y += 34;

  /* 1. Executive summary */
  kit.section('1. Executive summary');
  kit.tiles([
    { label: 'Bookings', value: num(s.bookings), sub: `${pc(s.occupancy)} of capacity` },
    { label: 'Entries', value: num(s.entries), sub: `${pc(s.showUpRate)} of bookings` },
    { label: 'Visitors', value: num(s.visitors), sub: `${num(report.visitors.new)} new` },
    { label: 'Collected', value: inr(f.collected), sub: `${num(f.payments)} payments`, tone: C.brand },
    { label: 'Skipped', value: num(s.skipped), sub: `${pc(s.noShowRate)} no-show`, tone: '#e08700' },
    { label: 'Invalid passes', value: num(s.invalid), sub: `${pc(s.invalidRate)} of look-ups`, tone: '#b42318' },
    { label: 'Duplicates', value: num(s.duplicate), sub: `${pc(s.duplicateRate)} of look-ups`, tone: '#b42318' },
    { label: 'Net Pravesha', value: inr(f.netPravesha), sub: 'after GST and gateway', tone: C.brand },
  ]);

  const hi = report.peaks.highestDay;
  const lo = report.peaks.lowestDay;
  kit.note([
    hi && p.days > 1 ? `Busiest day ${longDate(hi.day)} with ${num(hi.entries)} entries; quietest ${longDate(lo.day)} with ${num(lo.entries)}.` : null,
    report.peaks.peakHour ? `Peak hour ${report.peaks.peakHour.label} (${num(report.peaks.peakHour.entries)} entries).` : null,
    `Average ${num(s.averagePerDay)} entries a day.`,
    report.visitors.growth !== null ? `Visitors ${report.visitors.growth >= 0 ? 'up' : 'down'} ${pc(Math.abs(report.visitors.growth))} on the previous ${p.days}-day period.` : null,
  ].filter(Boolean).join(' '));

  /* 2. Visitors */
  kit.section('2. Visitor statistics', 'A visitor is a WhatsApp number. Returning means they had entered before this period began.');
  kit.tiles([
    { label: 'Visitors', value: num(report.visitors.total) },
    { label: 'New', value: num(report.visitors.new) },
    { label: 'Returning', value: num(report.visitors.returning), sub: `${pc(report.visitors.returningShare)} of visitors` },
    { label: 'More than once', value: num(report.visitors.repeatWithinPeriod), sub: 'within this period' },
  ]);

  /* 3. Vehicles */
  kit.section('3. Vehicle statistics', 'By travel date. Pass value is the department entry fee plus the Pravesha service fee.');
  kit.table([
    { h: 'Vehicle type', k: 'label', w: 0.28 },
    { h: 'Passes', k: 'passes', w: 0.11, right: true, v: (r) => num(r.passes) },
    { h: 'Entries', k: 'entries', w: 0.11, right: true, v: (r) => num(r.entries) },
    { h: 'Share', k: 'shareOfEntries', w: 0.1, right: true, v: (r) => pc(r.shareOfEntries) },
    { h: 'Pass value', k: 'passValue', w: 0.14, right: true, v: (r) => inr(r.passValue) },
    { h: 'Department', k: 'department', w: 0.13, right: true, v: (r) => inr(r.department) },
    { h: 'Service fee', k: 'serviceFee', w: 0.13, right: true, v: (r) => inr(r.serviceFee) },
  ], report.vehicles, {
    totals: {
      passes: num(report.vehicles.reduce((a, v) => a + v.passes, 0)),
      entries: num(report.vehicles.reduce((a, v) => a + v.entries, 0)),
      shareOfEntries: '100%',
      passValue: inr(report.vehicles.reduce((a, v) => a + v.passValue, 0)),
      department: inr(report.vehicles.reduce((a, v) => a + v.department, 0)),
      serviceFee: inr(report.vehicles.reduce((a, v) => a + v.serviceFee, 0)),
    },
  });
  kit.bars({
    title: 'Entries by vehicle type',
    data: report.vehicles.map((v) => ({ label: v.label.split(' ')[0], entries: v.entries })),
    keys: ['entries'], h: 110,
  });

  /* 4. Slots */
  kit.section('4. Slot statistics', 'Capacity is the places offered across every day of the period.');
  kit.table([
    { h: 'Slot', k: 'label', w: 0.34 },
    { h: 'Capacity', k: 'capacity', w: 0.13, right: true, v: (r) => num(r.capacity) },
    { h: 'Booked', k: 'booked', w: 0.13, right: true, v: (r) => num(r.booked) },
    { h: 'Entered', k: 'entered', w: 0.13, right: true, v: (r) => num(r.entered) },
    { h: 'Occupancy', k: 'occupancy', w: 0.13, right: true, v: (r) => pc(r.occupancy) },
    { h: 'Show-up', k: 'showUp', w: 0.14, right: true, v: (r) => pc(r.showUp) },
  ], report.slots);

  /* 5. Staff */
  kit.section('5. Staff statistics', 'Check time is measured by the gate app, from opening a pass to recording the entry.');
  if (report.staff.length) {
    kit.table([
      { h: 'Staff', k: 'name', w: 0.24 },
      { h: 'Checks', k: 'checks', w: 0.1, right: true, v: (r) => num(r.checks) },
      { h: 'Valid', k: 'valid', w: 0.1, right: true, v: (r) => num(r.valid) },
      { h: 'Invalid', k: 'invalid', w: 0.1, right: true, v: (r) => num(r.invalid) },
      { h: 'Duplicate', k: 'duplicate', w: 0.11, right: true, v: (r) => num(r.duplicate) },
      { h: 'Avg check', k: 'averageMs', w: 0.12, right: true, v: (r) => (r.averageMs === null ? '—' : `${(r.averageMs / 1000).toFixed(1)} s`) },
      { h: 'Fastest', k: 'fastestMs', w: 0.1, right: true, v: (r) => (r.fastestMs === null ? '—' : `${(r.fastestMs / 1000).toFixed(1)} s`) },
      { h: 'Peak hour', k: 'peak', w: 0.13, right: true, v: (r) => (r.peakHour ? r.peakHour.label : '—') },
    ], report.staff);
  } else {
    kit.note('No gate checks were recorded in this period.');
  }

  /* 6. Negative activity */
  kit.section('6. Invalid and negative activity', 'What was refused or went unused. Each is a count of events, not of visitors.');
  kit.tiles([
    { label: 'Skipped (no-show)', value: num(s.skipped), sub: `${pc(s.noShowRate)} of bookings`, tone: '#e08700' },
    { label: 'Abandoned payment', value: num(s.abandoned), sub: 'place held, never paid', tone: '#e08700' },
    { label: 'Invalid passes', value: num(s.invalid), sub: 'wrong day, gate, unpaid, unknown', tone: '#b42318' },
    { label: 'Duplicates', value: num(s.duplicate), sub: 'same pass presented twice', tone: '#b42318' },
    { label: 'Admitted outside slot', value: num(s.admittedAnyway), sub: 'on a staff member’s authority', tone: '#e08700' },
    { label: 'Invalid attempt rate', value: pc(s.invalidRate), sub: `of ${num(s.lookups)} look-ups`, tone: '#b42318' },
  ], { cols: 3 });

  /* 7. Financial summary */
  kit.section('7. Financial summary', 'By payment date — the basis that reconciles with the bank.');
  kit.split({
    title: 'How the money collected divides',
    total: f.collected,
    parts: [
      { label: 'Tourism Department', value: f.department, colour: '#075e54' },
      { label: 'Pravesha net revenue', value: Math.max(0, f.netPravesha), colour: '#00a884' },
      { label: `GST (${f.gstPercent}% within service fee)`, value: f.gst, colour: '#e08700' },
      { label: 'Payment gateway charges', value: f.gateway || 0, colour: '#667781' },
    ],
  });
  kit.table([
    { h: 'Line', k: 'label', w: 0.7 },
    { h: 'Amount', k: 'value', w: 0.3, right: true },
  ], [
    { label: 'Total collected from visitors', value: inr(f.collected) },
    { label: 'Tourism Department (entry fees)', value: inr(f.department) },
    { label: `Pravesha service fee (${f.serviceFeePercent}%)`, value: inr(f.serviceFee) },
    { label: `   less GST within the service fee (${f.gstPercent}%)`, value: `− ${inr(f.gst)}` },
    { label: '   less payment gateway charges', value: f.gateway === null ? 'not reported' : `− ${inr(f.gateway)}` },
    { label: 'Net Pravesha revenue', value: inr(f.netPravesha) },
    { label: `Refunds (${num(f.refundCount)})`, value: inr(f.refunds) },
    { label: 'Collected after refunds', value: inr(f.netCollected) },
  ]);

  /* 8. Graphs */
  kit.section('8. Graphs', null, { keep: 200 });
  if (report.daily.length > 1) {
    kit.bars({
      title: 'Entries by day, by vehicle type',
      data: report.daily.map((d) => ({ label: d.day.slice(8), bikes: d.bikes, cars: d.cars, toofans: d.toofans, tts: d.tts })),
      keys: ['bikes', 'cars', 'toofans', 'tts'], labels: ['Bike', 'Car', 'Toofan', 'TT'], stacked: true, h: 140,
    });
    kit.bars({
      title: 'Money collected by day (₹)',
      data: report.daily.map((d) => ({ label: d.day.slice(8), department: d.department, fee: d.serviceFee })),
      keys: ['department', 'fee'], labels: ['Tourism Department', 'Pravesha service fee'], colours: ['#075e54', '#00a884'],
      stacked: true, h: 130, format: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))),
    });
  }
  if (report.weekly.length > 1) {
    kit.bars({
      title: 'Entries by week',
      data: report.weekly.map((w) => ({
        label: new Date(`${w.week}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
        entries: w.entries,
      })),
      keys: ['entries'], h: 100,
    });
  }
  if (report.hours.length) {
    /* Every hour the gates are open, empty ones included: an hour missing from
       the axis looks like an hour that does not exist, not a quiet one. */
    const byHour = Object.fromEntries(report.hours.map((h) => [h.hour, h.entries]));
    const lo = Math.min(6, ...report.hours.map((h) => h.hour));
    const hiH = Math.max(18, ...report.hours.map((h) => h.hour));
    const allHours = [];
    for (let h = lo; h <= hiH; h += 1) allHours.push({ label: `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`, entries: byHour[h] || 0 });
    kit.bars({
      title: 'Entries by hour of day',
      data: allHours,
      keys: ['entries'], colours: ['#128c7e'], h: 110,
    });
  }

  /* 9. When vehicles actually arrive — the roster question. */
  const pat = report.patterns;
  if (pat && pat.total > 0) {
    kit.section('9. When they arrive', 'Averages across this period, by weekday and hour. This is the shape a staff roster has to match.', { keep: 210 });
    /* Only the hours the gates were actually used, so the grid is readable. */
    const used = pat.byHour.filter((h) => h.entries > 0).map((h) => h.hour);
    const lo = Math.min(6, ...used);
    const hi = Math.max(18, ...used);
    const hours = [];
    for (let h = lo; h <= hi; h += 1) {
      hours.push({ hour: h, short: `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}` });
    }
    kit.heat({
      title: 'Vehicles admitted — average per hour, by weekday',
      rows: pat.rows.map((r) => ({ label: `${r.day.slice(0, 3)} (${r.days})`, hours: r.hours })),
      hours,
      max: pat.maxAverage,
      valueOf: (r, h) => r.hours[h.hour]?.average || 0,
      format: (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1)),
    });
    if (pat.busiest) {
      kit.tiles([
        { label: 'Busiest hour of the week', value: `${pat.busiest.day.slice(0, 3)} ${pat.busiest.label}`, sub: `${num(pat.busiest.entries)} admitted` },
        { label: 'Busiest weekday', value: pat.busiestDay ? pat.busiestDay.day : '—',
          sub: pat.busiestDay ? `${num(pat.busiestDay.entries)} across ${pat.busiestDay.days} such day(s)` : '' },
      ], { cols: 2 });
    }
  }

  /* 10. Where the vehicles are registered. */
  const org = report.origins;
  if (org && org.vehicles > 0) {
    kit.section('10. Where they come from',
      'From the number plate and, where a registration certificate has been fetched, the office that issued it. '
      + 'Counted by vehicle: one that came up nine times counts once.', { keep: 200 });
    kit.tiles([
      { label: 'Distinct vehicles', value: num(org.vehicles), sub: `${num(org.entries)} arrivals between them` },
      { label: 'Home state', value: org.home ? org.home.name : '—', sub: org.home ? `${pc(org.home.share)} of vehicles` : '' },
      { label: 'From elsewhere', value: num(org.fromOutside),
        sub: `${pc(org.vehicles ? (org.fromOutside / org.vehicles) * 100 : 0)} from another state or UT`, tone: '#e08700' },
      { label: 'States and UTs', value: num(org.states.length), sub: 'with at least one vehicle' },
    ]);
    if (org.states.length > 1) {
      kit.bars({
        title: 'Vehicles by state (top 8)',
        data: org.states.slice(0, 8).map((st) => ({ label: st.code, vehicles: st.vehicles })),
        keys: ['vehicles'], colours: ['#075e54'], h: 110,
      });
    }
    kit.table([
      { h: 'State / UT', k: 'name', w: 0.3, v: (r) => r.name },
      { h: 'Code', k: 'code', w: 0.1, v: (r) => r.code },
      { h: 'Vehicles', k: 'vehicles', w: 0.2, right: true, v: (r) => num(r.vehicles) },
      { h: 'Arrivals', k: 'entries', w: 0.2, right: true, v: (r) => num(r.entries) },
      { h: 'Share', k: 'share', w: 0.2, right: true, v: (r) => pc(r.share) },
    ], org.states, { fs: 8, rowH: 15 });

    const named = org.places.filter((x) => x.named).slice(0, 20);
    if (named.length) {
      kit.section('10.1 By district and registering office',
        org.named < org.vehicles
          ? `${num(org.vehicles - org.named)} vehicle(s) have no registration certificate on file, so their district is not known and they are left out of this table.`
          : null,
        { keep: 120 });
      kit.table([
        { h: 'Place', k: 'place', w: 0.4, v: (r) => r.place },
        { h: 'State / UT', k: 'stateName', w: 0.24, v: (r) => r.stateName },
        { h: 'Vehicles', k: 'vehicles', w: 0.14, right: true, v: (r) => num(r.vehicles) },
        { h: 'Arrivals', k: 'entries', w: 0.12, right: true, v: (r) => num(r.entries) },
        { h: 'Share', k: 'share', w: 0.1, right: true, v: (r) => pc(r.share) },
      ], named, { fs: 8, rowH: 15 });
    }
  }

  /* 11. Each staff member, day by day. */
  const sd = report.staffDaily;
  if (sd && sd.staff.length && sd.entries.length) {
    kit.section('11. Staff day by day', 'Vehicles admitted by each staff member on each day of the period.', { keep: 120 });
    const cols = [{ h: 'Date', k: 'day', w: 0.16, v: (r) => r.day }];
    /* At most six columns of people: beyond that the table stops being readable
       on paper, and the workbook carries the rest. */
    const people = sd.staff.slice(0, 6);
    people.forEach((person) => {
      cols.push({
        h: person.name, k: person.name, w: (1 - 0.16) / people.length,
        right: true, v: (r) => num(r[person.name] || 0),
      });
    });
    kit.table(cols, sd.entries, { fs: 7.5, rowH: 14 });
    if (sd.staff.length > people.length) {
      kit.note(`${sd.staff.length - people.length} more staff member(s) worked in this period — every one of them is in the spreadsheet.`);
    }
  }

  /* 12. Detailed tables */
  if (report.daily.length > 1) {
    kit.section('12. Day by day', null, { keep: 120 });
    const sumOf = (k) => report.daily.reduce((a, d) => a + Number(d[k] || 0), 0);
    kit.table([
      { h: 'Date', k: 'day', w: 0.13, v: (r) => r.day },
      { h: 'Bookings', k: 'bookings', w: 0.09, right: true, v: (r) => num(r.bookings) },
      { h: 'Entries', k: 'entries', w: 0.08, right: true, v: (r) => num(r.entries) },
      { h: 'Bike', k: 'bikes', w: 0.07, right: true, v: (r) => num(r.bikes) },
      { h: 'Car', k: 'cars', w: 0.07, right: true, v: (r) => num(r.cars) },
      { h: 'Toofan', k: 'toofans', w: 0.07, right: true, v: (r) => num(r.toofans) },
      { h: 'TT', k: 'tts', w: 0.06, right: true, v: (r) => num(r.tts) },
      { h: 'Skipped', k: 'skipped', w: 0.08, right: true, v: (r) => num(r.skipped) },
      { h: 'Invalid', k: 'invalid', w: 0.08, right: true, v: (r) => num(r.invalid) },
      { h: 'Collected', k: 'collected', w: 0.14, right: true, v: (r) => inr(r.collected) },
      { h: 'Fee', k: 'serviceFee', w: 0.13, right: true, v: (r) => inr(r.serviceFee) },
    ], report.daily, {
      fs: 7.5, rowH: 14,
      totals: {
        bookings: num(sumOf('bookings')), entries: num(sumOf('entries')), bikes: num(sumOf('bikes')),
        cars: num(sumOf('cars')), toofans: num(sumOf('toofans')), tts: num(sumOf('tts')),
        skipped: num(sumOf('skipped')), invalid: num(sumOf('invalid')),
        collected: inr(sumOf('collected')), serviceFee: inr(sumOf('serviceFee')),
      },
    });
  }

  kit.note(`Report ${reportNo}. Fingerprint ${report.fingerprint}. Figures are drawn from the live Pravesha database at the time of generation; `
    + 'a report regenerated later for the same period may differ if bookings for past dates were changed since.');

  footer(doc, {
    generated: `${reportNo} · generated ${istDateTime(generatedAt)}`,
    pageOf: (i, nPages) => `Page ${i} of ${nPages}`,
    productLine: 'Pravesha is a product of ServerPe App Solutions — Smart Clicks, Smart Taps. (www.serverpe.in)',
  });

  return toBuffer(doc);
}

const filename = (report, reportNo) => `Pravesha-${report.period.kind}-report-${report.period.from}${report.period.to !== report.period.from ? `-to-${report.period.to}` : ''}-${reportNo}.pdf`;

module.exports = { render, filename };
