(function () {
  var TYPE_META = {
    url: {
      title: 'URL',
      subtitle: 'Open a link when the tag is scanned.',
      fields: [
        { id: 'url', label: 'url', type: 'url', placeholder: 'https://claw.app', required: true },
      ],
      buildPayload: function (values) {
        return ClawNfc.buildUrlPayload(values.url);
      },
    },
    text: {
      title: 'Text',
      subtitle: 'Plain text shown on scan.',
      fields: [
        { id: 'text', label: 'text', type: 'text', placeholder: 'Bonjour', required: true },
      ],
      buildPayload: function (values) {
        return ClawNfc.buildTextPayload(values.text);
      },
    },
    contact: {
      title: 'Contact',
      subtitle: 'vCard contact card.',
      fields: [
        { id: 'name', label: 'name', type: 'text', placeholder: 'Laurine', required: true },
        { id: 'phone', label: 'phone', type: 'tel', placeholder: '+41 79 000 00 00' },
        { id: 'email', label: 'email', type: 'email', placeholder: 'hello@claw.app' },
      ],
      buildPayload: function (values) {
        return ClawNfc.buildContactPayload(values.name, values.phone, values.email);
      },
    },
    wifi: {
      title: 'WiFi',
      subtitle: 'Network credentials (SSID;password).',
      fields: [
        { id: 'ssid', label: 'ssid', type: 'text', placeholder: 'MonWifi', required: true },
        { id: 'password', label: 'password', type: 'password', placeholder: 'motdepasse' },
      ],
      buildPayload: function (values) {
        return ClawNfc.buildWifiPayload(values.ssid, values.password);
      },
    },
  };

  var params = new URLSearchParams(window.location.search);
  var type = params.get('type') || 'text';
  var meta = TYPE_META[type];

  if (!meta) {
    window.location.replace('nfc-home.html');
    return;
  }

  var titleEl = document.getElementById('nfc-title');
  var subtitleEl = document.getElementById('nfc-subtitle');
  var fieldsEl = document.getElementById('nfc-fields');
  var statusEl = document.getElementById('nfc-status');
  var connectBtn = document.getElementById('nfc-connect-btn');
  var programBtn = document.getElementById('nfc-program-btn');
  var form = document.getElementById('nfc-form');

  titleEl.textContent = meta.title;
  subtitleEl.textContent = meta.subtitle;

  meta.fields.forEach(function (field) {
    var fieldset = document.createElement('fieldset');
    fieldset.className = 'signal-field';
    fieldset.innerHTML =
      '<legend class="signal-field__label">' + field.label + '</legend>' +
      '<input class="signal-input" id="nfc-' + field.id + '" name="' + field.id + '" type="' + field.type + '" placeholder="' + field.placeholder + '"' +
      (field.required ? ' required' : '') + '>';
    fieldsEl.appendChild(fieldset);
  });

  var titleFieldset = document.createElement('fieldset');
  titleFieldset.className = 'signal-field';
  titleFieldset.innerHTML =
    '<legend class="signal-field__label">title (saved in library)</legend>' +
    '<input class="signal-input" id="nfc-label" name="label" type="text" placeholder="e.g. My website link">';
  fieldsEl.appendChild(titleFieldset);

  function refreshStatus() {
    if (!window.ClawBle) {
      statusEl.textContent = 'BLE not available';
      programBtn.disabled = true;
      return;
    }
    if (ClawBle.isConnected()) {
      var name = ClawBle.getDeviceName() || 'XIAO';
      if (!ClawBle.isNfcDevice()) {
        statusEl.textContent = 'Connected to ' + name + ' — use XIAONFC for NFC';
        programBtn.disabled = true;
        connectBtn.textContent = 'Connect XIAO NFC';
        return;
      }
      statusEl.textContent = 'Connected to ' + name;
      programBtn.disabled = false;
      connectBtn.textContent = 'Disconnect';
    } else {
      statusEl.textContent = 'Not connected — tap Connect XIAO NFC';
      programBtn.disabled = true;
      connectBtn.textContent = 'Connect XIAO NFC';
    }
  }

  function readValues() {
    var values = {};
    meta.fields.forEach(function (field) {
      var input = document.getElementById('nfc-' + field.id);
      values[field.id] = input ? input.value.trim() : '';
    });
    return values;
  }

  connectBtn.addEventListener('click', function () {
    if (!window.ClawBle) {
      alert('Web Bluetooth is not available.');
      return;
    }
    if (ClawBle.isConnected()) {
      ClawBle.disconnect();
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    var connectPromise = ClawBle.connectNfc ? ClawBle.connectNfc() : ClawBle.connect();
    connectPromise
      .catch(function (err) {
        alert('Could not connect: ' + err.message);
      })
      .finally(function () {
        connectBtn.disabled = false;
        refreshStatus();
      });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!window.ClawBle || !ClawNfc) {
      return;
    }

    var values = readValues();
    for (var i = 0; i < meta.fields.length; i++) {
      var field = meta.fields[i];
      if (field.required && !values[field.id]) {
        document.getElementById('nfc-' + field.id).focus();
        return;
      }
    }

    var payload = meta.buildPayload(values);
    var command = ClawNfc.buildSetNfcCommand(type, payload);

    programBtn.disabled = true;
    programBtn.textContent = 'Programming…';
    statusEl.textContent = 'Sending to XIAO…';

    function sendCommand() {
      if (ClawBle.requireNfcDevice) {
        ClawBle.requireNfcDevice();
      } else if (!ClawBle.isConnected()) {
        throw new Error('Not connected to XIAO NFC');
      }

      if (ClawBle.isConnected()) {
        return ClawBle.sendAndWaitForAck(command, 'ACK|SET_NFC', 15000);
      }
      return ClawBle.restoreConnection().then(function (ok) {
        if (!ok) {
          throw new Error('Not connected to XIAO NFC');
        }
        if (ClawBle.requireNfcDevice) {
          ClawBle.requireNfcDevice();
        }
        return ClawBle.sendAndWaitForAck(command, 'ACK|SET_NFC', 15000);
      });
    }

    sendCommand()
      .then(function () {
        var titleInput = document.getElementById('nfc-label');
        var title = titleInput && titleInput.value.trim();
        if (!title && window.ClawNfcStorage) {
          title = ClawNfcStorage.defaultTitle(type, payload);
        }
        if (window.ClawNfcStorage && window.ClawStorage) {
          var saved = ClawNfcStorage.saveNfcConfig({ title: title, type: type, payload: payload });
          if (saved) {
            ClawStorage.setActiveNfcId(ClawStorage.getSelectedId(), saved.id);
          }
        }
        statusEl.textContent = 'NFC programmed and saved — scan with your phone';
        programBtn.textContent = 'Program NFC tag';
      })
      .catch(function (err) {
        statusEl.textContent = 'Failed: ' + err.message;
        programBtn.textContent = 'Program NFC tag';
        alert('NFC programming failed: ' + err.message);
      })
      .finally(function () {
        programBtn.disabled = !ClawBle.isConnected();
      });
  });

  if (window.ClawBle) {
    ClawBle.onConnectionChange(refreshStatus);
    ClawBle.restoreConnection().finally(refreshStatus);
  } else {
    refreshStatus();
  }
})();
