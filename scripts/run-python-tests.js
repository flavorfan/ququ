const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';

function resolvePythonPath() {
  const candidates = isWindows
    ? [
        path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
        path.join(projectRoot, 'python', 'Scripts', 'python.exe'),
        'python',
      ]
    : [
        path.join(projectRoot, '.venv', 'bin', 'python3'),
        path.join(projectRoot, '.venv', 'bin', 'python'),
        path.join(projectRoot, 'python', 'bin', 'python3.11'),
        'python3',
        'python',
      ];

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return isWindows ? 'python' : 'python3';
}

const pythonPath = resolvePythonPath();
const pythonProcess = spawn(pythonPath, ['-m', 'pytest', 'tests/py'], {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
});

pythonProcess.on('close', (code) => {
  process.exit(code ?? 1);
});

pythonProcess.on('error', (error) => {
  console.error(`Failed to run Python tests with ${pythonPath}: ${error.message}`);
  process.exit(1);
});
