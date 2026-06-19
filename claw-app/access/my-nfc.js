(function () {
  var list = document.getElementById('nfc-list');
  var empty = document.getElementById('nfc-empty');
  var configs = ClawNfcStorage.getNfcConfigs();
  var active = ClawNfcStorage.getActiveNfc();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (!configs.length) {
    return;
  }

  empty.hidden = true;
  list.hidden = false;

  configs.forEach(function (item) {
    var isActive = active && active.id === item.id;
    var li = document.createElement('li');
    li.className = 'nfc-list__item' + (isActive ? ' nfc-list__item--active' : '');
    li.innerHTML =
      '<div class="saved-item__content">' +
        '<p class="nfc-list__title">' + escapeHtml(item.title) +
          (isActive ? ' <span class="nfc-list__badge">active</span>' : '') +
        '</p>' +
        '<p class="nfc-list__meta">' + escapeHtml(ClawNfcStorage.typeLabel(item.type)) + '</p>' +
        '<p class="nfc-list__preview">' + escapeHtml(ClawNfcStorage.previewPayload(item.type, item.payload)) + '</p>' +
      '</div>' +
      '<button type="button" class="delete-btn" data-id="' + escapeHtml(item.id) + '">Delete</button>';
    list.appendChild(li);
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-btn');
    if (!btn) {
      return;
    }
    if (!window.confirm('Delete this NFC tag from the library?')) {
      return;
    }
    ClawNfcStorage.deleteNfcConfig(btn.getAttribute('data-id'));
    btn.closest('.nfc-list__item').remove();
    if (!list.querySelector('.nfc-list__item')) {
      list.hidden = true;
      empty.hidden = false;
    }
  });
})();
