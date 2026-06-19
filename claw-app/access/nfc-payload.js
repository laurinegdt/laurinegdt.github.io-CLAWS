(function (global) {
  function joinFields(fields) {
    return fields.map(function (value) {
      return String(value || '').replace(/;/g, ',');
    }).join(';');
  }

  function buildSetNfcCommand(type, payload) {
    return 'SET_NFC|' + type + '|' + payload;
  }

  function buildUrlPayload(url) {
    return url.trim();
  }

  function buildTextPayload(text) {
    return text;
  }

  function buildContactPayload(name, phone, email) {
    return joinFields([name, phone, email]);
  }

  function buildWifiPayload(ssid, password) {
    return joinFields([ssid, password]);
  }

  global.ClawNfc = {
    buildSetNfcCommand: buildSetNfcCommand,
    buildUrlPayload: buildUrlPayload,
    buildTextPayload: buildTextPayload,
    buildContactPayload: buildContactPayload,
    buildWifiPayload: buildWifiPayload,
  };
})(window);
