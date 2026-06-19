(function (global) {
  var SERVICE_UUID = '12345678-1234-1234-1234-123456789010';
  var TX_UUID = '87654321-4321-4321-4321-210987654321';
  var RX_UUID = '11111111-2222-3333-4444-555555555555';
  var DEVICE_NAME = 'CLAWEmit';

  function waitForLine(expectedPrefix, txCharacteristic, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        txCharacteristic.removeEventListener('characteristicvaluechanged', onNotify);
        reject(new Error('Emitter BLE timeout'));
      }, timeoutMs || 8000);

      function onNotify(event) {
        var decoder = new TextDecoder('utf-8');
        var message = decoder.decode(event.target.value).trim();
        if (message.indexOf(expectedPrefix) === 0 || message === 'ACK|SET_SIGNAL') {
          clearTimeout(timer);
          txCharacteristic.removeEventListener('characteristicvaluechanged', onNotify);
          resolve(message);
        }
      }

      txCharacteristic.addEventListener('characteristicvaluechanged', onNotify);
    });
  }

  async function syncEmitter(name, description) {
    if (!navigator.bluetooth) {
      return false;
    }

    var device = await navigator.bluetooth.requestDevice({
      filters: [
        { name: DEVICE_NAME },
        { namePrefix: 'CLAWEmit' }
      ],
      optionalServices: [SERVICE_UUID]
    });

    await device.gatt.connect();
    var service = await device.gatt.getPrimaryService(SERVICE_UUID);
    var txChar = await service.getCharacteristic(TX_UUID);
    var rxChar = await service.getCharacteristic(RX_UUID);

    await txChar.startNotifications();
    var command = 'SET_SIGNAL|' + name + '|' + description;
    var ackPromise = waitForLine('ACK|SET_SIGNAL', txChar, 10000);
    var encoder = new TextEncoder();
    await rxChar.writeValue(encoder.encode(command));
    await ackPromise;

    if (device.gatt.connected) {
      device.gatt.disconnect();
    }
    return true;
  }

  global.ClawSignalEmitter = {
    syncEmitter: syncEmitter
  };
})(window);
