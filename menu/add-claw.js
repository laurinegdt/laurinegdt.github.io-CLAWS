(function () {
  if (!window.ClawStorage) {
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var isNew = params.get('new') === '1';
  var newSection = document.getElementById('new-claw-section');
  var modifierSection = document.getElementById('modifier-section');
  var newForm = document.getElementById('new-claw-form');
  var addPasswordLink = document.getElementById('modifier-add-password');
  var myPasswordsLink = document.getElementById('modifier-my-passwords');
  var programNfcLink = document.getElementById('modifier-program-nfc');
  var myNfcLink = document.getElementById('modifier-my-nfc');
  var modeEl = document.getElementById('modifier-claw-mode');

  if (isNew) {
    document.title = 'CLAW — New claw';
    if (newSection) {
      newSection.hidden = false;
    }
    if (modifierSection) {
      modifierSection.hidden = true;
    }

    if (newForm) {
      newForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var modeInput = newForm.querySelector('input[name="accessMode"]:checked');
        if (!modeInput) {
          window.alert('Choose Password or NFC for this claw.');
          return;
        }
        var labelInput = document.getElementById('new-claw-label');
        var label = labelInput && labelInput.value.trim();
        var claws = ClawStorage.getClaws();
        if (!label) {
          label = modeInput.value === 'password' ? 'Password claw ' + (claws.length + 1) : 'NFC claw ' + (claws.length + 1);
        }
        var claw = ClawStorage.createClaw({ label: label, accessMode: modeInput.value });
        window.location.replace(ClawStorage.getClawDetailUrl(claw.id));
      });
    }
    return;
  }

  if (!ClawStorage.requireSelectedOrRedirect('../my-claw/my-claws.html')) {
    return;
  }

  var selected = ClawStorage.getSelectedClaw();
  var nameEl = document.getElementById('modifier-claw-name');
  if (nameEl && selected) {
    nameEl.textContent = selected.label;
  }

  if (selected && modeEl) {
    if (selected.accessMode === 'password') {
      modeEl.textContent = 'Function: Password (XIAO Chat)';
      if (addPasswordLink) {
        addPasswordLink.hidden = false;
      }
      if (myPasswordsLink) {
        myPasswordsLink.hidden = false;
      }
    } else if (selected.accessMode === 'nfc') {
      modeEl.textContent = 'Function: NFC tag';
      if (programNfcLink) {
        programNfcLink.hidden = false;
      }
      if (myNfcLink) {
        myNfcLink.hidden = false;
      }
    } else {
      modeEl.textContent = 'No function set — choose Password or NFC when creating a claw';
    }
  }

  if (window.ClawContext) {
    ClawContext.initBackLinks();
  }
})();
