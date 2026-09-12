/* Pravesha booking form — client script.
   Plain ES5-ish JavaScript with no build step: this is opened from a chat, on
   whatever browser the visitor's phone gives WhatsApp, and a transpiler in the
   way of that is a dependency with nothing to show for itself. */
(function () {
  function $(id) { return document.getElementById(id); }
  var tok = $('tok').value;
  var state = {};

  /* Two failures that used to share one message, and should not.

     A request that never got a proper answer -- no signal, a timeout, a proxy
     error page instead of JSON -- is worth retrying, and the visitor is told so.
     An error in this script is not: retrying runs the same broken code, so it is
     reported to the server and the visitor is asked to reload. Collapsing both
     into "Something went wrong" is what made a correct server response look
     like an outage. */
  function report(step, err) {
    try {
      navigator.sendBeacon('/book/client-error', new Blob([JSON.stringify({
        step: step, message: String(err && err.message || err), stack: String(err && err.stack || '')
      })], { type: 'application/json' }));
    } catch (e) { /* reporting must never become the second failure */ }
  }
  window.addEventListener('error', function (e) { report('window', e.error || e.message); });

  function api(path, body) {
    var ctrl = window.AbortController ? new AbortController() : null;
    /* ULIP has taken five seconds on a first lookup. Twenty is generous for that
       and still ends before a visitor gives up and closes the page. */
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch('/book/' + tok + '/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      var type = r.headers.get('content-type') || '';
      if (type.indexOf('application/json') === -1) {
        var e = new Error('non-json response ' + r.status); e.network = true; throw e;
      }
      return r.json();
    }, function (err) {
      if (timer) clearTimeout(timer);
      err.network = true; throw err;
    });
  }

  function show(el, on) { el.classList.toggle('show', !!on); }
  function vis(el, on) { el.classList.toggle('hide', !on); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var TYPE = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' };

  function placeIsSoon() {
    var o = $('place').selectedOptions[0];
    return !!(o && o.getAttribute('data-soon') === '1');
  }

  /* The visitor's own row in the fee table, once we know what they drive — so
     the number on the review screen is visibly the one from the table above,
     not a figure that appeared from nowhere. */
  function highlightFee(catId) {
    var rows = document.querySelectorAll('#fees tbody tr');
    Array.prototype.forEach.call(rows, function (tr) {
      tr.classList.toggle('mine', !!catId && tr.getAttribute('data-cat') === String(catId));
    });
  }

  /* Forget the vehicle, keep the slot. The slot sits under the date and was
     chosen for its time; a different vehicle only changes how many are left. */
  function clearVehicle() {
    highlightFee(null);
    state.vehicle = null;
    vis($('slotNudge'), false);
    show($('vok'), false); show($('verr'), false);
    vis($('revCard'), false);
  }

  /* A destination that is not open yet stays visible in the list and simply
     cannot be chosen. Hiding it would make the platform look like it serves one
     hill; showing it greyed says which ones are coming. */
  function onPlace() {
    var soon = placeIsSoon();
    show($('soon'), soon);
    $('check').disabled = soon;
    clearVehicle();
    state.slot = null;
    state.checked = false;
    loadSlots();
  }

  $('place').addEventListener('change', onPlace);

  /* A different date can make a checked vehicle unbookable (it may already hold
     a pass for that day), so a date change re-runs the vehicle check, which
     reloads the slots; otherwise the slots are reloaded directly. */
  $('date').addEventListener('change', function () {
    state.slot = null;
    vis($('revCard'), false);
    if (state.vehicle || state.checked) $('check').click();
    else loadSlots();
  });

  $('reg').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    var had = !!state.vehicle;
    clearVehicle();
    state.checked = false;
    state.checkedReg = null;
    if (had) loadSlots(); // the counts were for the old vehicle
  });

  /*
   * Look the vehicle up.
   *
   * WHY THIS IS NO LONGER ONLY A BUTTON. The slot grid sits above the vehicle
   * field, so a visitor who typed their number and then scrolled up to pick a
   * slot had chosen everything the form needs and still saw nothing happen —
   * the review only appears once the vehicle has been checked, and the button
   * to do that was now off the bottom of their screen. They scrolled back down,
   * tapped Check vehicle, and were scrolled up again. Choosing a slot now runs
   * the check itself, and so does leaving the number field.
   *
   * IT IS STILL NOT RUN WHILE THEY TYPE. Every check is a paid call to the
   * vehicle register, and a plate half-entered is a call spent on a number that
   * does not exist yet. So it runs on a deliberate act — a slot chosen, the
   * field left, Enter pressed, or the button — and never twice for the same
   * number.
   */
  function runCheck(opts) {
    var quiet = opts && opts.quiet;
    var reg = $('reg').value.trim();
    if (reg.length < 6) {
      if (quiet) return;
      $('verr').innerHTML = '<b class="msg-title">Vehicle number needed</b>Please enter the full registration number.';
      show($('verr'), true); return;
    }
    if ($('check').disabled) return;
    state.checkedReg = reg;
    var b = $('check');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>Checking…';
    show($('verr'), false); show($('vok'), false);

    state.checked = true;
    api('vehicle', { regNo: reg, placeId: $('place').value, travelDate: $('date').value }).then(function (r) {
      b.disabled = false; b.textContent = 'Check vehicle';
      if (!r.ok) {
        state.vehicle = null;
        highlightFee(null);
        var m = (r.title ? '<b class="msg-title">' + esc(r.title) + '</b>' : '')
          + esc(r.message || 'We could not check that number.');
        if (r.messageKn) { m += '<br><span style="opacity:.9">' + esc(r.messageKn) + '</span>'; }
        if (r.vehicle) { m += '<br><span style="opacity:.8;font-size:12.5px">' + esc(r.vehicle) + '</span>'; }
        $('verr').innerHTML = m;
        show($('verr'), true);
        vis($('revCard'), false);
        loadSlots();
        return;
      }
      state.vehicle = r;
      /* Laid out as labelled fields rather than one run-on line, so the visitor
         can check each part against their own vehicle -- and "Vehicle type" is
         always one of the four fare categories, since that is what they pay. */
      var dash = '—';
      var cell = function (k, val) {
        var d = document.createElement('dd'); d.textContent = val || dash;
        var t = document.createElement('dt'); t.textContent = k;
        return [t, d];
      };
      var grid = $('vgrid'); grid.innerHTML = '';
      [['Manufacturer', r.vehicle.make], ['Model', r.vehicle.model], ['Variant', r.vehicle.variant]]
        .forEach(function (p) { cell(p[0], p[1]).forEach(function (n) { grid.appendChild(n); }); });
      var tdt = document.createElement('dt'); tdt.textContent = 'Vehicle type';
      var tdd = document.createElement('dd');
      var chip = document.createElement('span'); chip.className = 'vtype';
      chip.textContent = TYPE[r.category.code] || r.category.label;
      tdd.appendChild(chip); grid.appendChild(tdt); grid.appendChild(tdd);
      $('vreg').textContent = r.regNo;
      $('vfee').innerHTML = 'Fee for this vehicle: <b>₹' + esc(r.price.total) + '</b>';
      show($('vok'), true);
      highlightFee(r.category.id);
      var hadSlot = !!state.slot;
      loadSlots();
      /* No slot picked yet: the next thing to do is back up the page. Go there
         once the grid has redrawn with this vehicle's column highlighted. */
      if (!hadSlot) setTimeout(function () { if (state.vehicle && !state.slot) goToSlots(); }, 700);
    }).catch(function (err) {
      b.disabled = false; b.textContent = 'Check vehicle';
      if (err && err.network) {
        $('verr').innerHTML = '<b class="msg-title">No connection</b>Could not reach the server. Please check your connection and tap Check vehicle again.';
      } else {
        report('vehicle-render', err);
        $('verr').innerHTML = '<b class="msg-title">Please reload</b>This page needs refreshing. Please reload it and try again.';
      }
      show($('verr'), true);
    });
  }

  $('check').addEventListener('click', function () { runCheck(); });

  /* Leaving the field, or pressing Go on the keyboard, is as clear a statement
     that the number is finished as tapping the button is. */
  $('reg').addEventListener('change', function () { runCheck({ quiet: true }); });
  $('reg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); this.blur(); runCheck(); }
  });

  /* The slots, directly under the date, as a grid.

     One row per slot, one column per vehicle type, each cell the places left
     for that type as a coloured pill — green with room, amber when running low,
     red when full. Capacity is held per type (the number left for a car is not
     the number left for a Tempo Traveller at the same hour), so every type's
     count is shown from the start. Once the vehicle is checked its column is
     highlighted and the others fade, and a row is only selectable if that
     column still has a place. A slot picked before the vehicle was checked is
     kept if it is still open for it, and cleared with a reason if not. */
  var COLS = [
    { code: 'BIKE', icon: '🏍️', name: 'Bike' },
    { code: 'CAR', icon: '🚗', name: 'Car' },
    { code: 'TOOFAN', icon: '🚙', name: 'Toofan' },
    { code: 'TT', icon: '🚐', name: 'TT' }
  ];
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* "Morning 6:00 AM - 12:00 PM" -> ["Morning", "6:00 AM – 12:00 PM"] */
  function splitLabel(label) {
    var m = String(label).match(/^(\S+)\s+(.*)$/);
    return m ? [m[1], m[2].replace(' - ', ' – ')] : [label, ''];
  }

  function level(left, cap) {
    if (left <= 0) return 'full';
    if (left === 1 || left <= Math.ceil(cap / 3)) return 'low';
    return 'ok';
  }

  /* Count up from zero, eased, so a changed number reads as a change. */
  function countUp(el) {
    var to = Number(el.getAttribute('data-to')) || 0;
    if (calm || to <= 0) { el.textContent = String(to); return; }
    var start = null, dur = 550;
    function step(ts) {
      if (start === null) start = ts;
      var k = Math.min(1, (ts - start) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  var loadSeq = 0;
  function loadSlots() {
    var mine = ++loadSeq;
    if (placeIsSoon()) { $('slots').innerHTML = ''; return; }
    var v = state.vehicle;
    var myCode = v ? v.category.code : null;
    $('slots').innerHTML = '<div class="hint">Loading time slots…</div>';

    api('slots', { placeId: $('place').value, travelDate: $('date').value }).then(function (r) {
      if (mine !== loadSeq) return; // a newer load has started; this answer is stale
      if (!r.ok) { $('slots').innerHTML = '<div class="hint">Could not load time slots.</div>'; return; }

      var WHY = { slot_over: 'Finished for today', too_late: 'Closed — last entry was ', date_past: 'This date has passed' };
      var anyOpen = false, keep = null, lost = null;

      var head = '<div class="sg-row sg-head"><div class="sg-slot">Time slot</div>'
        + COLS.map(function (col) {
          return '<div class="sg-type' + (myCode === col.code ? ' mine' : '') + (myCode && myCode !== col.code ? ' dim' : '') + '">'
            + '<span class="sg-ico">' + col.icon + '</span>' + col.name + '</div>';
        }).join('') + '</div>';

      var rows = r.slots.map(function (s, ri) {
        var byCode = {};
        (s.types || []).forEach(function (x) { byCode[x.code] = x; });
        var timeShut = s.timeClosed || s.isOpen === false;
        var mineLeft = myCode && byCode[myCode] ? byCode[myCode].remaining : null;
        var selectable = !timeShut && (myCode ? mineLeft > 0 : (s.types || []).some(function (x) { return x.remaining > 0; }));
        if (selectable) anyOpen = true;
        if (state.slot && state.slot.id === s.slotId) { if (selectable) keep = s; else lost = s; }

        var parts = splitLabel(s.label);
        var note = timeShut
          ? (s.timeClosed ? (s.timeReason === 'too_late' ? WHY.too_late + s.lastEntry : (WHY[s.timeReason] || 'Closed')) : (s.closedNote || 'Closed'))
          : 'Last entry ' + s.lastEntry;

        var cells = timeShut
          ? '<div class="sg-shut">' + esc(note) + '</div>'
          : COLS.map(function (col, ci) {
            var x = byCode[col.code] || { remaining: 0, capacity: 0 };
            var lv = level(x.remaining, x.capacity);
            return '<div class="sg-cell' + (myCode === col.code ? ' mine' : '') + (myCode && myCode !== col.code ? ' dim' : '') + '">'
              + '<span class="pill ' + lv + '" style="animation-delay:' + (calm ? 0 : (ri * 90 + ci * 45)) + 'ms">'
              + (x.remaining <= 0 ? 'Full' : '<b class="n" data-to="' + x.remaining + '">0</b><small>/' + x.capacity + '</small>')
              + '</span></div>';
          }).join('');

        return '<label class="sg-row sg-body' + (selectable ? '' : ' off') + (keep === s ? ' sel' : '') + '" data-slot="' + esc(s.slotId) + '">'
          + '<div class="sg-slot"><input type="radio" name="slot" value="' + esc(s.slotId) + '"' + (selectable ? '' : ' disabled') + (keep === s ? ' checked' : '') + '>'
          + '<span><b class="slot-name" data-label="' + esc(s.label) + '">' + esc(parts[0]) + '</b>'
          + '<span class="sg-time">' + esc(parts[1]) + '</span>'
          + (timeShut ? '' : '<span class="sg-note">' + esc(note) + '</span>') + '</span></div>'
          + cells + '</label>';
      }).join('');

      var html = '<div class="sgrid' + (calm ? ' calm' : '') + '">' + head + rows + '</div>'
        + '<div class="sg-legend"><span class="pill ok">3</span> places left <span class="pill low">1</span> almost full <span class="pill full">Full</span></div>';
      if (!v) html = '<div class="hint" style="margin:0 0 8px">Places left for each vehicle type. After you check your vehicle below, its column is highlighted.</div>' + html;
      if (lost) html += '<div class="msg warn show"><b class="msg-title">Please choose another slot</b>' + esc(lost.label) + ' is not available for your vehicle.</div>';
      if (!anyOpen) html += '<div class="msg warn show"><b class="msg-title">No slots on this date</b>Please choose another date.</div>';

      $('slots').innerHTML = html;
      if (!keep) state.slot = null;
      Array.prototype.forEach.call($('slots').querySelectorAll('.n'), countUp);

      Array.prototype.forEach.call($('slots').querySelectorAll('input[name=slot]'), function (i) {
        i.addEventListener('change', function () {
          Array.prototype.forEach.call($('slots').querySelectorAll('.sg-body'), function (el) {
            el.classList.toggle('sel', el.getAttribute('data-slot') === i.value);
          });
          state.slot = { id: i.value, label: i.parentNode.querySelector('.slot-name').getAttribute('data-label') };
          /* Everything the form needs may already be on the page: if a number
             is sitting in the field unchecked, check it now rather than leaving
             the visitor to find a button they have scrolled past. */
          if (!state.vehicle && $('reg').value.trim().length >= 6 && $('reg').value.trim() !== state.checkedReg) {
            runCheck({ quiet: true });
          } else {
            review();
          }
        });
      });
      review();
    }).catch(function (err) {
      if (mine !== loadSeq) return;
      if (!(err && err.network)) report('slots-render', err);
      $('slots').innerHTML = '<div class="msg bad show">'
        + (err && err.network ? '<b class="msg-title">No connection</b>Could not load time slots. Please check your connection and change the date to retry.'
                              : '<b class="msg-title">Please reload</b>This page needs refreshing. Please reload it and try again.')
        + '</div>';
    });
  }

  /* Take the visitor back up to the slot grid and make it noticeable. */
  function goToSlots() {
    var grid = $('slots');
    grid.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    var sg = grid.querySelector('.sgrid');
    if (sg) { sg.classList.remove('attn'); void sg.offsetWidth; sg.classList.add('attn'); }
  }
  $('toSlots').addEventListener('click', goToSlots);

  function review() {
    var v = state.vehicle, s = state.slot;
    /* Vehicle checked but no slot yet: the next step is above, so say so here. */
    vis($('slotNudge'), !!(v && !s));
    if (!v || !s) { vis($('revCard'), false); return; }
    var placeName = $('place').selectedOptions[0].textContent.split('—')[0].trim();
    var dateName = $('date').selectedOptions[0].textContent;
    var tr = function (k, val, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + k + '</th><td>' + val + '</td></tr>';
    };
    $('review').innerHTML =
      '<table class="rev">'
      + '<thead><tr><th>Booking summary<span>' + esc(v.regNo) + '</span></th></tr></thead>'
      + '<tbody>'
      + '<tr><td><table class="inner"><caption>Visit details</caption><tbody>'
      + tr('Name', esc($('name').value || '—'))
      + tr('Destination', esc(placeName))
      + tr('Date of visit', esc(dateName))
      + tr('Time slot', esc(s.label))
      + '</tbody></table></td></tr>'
      + '<tr><td><table class="inner"><caption>Vehicle details</caption><tbody>'
      + tr('Vehicle number', '<span class="mono">' + esc(v.regNo) + '</span>')
      + tr('Manufacturer', esc(v.vehicle.make || '—'))
      + tr('Model', esc(v.vehicle.model || '—'))
      + tr('Variant', esc(v.vehicle.variant || '—'))
      + tr('Vehicle type', esc(TYPE[v.category.code] || v.category.label))
      + '</tbody></table></td></tr>'
      + '<tr><td><table class="inner pay"><caption>Payment details</caption><tbody>'
      + tr('Entry fee', '₹' + esc(v.price.entry))
      + tr('Platform fee', '₹' + esc(v.price.platform))
      + tr('Total payable', '₹' + esc(v.price.total), 'total')
      + '</tbody></table></td></tr>'
      + '</tbody></table>';
    vis($('revCard'), true);
    $('revCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* Continue to payment, in two steps.

     1. HOLD. The server re-checks everything the form showed — slot still open,
        place still free, vehicle still allowed, no pass already held — and holds
        the place for this vehicle. A held place counts as taken, exactly like a
        booked one, so nobody else can buy it while this visitor decides.
     2. CONFIRM. A sheet shows what is held, the amount, and the time left, and
        only "Confirm & pay" goes on to Razorpay. Cancel gives the place back at
        once instead of leaving it locked until the hold ages out.

     The countdown runs from the seconds the server said were left, not from the
     phone's own clock, which may be wrong. */
  var hold = null;

  function fmt(sec) {
    var s = Math.max(0, sec);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function closeHold() {
    if (hold && hold.timer) clearInterval(hold.timer);
    hold = null;
    vis($('holdModal'), false);
    document.body.style.overflow = '';
    /* The tick belonged to that hold. A new one starts unticked. */
    var box = $('atGate'), row = $('atGateRow'), msg = $('atGateMsg');
    if (box) box.checked = false;
    if (row) row.classList.remove('on');
    if (msg) msg.className = 'msg';
  }

  function releaseHold(reason) {
    api('release', {}).catch(function () { /* the hold ages out on its own */ });
    closeHold();
    var b = $('pay');
    b.disabled = false; b.textContent = 'Continue to payment';
    if (reason) {
      $('payerr').innerHTML = reason;
      show($('payerr'), true);
    }
    loadSlots();
  }

  function openHold(r) {
    var v = state.vehicle, s = state.slot;
    var placeName = $('place').selectedOptions[0].textContent.split('—')[0].trim();
    var dateName = $('date').selectedOptions[0].textContent;
    var tr = function (k, val, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + k + '</th><td>' + val + '</td></tr>';
    };
    $('holdSummary').innerHTML = '<table class="sum"><tbody>'
      + tr('Vehicle', esc(v.regNo) + ' · ' + esc(TYPE[v.category.code] || v.category.label))
      + tr('Destination', esc(placeName))
      + tr('Date', esc(dateName))
      + tr('Time slot', esc(s.label))
      + tr('Total payable', '₹' + esc(r.amount || v.price.total), 'total')
      + '</tbody></table>';
    $('holdPay').textContent = 'Confirm & pay ₹' + (r.amount || v.price.total);
    $('holdPay').disabled = false;
    show($('holdErr'), false);

    hold = { payUrl: r.payUrl, endsAt: Date.now() + (r.secondsLeft || (r.holdMinutes || 10) * 60) * 1000 };
    var tick = function () {
      if (!hold) return;
      var left = Math.round((hold.endsAt - Date.now()) / 1000);
      $('holdClock').textContent = fmt(left);
      $('holdTimer').classList.toggle('low', left <= 120);
      if (left <= 0) {
        releaseHold('<b class="msg-title">Hold expired</b>The place was released because payment was not started in time. Please try again.');
      }
    };
    tick();
    hold.timer = setInterval(tick, 1000);

    /*
     * "I am already at the checkpost", offered only when the server says this
     * pass could be used the moment it is paid for. Always unticked: the costly
     * mistake is a tick nobody meant, and a remembered one would be exactly
     * that.
     */
    atGate.reset(r.selfCheckin);

    vis($('holdModal'), true);
    document.body.style.overflow = 'hidden';
    $('holdPay').focus();
  }

  /*
   * The tick box, and the check behind it.
   *
   * TICKING ASKS THE PHONE WHERE IT IS. The claim on its own is worth little —
   * not because visitors lie, but because a box can be tapped by mistake, and
   * the cost of that mistake is a pass the barrier reads as already entered
   * while its owner is still hours away. The position turns the claim into
   * something checkable, and from home it fails by kilometres.
   *
   * THE PHONE DOES NOT DECIDE. It reports coordinates; the server compares them
   * with the gate's and answers. Everything here is presentation.
   *
   * A REFUSAL IS NOT A FAILURE. Location switched off, a fix too vague to mean
   * anything, or simply being somewhere else: the box unticks itself, says why
   * in a sentence, and the visitor pays exactly as before and is checked in at
   * the barrier — which is what would have happened anyway.
   */
  var atGate = (function () {
    var row = $('atGateRow'), box = $('atGate'), msg = $('atGateMsg'), hint = $('atGateHint');

    /*
     * THIS SCRIPT MUST NEVER ASSUME THE PAGE IT IS RUNNING AGAINST.
     *
     * app.js is re-read from disk on every request, while the page's HTML lives
     * in a module the server loaded when it started. Deploy a new script without
     * restarting and a visitor gets tomorrow's script with today's page — which
     * is exactly what happened: these four elements did not exist yet, the line
     * below threw while the page was still wiring itself up, and every listener
     * registered after this point — including the one on Continue to payment —
     * was never attached. A missing tick box turned into a dead payment button.
     *
     * So a page without these elements simply does not offer the feature. That
     * is the honest outcome of a half-deployed page, and it costs nobody a
     * booking.
     */
    if (!row || !box || !msg || !hint) return { reset: function () {} };

    function say(text, good) {
      msg.textContent = text || '';
      msg.className = 'msg' + (text ? (good ? ' good show' : ' warn show') : '');
    }

    function tell(on, extra) {
      return api('atgate', Object.assign({ on: on }, extra || {}));
    }

    function reset(offer) {
      box.checked = false;
      row.classList.remove('on', 'busy');
      say('');
      var show = !!(offer && offer.offered);
      vis(row, show);
      if (show && offer.gate) hint.textContent = 'Your entry at ' + offer.gate + ' will be recorded now, so you can drive through without waiting.';
      /* Anything left over from a previous hold is cleared on the server too. */
      if (!show) tell(false).catch(function () {});
    }

    box.addEventListener('change', function () {
      if (!box.checked) {
        row.classList.remove('on');
        say('');
        tell(false).catch(function () {});
        return;
      }

      if (!navigator.geolocation) {
        box.checked = false;
        say('This browser cannot share your location, so we cannot confirm you are at the gate. The staff member will check you in.');
        return;
      }

      row.classList.add('busy');
      say('Checking that you are at the gate…');

      navigator.geolocation.getCurrentPosition(function (pos) {
        tell(true, {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }).then(function (r) {
          row.classList.remove('busy');
          if (r.ok && r.on) {
            box.checked = true;
            row.classList.add('on');
            say(r.message || 'You are at the gate. Your entry will be recorded when you pay.', true);
          } else {
            box.checked = false;
            row.classList.remove('on');
            say(r.message || 'We could not confirm you are at the gate. The staff member will check you in.');
          }
        }).catch(function () {
          row.classList.remove('busy');
          box.checked = false;
          say('We could not check just now. The staff member will check you in.');
        });
      }, function (err) {
        row.classList.remove('busy');
        box.checked = false;
        say(err && err.code === 1
          ? 'Location is switched off for this page, so we cannot confirm you are at the gate. The staff member will check you in.'
          : 'We could not read your location. The staff member will check you in.');
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });

    return { reset: reset };
  }());

  $('pay').addEventListener('click', function () {
    var v = state.vehicle, s = state.slot;
    if (!v || !s) return;
    var b = $('pay'), err = $('payerr');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>Holding your place…';
    show(err, false);

    api('confirm', {
      placeId: $('place').value, travelDate: $('date').value,
      slotId: s.id, regNo: v.regNo
    }).then(function (r) {
      if (!r.ok) {
        b.disabled = false; b.textContent = 'Continue to payment';
        err.innerHTML = '<b class="msg-title">Could not hold your place</b>' + esc(r.message || 'Please try again.');
        show(err, true);
        if (r.error === 'sold_out' || r.error === 'slot_closed') loadSlots();
        return;
      }
      b.innerHTML = '<span class="spin"></span>Place held';
      openHold(r);
    }).catch(function (e) {
      b.disabled = false; b.textContent = 'Continue to payment';
      if (!(e && e.network)) report('confirm', e);
      err.innerHTML = e && e.network
        ? '<b class="msg-title">No connection</b>Could not reach the server. Please check your connection and try again.'
        : '<b class="msg-title">Please reload</b>This page needs refreshing. Please reload it and try again.';
      show(err, true);
    });
  });

  $('holdPay').addEventListener('click', function () {
    if (!hold) return;
    var b = $('holdPay');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>Opening secure payment…';
    if (hold.timer) clearInterval(hold.timer);
    window.location.href = hold.payUrl;
  });

  $('holdCancel').addEventListener('click', function () {
    releaseHold('<b class="msg-title">Place released</b>Nothing was charged. You can change your choices and continue again.');
  });

  /* THE KEYBOARD MUST NOT HIDE WHAT IS BEING TYPED.

     On a phone the on-screen keyboard covers the lower half of the page, and the
     vehicle number field sat underneath it. Three layers, because in-app
     browsers disagree about which of them they honour:

       1. the viewport meta asks the browser to shrink the page when the
          keyboard opens (interactive-widget=resizes-content), so it keeps the
          focused field in view itself;
       2. a tapped field is scrolled to the middle of what is left visible, once
          the keyboard has finished opening;
       3. while the keyboard is up, any resize of the visible area that leaves
          the field underneath brings it back up — iPhones do not resize the
          page at all and only report it through visualViewport. */
  function keepInView(el) {
    if (!el || !el.getBoundingClientRect) return;
    var vv = window.visualViewport;
    var visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    var r = el.getBoundingClientRect();
    if (r.bottom > visibleBottom - 16 || r.top < 8) {
      el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    }
  }
  function isTyping(el) {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.readOnly;
  }
  document.addEventListener('focusin', function (e) {
    if (!isTyping(e.target)) return;
    var el = e.target;
    setTimeout(function () { keepInView(el); }, 300);  // keyboard mid-animation
    setTimeout(function () { keepInView(el); }, 650);  // keyboard fully open
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (isTyping(document.activeElement)) keepInView(document.activeElement);
    });
  }

  /* "Go" on the keyboard checks the vehicle and puts the keyboard away, so the
     result is not hidden under it and there is no reaching past it for the
     button. */
  $('reg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      this.blur();
      $('check').click();
      setTimeout(function () { keepInView($('vok').classList.contains('show') ? $('vok') : $('verr')); }, 400);
    }
  });

  onPlace();
})();
