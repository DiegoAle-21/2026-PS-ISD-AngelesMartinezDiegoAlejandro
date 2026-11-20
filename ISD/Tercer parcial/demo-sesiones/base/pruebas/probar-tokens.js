const assert = require('node:assert/strict');
const { crearApp } = require('../app');
const { crearModeloTokens } = require('../modelos/tokens.modelo');
const config = require('../config');

async function main() {
  const filas = [];
  const consultas = [];
  const pool = {
    async query(sql, parametros = []) {
      consultas.push(sql);
      if (sql.startsWith('INSERT IGNORE INTO tokens_revocados')) {
        filas.push({
          jti: parametros[0],
          usuario: parametros[1],
          expira: new Date(parametros[2] * 1000),
          revocado_en: new Date(),
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT jti, usuario, expira, revocado_en')) return [filas];
      throw new Error(`Consulta no esperada en prueba: ${sql}`);
    },
  };

  const tokens = crearModeloTokens(pool);
  const tokenVencido = Math.floor(Date.now() / 1000) - 60;
  await tokens.revocar('jti-vencido', 'ana', tokenVencido);
  await tokens.revocar('jti-activo', 'luis', tokenVencido + 3600);

  assert.equal(filas.length, 2, 'se conserva el token vencido tras registrar una revocación posterior');
  assert.equal(consultas.some((sql) => sql.startsWith('DELETE FROM tokens_revocados')), false);

  const app = crearApp({ ...config, almacen: 'memoria' }, pool);
  const servidor = await new Promise((resolve) => {
    const instancia = app.listen(0, () => resolve(instancia));
  });
  try {
    const respuesta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/diagnostico/tokens`);
    const datos = await respuesta.json();
    assert.equal(respuesta.status, 200);
    assert.equal(datos.revocados.length, 2);
    assert.equal(datos.revocados.find((token) => token.jti === 'jti-venc…').estado, 'vencido');
    assert.equal(datos.revocados.find((token) => token.jti === 'jti-acti…').estado, 'revocado');
  } finally {
    await new Promise((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
  }

  console.log('Prueba de historial y visualización de tokens revocados: correcta.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
