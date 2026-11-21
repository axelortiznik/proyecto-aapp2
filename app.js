let html5QrCode = null;
let currentTablet = null;

const ESTADO_LABELS = {
  EN_PANOL: { text: 'En Pañol', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' },
  USO_LOCAL: { text: 'En Uso Local (Oficina)', cls: 'bg-sky-500/20 text-sky-300 border border-sky-500/40' },
  USO_EXTERNO: { text: 'En Uso Externo (Home Office)', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
  SERVICIO_TECNICO: { text: 'En Servicio Técnico', cls: 'bg-rose-500/20 text-rose-300 border border-rose-500/40' }
};

function showAlert(msg, type = 'info') {
  const box = document.getElementById('global-alert');
  const styles = {
    info: 'bg-slate-900 border-slate-700 text-slate-200',
    success: 'bg-emerald-950 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950 border-rose-500 text-rose-200'
  };
  box.className = `p-3.5 rounded-xl border text-sm font-medium ${styles[type] || styles.info}`;
  box.textContent = msg;
  box.classList.remove('hidden');
}

function hideAlert() {
  document.getElementById('global-alert').classList.add('hidden');
}

function showSection(name) {
  ['home', 'scanner', 'detail', 'alta'].forEach((sec) => {
    document.getElementById(`sec-${sec}`).classList.toggle('hidden', sec !== name);
  });
  if (name === 'home') {
    refreshDashboard();
  }
}

function refreshDashboard() {
  const c = PañolDB.getCountsByEstado();
  document.getElementById('cnt-panol').textContent = c.EN_PANOL;
  document.getElementById('cnt-local').textContent = c.USO_LOCAL;
  document.getElementById('cnt-externo').textContent = c.USO_EXTERNO;
  document.getElementById('cnt-taller').textContent = c.SERVICIO_TECNICO;
}

async function openScanner() {
  hideAlert();
  showSection('scanner');

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode('qr-reader');
  }

  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 230, height: 230 } },
      (decodedText) => {
        handleScannedPayload(decodedText);
      },
      () => {}
    );
  } catch (err) {
    showAlert('No se pudo abrir la cámara. Podés usar el ingreso manual por serie abajo.', 'error');
  }
}

async function stopScannerAndHome() {
  if (html5QrCode && html5QrCode.isScanning) {
    try {
      await html5QrCode.stop();
    } catch (_) {}
  }
  showSection('home');
}

async function handleScannedPayload(rawText) {
  if (html5QrCode && html5QrCode.isScanning) {
    try {
      await html5QrCode.stop();
    } catch (_) {}
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || !parsed.serie) {
      throw new Error('El QR no contiene el campo "serie".');
    }
    const tablet = PañolDB.upsertTabletFromData(parsed, 'EN_PANOL');
    renderTabletDetail(tablet);
  } catch (e) {
    showAlert(`QR inválido o sin formato de tablet: ${e.message}`, 'error');
    showSection('home');
  }
}

function buscarPorSerieManual() {
  hideAlert();
  const serie = document.getElementById('manual-serie-input').value.trim();
  if (!serie) {
    showAlert('Ingresá un número de serie para buscar.', 'error');
    return;
  }
  const tablet = PañolDB.getTabletBySerie(serie);
  if (!tablet) {
    showAlert(`No se encontró ninguna tablet con serie "${serie.toUpperCase()}".`, 'error');
    return;
  }
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().catch(() => {});
  }
  renderTabletDetail(tablet);
}

function renderTabletDetail(tablet) {
  currentTablet = tablet;
  showSection('detail');

  document.getElementById('det-serie').textContent = tablet.serie;
  const badge = document.getElementById('det-estado-badge');
  const st = ESTADO_LABELS[tablet.estado] || { text: tablet.estado, cls: 'bg-slate-700 text-white' };
  badge.textContent = st.text;
  badge.className = `px-3 py-1 rounded-full text-xs font-bold ${st.cls}`;

  const specs = [
    ['Procesador', tablet.cpu],
    ['Memoria RAM', tablet.ram],
    ['Almacenamiento', tablet.almacenamiento],
    ['Pantalla', tablet.pantalla],
    ['Puertos', tablet.puertos],
    ['Conectividad', tablet.conectividad]
  ];

  document.getElementById('det-specs').innerHTML = specs
    .map(
      ([k, v]) =>
        `<div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
           <span class="text-slate-400 block">${k}</span>
           <span class="text-slate-100 font-medium">${v}</span>
         </div>`
    )
    .join('');

  const boxDespacho = document.getElementById('box-despacho');
  const boxDevolucion = document.getElementById('box-devolucion');

  if (tablet.estado === 'EN_PANOL') {
    boxDespacho.classList.remove('hidden');
    boxDevolucion.classList.add('hidden');
    document.getElementById('inp-legajo').value = '';
    document.getElementById('sel-modalidad').value = 'LOCAL';
    document.getElementById('inp-tarea').value = '';
    validarFormularioDespacho();
  } else if (tablet.estado === 'USO_LOCAL' || tablet.estado === 'USO_EXTERNO') {
    boxDespacho.classList.add('hidden');
    boxDevolucion.classList.remove('hidden');
    document.getElementById('chk-danada').checked = false;
    const mov = PañolDB.getActiveMovimiento(tablet.serie);
    document.getElementById('dev-info-prestamo').textContent = mov
      ? `En poder de legajo ${mov.legajo_empleado} (${mov.modalidad})${mov.tarea_asignada ? ` — Tarea: ${mov.tarea_asignada}` : ''}.`
      : 'Dispositivo actualmente en préstamo.';
  } else {
    boxDespacho.classList.add('hidden');
    boxDevolucion.classList.add('hidden');
  }
}

function validarFormularioDespacho() {
  const modalidad = document.getElementById('sel-modalidad').value;
  const tarea = document.getElementById('inp-tarea').value.trim();
  const warn = document.getElementById('home-office-warning');
  const btn = document.getElementById('btn-confirmar-despacho');

  const esHomeOfficeSinTarea = modalidad === 'HOME_OFFICE' && tarea === '';
  warn.classList.toggle('hidden', !esHomeOfficeSinTarea);
  btn.disabled = esHomeOfficeSinTarea;
}

function confirmarDespacho() {
  hideAlert();
  try {
    const actualizada = PañolDB.despacharTablet({
      serie: currentTablet.serie,
      legajo: document.getElementById('inp-legajo').value,
      modalidad: document.getElementById('sel-modalidad').value,
      tarea: document.getElementById('inp-tarea').value
    });
    showAlert(`Tablet ${actualizada.serie} despachada correctamente.`, 'success');
    renderTabletDetail(actualizada);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function confirmarDevolucion() {
  hideAlert();
  try {
    const danada = document.getElementById('chk-danada').checked;
    const actualizada = PañolDB.devolverTablet({
      serie: currentTablet.serie,
      danada
    });
    showAlert(
      danada
        ? `Devolución registrada: ${actualizada.serie} pasó a Servicio Técnico.`
        : `Devolución registrada: ${actualizada.serie} reingresó En Pañol.`,
      'success'
    );
    renderTabletDetail(actualizada);
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

function registrarAltaTablet() {
  hideAlert();
  const payload = {
    serie: document.getElementById('alta-serie').value.trim().toUpperCase(),
    cpu: document.getElementById('alta-cpu').value.trim(),
    ram: document.getElementById('alta-ram').value.trim(),
    almacenamiento: document.getElementById('alta-alm').value.trim(),
    pantalla: document.getElementById('alta-pantalla').value.trim(),
    puertos: document.getElementById('alta-puertos').value.trim(),
    conectividad: document.getElementById('alta-redes').value.trim()
  };

  if (!payload.serie || !payload.cpu || !payload.ram || !payload.almacenamiento || !payload.pantalla || !payload.puertos || !payload.conectividad) {
    showAlert('Completá todos los campos técnicos obligatorios para registrar la tablet.', 'error');
    return;
  }

  try {
    PañolDB.upsertTabletFromData(payload, 'EN_PANOL');
    const jsonStr = JSON.stringify(payload, null, 2);

    const qrBox = document.getElementById('qr-output-box');
    const qrCanvas = document.getElementById('qr-canvas');
    qrCanvas.innerHTML = '';
    new QRCode(qrCanvas, {
      text: JSON.stringify(payload),
      width: 180,
      height: 180
    });

    document.getElementById('qr-json-preview').textContent = jsonStr;
    qrBox.classList.remove('hidden');
    showAlert(`Tablet ${payload.serie} registrada En Pañol con su código QR.`, 'success');
  } catch (e) {
    showAlert(e.message, 'error');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  await PañolDB.init();
  refreshDashboard();
});