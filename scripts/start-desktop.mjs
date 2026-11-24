import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(require('electron'), ['.'], { env, stdio: 'inherit', shell: false });
child.on('error', () => { console.error('데스크톱 실행 실패. npm ci와npm run build를 확인하세요.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
