(function (global) {
  var SERVICE_UUID = '12345678-1234-1234-1234-123456789012';
  var TX_UUID = '87654321-4321-4321-4321-210987654321';
  var RX_UUID = '11111111-2222-3333-4444-555555555555';
  var DEVICE_NAME = 'CLAWRecv';
  var OTHER_CLAW_NAMES = ['XIAOChat', 'XIAONFC', 'CLAWEmit'];

  var device = null;
  var txChar = null;
  var rxChar = null;
  var listeners = [];
  var connected = false;

  function onDetection(listener) {
    listeners.push(listener);
  }

  function emitDetection(entry) {
    listeners.forEach(function (fn) {
      fn(entry);
    });
  }

  function parseSignalLine(message) {
    if (!message || message.indexOf('SIGNAL|') !== 0) {
      return null;
    }
    var parts = message.split('|');
    if (parts.length < 4) {
      return null;
    }
    return {
      signalId: parts[1],
      name: parts[2],
      description: parts[3]
    };
  }

  function handleNotification(event) {
    var decoder = new TextDecoder('utf-8');
    var message = decoder.decode(event.target.value).trim();
    var entry = parseSignalLine(message);
    if (entry) {
      emitDetection(entry);
    }
  }

  function onGattDisconnected() {
    connected = false;
    txChar = null;
    rxChar = null;
  }

  function isConnected() {
    return connected && device && device.gatt && device.gatt.connected;
  }

  function isClawRecvDevice(name) {
    if (!name) {
      return false;
    }
    return name === DEVICE_NAME || name.indexOf('CLAWRecv') === 0;
  }

  function isOtherClawDevice(name) {
    if (!name) {
      return false;
    }
    for (var i = 0; i < OTHER_CLAW_NAMES.length; i++) {
      if (name === OTHER_CLAW_NAMES[i] || name.indexOf(OTHER_CLAW_NAMES[i]) === 0) {
        return true;
      }
    }
    return false;
  }

  function wrongDeviceMessage(name) {
    return (
      'Wrong device: choose CLAWRecv (receiver), not ' +
      (name || 'unknown') +
      '. Flash RECEPTRICE.ino on the receiver XIAO.'
    );
  }

  function friendlyError(err) {
    if (!err) {
      return 'Unknown error';
    }
    if (err.name === 'NotFoundError') {
      return (
        'CLAWRecv not visible.\n\n' +
        '1. Flash RECEPTRICE.ino — serial must say ROLE: RECEIVER\n' +
        '2. USB plugged in OR press reset after wake\n' +
        '3. Chrome/Edge on localhost or HTTPS\n' +
        '4. Mac: remove CLAWRecv from System Settings → Bluetooth if listed there'
      );
    }
    if (err.name === 'SecurityError') {
      return 'Web Bluetooth blocked. Use Chrome or Edge on HTTPS or localhost.';
    }
    if (err.name === 'NetworkError') {
      return 'Connection lost. Move closer to the receiver and try again.';
    }
    return err.message || String(err);
  }

  async function requestReceiverDevice() {
    var strategies = [
      {
        filters: [{ services: [SERVICE_UUID], name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID]
      },
      {
        filters: [{ services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID]
      },
      {
        filters: [
          { name: DEVICE_NAME },
          { namePrefix: 'CLAWRecv' }
        ],
        optionalServices: [SERVICE_UUID]
      }
    ];

    var lastErr = null;
    for (var i = 0; i < strategies.length; i++) {
      try {
        var picked = await navigator.bluetooth.requestDevice(strategies[i]);
        if (isOtherClawDevice(picked.name) && !isClawRecvDevice(picked.name)) {
          throw new Error(wrongDeviceMessage(picked.name));
        }
        return picked;
      } catch (err) {
        if (err.message && err.message.indexOf('Wrong device') === 0) {
          throw err;
        }
        if (err.name !== 'NotFoundError') {
          throw err;
        }
        lastErr = err;
      }
    }

    var fallback = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID]
    });

    if (isClawRecvDevice(fallback.name)) {
      return fallback;
    }

    if (isOtherClawDevice(fallback.name)) {
      throw new Error(wrongDeviceMessage(fallback.name));
    }

    if (fallback.name) {
      throw new Error(wrongDeviceMessage(fallback.name));
    }

    throw lastErr || new Error(
      'Could not find CLAWRecv. Check serial says ROLE: RECEIVER and try again.'
    );
  }

  async function connectGatt(target) {
    target.removeEventListener('gattserverdisconnected', onGattDisconnected);
    target.addEventListener('gattserverdisconnected', onGattDisconnected);

    await target.gatt.connect();
    var service = await target.gatt.getPrimaryService(SERVICE_UUID);
    txChar = await service.getCharacteristic(TX_UUID);
    rxChar = await service.getCharacteristic(RX_UUID);

    await txChar.startNotifications();
    txChar.addEventListener('characteristicvaluechanged', handleNotification);

    connected = true;

    var encoder = new TextEncoder();
    await rxChar.writeValue(encoder.encode('PULL_SIGNALS'));

    return target.name || DEVICE_NAME;
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth not supported — use Chrome or Edge, not Safari');
    }

    if (isConnected()) {
      return device.name;
    }

    device = await requestReceiverDevice();

    if (isOtherClawDevice(device.name) && !isClawRecvDevice(device.name)) {
      throw new Error(wrongDeviceMessage(device.name));
    }

    try {
      return await connectGatt(device);
    } catch (err) {
      if (!isClawRecvDevice(device.name) && device.name) {
        throw new Error(wrongDeviceMessage(device.name));
      }
      throw err;
    }
  }

  async function disconnect() {
    connected = false;
    if (txChar) {
      txChar.removeEventListener('characteristicvaluechanged', handleNotification);
    }
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
    }
    txChar = null;
    rxChar = null;
  }

  function requestNotificationsPermission() {
    if (!('Notification' in window)) {
      return Promise.resolve(false);
    }
    if (Notification.permission === 'granted') {
      return Promise.resolve(true);
    }
    if (Notification.permission === 'denied') {
      return Promise.resolve(false);
    }
    return Notification.requestPermission().then(function (p) {
      return p === 'granted';
    });
  }

  function showNewSignalNotification(entry) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }
    var body = entry.name;
    if (entry.description) {
      body += '\n' + entry.description;
    }
    new Notification('New Signal', {
      body: body,
      tag: 'claw-signal-' + (entry.signalId || Date.now())
    });
  }

  global.ClawSignalBle = {
    connect: connect,
    disconnect: disconnect,
    isConnected: isConnected,
    onDetection: onDetection,
    requestNotificationsPermission: requestNotificationsPermission,
    showNewSignalNotification: showNewSignalNotification,
    friendlyError: friendlyError
  };
})(window);
