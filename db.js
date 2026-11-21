const STORAGE_KEY = 'panol_app_sqlite_b64';

const PañolDB = (() => {
  let SQL = null;
  let db = null;

  function uint8ToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToUint8(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function init() {
    SQL = await initSqlJs({
      locateFile: (file) => `https://github.com/axelortiznik/proyecto-aapp2.git${file}`
    });

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      db = new SQL.Database(base64ToUint8(saved));
    } else {
      db = new SQL.Database();
      createSchema();
      seedInitialData();
      persist();
    }
    return db;
  }

  function createSchema() {
    db.run(`
      CREATE TABLE IF NOT EXISTS tablets (
        serie TEXT PRIMARY KEY,
        cpu TEXT NOT NULL,
        ram TEXT NOT NULL,
        almacenamiento TEXT NOT NULL,
        pantalla TEXT NOT NULL,
        puertos TEXT NOT NULL,
        conectividad TEXT NOT NULL,
        estado TEXT NOT NULL
      );
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS movimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serie TEXT NOT NULL,
        legajo_empleado TEXT NOT NULL,
        modalidad TEXT NOT NULL,
        tarea_asignada TEXT,
        fecha_salida TEXT NOT NULL,
        fecha_devolucion TEXT,
        estado_fisico_retorno TEXT,
        FOREIGN KEY (serie) REFERENCES tablets (serie)
      );
    `);
  }

  function seedInitialData() {
    const muestras = [
      {
        serie: 'TAB-001',
        cpu: 'Snapdragon 680',
        ram: '4GB',
        almacenamiento: '64GB',
        pantalla: '10.4"',
        puertos: 'USB-C, Jack 3.5mm',
        conectividad: 'Wi-Fi, Bluetooth 5.1, 4G',
        estado: 'EN_PANOL'
      },
      {
        serie: 'TAB-002',
        cpu: 'MediaTek Helio G99',
        ram: '6GB',
        almacenamiento: '128GB',
        pantalla: '11"',
        puertos: 'USB-C',
        conectividad: 'Wi-Fi 6, Bluetooth 5.2',
        estado: 'USO_EXTERNO'
      }
    ];

    muestras.forEach((t) => {
      db.run(
        `INSERT OR IGNORE INTO tablets (serie, cpu, ram, almacenamiento, pantalla, puertos, conectividad, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [t.serie, t.cpu, t.ram, t.almacenamiento, t.pantalla, t.puertos, t.conectividad, t.estado]
      );
    });

    db.run(
      `INSERT INTO movimientos (serie, legajo_empleado, modalidad, tarea_asignada, fecha_salida)
       VALUES ('TAB-002', 'LEG-408', 'HOME_OFFICE', 'Relevamiento remoto de inventario', ?);`,
      [new Date().toISOString()]
    );
  }

  function persist() {
    if (!db) return;
    const data = db.export();
    localStorage.setItem(STORAGE_KEY, uint8ToBase64(data));
  }

  function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  function getCountsByEstado() {
    const rows = queryAll(`SELECT estado, COUNT(*) AS total FROM tablets GROUP BY estado;`);
    const counts = {
      EN_PANOL: 0,
      USO_LOCAL: 0,
      USO_EXTERNO: 0,
      SERVICIO_TECNICO: 0
    };
    rows.forEach((r) => {
      counts[r.estado] = r.total;
    });
    return counts;
  }

  function getTabletBySerie(serie) {
    const clean = (serie || '').trim().toUpperCase();
    const rows = queryAll(`SELECT * FROM tablets WHERE UPPER(serie) = ? LIMIT 1;`, [clean]);
    return rows[0] || null;
  }

  function getActiveMovimiento(serie) {
    const rows = queryAll(
      `SELECT * FROM movimientos WHERE serie = ? AND fecha_devolucion IS NULL ORDER BY id DESC LIMIT 1;`,
      [serie]
    );
    return rows[0] || null;
  }

  function upsertTabletFromData(data, estadoInicial = 'EN_PANOL') {
    const serie = (data.serie || '').trim().toUpperCase();
    const existente = getTabletBySerie(serie);
    if (existente) {
      return existente;
    }

    db.run(
      `INSERT INTO tablets (serie, cpu, ram, almacenamiento, pantalla, puertos, conectividad, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        serie,
        data.cpu || 'No especificado',
        data.ram || 'No especificado',
        data.almacenamiento || 'No especificado',
        data.pantalla || 'No especificado',
        data.puertos || 'No especificado',
        data.conectividad || 'No especificado',
        estadoInicial
      ]
    );
    persist();
    return getTabletBySerie(serie);
  }

  function despacharTablet({ serie, legajo, modalidad, tarea }) {
    const tablet = getTabletBySerie(serie);
    if (!tablet) {
      throw new Error('La tablet no existe en el registro local.');
    }
    if (tablet.estado !== 'EN_PANOL') {
      throw new Error(`No se puede despachar: el estado actual es ${tablet.estado}.`);
    }

    const legajoLimpio = (legajo || '').trim();
    const tareaLimpia = (tarea || '').trim();

    if (!legajoLimpio) {
      throw new Error('Debe ingresar el legajo del empleado.');
    }
    if (modalidad === 'HOME_OFFICE' && !tareaLimpia) {
      throw new Error('Para retirar en Home Office es obligatorio indicar una tarea asignada.');
    }

    const nuevoEstado = modalidad === 'HOME_OFFICE' ? 'USO_EXTERNO' : 'USO_LOCAL';

    db.run(
      `INSERT INTO movimientos (serie, legajo_empleado, modalidad, tarea_asignada, fecha_salida)
       VALUES (?, ?, ?, ?, ?);`,
      [tablet.serie, legajoLimpio, modalidad, tareaLimpia || null, new Date().toISOString()]
    );

    db.run(`UPDATE tablets SET estado = ? WHERE serie = ?;`, [nuevoEstado, tablet.serie]);
    persist();
    return getTabletBySerie(tablet.serie);
  }

  function devolverTablet({ serie, danada }) {
    const tablet = getTabletBySerie(serie);
    if (!tablet) {
      throw new Error('Tablet no encontrada.');
    }

    const movActivo = getActiveMovimiento(tablet.serie);
    if (movActivo) {
      db.run(
        `UPDATE movimientos
         SET fecha_devolucion = ?, estado_fisico_retorno = ?
         WHERE id = ?;`,
        [new Date().toISOString(), danada ? 'DANADA' : 'SANA', movActivo.id]
      );
    }

    const estadoFinal = danada ? 'SERVICIO_TECNICO' : 'EN_PANOL';
    db.run(`UPDATE tablets SET estado = ? WHERE serie = ?;`, [estadoFinal, tablet.serie]);
    persist();
    return getTabletBySerie(tablet.serie);
  }

  return {
    init,
    getCountsByEstado,
    getTabletBySerie,
    getActiveMovimiento,
    upsertTabletFromData,
    despacharTablet,
    devolverTablet
  };
})();