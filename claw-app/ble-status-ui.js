(function (global) {
  function mountClawBleChip() {
    if (document.getElementById('claw-ble-chip')) {
      return;
    }

    var chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'claw-ble-chip';
    chip.className = 'claw-ble-chip claw-ble-chip--off';
    chip.innerHTML =
      '<span class="claw-ble-chip__dot" aria-hidden="true"></span>' +
      '<span class="claw-ble-chip__label">CLAW</span>';

    document.body.appendChild(chip);

    if (!global.ClawBle) {
      chip.classList.add('claw-ble-chip--unsupported');
      chip.title = 'Bluetooth not available';
      chip.setAttribute('aria-label', 'CLAW Bluetooth not available');
      return;
    }

    if (!navigator.bluetooth) {
      chip.classList.add('claw-ble-chip--unsupported');
      chip.title = 'Web Bluetooth not supported in this browser';
      chip.setAttribute('aria-label', 'CLAW Bluetooth not supported');
      return;
    }

    function setState(connected, deviceName) {
      var known = global.ClawBle.isKnownDevice && global.ClawBle.isKnownDevice();

      chip.classList.remove('claw-ble-chip--off', 'claw-ble-chip--on', 'claw-ble-chip--busy', 'claw-ble-chip--reconnect');
      chip.classList.add(connected ? 'claw-ble-chip--on' : (known ? 'claw-ble-chip--reconnect' : 'claw-ble-chip--off'));

      if (connected) {
        chip.title = deviceName
          ? 'Connected to ' + deviceName + ' · Tap to disconnect'
          : 'CLAW connected · Tap to disconnect';
        chip.setAttribute('aria-label', 'CLAW connected. Tap to disconnect.');
      } else if (known) {
        chip.title = 'CLAW paired · Tap to reconnect';
        chip.setAttribute('aria-label', 'CLAW paired but disconnected. Tap to reconnect.');
      } else {
        chip.title = 'CLAW not connected · Tap to connect';
        chip.setAttribute('aria-label', 'CLAW not connected. Tap to connect.');
      }
    }

    function refreshState() {
      setState(global.ClawBle.isConnected(), global.ClawBle.getDeviceName());
    }

    refreshState();
    global.ClawBle.onConnectionChange(setState);

    global.ClawBle.restoreConnection()
      .then(refreshState)
      .catch(refreshState);

    chip.addEventListener('click', function () {
      if (chip.classList.contains('claw-ble-chip--busy')) {
        return;
      }

      if (global.ClawBle.isConnected()) {
        global.ClawBle.disconnect();
        return;
      }

      chip.classList.add('claw-ble-chip--busy');
      chip.classList.remove('claw-ble-chip--off', 'claw-ble-chip--on', 'claw-ble-chip--reconnect');
      chip.title = 'Connecting…';
      chip.setAttribute('aria-label', 'Connecting to CLAW…');

      global.ClawBle.connect()
        .catch(function (err) {
          alert(
            'Could not connect: ' + err.message +
            '\n\nYour Mac may already be connected to CLAW as a keyboard (auto-reconnect on power-on).' +
            '\nOpen System Settings → Bluetooth, disconnect XIAOChat, then tap CLAW again here.' +
            '\nOr wait a few seconds and retry — the device may accept a second connection.'
          );
        })
        .finally(function () {
          chip.classList.remove('claw-ble-chip--busy');
          refreshState();
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountClawBleChip);
  } else {
    mountClawBleChip();
  }
})(window);
