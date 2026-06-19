(function () {
  var list = document.getElementById('password-list');
  var empty = document.getElementById('password-empty');
  var addBtn = document.getElementById('password-add-btn');
  var passwords = ClawPassword.getPasswords();
  var active = ClawPassword.getActivePassword();

  if (!passwords.length) {
    addBtn.hidden = false;
    return;
  }

  empty.hidden = true;
  list.hidden = false;

  passwords.forEach(function (item) {
    var meta = item.activateBy;
    if (item.activateBy === 'gesture' && item.gestureSequence && item.gestureSequence.length) {
      meta += ' · ' + item.gestureSequence.join(' → ');
    }
    var isActive = active && active.id === item.id;

    var li = document.createElement('li');
    li.className = 'password-list__item' + (isActive ? ' password-list__item--active' : '');
    li.innerHTML =
      '<div class="saved-item__content">' +
        '<p class="password-list__name">' + escapeHtml(item.name) +
          (isActive ? ' <span class="saved-item__badge">active</span>' : '') +
        '</p>' +
        '<p class="password-list__meta">activate by ' + escapeHtml(meta) + '</p>' +
        '<p class="password-list__secret" aria-label="Password hidden">••••••••</p>' +
      '</div>' +
      '<button type="button" class="delete-btn" data-id="' + escapeHtml(item.id) + '">Delete</button>';
    list.appendChild(li);
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-btn');
    if (!btn) return;
    ClawPassword.deletePassword(btn.getAttribute('data-id'));
    btn.closest('.password-list__item').remove();
    if (!list.querySelector('.password-list__item')) {
      list.hidden = true;
      empty.hidden = false;
      addBtn.hidden = false;
    }
  });

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  if (passwords.length && window.ClawBle && window.ClawBle.isConnected()) {
    ClawPassword.syncToDevice().catch(function () {});
  }
})();
