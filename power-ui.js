(() => {
  'use strict';

  const SERVICE_UUID = '7b7e1000-6f1d-4f35-9f55-42494b45434f';
  const COMMAND_UUID = '7b7e1001-6f1d-4f35-9f55-42494b45434f';
  const STATUS_UUID = '7b7e1002-6f1d-4f35-9f55-42494b45434f';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  let device = null;
  let command = null;
  let statusChar = null;
  let attachTimer = null;
  let refreshTimer = null;
  let refreshPending = false;

  function $(id) { return document.getElementById(id); }

  function renderDisconnected() {
    const battery = $('batteryStatus');
    if (battery) {
      battery.textContent = 'Battery: —';
      battery.dataset.level = '';
    }
    const power = $('powerOff');
    if (power) power.disabled = true;
  }

  function parseInfo(text) {
    const battery = $('batteryStatus');
    if (!battery) return;
    const percent = text.match(/(?:^|,)BAT=(\d{1,3})(?:,|$)/);
    const mv = text.match(/(?:^|,)VBAT=(\d+)(?:,|$)/);
    const charging = text.match(/(?:^|,)CHG=([^,]+)(?:,|$)/);
    if (!percent && !mv) return;
    const p = percent ? Math.max(0, Math.min(100, Number(percent[1]))) : null;
    const volts = mv ? (Number(mv[1]) / 1000).toFixed(2) : null;
    let label = p !== null ? `Battery: ${p}%` : `Battery: ${volts} V`;
    if (p !== null && volts) label += ` · ${volts} V`;
    if (charging && /^(?:1|charging|yes)$/i.test(charging[1])) label += ' · charging';
    battery.textContent = label;
    battery.dataset.level = p === null ? '' : p <= 15 ? 'critical' : p <= 30 ? 'low' : 'ok';
  }

  function onStatus(event) {
    try { parseInfo(dec.decode(event.target.value)); } catch (_) {}
  }

  async function writeCommand(text) {
    if (!device?.gatt?.connected || !command) throw new Error('Bike Coach is not connected.');
    const bytes = enc.encode(text);
    if (command.properties.writeWithoutResponse && command.writeValueWithoutResponse) {
      await command.writeValueWithoutResponse(bytes);
    } else if (command.writeValueWithResponse) {
      await command.writeValueWithResponse(bytes);
    } else {
      await command.writeValue(bytes);
    }
  }

  async function refreshBattery() {
    if (refreshPending || !device?.gatt?.connected || !command) return;
    refreshPending = true;
    try { await writeCommand('INFO'); } catch (_) {} finally { refreshPending = false; }
  }

  async function attachCharacteristics() {
    if (!device?.gatt?.connected || command || statusChar) return;
    try {
      const service = await device.gatt.getPrimaryService(SERVICE_UUID);
      command = await service.getCharacteristic(COMMAND_UUID);
      statusChar = await service.getCharacteristic(STATUS_UUID);
      statusChar.addEventListener('characteristicvaluechanged', onStatus);
      if (!statusChar.properties.notify || await statusChar.startNotifications()) {
        $('powerOff') && ($('powerOff').disabled = false);
        setTimeout(refreshBattery, 1500);
        clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshBattery, 60000);
      }
    } catch (_) {
      command = null;
      statusChar = null;
    }
  }

  function captureDevice(selected) {
    device = selected;
    command = null;
    statusChar = null;
    if (!device) return;
    device.addEventListener('gattserverdisconnected', () => {
      command = null;
      statusChar = null;
      clearInterval(refreshTimer);
      renderDisconnected();
    });
    clearInterval(attachTimer);
    attachTimer = setInterval(() => {
      if (device?.gatt?.connected) attachCharacteristics();
    }, 250);
  }

  function installBluetoothCapture() {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth || typeof bluetooth.requestDevice !== 'function') return;
    const original = bluetooth.requestDevice.bind(bluetooth);
    try {
      bluetooth.requestDevice = async options => {
        const selected = await original(options);
        captureDevice(selected);
        return selected;
      };
    } catch (_) {
      // Some browsers expose requestDevice as read-only. The main app still works;
      // battery/power controls simply remain disabled in that browser.
    }
  }

  function installUi() {
    const connection = $('connection');
    if (connection && !$('batteryStatus')) {
      const battery = document.createElement('span');
      battery.id = 'batteryStatus';
      battery.textContent = 'Battery: —';
      battery.style.marginLeft = '12px';
      battery.style.fontSize = '13px';
      connection.insertAdjacentElement('afterend', battery);
    }

    const advanced = $('advanced');
    if (advanced && !$('powerOff')) {
      const details = document.createElement('details');
      details.id = 'powerSettings';
      const summary = document.createElement('summary');
      summary.textContent = 'Device power';
      const p = document.createElement('p');
      p.textContent = 'Power off closes the current log, stops Bluetooth and sensors, and puts Bike Coach into deep sleep. Press the physical RESET button on the board to wake it.';
      const button = document.createElement('button');
      button.id = 'powerOff';
      button.className = 'quiet';
      button.textContent = 'Power Off Bike Coach';
      button.disabled = true;
      button.addEventListener('click', async () => {
        if (!device?.gatt?.connected || !command) return;
        if (!confirm('Power off Bike Coach? Press the RESET button on the board to turn it back on.')) return;
        button.disabled = true;
        try {
          await writeCommand('POWER_OFF');
          const status = $('status');
          if (status) status.textContent = 'Bike Coach is powering off. Press RESET on the board to wake it.';
        } catch (error) {
          button.disabled = false;
          const status = $('status');
          if (status) status.textContent = error.message || 'Could not power off Bike Coach.';
        }
      });
      details.append(summary, p, button);
      advanced.append(details);
    }
    renderDisconnected();
  }

  installBluetoothCapture();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installUi, {once: true});
  else installUi();
})();
