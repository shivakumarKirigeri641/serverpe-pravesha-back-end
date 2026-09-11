/* Pravesha booking form — client script.
   Plain ES5-ish JavaScript with no build step: this is opened from a chat, on
   whatever browser the visitor's phone gives WhatsApp, and a transpiler in the
   way of that is a dependency with nothing to show for itself. */
(function () {
  function $(id) { return document.getElementById(id); }
  var tok = $('tok').value;
  var state = {};

  function api(path, body) {
    return fetch('/book/' + tok + '/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
  function show(el, on) { el.classList.toggle('show', !!on); }
  function vis(el, on) { el.classList.toggle('hide', !on); }

  function placeIsSoon() {
    var o = $('place').selectedOptions[0];
    return !!(o && o.getAttribute('data-soon') === '1');
  }

  /* A destination that is not open yet stays visible in the list and simply
     cannot be chosen. Hiding it would make the platform look like it serves one
     hill; showing it greyed says which ones are coming. */
  function onPlace() {
    var soon = placeIsSoon();
    show($('soon'), soon);
    $('check').disabled = soon;
    reset();
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

  function reset() {
    highlightFee(null);
    state.vehicle = null; state.slot = null;
    show($('vok'), false); show($('verr'), false);
    vis($('slotCard'), false); vis($('revCard'), false);
  }

  $('place').addEventListener('change', onPlace);
  $('date').addEventListener('change', function () { if (state.vehicle) loadSlots(); });

  $('reg').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    reset();
  });

  $('check').addEventListener('click', function () {
    var reg = $('reg').value.trim();
    if (reg.length < 6) {
      $('verr').innerHTML = 'Please enter the full registration number.';
      show($('verr'), true); return;
    }
    var b = $('check');
    b.disabled = true;
    b.innerHTML = '<span class="spin"></span>Checking…';
    show($('verr'), false); show($('vok'), false);

    api('vehicle', { regNo: reg, placeId: $('place').value }).then(function (r) {
      b.disabled = false; b.textContent = 'Check vehicle';
      if (!r.ok) {
        var m = r.message || 'We could not check that number.';
        if (r.messageKn) { m += '<br><span style="opacity:.85">' + r.messageKn + '</span>'; }
        if (r.vehicle) { m += '<br><span style="opacity:.7;font-size:12.5px">' + r.vehicle + '</span>'; }
        $('verr').innerHTML = m;
        show($('verr'), true);
        return;
      }
      state.vehicle = r;
      /* Laid out as labelled fields rather than one run-on line, so the visitor
         can check each part against their own vehicle -- and "Vehicle type" is
         always one of the four fare categories, since that is what they pay. */
      var TYPE = { BIKE: 'Bike', CAR: 'Car', TOOFAN: 'Toofan', TT: 'Tempo Traveller (TT)' };
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
      $('vfee').innerHTML = 'Fee for this vehicle: <b>₹' + r.price.total + '</b>';
      show($('vok'), true);
      highlightFee(r.category.id);
      loadSlots();
    }).catch(function () {
      b.disabled = false; b.textContent = 'Check vehicle';
      $('verr').textContent = 'Something went wrong. Please try again.';
      show($('verr'), true);
    });
  });

  /* Availability is asked for only once the vehicle is known, because capacity
     is held per category: the number left for a car is not the number left for
     a Tempo Traveller on the same road at the same hour. */
  function loadSlots() {
    if (!state.vehicle) return;
    $('slots').innerHTML = '<div class="hint">Checking availability…</div>';
    vis($('slotCard'), true); vis($('revCard'), false);
    state.slot = null;

    api('slots', {
      placeId: $('place').value,
      categoryId: state.vehicle.category.id,
      travelDate: $('date').value
    }).then(function (r) {
      if (!r.ok) { $('slots').innerHTML = '<div class="hint">Could not load availability.</div>'; return; }
      /* Why a slot cannot be picked is said plainly, because the reasons mean
         different things to the visitor: "Full" means try another slot, while
         "Finished for today" means try another day. */
      var WHY = {
        slot_over: 'Finished for today',
        too_late: 'Closed — last entry was ',
        date_past: 'This date has passed'
      };
      var anyOpen = false;
      $('slots').innerHTML = r.slots.map(function (s) {
        var left, closed = !s.bookable;
        if (s.timeClosed) {
          left = s.timeReason === 'too_late' ? WHY.too_late + s.lastEntry : (WHY[s.timeReason] || 'Closed');
        } else if (!s.isOpen) {
          left = s.closedNote || 'Closed';
        } else if (s.remaining <= 0) {
          left = 'Full';
        } else {
          left = s.remaining + ' of ' + s.capacity + ' left · last entry ' + s.lastEntry;
          anyOpen = true;
        }
        return '<label class="slot' + (closed ? ' full' : '') + '" data-slot="' + s.slotId + '">'
          + '<input type="radio" name="slot" value="' + s.slotId + '"' + (closed ? ' disabled' : '') + '>'
          + '<span class="slot-main"><span class="slot-name">' + s.label + '</span>'
          + '<span class="slot-left' + (closed ? ' closed' : '') + '">' + left + '</span></span></label>';
      }).join('');
      if (!anyOpen) {
        $('slots').innerHTML += '<div class="msg warn show">No slots are available on this date. Please choose another date.</div>';
      }

      var radios = $('slots').querySelectorAll('input[name=slot]');
      Array.prototype.forEach.call(radios, function (i) {
        i.addEventListener('change', function () {
          var all = $('slots').querySelectorAll('.slot');
          Array.prototype.forEach.call(all, function (el) {
            el.classList.toggle('sel', el.getAttribute('data-slot') === i.value);
          });
          var wrap = i.parentNode;
          state.slot = { id: i.value, label: wrap.querySelector('.slot-name').textContent };
          review();
        });
      });
    });
  }

  function row(k, v) {
    return '<div class="row"><span style="color:var(--muted)">' + k + '</span><span>' + v + '</span></div>';
  }

  function review() {
    var v = state.vehicle, s = state.slot;
    if (!v || !s) return;
    var placeName = $('place').selectedOptions[0].textContent.split('—')[0].trim();
    var dateName = $('date').selectedOptions[0].textContent;
    $('review').innerHTML =
      '<div class="sub">Visit details</div>'
      + row('Name', $('name').value || '—')
      + row('Destination', placeName)
      + row('Date', dateName)
      + row('Slot', s.label)
      + row('Vehicle', v.regNo)
      + row('Type', v.category.label)
      + '<div class="sub gap">Payment summary</div>'
      + '<table class="paygrid"><tbody>'
      + '<tr><td>Entry fee (' + v.category.label + ')</td><td>₹' + v.price.entry + '</td></tr>'
      + '<tr><td>Platform fee</td><td>₹' + v.price.platform + '</td></tr>'
      + '<tr class="total"><td>Total payable</td><td>₹' + v.price.total + '</td></tr>'
      + '</tbody></table>';
    vis($('revCard'), true);
    $('revCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('pay').addEventListener('click', function () {
    alert('Payment is the next step — Razorpay checkout is already built and will be connected here.');
  });

  onPlace();
})();
