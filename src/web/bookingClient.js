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

  function reset() {
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
      $('vtitle').textContent = [r.vehicle.make, r.vehicle.model].filter(Boolean).join(' ') || r.regNo;
      $('vsub').textContent = [r.vehicle.type, r.vehicle.fuel, r.vehicle.colour].filter(Boolean).join(' · ');
      $('vbadge').textContent = r.category.label + ' — ₹' + r.price.total;
      show($('vok'), true);
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
      $('slots').innerHTML = r.slots.map(function (s) {
        var full = !s.isOpen || s.remaining <= 0;
        var left = !s.isOpen ? (s.closedNote || 'Closed')
          : (s.remaining <= 0 ? 'Full' : s.remaining + ' of ' + s.capacity + ' left');
        return '<label class="slot' + (full ? ' full' : '') + '" data-slot="' + s.slotId + '">'
          + '<input type="radio" name="slot" value="' + s.slotId + '"' + (full ? ' disabled' : '') + '>'
          + '<span class="slot-main"><span class="slot-name">' + s.label + '</span>'
          + '<span class="slot-left">' + left + '</span></span></label>';
      }).join('');

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
      row('Name', $('name').value || '—')
      + row('Destination', placeName)
      + row('Date', dateName)
      + row('Slot', s.label)
      + row('Vehicle', v.regNo)
      + row('Type', v.category.label)
      + row('Entry fee', '₹' + v.price.entry)
      + row('Platform fee', '₹' + v.price.platform)
      + '<div class="row total"><span>Total</span><span>₹' + v.price.total + '</span></div>';
    vis($('revCard'), true);
    $('revCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('pay').addEventListener('click', function () {
    alert('Payment is the next step — Razorpay checkout is already built and will be connected here.');
  });

  onPlace();
})();
