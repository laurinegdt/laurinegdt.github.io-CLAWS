(function () {
  var params = new URLSearchParams(window.location.search);
  var clawId = params.get('id');
  var claw = clawId ? ClawStorage.getClaw(clawId) : ClawStorage.getSelectedClaw();

  if (!claw) {
    window.location.replace('my-claws.html');
    return;
  }

  ClawStorage.setSelectedId(claw.id);

  var titleEl = document.getElementById('claw-page-title');
  var subtitleEl = document.getElementById('claw-page-subtitle');
  var nameEl = document.getElementById('id-card-name');
  var messageEl = document.getElementById('id-card-message');
  var emptyEl = document.getElementById('id-card-empty');
  var card = document.getElementById('id-card');
  var deleteBtn = document.getElementById('delete-claw-btn');
  var modifierBtn = document.getElementById('modifier-btn');
  var passwordSection = document.getElementById('password-section');
  var nfcSection = document.getElementById('nfc-section');
  var signalLogLink = document.getElementById('signal-log-link');
  var signalLogSummary = document.getElementById('signal-log-summary');
  var signalEditLink = document.getElementById('signal-edit-link');
  var signal = claw.signal;

  var signalEditUrl =
    '../community/my-signal.html?id=' + encodeURIComponent(claw.id);

  if (signalEditLink) {
    signalEditLink.href = signalEditUrl;
  }

  titleEl.textContent = claw.label.toUpperCase();
  if (claw.accessMode === 'password') {
    subtitleEl.textContent = 'Password claw — XIAO Chat';
    if (passwordSection) {
      passwordSection.hidden = false;
    }
  } else if (claw.accessMode === 'nfc') {
    subtitleEl.textContent = 'NFC claw';
    if (nfcSection) {
      nfcSection.hidden = false;
    }
  } else {
    subtitleEl.textContent = 'Your claw profile';
    if (passwordSection) {
      passwordSection.hidden = false;
    }
    if (nfcSection) {
      nfcSection.hidden = false;
    }
  }

  var passwordLabelEl = document.getElementById('active-password-label');
  var nfcLabelEl = document.getElementById('active-nfc-label');

  modifierBtn.href = '../menu/add-claw.html';

  if (!signal || !signal.message) {
    card.classList.add('id-card--empty');
    if (signalEditLink) {
      signalEditLink.textContent = 'Create signal';
    }
  } else {
    card.classList.add('id-card--active');
    nameEl.textContent = signal.name;
    messageEl.textContent = signal.message;
    emptyEl.hidden = true;
    if (signalEditLink) {
      signalEditLink.textContent = 'Edit signal';
    }
  }

  if (signalLogLink) {
    signalLogLink.href =
      '../community/signal-log.html?id=' + encodeURIComponent(claw.id);
  }

  var logCount = ClawStorage.getClawSignalLog(claw.id).length;
  if (signalLogSummary) {
    if (logCount === 0) {
      signalLogSummary.textContent = '· no detections yet';
    } else {
      signalLogSummary.textContent =
        '· ' + logCount + (logCount === 1 ? ' detection' : ' detections');
    }
  }

  var activePassword = ClawStorage.getActivePassword(claw.id);
  if (activePassword) {
    passwordLabelEl.textContent = activePassword.name;
    passwordLabelEl.classList.add('claw-active__value--set');
  } else {
    passwordLabelEl.textContent = 'None — tap Choose password';
    passwordLabelEl.classList.add('claw-active__value--empty');
  }

  var activeNfc = ClawStorage.getActiveNfc(claw.id);
  if (activeNfc) {
    nfcLabelEl.textContent = activeNfc.title;
    nfcLabelEl.classList.add('claw-active__value--set');
  } else {
    nfcLabelEl.textContent = 'None — tap Choose NFC';
    nfcLabelEl.classList.add('claw-active__value--empty');
  }

  deleteBtn.addEventListener('click', function () {
    if (!window.confirm('Delete this claw and its saved data?')) {
      return;
    }
    ClawStorage.deleteClaw(claw.id);
    window.location.href = 'my-claws.html';
  });
})();
