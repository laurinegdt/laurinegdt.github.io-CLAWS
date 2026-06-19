(function () {
  var list = document.getElementById('badge-list');
  var empty = document.getElementById('badge-empty');
  var addBtn = document.getElementById('badge-add-btn');
  var badges = ClawBadge.getBadges();

  if (!badges.length) {
    addBtn.hidden = false;
    return;
  }

  empty.hidden = true;
  list.hidden = false;

  badges.forEach(function (badge) {
    var li = document.createElement('li');
    li.className = 'badge-list__item';
    li.innerHTML =
      '<div class="saved-item__content">' +
        '<p class="badge-list__name">' + escapeHtml(badge.name) + '</p>' +
        '<p class="badge-list__uid">' + escapeHtml(badge.uid) + '</p>' +
      '</div>' +
      '<button type="button" class="delete-btn" data-id="' + escapeHtml(badge.id) + '">Delete</button>';
    list.appendChild(li);
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-btn');
    if (!btn) return;
    ClawBadge.deleteBadge(btn.getAttribute('data-id'));
    btn.closest('.badge-list__item').remove();
    if (!list.querySelector('.badge-list__item')) {
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
})();
