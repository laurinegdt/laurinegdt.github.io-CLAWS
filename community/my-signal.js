(function () {
  if (!window.ClawStorage) {
    window.location.replace('../my-claw/my-claws.html');
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var clawId = params.get('id');
  if (clawId && ClawStorage.getClaw(clawId)) {
    ClawStorage.setSelectedId(clawId);
  }

  var claw = ClawStorage.getSelectedClaw();
  if (!claw) {
    window.location.replace('../my-claw/my-claws.html');
    return;
  }

  clawId = claw.id;

  if (window.ClawContext) {
    ClawContext.initBackLinks();
  }

  var clawLabelEl = document.getElementById('my-signal-claw');
  if (clawLabelEl) {
    clawLabelEl.textContent = claw.label;
  }

  var form = document.getElementById('signal-form');
  var deleteBtn = document.getElementById('delete-signal');
  var syncBtn = document.getElementById('sync-emitter');
  var nameModeAnonymous = form.querySelector('input[value="anonymous"]');
  var nameModeCustom = document.getElementById('name-mode-custom');
  var displayName = document.getElementById('display-name');
  var displayMessage = document.getElementById('display-message');

  if (!window.ClawSignal) {
    alert('Signal storage failed to load. Refresh the page.');
    return;
  }

  var saved = ClawSignal.getMySignal();
  var hasSaved = !!(saved && saved.message);

  function clawUrl() {
    return '../my-claw/my-claw.html?id=' + encodeURIComponent(clawId);
  }

  function syncNameField() {
    var isCustom = nameModeCustom.checked;
    displayName.disabled = !isCustom;
    if (!isCustom) {
      displayName.value = '';
    }
  }

  function fillForm(signal) {
    if (!signal) {
      return;
    }
    displayMessage.value = signal.message;
    if (signal.name === 'anonymous') {
      nameModeAnonymous.checked = true;
    } else {
      nameModeCustom.checked = true;
      displayName.value = signal.name;
    }
    syncNameField();
  }

  function readForm() {
    var message = displayMessage.value.trim();
    if (!message) {
      displayMessage.focus();
      return null;
    }

    var name;
    if (nameModeAnonymous.checked) {
      name = 'anonymous';
    } else {
      name = displayName.value.trim();
      if (!name) {
        nameModeCustom.checked = true;
        syncNameField();
        displayName.focus();
        return null;
      }
    }

    return { name: name, message: message };
  }

  if (hasSaved) {
    fillForm(saved);
    deleteBtn.hidden = false;
    if (syncBtn) {
      syncBtn.hidden = false;
    }
  }

  nameModeAnonymous.addEventListener('change', syncNameField);
  nameModeCustom.addEventListener('change', syncNameField);
  displayName.addEventListener('focus', function () {
    nameModeCustom.checked = true;
    syncNameField();
  });
  displayName.addEventListener('input', function () {
    if (displayName.value.trim()) {
      nameModeCustom.checked = true;
      syncNameField();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = readForm();
    if (!data) {
      return;
    }
    var result = ClawSignal.saveMySignal(data.name, data.message, clawId);
    if (!result) {
      alert('Could not save signal. Open this page from your claw and try again.');
      return;
    }
    window.location.href = clawUrl();
  });

  deleteBtn.addEventListener('click', function () {
    if (!window.confirm('Delete this signal?')) {
      return;
    }
    ClawSignal.deleteMySignal(clawId);
    window.location.href = clawUrl();
  });

  if (syncBtn && window.ClawSignalEmitter) {
    syncBtn.addEventListener('click', function () {
      var data = readForm();
      if (!data) {
        return;
      }
      ClawSignal.saveMySignal(data.name, data.message, clawId);
      syncBtn.disabled = true;
      syncBtn.textContent = 'Connecting…';
      ClawSignalEmitter.syncEmitter(data.name, data.message)
        .then(function () {
          syncBtn.textContent = 'Synced to emitter';
        })
        .catch(function (err) {
          alert('Could not connect to CLAWEmit: ' + (err.message || err));
          syncBtn.textContent = 'Sync to emitter';
        })
        .finally(function () {
          syncBtn.disabled = false;
        });
    });
  }
})();
