(function () {
  var pending = ClawPassword.getPendingPassword();
  if (!pending || !pending.name) {
    window.location.replace('new-password.html');
    return;
  }

  if (window.ClawStorage && !ClawStorage.requireAccessMode(null, 'password', '../my-claw/my-claws.html')) {
    return;
  }

  var MIN_GESTURES = 3;
  var MAX_GESTURES = 5;
  var gestureSequence = [];

  document.getElementById('saved-password-name').textContent = pending.name;

  var activateBy = document.getElementById('activate-by');
  var gestureSection = document.getElementById('gesture-section');
  var gestureDisplay = document.getElementById('gesture-seq-display');
  var gestureClear = document.getElementById('gesture-clear');
  var saveBtn = document.getElementById('save-btn');
  var connectBtn = document.getElementById('connect-xiao-btn');
  var bleHint = document.getElementById('ble-hint');

  function isChatReady() {
    return !!(window.ClawBle && ClawBle.isChatDevice && ClawBle.isChatDevice());
  }

  function updateBleUi() {
    var connected = isChatReady();
    if (saveBtn) {
      saveBtn.disabled = !connected;
    }
    if (bleHint) {
      if (connected) {
        bleHint.textContent = 'XIAO connected — you can save.';
      } else if (window.ClawBle && ClawBle.isConnected && ClawBle.isConnected()) {
        bleHint.textContent = 'Wrong device connected — use Connect XIAO for XIAOChat.';
      } else {
        bleHint.textContent = 'Connect your XIAO Chat before saving.';
      }
    }
    if (connectBtn) {
      connectBtn.textContent = connected ? 'XIAO connected' : 'Connect XIAO';
      connectBtn.disabled = connected;
    }
  }

  function updateGestureDisplay() {
    gestureDisplay.textContent = gestureSequence.length
      ? gestureSequence.join(' → ')
      : '—';
    gestureDisplay.className = 'gesture-seq-display' + (gestureSequence.length >= MIN_GESTURES ? ' gesture-seq-display--ok' : '');
  }

  activateBy.addEventListener('change', function () {
    var isGesture = activateBy.value === 'gesture';
    gestureSection.hidden = !isGesture;
    if (!isGesture) {
      gestureSequence = [];
      updateGestureDisplay();
    }
  });

  document.querySelectorAll('.gesture-record-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (gestureSequence.length >= MAX_GESTURES) return;
      gestureSequence.push(btn.getAttribute('data-gesture'));
      updateGestureDisplay();
    });
  });

  gestureClear.addEventListener('click', function () {
    gestureSequence = [];
    updateGestureDisplay();
  });

  if (connectBtn && window.ClawBle) {
    connectBtn.addEventListener('click', function () {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting…';
      var connectPromise = ClawBle.connectChat
        ? ClawBle.connectChat()
        : ClawBle.connect();
      connectPromise
        .catch(function (err) {
          alert(
            'Could not connect to XIAO Chat:\n\n' + err.message +
            '\n\nIf your Mac already paired XIAO as a keyboard, open System Settings → Bluetooth, disconnect XIAOChat, then try again here.'
          );
        })
        .finally(updateBleUi);
    });
    ClawBle.onConnectionChange(updateBleUi);
  }

  if (window.ClawBle) {
    var restorePromise = ClawBle.restoreChatConnection
      ? ClawBle.restoreChatConnection()
      : ClawBle.restoreConnection();
    restorePromise.finally(updateBleUi);
  } else {
    updateBleUi();
  }

  document.getElementById('activate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!isChatReady()) {
      alert('Connect your XIAO Chat first, then tap Save.');
      return;
    }
    if (!activateBy.value) {
      activateBy.focus();
      return;
    }

    if (activateBy.value === 'gesture') {
      if (gestureSequence.length < MIN_GESTURES) {
        alert('Add at least ' + MIN_GESTURES + ' gestures to your sequence.');
        return;
      }
    }

    var entry = {
      name: pending.name,
      password: pending.password,
      activateBy: activateBy.value,
      gestureSequence: activateBy.value === 'gesture' ? gestureSequence.slice() : null,
    };

    ClawPassword.savePassword(entry);

    saveBtn.disabled = true;
    saveBtn.textContent = 'Sending to XIAO…';

    var payload = ClawPassword.buildBlePayload(entry);
    ClawBle.sendAndWaitForAck(payload, 'ACK|SET_PASSWORD', 8000)
      .then(function () {
        window.location.href = '../my-claw/assign-password.html';
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        alert('BLE sync failed: ' + err.message);
      });
  });

  updateGestureDisplay();
})();
