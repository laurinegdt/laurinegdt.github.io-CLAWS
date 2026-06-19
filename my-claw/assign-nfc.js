(function () {
  var claw = ClawStorage.getSelectedClaw();
  if (!claw) {
    window.location.replace('my-claws.html');
    return;
  }
  if (!ClawStorage.requireAccessMode(claw.id, 'nfc', 'my-claw.html')) {
    return;
  }

  var listEl = document.getElementById('assign-list');
  var form = document.getElementById('assign-form');
  var configs = ClawNfcStorage.getNfcConfigs();
  var active = ClawNfcStorage.getActiveNfc();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (!configs.length) {
    listEl.innerHTML =
      '<li class="assign-list__empty">No NFC tags yet. ' +
      '<a href="../access/nfc-home.html">Add one</a>.</li>';
    form.querySelector('.signal-save').disabled = true;
    return;
  }

  var noneId = '__none__';
  var selectedId = active ? active.id : noneId;

  var noneLi = document.createElement('li');
  noneLi.className = 'assign-list__item';
  noneLi.innerHTML =
    '<label class="assign-option">' +
      '<input type="radio" name="active" value="' + noneId + '"' +
      (selectedId === noneId ? ' checked' : '') + '>' +
      '<span class="assign-option__body">' +
        '<span class="assign-option__title">None</span>' +
        '<span class="assign-option__meta">No NFC on this claw</span>' +
      '</span>' +
    '</label>';
  listEl.appendChild(noneLi);

  configs.forEach(function (item) {
    var li = document.createElement('li');
    li.className = 'assign-list__item';
    li.innerHTML =
      '<label class="assign-option">' +
        '<input type="radio" name="active" value="' + escapeHtml(item.id) + '"' +
        (item.id === selectedId ? ' checked' : '') + '>' +
        '<span class="assign-option__body">' +
          '<span class="assign-option__title">' + escapeHtml(item.title) + '</span>' +
          '<span class="assign-option__meta">' +
            escapeHtml(ClawNfcStorage.typeLabel(item.type)) + ' · ' +
            escapeHtml(ClawNfcStorage.previewPayload(item.type, item.payload)) +
          '</span>' +
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
    ClawNfcStorage.setActiveNfc(id);
    if (id && window.ClawBle && ClawBle.isConnected()) {
      var config = configs.filter(function (c) { return c.id === id; })[0];
      ClawNfcStorage.syncToDevice(config).finally(function () {
        window.location.href = ClawStorage.getClawDetailUrl(claw.id);
      });
      return;
    }
    window.location.href = ClawStorage.getClawDetailUrl(claw.id);
  });
})();
