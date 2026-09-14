/* Pravesha booking form — client script.
   Plain ES5-ish JavaScript with no build step: this is opened from a chat, on
   whatever browser the visitor's phone gives WhatsApp, and a transpiler in the
   way of that is a dependency with nothing to show for itself. */
(function () {
  function $(id) { return document.getElementById(id); }
  var tok = $('tok').value;
  var state = {};

  /* THE VISITOR'S LANGUAGE, read off the page the server rendered for them.
     Every sentence this script draws is in T below. A page without a lang (an
     older page meeting this newer script) is English, which is what it was. */
  var lang = document.documentElement.getAttribute('lang') === 'kn' ? 'kn' : 'en';
  var T = {
    en: {
      needNumT: 'Vehicle number needed', needNum: 'Please enter the full registration number.',
      checking: 'Checking…', checkBtn: 'Check vehicle', cantCheck: 'We could not check that number.',
      make: 'Manufacturer', model: 'Model', variant: 'Variant', vtype: 'Vehicle type',
      feeFor: 'Fee for this vehicle:',
      noConnT: 'No connection', noConnCheck: 'Could not reach the server. Please check your connection and tap Check vehicle again.',
      reloadT: 'Please reload', reload: 'This page needs refreshing. Please reload it and try again.',
      loadingSlots: 'Loading time slots…', cantLoad: 'Could not load time slots.',
      slotOver: 'Finished for today', tooLate: 'Closed — last entry was {t}', datePast: 'This date has passed', closed: 'Closed',
      lastEntry: 'Last entry {t}', full: 'Full', forYours: 'for your vehicle', left1: 'place left', leftN: 'places left',
      chipFull: 'full', chipLeft: '{n} of {c} left',
      lgLeft: 'places left', lgLow: 'almost full', lgFull: 'full',
      intro: 'Places left for each vehicle type. Once you check your vehicle below, its own count is shown here.',
      lostT: 'Please choose another slot', lost: '{slot} is not available for your vehicle.',
      noSlotsT: 'No slots on this date', noSlots: 'Please choose another date.',
      slotsNoConn: 'Could not load time slots. Please check your connection and change the date to retry.',
      summary: 'Booking summary', visit: 'Visit details', name: 'Name', dest: 'Destination', date: 'Date of visit', slot: 'Time slot',
      vdetails: 'Vehicle details', vnum: 'Vehicle number', paydetails: 'Payment details',
      entryFee: 'Entry fee', platFee: 'Platform fee', total: 'Total payable',
      vehicle: 'Vehicle', dateShort: 'Date', confirmPay: 'Confirm & pay ₹{a}',
      holdExpT: 'Hold expired', holdExp: 'The place was released because payment was not started in time. Please try again.',
      continuePay: 'Continue to payment', holding: 'Holding your place…', held: 'Place held',
      cantHoldT: 'Could not hold your place', tryAgain: 'Please try again.',
      payNoConn: 'Could not reach the server. Please check your connection and try again.',
      opening: 'Opening secure payment…',
      releasedT: 'Place released', released: 'Nothing was charged. You can change your choices and continue again.',
      gateHint: 'Your entry at {gate} will be recorded now, so you can drive through without waiting.',
      noGeo: 'This browser cannot share your location, so we cannot confirm you are at the gate. The staff member will check you in.',
      checkingGate: 'Checking that you are at the gate…',
      atGate: 'You are at the gate. Your entry will be recorded when you pay.',
      notAtGate: 'We could not confirm you are at the gate. The staff member will check you in.',
      gateErr: 'We could not check just now. The staff member will check you in.',
      locOff: 'Location is switched off for this page, so we cannot confirm you are at the gate. The staff member will check you in.',
      locUnread: 'We could not read your location. The staff member will check you in.'
    },
    kn: {
      needNumT: 'ವಾಹನ ಸಂಖ್ಯೆ ಬೇಕು', needNum: 'ದಯವಿಟ್ಟು ಪೂರ್ಣ ನೋಂದಣಿ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
      checking: 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…', checkBtn: 'ವಾಹನ ಪರಿಶೀಲಿಸಿ', cantCheck: 'ಆ ಸಂಖ್ಯೆಯನ್ನು ಪರಿಶೀಲಿಸಲಾಗಲಿಲ್ಲ.',
      make: 'ತಯಾರಕರು', model: 'ಮಾದರಿ', variant: 'ವೇರಿಯಂಟ್', vtype: 'ವಾಹನದ ಪ್ರಕಾರ',
      feeFor: 'ಈ ವಾಹನಕ್ಕೆ ಶುಲ್ಕ:',
      noConnT: 'ಸಂಪರ್ಕವಿಲ್ಲ', noConnCheck: 'ಸರ್ವರ್ ತಲುಪಲಾಗಲಿಲ್ಲ. ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಮತ್ತೆ "ವಾಹನ ಪರಿಶೀಲಿಸಿ" ಒತ್ತಿ.',
      reloadT: 'ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ', reload: 'ದಯವಿಟ್ಟು ಪುಟವನ್ನು ಮರುಲೋಡ್ ಮಾಡಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      loadingSlots: 'ಸಮಯದ ಸ್ಲಾಟ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…', cantLoad: 'ಸ್ಲಾಟ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ.',
      slotOver: 'ಇಂದಿನ ಸಮಯ ಮುಗಿದಿದೆ', tooLate: 'ಮುಚ್ಚಿದೆ — ಕೊನೆಯ ಪ್ರವೇಶ {t}', datePast: 'ಈ ದಿನಾಂಕ ಕಳೆದಿದೆ', closed: 'ಮುಚ್ಚಿದೆ',
      lastEntry: 'ಕೊನೆಯ ಪ್ರವೇಶ {t}', full: 'ಭರ್ತಿ', forYours: 'ನಿಮ್ಮ ವಾಹನಕ್ಕೆ', left1: 'ಸ್ಥಾನ ಬಾಕಿ', leftN: 'ಸ್ಥಾನ ಬಾಕಿ',
      chipFull: 'ಭರ್ತಿ', chipLeft: '{c} ರಲ್ಲಿ {n} ಬಾಕಿ',
      lgLeft: 'ಸ್ಥಾನ ಲಭ್ಯ', lgLow: 'ಬಹುತೇಕ ಭರ್ತಿ', lgFull: 'ಭರ್ತಿ',
      intro: 'ಪ್ರತಿ ವಾಹನ ಪ್ರಕಾರಕ್ಕೆ ಉಳಿದ ಸ್ಥಾನಗಳು. ಕೆಳಗೆ ನಿಮ್ಮ ವಾಹನ ಪರಿಶೀಲಿಸಿದ ನಂತರ, ಅದರ ಸಂಖ್ಯೆ ಇಲ್ಲಿ ಕಾಣಿಸುತ್ತದೆ.',
      lostT: 'ದಯವಿಟ್ಟು ಬೇರೆ ಸ್ಲಾಟ್ ಆಯ್ಕೆಮಾಡಿ', lost: '{slot} ನಿಮ್ಮ ವಾಹನಕ್ಕೆ ಲಭ್ಯವಿಲ್ಲ.',
      noSlotsT: 'ಈ ದಿನಾಂಕದಲ್ಲಿ ಸ್ಲಾಟ್‌ಗಳಿಲ್ಲ', noSlots: 'ದಯವಿಟ್ಟು ಬೇರೆ ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ.',
      slotsNoConn: 'ಸ್ಲಾಟ್‌ಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ. ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಲು ದಿನಾಂಕ ಬದಲಿಸಿ.',
      summary: 'ಬುಕಿಂಗ್ ಸಾರಾಂಶ', visit: 'ಭೇಟಿಯ ವಿವರಗಳು', name: 'ಹೆಸರು', dest: 'ಪ್ರವಾಸಿ ತಾಣ', date: 'ಭೇಟಿಯ ದಿನಾಂಕ', slot: 'ಸಮಯದ ಸ್ಲಾಟ್',
      vdetails: 'ವಾಹನದ ವಿವರಗಳು', vnum: 'ವಾಹನ ಸಂಖ್ಯೆ', paydetails: 'ಪಾವತಿ ವಿವರಗಳು',
      entryFee: 'ಪ್ರವೇಶ ಶುಲ್ಕ', platFee: 'ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ಶುಲ್ಕ', total: 'ಒಟ್ಟು ಪಾವತಿಸಬೇಕಾದದ್ದು',
      vehicle: 'ವಾಹನ', dateShort: 'ದಿನಾಂಕ', confirmPay: 'ದೃಢೀಕರಿಸಿ, ₹{a} ಪಾವತಿಸಿ',
      holdExpT: 'ಕಾಯ್ದಿರಿಸುವ ಸಮಯ ಮುಗಿದಿದೆ', holdExp: 'ಸಮಯಕ್ಕೆ ಪಾವತಿ ಆರಂಭಿಸದ ಕಾರಣ ಸ್ಥಾನ ಬಿಡುಗಡೆಯಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      continuePay: 'ಪಾವತಿಗೆ ಮುಂದುವರಿಯಿರಿ', holding: 'ನಿಮ್ಮ ಸ್ಥಾನ ಕಾಯ್ದಿರಿಸಲಾಗುತ್ತಿದೆ…', held: 'ಸ್ಥಾನ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ',
      cantHoldT: 'ನಿಮ್ಮ ಸ್ಥಾನ ಕಾಯ್ದಿರಿಸಲಾಗಲಿಲ್ಲ', tryAgain: 'ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      payNoConn: 'ಸರ್ವರ್ ತಲುಪಲಾಗಲಿಲ್ಲ. ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
      opening: 'ಸುರಕ್ಷಿತ ಪಾವತಿ ತೆರೆಯಲಾಗುತ್ತಿದೆ…',
      releasedT: 'ಸ್ಥಾನ ಬಿಡುಗಡೆಯಾಗಿದೆ', released: 'ಯಾವುದೇ ಹಣ ಕಡಿತವಾಗಿಲ್ಲ. ನಿಮ್ಮ ಆಯ್ಕೆಗಳನ್ನು ಬದಲಿಸಿ ಮತ್ತೆ ಮುಂದುವರಿಯಬಹುದು.',
      gateHint: '{gate} ನಲ್ಲಿ ನಿಮ್ಮ ಪ್ರವೇಶ ಈಗಲೇ ದಾಖಲಾಗುತ್ತದೆ, ಕಾಯದೆ ಒಳಗೆ ಹೋಗಬಹುದು.',
      noGeo: 'ಈ ಬ್ರೌಸರ್ ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಸಾಧ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ ನೀವು ಗೇಟ್‌ನಲ್ಲಿರುವುದನ್ನು ದೃಢೀಕರಿಸಲಾಗದು. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಿಸುತ್ತಾರೆ.',
      checkingGate: 'ನೀವು ಗೇಟ್‌ನಲ್ಲಿದ್ದೀರಾ ಎಂದು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…',
      atGate: 'ನೀವು ಗೇಟ್‌ನಲ್ಲಿದ್ದೀರಿ. ಪಾವತಿಸಿದಾಗ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಾಗುತ್ತದೆ.',
      notAtGate: 'ನೀವು ಗೇಟ್‌ನಲ್ಲಿರುವುದನ್ನು ದೃಢೀಕರಿಸಲಾಗಲಿಲ್ಲ. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಿಸುತ್ತಾರೆ.',
      gateErr: 'ಈಗ ಪರಿಶೀಲಿಸಲಾಗಲಿಲ್ಲ. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಿಸುತ್ತಾರೆ.',
      locOff: 'ಈ ಪುಟಕ್ಕೆ ಸ್ಥಳ (ಲೊಕೇಶನ್) ಆಫ್ ಆಗಿದೆ, ಆದ್ದರಿಂದ ನೀವು ಗೇಟ್‌ನಲ್ಲಿರುವುದನ್ನು ದೃಢೀಕರಿಸಲಾಗದು. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಿಸುತ್ತಾರೆ.',
      locUnread: 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಓದಲಾಗಲಿಲ್ಲ. ಸಿಬ್ಬಂದಿ ನಿಮ್ಮ ಪ್ರವೇಶ ದಾಖಲಿಸುತ್ತಾರೆ.'
    }
  };
  /* t('lost', { slot: 'Morning' }) — a sentence, with its blanks filled. */
  function t(key, vars) {
    var s = (T[lang] && T[lang][key]) || T.en[key] || key;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null ? m : vars[k]; }) : s;
  }

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
  function msgHtml(titleKey, bodyText) {
    return '<b class="msg-title">' + esc(t(titleKey)) + '</b>' + esc(bodyText);
  }

  var TYPES = {
    en: { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' },
    kn: { BIKE: 'ದ್ವಿಚಕ್ರ ವಾಹನ', CAR: 'ಕಾರು', TOOFAN: 'ಟೂಫಾನ್', TT: 'ಟೆಂಪೋ ಟ್ರಾವೆಲರ್ (TT)' }
  };
  var TYPE = TYPES[lang];

  /* "17:00" / "ಸಂಜೆ 5:00" — Kannada says which part of the day, not AM/PM. */
  function clock(hhmm) {
    if (lang !== 'kn' || !hhmm) return hhmm;
    var p = String(hhmm).split(':'), h = Number(p[0]);
    var period = h >= 5 && h < 12 ? 'ಬೆಳಿಗ್ಗೆ' : h >= 12 && h < 16 ? 'ಮಧ್ಯಾಹ್ನ' : h >= 16 && h < 19 ? 'ಸಂಜೆ' : 'ರಾತ್ರಿ';
    return period + ' ' + (h % 12 === 0 ? 12 : h % 12) + ':' + (p[1] || '00');
  }

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
      $('verr').innerHTML = msgHtml('needNumT', t('needNum'));
      show($('verr'), true); return;
    }
    if ($('check').disabled) return;
    state.checkedReg = reg;
    var b = $('check');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>' + esc(t('checking'));
    show($('verr'), false); show($('vok'), false);

    state.checked = true;
    api('vehicle', { regNo: reg, placeId: $('place').value, travelDate: $('date').value }).then(function (r) {
      b.disabled = false; b.textContent = t('checkBtn');
      if (!r.ok) {
        state.vehicle = null;
        highlightFee(null);
        var m = (r.title ? '<b class="msg-title">' + esc(r.title) + '</b>' : '')
          + esc(r.message || t('cantCheck'));
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
        var dt = document.createElement('dt'); dt.textContent = k;
        return [dt, d];
      };
      var grid = $('vgrid'); grid.innerHTML = '';
      [[t('make'), r.vehicle.make], [t('model'), r.vehicle.model], [t('variant'), r.vehicle.variant]]
        .forEach(function (p) { cell(p[0], p[1]).forEach(function (n) { grid.appendChild(n); }); });
      var tdt = document.createElement('dt'); tdt.textContent = t('vtype');
      var tdd = document.createElement('dd');
      var chip = document.createElement('span'); chip.className = 'vtype';
      chip.textContent = TYPE[r.category.code] || r.category.label;
      tdd.appendChild(chip); grid.appendChild(tdt); grid.appendChild(tdd);
      $('vreg').textContent = r.regNo;
      $('vfee').innerHTML = esc(t('feeFor')) + ' <b>₹' + esc(r.price.total) + '</b>';
      show($('vok'), true);
      highlightFee(r.category.id);
      var hadSlot = !!state.slot;
      loadSlots();
      /* No slot picked yet: the next thing to do is back up the page. Go there
         once the grid has redrawn with this vehicle's column highlighted. */
      if (!hadSlot) setTimeout(function () { if (state.vehicle && !state.slot) goToSlots(); }, 700);
    }).catch(function (err) {
      b.disabled = false; b.textContent = t('checkBtn');
      if (err && err.network) {
        $('verr').innerHTML = msgHtml('noConnT', t('noConnCheck'));
      } else {
        report('vehicle-render', err);
        $('verr').innerHTML = msgHtml('reloadT', t('reload'));
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

  /* The slots, directly under the date: a card for each.

     Capacity is held per vehicle type — the number left for a car is not the
     number left for a Tempo Traveller at the same hour — so every type's count
     is shown from the start, as chips that wrap two-by-two on a narrow phone.
     This was a five-column table, which read well on a laptop and would not fit
     the screen most visitors actually book on.

     Colour carries the level (green room, amber low, red full) and the number
     carries the fact, so it reads with the colours removed. Once the vehicle is
     checked, its own count is promoted into the corner of the card in large type
     and the other three fade back; a card is only selectable if that type still
     has a place. A slot picked before the vehicle was checked is kept if it is
     still open for it, and cleared with a reason if not. */
  var COLS = [
    { code: 'BIKE', icon: '🏍️', name: lang === 'kn' ? 'ಬೈಕ್' : 'Bike' },
    { code: 'CAR', icon: '🚗', name: lang === 'kn' ? 'ಕಾರು' : 'Car' },
    { code: 'TOOFAN', icon: '🚙', name: lang === 'kn' ? 'ಟೂಫಾನ್' : 'Toofan' },
    { code: 'TT', icon: '🚐', name: lang === 'kn' ? 'ಟಿಟಿ' : 'TT' }
  ];
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A slot as the visitor reads it: [name, time, the whole label].
     English: "Morning 6:00 AM - 12:00 PM" -> ["Morning", "6:00 AM – 12:00 PM"].
     Kannada: the name is translated from the English one, and the time is the
     stored Kannada label ("ಬೆಳಿಗ್ಗೆ 6:00 - ಮಧ್ಯಾಹ್ನ 12:00"), which already says
     which part of the day each end falls in. A slot with no Kannada label
     falls back to English rather than to a blank. */
  var SLOT_KN = { Morning: 'ಬೆಳಗಿನ ಸ್ಲಾಟ್', Afternoon: 'ಮಧ್ಯಾಹ್ನದ ಸ್ಲಾಟ್', Evening: 'ಸಂಜೆಯ ಸ್ಲಾಟ್', Night: 'ರಾತ್ರಿಯ ಸ್ಲಾಟ್' };
  function slotText(s) {
    var m = String(s.label).match(/^(\S+)\s+(.*)$/);
    var en = m ? [m[1], m[2].replace(' - ', ' – ')] : [s.label, ''];
    if (lang !== 'kn' || !s.labelKn) return [en[0], en[1], s.label];
    var time = String(s.labelKn).replace(' - ', ' – ');
    var name = SLOT_KN[en[0]] || en[0];
    return [name, time, name + ' (' + time + ')'];
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

  /*
   * THE SLOT CARDS BRING THEIR OWN STYLING.
   *
   * app.js is re-read from disk on every request; the page's HTML and CSS live
   * in a module the server loaded when it started. Change how the slots are
   * drawn and the new markup reaches a visitor at once, while the CSS for it
   * waits for a restart — which is how the slot grid came to render on a phone
   * as a run of unstyled text: "Bike148Car399Toofan100TT100".
   *
   * Markup and styling now ship in the same file, so they cannot disagree. The
   * colours come from the page's own variables, which have been stable for far
   * longer than this layout has.
   */
  var SLOT_CSS = ".sgrid{display:grid;gap:10px}\n.slotcard{display:block;border:1px solid var(--line);border-radius:14px;background:var(--card);\npadding:12px 13px;cursor:pointer;transition:border-color .2s ease,box-shadow .2s ease,background .2s ease}\n.slotcard.sel{border-color:var(--accent);background:rgba(0,168,132,.07);box-shadow:0 0 0 2px rgba(0,168,132,.35)}\n.slotcard.off{cursor:not-allowed;opacity:.72}\n.slot-top{display:flex;align-items:flex-start;gap:11px}\n.slot-top input{width:auto;flex:none;margin:2px 0 0;accent-color:var(--accent);transform:scale(1.15)}\n.slot-id{flex:1;min-width:0}\n.slot-name{display:block;font-weight:700;font-size:15.5px;line-height:1.25}\n.sg-time{display:block;font-size:13px;color:var(--ink);opacity:.85;line-height:1.35;margin-top:1px}\n.sg-note{display:block;font-size:12px;color:var(--muted);margin-top:2px}\n.slot-mine{flex:none;text-align:right;line-height:1}\n.slot-mine b{display:block;font-size:23px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--ok)}\n.slot-mine small{display:block;font-size:11px;color:var(--muted);margin-top:2px}\n.slot-mine.low b{color:#8a4b00}\n.slot-mine.full b{font-size:17px;color:#a4160c}\n.slot-types{display:grid;grid-template-columns:repeat(auto-fit,minmax(74px,1fr));gap:6px;margin-top:11px}\n.tchip{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;\npadding:7px 4px;border-radius:10px;background:var(--bg);border:1px solid var(--line);\ntransition:opacity .3s ease,background .3s ease}\n.tname{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:var(--muted);\nline-height:1.1;white-space:nowrap}\n.tchip i{font-style:normal;font-size:13px;line-height:1}\n.tchip b{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink);line-height:1.15}\n.tchip.ok b{color:#0b6b3a}\n.tchip.low{background:#fff6e6;border-color:#f0d3a0}\n.tchip.low b{color:#8a4b00}\n.tchip.full{background:#fdeceb;border-color:#f3c2be}\n.tchip.full b{color:#a4160c;font-size:13px}\n.tchip.mine{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent);background:rgba(0,168,132,.08)}\n.tchip.dim{opacity:.45}\n.sg-shut{margin-top:10px;padding:8px 10px;border-radius:10px;font-size:12.5px;font-weight:600;\ncolor:#9a3412;background:repeating-linear-gradient(135deg,transparent 0 8px,rgba(154,52,18,.07) 8px 16px);\nborder:1px dashed rgba(154,52,18,.35);text-align:center}\n@media(prefers-color-scheme:dark){\n.tchip.ok b{color:#7ff0b4}\n.tchip.low{background:#3a2708;border-color:#6b4a12}.tchip.low b{color:#ffd27a}\n.tchip.full{background:#3f1310;border-color:#7a2a24}.tchip.full b{color:#ffb3ab}\n.slot-mine b{color:#7ff0b4}.slot-mine.low b{color:#ffd27a}.slot-mine.full b{color:#ffb3ab}\n.sg-shut{color:#fdba74}\n}\n@media(prefers-reduced-motion:reduce){.slotcard,.tchip{transition:none}}\n@media(min-width:420px){\n.slot-types{grid-template-columns:repeat(4,minmax(0,1fr))}\n.tchip{font-size:12.5px;padding:8px 6px}\n}\n.sg-legend{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;color:var(--muted);margin-top:10px}\n.sg-legend span{display:inline-flex;align-items:center;gap:5px}\n.sg-legend i{font-style:normal;width:11px;height:11px;border-radius:3px;display:inline-block}";
  (function () {
    if (document.getElementById('slot-styles')) return;
    var el = document.createElement('style');
    el.id = 'slot-styles';
    el.textContent = SLOT_CSS;
    document.head.appendChild(el);
  }());

  /*
   * REDRAWING THE SLOTS MUST NOT MOVE THE PAGE UNDER THE VISITOR.
   *
   * The slot grid sits above the vehicle field. Every vehicle check redraws it
   * with that vehicle's counts, and the redraw used to collapse the grid to one
   * "Loading…" line first: everything below it — the field the visitor was
   * typing in — jumped up by the grid's height, and the grid grew back in front
   * of them. A visitor who had already picked a slot and scrolled down to type
   * their number was thrown back up to the slots, every time.
   *
   * So the old grid stays on screen, dimmed, until the new one is ready; and if
   * the vehicle field is where the visitor is looking, it is held at exactly the
   * same place on screen across the redraw, whatever the grid above it does.
   */
  function steady(update) {
    var anchor = $('reg');
    var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    /* Only when the field is on screen or already scrolled past — somebody
       looking at the slots themselves is left exactly where they are. */
    var hold = r && r.top < (window.innerHeight || 0);
    var before = hold ? r.top : 0;
    update();
    if (!hold) return;
    var shift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(shift) > 1) window.scrollBy(0, shift);
  }

  var loadSeq = 0;
  function loadSlots() {
    var mine = ++loadSeq;
    if (placeIsSoon()) { steady(function () { $('slots').innerHTML = ''; }); return; }
    var v = state.vehicle;
    var myCode = v ? v.category.code : null;
    if ($('slots').querySelector('.sgrid')) {
      $('slots').style.opacity = '.55';   // the counts are being refreshed; the grid stays put
    } else {
      $('slots').innerHTML = '<div class="hint">' + esc(t('loadingSlots')) + '</div>';
    }

    api('slots', { placeId: $('place').value, travelDate: $('date').value }).then(function (r) {
      if (mine !== loadSeq) return; // a newer load has started; this answer is stale
      if (!r.ok) {
        steady(function () {
          $('slots').innerHTML = '<div class="hint">' + esc(t('cantLoad')) + '</div>';
          $('slots').style.opacity = '';
        });
        return;
      }

      var anyOpen = false, keep = null, lost = null;

      var rows = r.slots.map(function (s) {
        var byCode = {};
        (s.types || []).forEach(function (x) { byCode[x.code] = x; });
        var timeShut = s.timeClosed || s.isOpen === false;
        var mineLeft = myCode && byCode[myCode] ? byCode[myCode].remaining : null;
        var selectable = !timeShut && (myCode ? mineLeft > 0 : (s.types || []).some(function (x) { return x.remaining > 0; }));
        if (selectable) anyOpen = true;
        if (state.slot && state.slot.id === s.slotId) { if (selectable) keep = s; else lost = s; }

        var parts = slotText(s);
        var note;
        if (!timeShut) note = t('lastEntry', { t: clock(s.lastEntry) });
        else if (!s.timeClosed) note = s.closedNote || t('closed');
        else if (s.timeReason === 'too_late') note = t('tooLate', { t: clock(s.lastEntry) });
        else if (s.timeReason === 'slot_over') note = t('slotOver');
        else if (s.timeReason === 'date_past') note = t('datePast');
        else note = t('closed');

        /* The visitor's own count, promoted once we know what they drive: by
           then the only question left is whether there is room for them. */
        var mineBox = '';
        if (!timeShut && myCode && byCode[myCode]) {
          var mx = byCode[myCode];
          var mlv = level(mx.remaining, mx.capacity);
          mineBox = '<span class="slot-mine ' + mlv + '">'
            + (mx.remaining <= 0
              ? '<b>' + esc(t('full')) + '</b><small>' + esc(t('forYours')) + '</small>'
              : '<b class="n" data-to="' + mx.remaining + '">0</b><small>' + esc(t(mx.remaining === 1 ? 'left1' : 'leftN')) + '</small>')
            + '</span>';
        }

        /* The four types. Chips rather than table cells: they wrap two-by-two
           on a narrow phone instead of being crushed into five columns. */
        var chips = timeShut
          ? '<div class="sg-shut">' + esc(note) + '</div>'
          : '<div class="slot-types">' + COLS.map(function (col) {
            var x = byCode[col.code] || { remaining: 0, capacity: 0 };
            var lv = level(x.remaining, x.capacity);
            var isMine = myCode === col.code;
            /* The name is on the chip, not only in a tooltip: a car and a
               Toofan are two emoji apart, and a phone has no hover. */
            return '<span class="tchip ' + lv + (isMine ? ' mine' : '') + (myCode && !isMine ? ' dim' : '') + '"'
              + ' title="' + esc(col.name) + ': ' + esc(x.remaining <= 0 ? t('chipFull') : t('chipLeft', { n: x.remaining, c: x.capacity })) + '">'
              + '<span class="tname"><i>' + col.icon + '</i>' + esc(col.name) + '</span>'
              + (x.remaining <= 0 ? '<b>' + esc(t('full')) + '</b>' : '<b class="n" data-to="' + x.remaining + '">0</b>')
              + '</span>';
          }).join('') + '</div>';

        return '<label class="slotcard' + (selectable ? '' : ' off') + (keep === s ? ' sel' : '') + '" data-slot="' + esc(s.slotId) + '">'
          + '<span class="slot-top">'
          + '<input type="radio" name="slot" value="' + esc(s.slotId) + '"' + (selectable ? '' : ' disabled') + (keep === s ? ' checked' : '') + '>'
          + '<span class="slot-id">'
          + '<b class="slot-name" data-label="' + esc(parts[2]) + '">' + esc(parts[0]) + '</b>'
          + '<span class="sg-time">' + esc(parts[1]) + '</span>'
          + (timeShut ? '' : '<span class="sg-note">' + esc(note) + '</span>')
          + '</span>'
          + mineBox
          + '</span>'
          + chips + '</label>';
      }).join('');

      var html = '<div class="sgrid">' + rows + '</div>'
        + '<div class="sg-legend">'
        + '<span><i style="background:#dcf5e8;border:1px solid #a9e2c4"></i>' + esc(t('lgLeft')) + '</span>'
        + '<span><i style="background:#fff6e6;border:1px solid #f0d3a0"></i>' + esc(t('lgLow')) + '</span>'
        + '<span><i style="background:#fdeceb;border:1px solid #f3c2be"></i>' + esc(t('lgFull')) + '</span>'
        + '</div>';
      if (!v) {
        html = '<div class="hint" style="margin:0 0 8px">' + esc(t('intro')) + '</div>' + html;
      }
      if (lost) html += '<div class="msg warn show">' + msgHtml('lostT', t('lost', { slot: slotText(lost)[2] })) + '</div>';
      if (!anyOpen) html += '<div class="msg warn show">' + msgHtml('noSlotsT', t('noSlots')) + '</div>';

      steady(function () {
        $('slots').innerHTML = html;
        $('slots').style.opacity = '';
      });
      if (!keep) state.slot = null;
      Array.prototype.forEach.call($('slots').querySelectorAll('.n'), countUp);

      Array.prototype.forEach.call($('slots').querySelectorAll('input[name=slot]'), function (i) {
        i.addEventListener('change', function () {
          Array.prototype.forEach.call($('slots').querySelectorAll('.slotcard'), function (el) {
            el.classList.toggle('sel', el.getAttribute('data-slot') === i.value);
          });
          /* The card is the label around the radio, whatever the markup nests. */
          var card = i.closest ? i.closest('.slotcard') : i.parentNode.parentNode;
          state.slot = { id: i.value, label: card.querySelector('.slot-name').getAttribute('data-label') };
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
      steady(function () {
        $('slots').innerHTML = '<div class="msg bad show">'
          + (err && err.network ? msgHtml('noConnT', t('slotsNoConn')) : msgHtml('reloadT', t('reload')))
          + '</div>';
        $('slots').style.opacity = '';
      });
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
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + esc(k) + '</th><td>' + val + '</td></tr>';
    };
    $('review').innerHTML =
      '<table class="rev">'
      + '<thead><tr><th>' + esc(t('summary')) + '<span>' + esc(v.regNo) + '</span></th></tr></thead>'
      + '<tbody>'
      + '<tr><td><table class="inner"><caption>' + esc(t('visit')) + '</caption><tbody>'
      + tr(t('name'), esc($('name').value || '—'))
      + tr(t('dest'), esc(placeName))
      + tr(t('date'), esc(dateName))
      + tr(t('slot'), esc(s.label))
      + '</tbody></table></td></tr>'
      + '<tr><td><table class="inner"><caption>' + esc(t('vdetails')) + '</caption><tbody>'
      + tr(t('vnum'), '<span class="mono">' + esc(v.regNo) + '</span>')
      + tr(t('make'), esc(v.vehicle.make || '—'))
      + tr(t('model'), esc(v.vehicle.model || '—'))
      + tr(t('variant'), esc(v.vehicle.variant || '—'))
      + tr(t('vtype'), esc(TYPE[v.category.code] || v.category.label))
      + '</tbody></table></td></tr>'
      + '<tr><td><table class="inner pay"><caption>' + esc(t('paydetails')) + '</caption><tbody>'
      + tr(t('entryFee'), '₹' + esc(v.price.entry))
      + tr(t('platFee'), '₹' + esc(v.price.platform))
      + tr(t('total'), '₹' + esc(v.price.total), 'total')
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
    b.disabled = false; b.textContent = t('continuePay');
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
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th>' + esc(k) + '</th><td>' + val + '</td></tr>';
    };
    $('holdSummary').innerHTML = '<table class="sum"><tbody>'
      + tr(t('vehicle'), esc(v.regNo) + ' · ' + esc(TYPE[v.category.code] || v.category.label))
      + tr(t('dest'), esc(placeName))
      + tr(t('dateShort'), esc(dateName))
      + tr(t('slot'), esc(s.label))
      + tr(t('total'), '₹' + esc(r.amount || v.price.total), 'total')
      + '</tbody></table>';
    $('holdPay').textContent = t('confirmPay', { a: r.amount || v.price.total });
    $('holdPay').disabled = false;
    show($('holdErr'), false);

    hold = { payUrl: r.payUrl, endsAt: Date.now() + (r.secondsLeft || (r.holdMinutes || 10) * 60) * 1000 };
    var tick = function () {
      if (!hold) return;
      var left = Math.round((hold.endsAt - Date.now()) / 1000);
      $('holdClock').textContent = fmt(left);
      $('holdTimer').classList.toggle('low', left <= 120);
      if (left <= 0) {
        releaseHold(msgHtml('holdExpT', t('holdExp')));
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
      var showRow = !!(offer && offer.offered);
      vis(row, showRow);
      if (showRow && offer.gate) hint.textContent = t('gateHint', { gate: offer.gate });
      /* Anything left over from a previous hold is cleared on the server too. */
      if (!showRow) tell(false).catch(function () {});
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
        say(t('noGeo'));
        return;
      }

      row.classList.add('busy');
      say(t('checkingGate'));

      /*
       * THE FIRST ANSWER IS OFTEN NOT THE REAL ONE.
       *
       * On Android the first request is where the browser asks "Allow?" — and if
       * the phone's own location switch is off, that request fails at once,
       * before the phone has offered to turn it on. The offer only appears on
       * the next request. Visitors tapped "Allow for now", were told their
       * location could not be read, ticked the box again, and only then saw the
       * phone ask to switch location on.
       *
       * So a failure that is not a flat refusal is asked again by the page
       * itself, twice, a moment apart — which is what brings up the phone's own
       * prompt — and the visitor sees "checking" throughout instead of an error
       * they have to work around. A refusal is asked once more (some in-app
       * browsers report the permission prompt itself as a refusal) and then
       * believed. Unticking the box stops it.
       */
      var attempt = 0;
      var locate = function () {
        attempt += 1;
        navigator.geolocation.getCurrentPosition(function (pos) {
          if (!box.checked) return;
          tell(true, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          }).then(function (r) {
            row.classList.remove('busy');
            if (r.ok && r.on) {
              box.checked = true;
              row.classList.add('on');
              say(r.message || t('atGate'), true);
            } else {
              box.checked = false;
              row.classList.remove('on');
              say(r.message || t('notAtGate'));
            }
          }).catch(function () {
            row.classList.remove('busy');
            box.checked = false;
            say(t('gateErr'));
          });
        }, function (err) {
          if (!box.checked) { row.classList.remove('busy'); return; }
          var refused = err && err.code === 1;
          if (attempt < (refused ? 2 : 3)) {
            say(t('checkingGate'));
            setTimeout(function () { if (box.checked) locate(); }, attempt === 1 ? 1500 : 2500);
            return;
          }
          row.classList.remove('busy');
          box.checked = false;
          say(refused ? t('locOff') : t('locUnread'));
        }, {
          enableHighAccuracy: true,
          timeout: attempt === 1 ? 15000 : 20000,
          /* A position remembered from before the switch was turned on is no use. */
          maximumAge: attempt === 1 ? 30000 : 0
        });
      };
      locate();
    });

    return { reset: reset };
  }());

  $('pay').addEventListener('click', function () {
    var v = state.vehicle, s = state.slot;
    if (!v || !s) return;
    var b = $('pay'), err = $('payerr');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>' + esc(t('holding'));
    show(err, false);

    api('confirm', {
      placeId: $('place').value, travelDate: $('date').value,
      slotId: s.id, regNo: v.regNo
    }).then(function (r) {
      if (!r.ok) {
        b.disabled = false; b.textContent = t('continuePay');
        err.innerHTML = msgHtml('cantHoldT', r.message || t('tryAgain'));
        show(err, true);
        if (r.error === 'sold_out' || r.error === 'slot_closed') loadSlots();
        return;
      }
      b.innerHTML = '<span class="spin"></span>' + esc(t('held'));
      openHold(r);
    }).catch(function (e) {
      b.disabled = false; b.textContent = t('continuePay');
      if (!(e && e.network)) report('confirm', e);
      err.innerHTML = e && e.network ? msgHtml('noConnT', t('payNoConn')) : msgHtml('reloadT', t('reload'));
      show(err, true);
    });
  });

  $('holdPay').addEventListener('click', function () {
    if (!hold) return;
    var b = $('holdPay');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>' + esc(t('opening'));
    if (hold.timer) clearInterval(hold.timer);
    window.location.href = hold.payUrl;
  });

  $('holdCancel').addEventListener('click', function () {
    releaseHold(msgHtml('releasedT', t('released')));
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
