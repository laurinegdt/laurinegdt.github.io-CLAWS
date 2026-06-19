(function () {
  var SCAN_DURATION_MS = 3500;

  var module = ClawBadge.createScannedModule();
  ClawBadge.setPendingModule(module);

  window.setTimeout(function () {
    window.location.href = 'badge-register.html';
  }, SCAN_DURATION_MS);
})();
