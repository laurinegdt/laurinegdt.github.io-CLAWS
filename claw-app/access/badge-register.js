(function () {
  var module = ClawBadge.getPendingModule();
  if (!module) {
    window.location.replace('scan-badge.html');
    return;
  }

  document.getElementById('nfc-uid').textContent = module.uid;
  document.getElementById('nfc-memory').textContent = module.memory;
  document.getElementById('nfc-tech').textContent = module.technology;

  document.getElementById('badge-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var nameInput = document.getElementById('badge-name');
    var name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    ClawBadge.saveBadge(name, module);
    window.location.href = 'my-badges.html';
  });
})();
