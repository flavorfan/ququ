const fs = require('fs');
const os = require('os');
const path = require('path');

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'ququ-electron-user-data')),
  },
}));

const FunASRManager = require('../../../src/helpers/funasrManager');

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logFunASR: vi.fn(),
  };
}

describe('FunASRManager', () => {
  const originalPlatform = process.platform;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('ELECTRON_USER_DATA', path.join(os.tmpdir(), 'ququ-electron-user-data'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('prefers Windows embedded python executable when present', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.NODE_ENV = 'development';

    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      return String(targetPath).endsWith(path.join('python', 'Scripts', 'python.exe'));
    });

    const manager = new FunASRManager(createLogger());

    expect(manager.getEmbeddedPythonPath()).toContain(path.join('python', 'Scripts', 'python.exe'));
    expect(existsSpy).toHaveBeenCalled();
  });

  it('builds isolated environment for embedded python on Windows without PYTHONHOME', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.NODE_ENV = 'development';

    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      return String(targetPath).endsWith(path.join('python', 'Scripts', 'python.exe'));
    });

    const manager = new FunASRManager(createLogger());
    const env = manager.buildPythonEnvironment();

    expect(env.PYTHONDONTWRITEBYTECODE).toBe('1');
    expect(env.PYTHONUNBUFFERED).toBe('1');
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.ELECTRON_USER_DATA).toContain('ququ-electron-user-data');
  });

  it('reports missing model files when model cache is absent', async () => {
    const logger = createLogger();
    const manager = new FunASRManager(logger);

    vi.spyOn(manager, 'getModelCachePath').mockReturnValue(path.join(os.tmpdir(), 'missing-model-cache'));
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = await manager.checkModelFiles();

    expect(result.success).toBe(true);
    expect(result.models_downloaded).toBe(false);
    expect(result.missing_models).toEqual(['asr', 'vad', 'punc']);
  });

  it('recognizes complete model files from the cache', async () => {
    const logger = createLogger();
    const manager = new FunASRManager(logger);
    const cacheRoot = path.join(os.tmpdir(), 'funasr-model-cache');

    vi.spyOn(manager, 'getModelCachePath').mockReturnValue(cacheRoot);
    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => String(targetPath).includes('model.pt') || targetPath === cacheRoot);
    vi.spyOn(fs, 'statSync').mockImplementation((targetPath) => {
      const target = String(targetPath);
      if (target.includes('speech_paraformer')) {
        return { size: 840 * 1024 * 1024 };
      }
      if (target.includes('speech_fsmn_vad')) {
        return { size: 1.6 * 1024 * 1024 };
      }
      return { size: 278 * 1024 * 1024 };
    });

    manager._clearModelCache();

    const result = await manager.checkModelFiles();

    expect(result.models_downloaded).toBe(true);
    expect(result.missing_models).toEqual([]);
    expect(result.details.asr.complete).toBe(true);
    expect(result.details.vad.complete).toBe(true);
    expect(result.details.punc.complete).toBe(true);
  });
});