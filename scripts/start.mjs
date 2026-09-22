#!/usr/bin/env node
/**
 * Запуск на хостинге одним приложением (Timeweb Apps):
 *   1) миграции базы, 2) воркер очереди в фоне, 3) сайт (next start на PORT).
 * Упал воркер: перезапускаем его через 5 с, сайт продолжает работать.
 * Упал сайт: выходим, хостинг перезапустит приложение целиком.
 */
import { spawn, spawnSync } from 'node:child_process';

const node = process.execPath;
const log = (...a) => console.log(new Date().toISOString(), '[start]', ...a);

const m = spawnSync(node, ['db/migrate.mjs'], { stdio: 'inherit' });
if (m.status !== 0) {
  log('миграции не применились, останавливаюсь (проверь DATABASE_URL и доступ к базе)');
  process.exit(m.status || 1);
}

let stopping = false;
let worker = null;

function startWorker() {
  worker = spawn(node, ['worker/index.mjs'], { stdio: 'inherit', env: { ...process.env, WORKER_HTTP: 'off' } });
  worker.on('exit', (code) => {
    if (stopping) return;
    log(`воркер завершился (код ${code}), перезапуск через 5 с`);
    setTimeout(startWorker, 5000);
  });
}
startWorker();

const web = spawn(node, ['node_modules/next/dist/bin/next', 'start', '-p', process.env.PORT || '3000'], { stdio: 'inherit' });
web.on('exit', (code) => {
  log(`сайт завершился (код ${code})`);
  stopping = true;
  worker?.kill('SIGTERM');
  process.exit(code ?? 1);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    stopping = true;
    worker?.kill(sig);
    web.kill(sig);
  });
}
