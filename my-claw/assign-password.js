(function () {
  var claw = ClawStorage.getSelectedClaw();
  if (!claw) {
    window.location.replace('my-claws.html');
    return;
  }
  if (!ClawStorage.requireAccessMode(claw.id, 'password', 'my-claw.html')) {
    return;
  }

  var listEl = document.getElementById('assign-list');
  var form = document.getElementById('assign-form');
  var passwords = ClawPassword.getPasswords();
  var active = ClawPassword.getActivePassword();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (!passwords.length) {
    listEl.innerHTML =
      '<li class="assign-list__empty">No passwords yet. ' +
      '<a href="../memory/new-password.html">Add one</a>.</li>';
    form.querySelector('.signal-save').disabled = true;
    return;
  }

  var noneId = '__none__';
  var options = [{ id: noneId, name: 'None', meta: 'No password on this claw' }].concat(
    passwords.map(function (p) {
      var meta = 'activate by ' + p.activateBy;
      if (p.activateBy === 'gesture' && p.gestureSequence && p.gestureSequence.length) {
        meta += ' · ' + p.gestureSequence.join(' → ');
      }
      return { id: p.id, name: p.name, meta: meta };
    })
  );

  var selectedId = active ? active.id : noneId;

  options.forEach(function (opt) {
    var li = document.createElement('li');
    li.className = 'assign-list__item';
    li.innerHTML =
      '<label class="assign-option">' +
        '<input type="radio" name="active" value="' + escapeHtml(opt.id) + '"' +
        (opt.id === selectedId ? ' checked' : '') + '>' +
        '<span class="assign-option__body">' +
          '<span class="assign-option__title">' + escapeHtml(opt.name) + '</span>' +
          '<span class="assign-option__meta">' + escapeHtml(opt.meta) + '</span>' +
        '</span>' +
      '</label>';
    listEl.appendChild(li);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var chosen = form.querySelector('input[name="active"]:checked');
    if (!chosen) {
      return;
    }
    var id = chosen.value === noneId ? null : chosen.value;
    ClawPassword.setActivePassword(id);
    if (id && window.ClawBle && ClawBle.isConnected()) {
      ClawPassword.syncToDevice().finally(function () {
        window.location.href = ClawStorage.getClawDetailUrl(claw.id);
      });
      return;
    }
    window.location.href = ClawStorage.getClawDetailUrl(claw.id);
  });
})();
