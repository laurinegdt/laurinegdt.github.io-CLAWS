(function (global) {
  var TYPE_LABELS = {
    url: 'URL',
    text: 'Text',
    contact: 'Contact',
    wifi: 'WiFi'
  };

  function getSelectedClawId() {
    if (!global.ClawStorage || !ClawStorage.getSelectedId()) {
      return null;
    }
    return ClawStorage.getSelectedId();
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || type;
  }

  function previewPayload(type, payload) {
    if (!payload) {
      return '';
    }
    if (type === 'url') {
      return payload;
    }
    if (type === 'text') {
      return payload.length > 48 ? payload.slice(0, 48) + '…' : payload;
    }
    if (type === 'wifi') {
      var parts = payload.split(';');
      return parts[0] ? 'SSID: ' + parts[0] : payload;
    }
    if (type === 'contact') {
      var name = payload.split(';')[0];
      return name || 'Contact';
    }
    return payload;
  }

  function defaultTitle(type, payload) {
    var label = typeLabel(type);
    var preview = previewPayload(type, payload);
    if (type === 'url') {
      preview = preview.replace(/^https?:\/\//, '').slice(0, 32);
    } else {
      preview = preview.slice(0, 32);
    }
    return label + ' · ' + preview;
  }

  function getNfcConfigs() {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return [];
    }
    return ClawStorage.getClawNfcConfigs(clawId);
  }

  function saveNfcConfig(entry) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    return ClawStorage.saveClawNfcConfig(clawId, entry);
  }

  function deleteNfcConfig(id) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return;
    }
    ClawStorage.deleteClawNfcConfig(clawId, id);
  }

  function getActiveNfc() {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    return ClawStorage.getActiveNfc(clawId);
  }

  function setActiveNfc(id) {
    var clawId = getSelectedClawId();
    if (!clawId) {
      return null;
    }
    return ClawStorage.setActiveNfcId(clawId, id);
  }

  function buildBleCommand(config) {
    if (!global.ClawNfc || !config) {
      return null;
    }
    return ClawNfc.buildSetNfcCommand(config.type, config.payload);
  }

  function syncToDevice(config) {
    if (!global.ClawBle) {
      return Promise.resolve(false);
    }
    if (global.ClawBle.requireNfcDevice) {
      try {
        ClawBle.requireNfcDevice();
      } catch (err) {
        return Promise.resolve(false);
      }
    }
    var nfc = config || getActiveNfc();
    if (!nfc) {
      return Promise.resolve(false);
    }
    var command = buildBleCommand(nfc);
    if (!command) {
      return Promise.resolve(false);
    }

    function trySync() {
      if (!ClawBle.isConnected()) {
        return ClawBle.restoreConnection().then(function (ok) {
          if (!ok) {
            return false;
          }
          return ClawBle.sendAndWaitForAck(command, 'ACK|SET_NFC', 15000).then(function () {
            return true;
          });
        });
      }
      return ClawBle.sendAndWaitForAck(command, 'ACK|SET_NFC', 15000).then(function () {
        return true;
      });
    }

    return trySync().catch(function () {
      return false;
    });
  }

  global.ClawNfcStorage = {
    typeLabel: typeLabel,
    previewPayload: previewPayload,
    defaultTitle: defaultTitle,
    getNfcConfigs: getNfcConfigs,
    saveNfcConfig: saveNfcConfig,
    deleteNfcConfig: deleteNfcConfig,
    getActiveNfc: getActiveNfc,
    setActiveNfc: setActiveNfc,
    buildBleCommand: buildBleCommand,
    syncToDevice: syncToDevice
  };
})(window);
