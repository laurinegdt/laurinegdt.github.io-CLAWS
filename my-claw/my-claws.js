(function () {
  var listEl = document.getElementById('my-claws-list');
  var claws = ClawStorage.getClaws();

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function signalPreview(claw) {
    if (claw.signal && claw.signal.message) {
      return claw.signal.message;
    }
    return 'No signal yet';
  }

  if (!claws.length) {
    listEl.innerHTML =
      '<li class="my-claws__empty">No claws yet. Add your first claw to get started.</li>';
    return;
  }

  claws.forEach(function (claw) {
    var li = document.createElement('li');
    li.className = 'my-claws__item';
    li.innerHTML =
      '<a class="my-claws__link" href="my-claw.html?id=' + encodeURIComponent(claw.id) + '">' +
        '<span class="my-claws__name">' + escapeHtml(claw.label) + '</span>' +
        '<span class="my-claws__preview">' + escapeHtml(signalPreview(claw)) + '</span>' +
      '</a>';
    listEl.appendChild(li);
  });
})();
